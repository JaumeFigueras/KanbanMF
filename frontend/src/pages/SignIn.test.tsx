import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { useLocation } from 'react-router-dom'
import { getAccessToken } from '../api/client'
import { AuthProvider } from '../context/AuthContext'
import { useAuth } from '../context/useAuth'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import { rememberReturnTo } from '../utils/returnTo'
import i18n from '../i18n'
import SignIn from './SignIn'

const LOGIN = '/api/v1/auth/local/login'

function renderSignIn() {
  return renderWithProviders(<SignIn />, { route: '/signin' })
}

// The address the router is at, to see where signing in leads.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}
const address = () => screen.getByTestId('address').textContent

// The page as the app shows it to someone signed out: under the AuthProvider
// whose session it starts, with no session yet.
function renderSignedOut() {
  fakeEndpoint('post', '/api/v1/auth/local/refresh', () => HttpResponse.json({ detail: 'No session' }, { status: 401 }))
  return renderWithProviders(<AuthProvider><SignIn /><Address /></AuthProvider>, { route: '/signin' })
}

const ACCEPTED: Answer = () => HttpResponse.json({ access_token: 'tok-new', token_type: 'bearer' })

// The fields are required, so MUI adds " *" to their labels; the password
// field has no role, so both are found by their label.
async function signIn(user: ReturnType<typeof renderSignIn>['user']) {
  await user.type(screen.getByLabelText('Email *'), 'marta@example.com')
  await user.type(screen.getByLabelText('Password *'), 'secret password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignIn', () => {
  describe('no answer is not a wrong answer (6E)', () => {
    it.each<[string, Answer, string]>([
      ['a wrong password or an unknown address (401)', () => HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }), 'Incorrect email or password'],
      ['something that isn\'t an address (422)', () => HttpResponse.json({ detail: [{ loc: ['body', 'email'], msg: 'not an email' }] }, { status: 422 }), 'Incorrect email or password'],
      ['an unverified address (403)', () => HttpResponse.json({ detail: 'Email not verified' }, { status: 403 }), 'Please verify your email address before signing in.'],
      ['any other refusal (403)', () => HttpResponse.json({ detail: 'Inactive user' }, { status: 403 }), 'Incorrect email or password'],
      ['a refusal that can\'t be read (403)', () => new HttpResponse('Forbidden', { status: 403 }), 'Incorrect email or password'],
      ['too many tries (429)', () => HttpResponse.json({ detail: 'Too many attempts' }, { status: 429 }), 'Too many attempts. Please wait a few minutes and try again.'],
      ['a server error', SERVER_ERROR, 'Something went wrong. Please try again.'],
      ['a dropped connection', DROPPED, "KanbanMF couldn't be reached. Check your connection and try again."],
      ['an answer that can\'t be read', () => new HttpResponse('{"access_tok', { headers: { 'Content-Type': 'application/json' } }), "KanbanMF couldn't be reached. Check your connection and try again."],
    ])('answers %s with what happened', async (_case, answer, message) => {
      const tried = fakeEndpoint('post', LOGIN, answer)
      const { user } = renderSignIn()

      await signIn(user)

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      expect(tried.requests.map((r) => r.body)).toEqual([{ email: 'marta@example.com', password: 'secret password' }])
    })
  })

  describe('signing in', () => {
    it('starts the session with the token it gets, and opens the boards', async () => {
      const tried = fakeEndpoint('post', LOGIN, ACCEPTED)
      // Sent with the browser's cookies, so the session cookie it answers
      // with is kept. (The fake server can't tell: MSW rebuilds the request.)
      const sent = vi.spyOn(globalThis, 'fetch')
      onTestFinished(() => sent.mockRestore())
      const { user } = renderSignedOut()
      expect(address()).toBe('/signin')

      await signIn(user)

      await waitFor(() => expect(address()).toBe('/boards'))
      expect(getAccessToken()).toBe('tok-new')
      expect(tried.requests).toHaveLength(1)
      expect(sent.mock.calls.filter(([url]) => url === LOGIN).map(([, init]) => init?.credentials)).toEqual(['include'])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('goes back to the page that sent you to sign in, with its address whole', async () => {
      fakeEndpoint('post', LOGIN, ACCEPTED)
      rememberReturnTo('/boards/board-7?card=card-3')
      const { user } = renderSignedOut()

      await signIn(user)

      await waitFor(() => expect(address()).toBe('/boards/board-7?card=card-3'))
    })

    it("can't be sent twice while it waits, and stays on the page when refused", async () => {
      const held = heldAnswer(() => HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }))
      const tried = fakeEndpoint('post', LOGIN, held.answer)
      const { user } = renderSignedOut()

      await signIn(user)

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      expect(tried.requests).toHaveLength(1)
      expect(address()).toBe('/signin')
      expect(getAccessToken()).toBeNull()
    })

    it('takes the last message away when it tries again', async () => {
      const held = heldAnswer(ACCEPTED)
      let answer: Answer = () => HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 })
      fakeEndpoint('post', LOGIN, (request) => answer(request))
      const { user } = renderSignedOut()
      await signIn(user)
      await screen.findByRole('alert')
      answer = held.answer

      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      await waitFor(() => expect(address()).toBe('/boards'))
    })

    it('shows an unverified address as a warning, not an error', async () => {
      fakeEndpoint('post', LOGIN, () => HttpResponse.json({ detail: 'Email not verified' }, { status: 403 }))
      const { user } = renderSignIn()

      await signIn(user)

      expect(await screen.findByRole('alert')).toHaveClass('MuiAlert-colorWarning')
    })

    it("warns after a sign-out the server couldn't confirm, until signing in again", async () => {
      fakeEndpoint('post', '/api/v1/auth/local/logout', DROPPED)
      fakeEndpoint('post', LOGIN, ACCEPTED)
      // Signs out the way the top bar does.
      function SignOut() {
        const { logout } = useAuth()
        return <button onClick={() => logout()}>Sign out</button>
      }
      const { user } = renderWithProviders(<><SignOut /><SignIn /></>, { route: '/signin', auth: true })
      expect(screen.queryByText(/couldn't end your session/)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Sign out' }))

      expect(await screen.findByText(/couldn't end your session/)).toBeInTheDocument()
      await signIn(user)
      await waitFor(() => expect(screen.queryByText(/couldn't end your session/)).not.toBeInTheDocument())
      expect(getAccessToken()).toBe('tok-new')
    })

    it('leads to the sign-up page for someone with no account', async () => {
      const { user } = renderSignedOut()

      await user.click(screen.getByRole('link', { name: 'Sign up' }))

      expect(address()).toBe('/signup')
    })
  })

  describe('the show-password button (6K)', () => {
    it('is named for what it does, and shows and hides the password', async () => {
      const { user } = renderSignIn()
      const password = screen.getByLabelText('Password *')
      expect(password).toHaveAttribute('type', 'password')

      await user.click(screen.getByRole('button', { name: 'Show password' }))

      expect(password).toHaveAttribute('type', 'text')
      await user.click(screen.getByRole('button', { name: 'Hide password' }))
      expect(password).toHaveAttribute('type', 'password')
    })

    it("is named in the page's language", async () => {
      await i18n.changeLanguage('ca')
      renderSignIn()

      expect(screen.getByRole('button', { name: 'Mostra la contrasenya' })).toBeInTheDocument()
    })
  })
})
