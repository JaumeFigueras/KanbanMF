import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { makeUser } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import i18n from '../i18n'
import OAuthConsent from './OAuthConsent'

const REQUEST_URL = '/api/v1/oauth/requests/:requestId'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz'

const BOARDS = [
  { id: 'board-1', name: 'Website redesign' },
  { id: 'board-2', name: 'Newsletter' },
]

// The request as GET /oauth/requests/{id} answers it: Claude, answering to
// claude.ai, and two boards of the user's own; and who you are, Emma Wilson.
function consentServer(request: Record<string, unknown> = {}, answer?: Answer, me?: Answer) {
  fakeEndpoint('get', '/api/v1/users/me', me ?? (() => HttpResponse.json(makeUser())))
  const read = fakeEndpoint('get', REQUEST_URL, answer ?? (() => HttpResponse.json({
    client_name: 'Claude',
    redirect_host: 'claude.ai',
    redirect_is_local: false,
    boards: BOARDS,
    expires_at: '2026-11-22T12:10:00Z',
    ...request,
  })))
  const approved = fakeEndpoint('post', `${REQUEST_URL}/approve`, () => HttpResponse.json({ redirect_to: CALLBACK }))
  const denied = fakeEndpoint('post', `${REQUEST_URL}/deny`, () => HttpResponse.json({ redirect_to: `${CALLBACK}&error=access_denied` }))
  return { read, approved, denied }
}

// The page asks who you are itself, and needs nothing else of the session
// (ProtectedRoute has checked it by then), so it is shown without one.
function renderConsent(search = '?request=req-1') {
  return renderWithProviders(<OAuthConsent />, { route: `/oauth/consent${search}` })
}

// Where the page sends the browser. jsdom can't leave the page, and its own
// location can't be watched, so the window gets a stand-in for the test —
// with the real address, which requests are still sent from — and the real
// one back after it.
function watchLocation() {
  const real = window.location
  const standIn = {
    href: real.href, origin: real.origin, protocol: real.protocol, host: real.host, hostname: real.hostname,
    port: real.port, pathname: real.pathname, search: real.search, hash: real.hash,
    assign: vi.fn(), replace: vi.fn(), reload: vi.fn(), toString: () => real.href,
  }
  vi.stubGlobal('location', standIn)
  onTestFinished(() => { vi.stubGlobal('location', real) })
  return standIn
}

const loaded = () => screen.findByRole('heading', { name: 'Connect Claude to KanbanMF' })
const box = (name: string) => screen.getByRole('checkbox', { name })
const button = (name: string) => screen.getByRole('button', { name })
const ALL = 'All my boards'

describe('OAuthConsent', () => {
  describe('the request', () => {
    it('shows who asks, who answers, where the answer goes, and the boards, none chosen yet', async () => {
      consentServer()
      renderConsent()

      expect(await loaded()).toBeInTheDocument()
      expect(screen.getByText(/^Claude is asking to reach your boards\./)).toBeInTheDocument()
      expect(screen.getByText('Signed in as Emma Wilson (emma.wilson@example.com).')).toBeInTheDocument()
      expect(screen.getByText('Your answer will be sent to claude.ai.')).toBeInTheDocument()
      expect(screen.queryByText(/a program on this computer/)).not.toBeInTheDocument()
      expect(box('Website redesign')).not.toBeChecked()
      expect(box('Newsletter')).not.toBeChecked()
      expect(box(ALL)).not.toBeChecked()
      expect(screen.getByRole('switch', { name: 'Read-only' })).not.toBeChecked()
      expect(screen.getByText(/^It can read these boards and add or change/)).toBeInTheDocument()
      expect(button('Allow')).toBeDisabled()
      expect(button('Deny')).toBeEnabled()
    })

    it('shows a spinner, under a title that names no app, until the request and who you are have come', async () => {
      const held = heldAnswer(() => HttpResponse.json({
        client_name: 'Claude', redirect_host: 'claude.ai', redirect_is_local: false, boards: BOARDS, expires_at: '2026-11-22T12:10:00Z',
      }))
      consentServer({}, held.answer)
      renderConsent()

      expect(await screen.findByRole('progressbar')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Connect an app to KanbanMF' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
      held.release()

      expect(await loaded()).toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('warns when the answer goes to a program on this computer', async () => {
      consentServer({ redirect_host: '127.0.0.1:33418', redirect_is_local: true })
      renderConsent()
      await loaded()

      expect(screen.getByRole('alert')).toHaveTextContent(
        'The answer goes to a program on this computer (127.0.0.1:33418). Only allow it if you started this connection yourself',
      )
    })

    it('says so when you have no boards of your own, and can still be denied', async () => {
      const server = consentServer({ boards: [] })
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()

      expect(screen.getByRole('alert')).toHaveTextContent("You don't have any boards of your own yet.")
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(button('Allow')).toBeDisabled()
      await user.click(button('Deny'))

      await waitFor(() => expect(location.assign).toHaveBeenCalledWith(`${CALLBACK}&error=access_denied`))
      expect(server.denied.requests).toHaveLength(1)
    })

    it('asks for the request named in the address', async () => {
      const server = consentServer()
      renderConsent('?request=8f0c6a1e-request')
      await loaded()

      expect(server.read.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/oauth/requests/8f0c6a1e-request'])
    })

    it('is in Catalan for a user who reads Catalan', async () => {
      await i18n.changeLanguage('ca')
      consentServer()
      renderConsent()

      expect(await screen.findByRole('heading', { name: 'Connecta Claude a KanbanMF' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Permet' })).toBeDisabled()
    })
  })

  describe('choosing the boards', () => {
    it('allows once a board is chosen, and marks "All my boards" as partly chosen', async () => {
      consentServer()
      const { user } = renderConsent()
      await loaded()

      await user.click(box('Newsletter'))

      expect(box('Newsletter')).toBeChecked()
      expect(box(ALL)).not.toBeChecked()
      expect(box(ALL)).toHaveAttribute('data-indeterminate', 'true')
      expect(button('Allow')).toBeEnabled()
      await user.click(box('Website redesign'))
      expect(box(ALL)).toBeChecked()
      expect(box(ALL)).toHaveAttribute('data-indeterminate', 'false')
      await user.click(box('Website redesign'))
      await user.click(box('Newsletter'))
      expect(button('Allow')).toBeDisabled()
    })

    it('chooses every board with "All my boards", and none with it again', async () => {
      consentServer()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))

      await user.click(box(ALL))

      expect(box('Website redesign')).toBeChecked()
      expect(box('Newsletter')).toBeChecked()
      await user.click(box(ALL))
      expect(box('Website redesign')).not.toBeChecked()
      expect(box('Newsletter')).not.toBeChecked()
      expect(button('Allow')).toBeDisabled()
    })

    it('explains what read-only means when it is switched on', async () => {
      consentServer()
      const { user } = renderConsent()
      await loaded()

      await user.click(screen.getByRole('switch', { name: 'Read-only' }))

      expect(screen.getByText('It can read these boards, but not change anything.')).toBeInTheDocument()
      expect(screen.queryByText(/add or change lists/)).not.toBeInTheDocument()
    })
  })

  describe('the answer', () => {
    it.each([
      ['able to change them', false],
      ['read-only', true],
    ])('allows the chosen boards, %s, and sends the browser back to the app', async (_case, readOnly) => {
      const server = consentServer()
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))
      if (readOnly) await user.click(screen.getByRole('switch', { name: 'Read-only' }))

      await user.click(button('Allow'))

      await waitFor(() => expect(location.assign).toHaveBeenCalledWith(CALLBACK))
      expect(server.approved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/oauth/requests/req-1/approve', { board_ids: ['board-2'], read_only: readOnly }],
      ])
      expect(server.denied.requests).toEqual([])
      // On its way out: nothing can be clicked twice.
      expect(button('Allow')).toBeDisabled()
      expect(button('Deny')).toBeDisabled()
    })

    it('denies, whatever was chosen, and sends the browser back to the app', async () => {
      const server = consentServer()
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))

      await user.click(button('Deny'))

      await waitFor(() => expect(location.assign).toHaveBeenCalledWith(`${CALLBACK}&error=access_denied`))
      expect(server.denied.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/oauth/requests/req-1/deny', null]])
      expect(server.approved.requests).toEqual([])
      expect(button('Allow')).toBeDisabled()
      expect(button('Deny')).toBeDisabled()
    })

    it("can't be sent twice while it waits", async () => {
      const held = heldAnswer(() => HttpResponse.json({ redirect_to: CALLBACK }))
      const server = consentServer()
      fakeEndpoint('post', `${REQUEST_URL}/approve`, held.answer)
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))

      await user.click(button('Allow'))

      expect(button('Allow')).toBeDisabled()
      expect(button('Deny')).toBeDisabled()
      held.release()
      await waitFor(() => expect(location.assign).toHaveBeenCalledWith(CALLBACK))
      expect(server.denied.requests).toEqual([])
    })

    it('says the request has expired when the answer finds it gone, and stays', async () => {
      consentServer()
      fakeEndpoint('post', `${REQUEST_URL}/approve`, () => HttpResponse.json({ detail: 'Authorization request not found or expired' }, { status: 404 }))
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))

      await user.click(button('Allow'))

      expect(await screen.findByRole('alert')).toHaveTextContent('This connection request has expired or was already answered.')
      expect(button('Allow')).toBeEnabled()
      expect(location.assign).not.toHaveBeenCalled()
    })

    it.each<[string, Answer]>([
      ['a server error', SERVER_ERROR],
      ['a dropped connection', DROPPED],
    ])('says something went wrong after %s, and can be sent again', async (_case, answer) => {
      consentServer()
      const approved = fakeEndpoint('post', `${REQUEST_URL}/approve`, answer)
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))

      await user.click(button('Allow'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(location.assign).not.toHaveBeenCalled()
      fakeEndpoint('post', `${REQUEST_URL}/approve`, () => HttpResponse.json({ redirect_to: CALLBACK }))
      await user.click(button('Allow'))
      await waitFor(() => expect(location.assign).toHaveBeenCalledWith(CALLBACK))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(approved.requests).toHaveLength(1)
    })
  })

  describe('a request that can’t be answered', () => {
    it.each([
      ['gone or expired (404)', 404],
      ['not a request id at all (422)', 422],
    ])('says it has expired when it is %s', async (_case, status) => {
      consentServer({}, () => HttpResponse.json({ detail: 'Not found' }, { status }))
      renderConsent()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This connection request has expired or was already answered. Start the connection again from the app.',
      )
      expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument()
    })

    it.each([
      ['no request in the address', '', 'This connection request is not valid.'],
      ['an unknown app', '?error=invalid_client', "This app isn't known to KanbanMF, or its address isn't accepted."],
      ['an unregistered answer address', '?error=invalid_redirect_uri', "The app asked to receive the answer at an address it didn't register"],
      ['any other error', '?error=invalid_request', 'This connection request is not valid.'],
    ])('says why, asking nothing, for %s', async (_case, search, message) => {
      const server = consentServer()
      renderConsent(search)

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('heading', { name: 'Connect an app to KanbanMF' })).toBeInTheDocument()
      expect(server.read.requests).toEqual([])
    })

    it('shows an error in the address even beside a request, offering no answer', async () => {
      consentServer()
      renderConsent('?request=req-1&error=invalid_client')

      expect(await screen.findByRole('alert')).toHaveTextContent("This app isn't known to KanbanMF")
      expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument()
    })

    it('says it has expired when it is gone, even if who you are failed too', async () => {
      consentServer({}, () => HttpResponse.json({ detail: 'Not found' }, { status: 404 }), SERVER_ERROR)
      renderConsent()

      expect(await screen.findByRole('alert')).toHaveTextContent('This connection request has expired')
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })
  })

  describe('a load that fails (6T)', () => {
    it.each<[string, 'request' | 'me', Answer]>([
      ['the request fails', 'request', SERVER_ERROR],
      ['who you are fails', 'me', SERVER_ERROR],
      ['the connection drops', 'request', DROPPED],
    ])("says the request couldn't be loaded when %s, and loads it with Try again", async (_case, failing, answer) => {
      // Fails until `failure` is cleared, then answers as usual.
      let failure: Answer | null = answer
      const fails = (usual: Answer): Answer => (request) => (failure ?? usual)(request)
      const REQUEST: Answer = () => HttpResponse.json({
        client_name: 'Claude', redirect_host: 'claude.ai', redirect_is_local: false, boards: BOARDS, expires_at: '2026-11-22T12:10:00Z',
      })
      const ME: Answer = () => HttpResponse.json(makeUser())
      consentServer({}, failing === 'request' ? fails(REQUEST) : undefined, failing === 'me' ? fails(ME) : undefined)
      const { user } = renderConsent()

      expect(await screen.findByRole('alert')).toHaveTextContent("The connection request couldn't be loaded.")
      expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
      failure = null
      await user.click(button('Try again'))

      expect(await loaded()).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(button('Deny')).toBeEnabled()
    })

    it('shows the spinner while Try again loads, and the message again if it fails again', async () => {
      const held = heldAnswer(SERVER_ERROR)
      let answer: Answer = SERVER_ERROR
      consentServer({}, (request) => answer(request))
      const { user } = renderConsent()
      await screen.findByText("The connection request couldn't be loaded.")
      answer = held.answer

      await user.click(button('Try again'))

      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("The connection request couldn't be loaded.")
    })

    it('is said in Catalan for a user who reads Catalan', async () => {
      await i18n.changeLanguage('ca')
      consentServer({}, SERVER_ERROR)
      renderConsent()

      expect(await screen.findByRole('alert')).toHaveTextContent("No s'ha pogut carregar la sol·licitud de connexió.")
      expect(button('Torna-ho a intentar')).toBeInTheDocument()
    })
  })

  describe('a change of language on the page (6S)', () => {
    // The page's own language field, as AuthControls shows it on a computer.
    async function chooseCatalan(user: ReturnType<typeof renderConsent>['user']) {
      await user.click(screen.getByRole('combobox', { name: 'Language' }))
      await user.click(await screen.findByRole('option', { name: 'Català' }))
    }

    it('keeps the request and your choices, without loading them again', async () => {
      const server = consentServer()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))

      await chooseCatalan(user)

      expect(await screen.findByRole('heading', { name: 'Connecta Claude a KanbanMF' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Newsletter' })).toBeChecked()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.read.requests).toHaveLength(1)
    })

    it('says a message already shown in the new language', async () => {
      consentServer()
      fakeEndpoint('post', `${REQUEST_URL}/approve`, SERVER_ERROR)
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))
      await user.click(button('Allow'))
      await screen.findByText('Something went wrong. Please try again.')

      await chooseCatalan(user)

      expect(await screen.findByRole('alert')).toHaveTextContent('Alguna cosa ha anat malament. Torna-ho a intentar.')
    })
  })

  describe('a choice of boards refused because they changed (6U)', () => {
    const REFUSED: Answer = () => HttpResponse.json({ detail: 'Only your own boards can be chosen.' }, { status: 422 })

    it('loads the list again, keeps the boards still offered, says why, and allows them', async () => {
      const server = consentServer()
      const location = watchLocation()
      const { user } = renderConsent()
      await loaded()
      await user.click(box(ALL))
      // "Newsletter" has been archived meanwhile.
      consentServer({ boards: [BOARDS[0]] })
      let refuse = true
      const approved = fakeEndpoint('post', `${REQUEST_URL}/approve`, (request) => {
        const answer: Answer = refuse ? REFUSED : () => HttpResponse.json({ redirect_to: CALLBACK })
        refuse = false
        return answer(request)
      })

      await user.click(button('Allow'))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Some of the boards you chose can no longer be shared, so the list has been updated. Check it and try again.',
      )
      expect(screen.queryByRole('checkbox', { name: 'Newsletter' })).not.toBeInTheDocument()
      expect(box('Website redesign')).toBeChecked()
      expect(box(ALL)).toBeChecked()
      expect(location.assign).not.toHaveBeenCalled()
      await user.click(button('Allow'))
      await waitFor(() => expect(location.assign).toHaveBeenCalledWith(CALLBACK))
      expect(approved.requests.map((r) => r.body)).toEqual([
        { board_ids: ['board-1', 'board-2'], read_only: false },
        { board_ids: ['board-1'], read_only: false },
      ])
      expect(server.read.requests).toHaveLength(1)
    })

    it('asks for a new choice when none of the chosen boards is offered any more', async () => {
      consentServer()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))
      consentServer({ boards: [BOARDS[0]] })
      fakeEndpoint('post', `${REQUEST_URL}/approve`, REFUSED)

      await user.click(button('Allow'))

      await screen.findByText(/can no longer be shared/)
      expect(box('Website redesign')).not.toBeChecked()
      expect(button('Allow')).toBeDisabled()
      expect(button('Deny')).toBeEnabled()
    })

    it.each<[string, Answer, string]>([
      ['finds the request gone', () => HttpResponse.json({ detail: 'Not found' }, { status: 404 }), 'This connection request has expired'],
      ['fails', SERVER_ERROR, 'Something went wrong. Please try again.'],
    ])('says so when loading the list again %s', async (_case, reload, message) => {
      consentServer()
      const { user } = renderConsent()
      await loaded()
      await user.click(box('Newsletter'))
      consentServer({}, reload)
      fakeEndpoint('post', `${REQUEST_URL}/approve`, REFUSED)

      await user.click(button('Allow'))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(button('Deny')).toBeEnabled()
    })
  })

})
