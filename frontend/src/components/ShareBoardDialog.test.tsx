import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import i18n from '../i18n'
import type { BoardRead } from '../types/board'
import type { BoardInvitationRead } from '../types/invitation'
import { fetchAppConfig } from '../api/config'
import { setWebSocketToken } from '../api/ws'
import { getClientId } from '../api/client'
import { fakeEndpoint, heldAnswer, type Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeBoard, makePerson } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ShareBoardDialog from './ShareBoardDialog'

// The server's config is fetched once per page load and kept in the module,
// which would carry one test's answer into the next: each test says instead.
vi.mock('../api/config', () => ({ fetchAppConfig: vi.fn() }))

const MEMBERS = '/api/v1/boards/:boardId/members'
const INVITATIONS = '/api/v1/boards/:boardId/invitations'
const INVITATION = '/api/v1/boards/:boardId/invitations/:invitationId'
const SHARES = '/api/v1/boards/:boardId/shares'
const SHARE = '/api/v1/boards/:boardId/shares/:userId'
const IMPACT = '/api/v1/boards/:boardId/shares/:userId/impact'
const SEARCH = '/api/v1/users/search'

const BOARD = makeBoard({ id: 'board-1', owner_id: 'user-1' })
const TEMPLATE = makeBoard({ id: 'board-9', owner_id: 'user-1', name: 'Kanban', is_template: true })

const EMMA = makePerson({ id: 'user-1', display_name: 'Emma Wilson' })
const LIAM = makePerson({ id: 'user-2', display_name: 'Liam Chen' })
const NOAH = makePerson({ id: 'user-3', display_name: 'Noah Garcia' })
const OLIVIA = makePerson({ id: 'user-4', display_name: 'Olivia Martin' })

const SOFIA: BoardInvitationRead = {
  id: 'invitation-1',
  email: 'sofia@example.com',
  language: 'ca',
  created_at: '2026-01-15T09:00:00Z',
  expires_at: '2026-02-14T09:00:00Z',
}

beforeEach(() => {
  vi.mocked(fetchAppConfig).mockResolvedValue({ email_enabled: true })
})

// The board's people (the owner among them, as the backend gives them) and
// its pending invitations.
function fakeShares({ members = [EMMA, LIAM, NOAH], invitations = [SOFIA] }: {
  members?: unknown[] | Answer
  invitations?: BoardInvitationRead[] | Answer
} = {}) {
  return {
    members: fakeEndpoint('get', MEMBERS, typeof members === 'function' ? members : () => HttpResponse.json(members)),
    invitations: fakeEndpoint('get', INVITATIONS, typeof invitations === 'function' ? invitations : () => HttpResponse.json(invitations)),
  }
}

const failure = (status = 500) => () => HttpResponse.json({ detail: 'Something failed' }, { status })

interface Shown {
  open: boolean
  board: BoardRead | null
  dateFormat: 'numeric' | 'textual'
}

function renderDialog(first: Partial<Shown> = {}) {
  const onClose = vi.fn()
  let shown: Shown = { open: true, board: BOARD, dateFormat: 'numeric', ...first }
  const dialog = ({ open, board, dateFormat }: Shown) => (
    <ShareBoardDialog open={open} onClose={onClose} board={board} numberLocale="en_GB" dateFormat={dateFormat} />
  )
  const result = renderWithProviders(dialog(shown))
  // Closes the dialog and opens it again, as the board menus do.
  function reopen(next: Partial<Shown> = {}) {
    result.rerender(dialog({ ...shown, open: false }))
    shown = { ...shown, ...next, open: true }
    result.rerender(dialog(shown))
  }
  return { ...result, onClose, reopen }
}

const shareDialog = () => screen.getByRole('dialog', { name: 'Share board' })
const removeButton = (name: string) => screen.getByRole('button', { name: `Remove ${name} from this board` })
const searchField = () => screen.getByRole('combobox', { name: 'Add people' })
const emailField = () => screen.getByRole('textbox', { name: 'Invite by email' })
const sendButton = () => screen.getByRole('button', { name: 'Send invitation' })

async function loaded() {
  await screen.findByRole('button', { name: 'Remove Liam Chen from this board' })
}

// Asks to remove someone, and waits for the card count that Remove waits for.
async function askToRemove(user: ReturnType<typeof renderDialog>['user'], name: string) {
  await user.click(removeButton(name))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled())
}

describe('ShareBoardDialog', () => {
  describe('the people it is shared with', () => {
    it('shows them, not the owner, each a button to remove them', async () => {
      fakeShares()
      renderDialog()
      await loaded()
      expect(removeButton('Noah Garcia')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Emma Wilson/ })).not.toBeInTheDocument()
    })

    it("says when it isn't shared with anyone", async () => {
      fakeShares({ members: [EMMA] })
      renderDialog()
      expect(await screen.findByText('Not shared with anyone yet.')).toBeInTheDocument()
    })

    it('asks before removing someone, saying how many of their cards will be replaced', async () => {
      fakeShares()
      const impact = fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 2 }))
      const removed = fakeEndpoint('delete', SHARE)
      const { user } = renderDialog()
      await loaded()

      await user.click(removeButton('Liam Chen'))

      const question = screen.getByRole('dialog', { name: 'Remove from board?' })
      expect(question).toHaveTextContent('Remove Liam Chen from this board? They will lose access.')
      expect(await within(question).findByText(/^They are on 2 cards of this board\./)).toBeInTheDocument()
      expect(impact.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/shares/user-2/impact'])
      expect(removed.requests).toEqual([])
    })

    it('says nothing of cards when they are on none', async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 0 }))
      const { user } = renderDialog()
      await loaded()
      await askToRemove(user, 'Liam Chen')
      expect(screen.queryByText(/^They are on/)).not.toBeInTheDocument()
      expect(screen.queryByText(/will be archived/)).not.toBeInTheDocument()
    })

    it("still warns that their cards will be archived when the count can't be found out", async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, failure(404))
      const { user } = renderDialog()
      await loaded()

      await askToRemove(user, 'Liam Chen')

      expect(screen.getByRole('dialog', { name: 'Remove from board?' })).toHaveTextContent(
        'Any cards of this board they are on will be archived, to keep their history, and copies without them will take their place, with you instead of them.',
      )
    })

    it('waits for the card count before Remove can be pressed', async () => {
      fakeShares()
      const held = heldAnswer(() => HttpResponse.json({ card_count: 2 }))
      fakeEndpoint('get', IMPACT, held.answer)
      const { user } = renderDialog()
      await loaded()
      await user.click(removeButton('Liam Chen'))
      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()

      held.release()

      await screen.findByText(/^They are on 2 cards/)
      expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
    })

    it('waits again for the next person asked about', async () => {
      fakeShares()
      const held = heldAnswer(() => HttpResponse.json({ card_count: 0 }))
      const impact = fakeEndpoint('get', IMPACT, (request) => (request.url.includes('user-2') ? HttpResponse.json({ card_count: 0 }) : held.answer(request)))
      const { user } = renderDialog()
      await loaded()
      await askToRemove(user, 'Liam Chen')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())

      await user.click(removeButton('Noah Garcia'))

      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
      await waitFor(() => expect(impact.requests).toHaveLength(2))
      held.release()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled())
    })

    it('removes them once confirmed', async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 0 }))
      const removed = fakeEndpoint('delete', SHARE)
      const { user } = renderDialog()
      await loaded()
      await askToRemove(user, 'Liam Chen')

      await user.click(screen.getByRole('button', { name: 'Remove' }))

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())
      expect(removed.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/shares/user-2'])
      expect(screen.queryByRole('button', { name: 'Remove Liam Chen from this board' })).not.toBeInTheDocument()
      expect(removeButton('Noah Garcia')).toBeInTheDocument()
    })

    it("says so, and keeps asking, when they can't be removed", async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 0 }))
      fakeEndpoint('delete', SHARE, failure())
      const { user } = renderDialog()
      await loaded()
      await askToRemove(user, 'Liam Chen')

      await user.click(screen.getByRole('button', { name: 'Remove' }))

      const question = screen.getByRole('dialog', { name: 'Remove from board?' })
      expect(await within(question).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(within(question).getByRole('button', { name: 'Remove' })).toBeEnabled()
    })

    it('Cancel keeps them', async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 0 }))
      const removed = fakeEndpoint('delete', SHARE)
      const { user } = renderDialog()
      await loaded()
      await user.click(removeButton('Liam Chen'))

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())
      expect(removed.requests).toEqual([])
      expect(removeButton('Liam Chen')).toBeInTheDocument()
    })

    it('takes nothing while removing', async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 0 }))
      const held = heldAnswer()
      fakeEndpoint('delete', SHARE, held.answer)
      const { user } = renderDialog()
      await loaded()
      await askToRemove(user, 'Liam Chen')

      await user.click(screen.getByRole('button', { name: 'Remove' }))

      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      held.release()
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())
    })

    it('asks afresh about the next person: no old error or card count', async () => {
      fakeShares()
      const held = heldAnswer(() => HttpResponse.json({ card_count: 0 }))
      fakeEndpoint('get', IMPACT, (request) => (request.url.includes('user-2') ? HttpResponse.json({ card_count: 3 }) : held.answer(request)))
      fakeEndpoint('delete', SHARE, failure())
      const { user } = renderDialog()
      await loaded()
      await user.click(removeButton('Liam Chen'))
      await screen.findByText(/^They are on 3 cards/)
      await user.click(screen.getByRole('button', { name: 'Remove' }))
      await screen.findByText('Something went wrong. Please try again.')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())

      await user.click(removeButton('Noah Garcia'))

      const question = screen.getByRole('dialog', { name: 'Remove from board?' })
      expect(question).toHaveTextContent('Remove Noah Garcia from this board?')
      expect(within(question).queryByRole('alert')).not.toBeInTheDocument()
      expect(within(question).queryByText(/^They are on/)).not.toBeInTheDocument()
      held.release()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled())
    })

    it("drops a late card count for the person asked about before", async () => {
      fakeShares()
      const held = heldAnswer(() => HttpResponse.json({ card_count: 3 }))
      const impact = fakeEndpoint('get', IMPACT, (request) => (request.url.includes('user-2') ? held.answer(request) : HttpResponse.json({ card_count: 0 })))
      const { user } = renderDialog()
      await loaded()
      await user.click(removeButton('Liam Chen'))
      await waitFor(() => expect(impact.requests).toHaveLength(1))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())
      await user.click(removeButton('Noah Garcia'))
      await waitFor(() => expect(impact.requests).toHaveLength(2))

      held.release()

      // Gives the late answer time to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByText(/^They are on/)).not.toBeInTheDocument()
    })

    it("drops a late failure of the count for the person asked about before", async () => {
      fakeShares()
      const liam = heldAnswer(failure())
      const noah = heldAnswer(() => HttpResponse.json({ card_count: 0 }))
      const impact = fakeEndpoint('get', IMPACT, (request) => (request.url.includes('user-2') ? liam.answer(request) : noah.answer(request)))
      const { user } = renderDialog()
      await loaded()
      await user.click(removeButton('Liam Chen'))
      await waitFor(() => expect(impact.requests).toHaveLength(1))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove from board?' })).not.toBeInTheDocument())
      await user.click(removeButton('Noah Garcia'))
      await waitFor(() => expect(impact.requests).toHaveLength(2))

      liam.release()

      // Gives the late answer time to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByText(/will be archived/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
      noah.release()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled())
    })

    it('can be reached and removed from the keyboard', async () => {
      fakeShares()
      fakeEndpoint('get', IMPACT, () => HttpResponse.json({ card_count: 0 }))
      const { user } = renderDialog()
      await loaded()
      removeButton('Liam Chen').focus()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('dialog', { name: 'Remove from board?' })).toHaveTextContent('Remove Liam Chen')
    })
  })

  describe('loading the people and invitations', () => {
    it('shows each list loading until it has arrived', async () => {
      const members = heldAnswer(() => HttpResponse.json([EMMA, LIAM, NOAH]))
      const invitations = heldAnswer(() => HttpResponse.json([SOFIA]))
      fakeShares({ members: members.answer, invitations: invitations.answer })
      renderDialog()
      expect(screen.getAllByRole('progressbar')).toHaveLength(2)
      expect(screen.queryByText('Not shared with anyone yet.')).not.toBeInTheDocument()
      expect(screen.queryByText('No pending invitations.')).not.toBeInTheDocument()

      members.release()
      await loaded()
      expect(screen.getAllByRole('progressbar')).toHaveLength(1)
      invitations.release()

      await screen.findByText('sofia@example.com')
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it.each([
      ['people', { members: failure() }, 'Not shared with anyone yet.'],
      ['invitations', { invitations: failure() }, 'No pending invitations.'],
    ])("says the %s couldn't be loaded, rather than that there are none", async (_, answers, emptyText) => {
      fakeShares(answers)
      renderDialog()
      expect(await within(shareDialog()).findByRole('alert')).toHaveTextContent(
        "The people and invitations couldn't be loaded. Please close this and try again.",
      )
      expect(screen.queryByText(emptyText)).not.toBeInTheDocument()
    })

    it('stops showing a list loading once it has failed', async () => {
      fakeShares({ members: failure(), invitations: failure() })
      renderDialog()
      await within(shareDialog()).findByRole('alert')
      await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    })

    it.each([
      ['people', { members: failure() }],
      ['invitations', { invitations: failure() }],
    ])('stops saying the %s failed once a reload from elsewhere works', async (_, answers) => {
      fakeShares(answers)
      setWebSocketToken('socket-token')
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      renderDialog()
      await within(shareDialog()).findByRole('alert')
      fakeShares()

      socket.receive({ type: 'board_shared', board_id: 'board-1', origin_client_id: null })

      await loaded()
      await screen.findByText('sofia@example.com')
      expect(within(shareDialog()).queryByRole('alert')).not.toBeInTheDocument()
    })

    it("doesn't show the last board's people and invitations while the next board's load", async () => {
      fakeShares()
      const { reopen } = renderDialog()
      await loaded()
      await screen.findByText('sofia@example.com')
      const members = heldAnswer(() => HttpResponse.json([EMMA]))
      const invitations = heldAnswer(() => HttpResponse.json([]))
      fakeShares({ members: members.answer, invitations: invitations.answer })

      reopen({ board: makeBoard({ id: 'board-2', owner_id: 'user-1' }) })

      expect(screen.queryByRole('button', { name: 'Remove Liam Chen from this board' })).not.toBeInTheDocument()
      expect(screen.queryByText('sofia@example.com')).not.toBeInTheDocument()
      expect(screen.getAllByRole('progressbar')).toHaveLength(2)
      // Lets the loads finish here, not in the next test.
      members.release()
      invitations.release()
      await screen.findByText('Not shared with anyone yet.')
      await screen.findByText('No pending invitations.')
    })

    it('drops a late answer for the last board', async () => {
      const members = heldAnswer(() => HttpResponse.json([EMMA, LIAM, NOAH]))
      const invitations = heldAnswer(() => HttpResponse.json([SOFIA]))
      const loads = fakeShares({ members: members.answer, invitations: invitations.answer })
      const { reopen } = renderDialog()
      await waitFor(() => expect([...loads.members.requests, ...loads.invitations.requests]).toHaveLength(2))
      fakeShares({ members: [EMMA], invitations: [] })
      reopen({ board: makeBoard({ id: 'board-2', owner_id: 'user-1' }) })
      await screen.findByText('Not shared with anyone yet.')
      await screen.findByText('No pending invitations.')

      members.release()
      invitations.release()

      // Gives the late answers time to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByRole('button', { name: 'Remove Liam Chen from this board' })).not.toBeInTheDocument()
      expect(screen.queryByText('sofia@example.com')).not.toBeInTheDocument()
    })

    it('drops a late failure for the last board too', async () => {
      const held = heldAnswer(failure())
      const loads = fakeShares({ members: held.answer, invitations: held.answer })
      const { reopen } = renderDialog()
      await waitFor(() => expect([...loads.members.requests, ...loads.invitations.requests]).toHaveLength(2))
      fakeShares()
      reopen({ board: makeBoard({ id: 'board-2', owner_id: 'user-1' }) })
      await loaded()

      held.release()

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(within(shareDialog()).queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([
      ['people', { members: failure() }],
      ['invitations', { invitations: failure() }],
    ])('says nothing of the failed %s while a reopening loads them', async (_, answers) => {
      fakeShares(answers)
      const { reopen } = renderDialog()
      await within(shareDialog()).findByRole('alert')
      const members = heldAnswer(() => HttpResponse.json([EMMA, LIAM, NOAH]))
      const invitations = heldAnswer(() => HttpResponse.json([SOFIA]))
      fakeShares({ members: members.answer, invitations: invitations.answer })

      reopen()

      expect(within(shareDialog()).queryByRole('alert')).not.toBeInTheDocument()
      members.release()
      invitations.release()
      await loaded()
      await screen.findByText('sofia@example.com')
      expect(within(shareDialog()).queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('adding people', () => {
    it('looks up what was typed, once typing pauses, and offers who it finds', async () => {
      fakeShares()
      const search = fakeEndpoint('get', SEARCH, () => HttpResponse.json([OLIVIA]))
      const { user } = renderDialog()
      await loaded()

      await user.type(searchField(), 'oli')

      // Named once: the avatar beside the name is hidden from screen readers.
      expect(await screen.findByRole('option', { name: 'Olivia Martin' })).toBeInTheDocument()
      expect(search.requests.map((r) => r.url.searchParams.get('q'))).toEqual(['oli'])
    })

    it("says it's looking, and names the field's arrow button, in Catalan", async () => {
      await i18n.changeLanguage('ca')
      fakeShares()
      const held = heldAnswer(() => HttpResponse.json([OLIVIA]))
      fakeEndpoint('get', SEARCH, held.answer)
      const { user } = renderDialog()
      await screen.findByRole('button', { name: "Elimina Liam Chen d'aquest tauler" })

      const field = screen.getByRole('combobox', { name: 'Afegeix persones' })
      await user.type(field, 'oli')

      expect(await screen.findByText("S'està carregant…")).toBeInTheDocument()
      expect(within(field.closest('.MuiAutocomplete-root') as HTMLElement).getByRole('button', { name: 'Tanca' }))
        .toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('option', { name: 'Olivia Martin' })).toBeInTheDocument()
    })

    it('looks up the text without the spaces around it', async () => {
      fakeShares()
      const search = fakeEndpoint('get', SEARCH, () => HttpResponse.json([]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), '  oli ')
      await waitFor(() => expect(search.requests).toHaveLength(1))
      expect(search.requests[0].url.searchParams.get('q')).toBe('oli')
    })

    it('sends the text as typed, special characters included', async () => {
      fakeShares()
      const search = fakeEndpoint('get', SEARCH, () => HttpResponse.json([]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'a+b&c@example.com')
      await waitFor(() => expect(search.requests).toHaveLength(1))
      expect(search.requests[0].url.searchParams.get('q')).toBe('a+b&c@example.com')
    })

    it('looks up nothing for blank text', async () => {
      fakeShares()
      const search = fakeEndpoint('get', SEARCH, () => HttpResponse.json([]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), '   ')
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(search.requests).toEqual([])
    })

    it('shows the hint, not a search going on, for blank text', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), '   ')
      expect(screen.getByText('Name, or full e-mail address…')).toBeInTheDocument()
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    it('forgets who it found once the text is cleared', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([OLIVIA]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'oli')
      await screen.findByRole('option', { name: /Olivia Martin/ })

      await user.clear(searchField())
      await user.type(searchField(), ' ')

      expect(screen.queryByRole('option', { name: /Olivia Martin/ })).not.toBeInTheDocument()
      expect(screen.getByText('Name, or full e-mail address…')).toBeInTheDocument()
    })

    it('offers neither the owner nor anyone already on the board', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([EMMA, LIAM, OLIVIA]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'a')
      await screen.findByRole('option', { name: /Olivia Martin/ })
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['OMOlivia Martin'])
    })

    it('shares with the person chosen, shows them, and empties the search', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([OLIVIA]))
      const shared = fakeEndpoint('post', SHARES, () => HttpResponse.json(OLIVIA, { status: 201 }))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'oli')

      await user.click(await screen.findByRole('option', { name: /Olivia Martin/ }))

      expect(await screen.findByRole('button', { name: 'Remove Olivia Martin from this board' })).toBeInTheDocument()
      expect(removeButton('Liam Chen')).toBeInTheDocument()
      expect(shared.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-1/shares', { user_id: 'user-4' }]])
      expect(searchField()).toHaveValue('')
    })

    it("says so when sharing fails", async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([OLIVIA]))
      fakeEndpoint('post', SHARES, failure())
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'oli')
      await user.click(await screen.findByRole('option', { name: /Olivia Martin/ }))
      expect(await within(shareDialog()).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(screen.queryByRole('button', { name: 'Remove Olivia Martin from this board' })).not.toBeInTheDocument()
    })

    it('says when no one is found, and how names are matched', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([]))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'zoe')
      expect(await screen.findByText(/^No one found\. Names match only people you already share a board with/)).toBeInTheDocument()
    })

    it('says no one was found when the search loses its connection', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.error())
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'oli')
      expect(await screen.findByText(/^No one found\./)).toBeInTheDocument()
    })

    it("shows the person shared with even when the people couldn't be loaded", async () => {
      fakeShares({ members: failure() })
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([OLIVIA]))
      fakeEndpoint('post', SHARES, () => HttpResponse.json(OLIVIA, { status: 201 }))
      const { user } = renderDialog()
      await within(shareDialog()).findByRole('alert')
      await user.type(searchField(), 'oli')

      await user.click(await screen.findByRole('option', { name: /Olivia Martin/ }))

      expect(await screen.findByRole('button', { name: 'Remove Olivia Martin from this board' })).toBeInTheDocument()
    })

    it('says when too many whole addresses were looked up', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, failure(429))
      const { user } = renderDialog()
      await loaded()
      await user.type(searchField(), 'zoe@example.com')
      expect(await screen.findByText('Too many attempts. Please wait a few minutes and try again.')).toBeInTheDocument()
    })
  })

  describe('pending invitations', () => {
    it('lists them, with when they expire and their language', async () => {
      fakeShares()
      renderDialog()
      expect(await screen.findByText('sofia@example.com')).toBeInTheDocument()
      expect(screen.getByText('Expires 14/02/2026 · CA')).toBeInTheDocument()
    })

    it('writes the expiry date out when dates are shown as text', async () => {
      fakeShares()
      renderDialog({ dateFormat: 'textual' })
      expect(await screen.findByText('Expires 14 Feb 2026 · CA')).toBeInTheDocument()
    })

    it('says when there are none', async () => {
      fakeShares({ invitations: [] })
      renderDialog()
      expect(await screen.findByText('No pending invitations.')).toBeInTheDocument()
    })

    it('asks before cancelling one, then cancels it', async () => {
      fakeShares()
      const cancelled = fakeEndpoint('delete', INVITATION)
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')

      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))
      const question = screen.getByRole('dialog', { name: 'Cancel invitation?' })
      expect(question).toHaveTextContent('Cancel the invitation to sofia@example.com? The link in their email will stop working.')
      expect(cancelled.requests).toEqual([])
      await user.click(within(question).getByRole('button', { name: 'Cancel invitation' }))

      await waitFor(() => expect(screen.queryByText('sofia@example.com')).not.toBeInTheDocument())
      expect(cancelled.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/invitations/invitation-1'])
      expect(screen.getByText('No pending invitations.')).toBeInTheDocument()
    })

    it('closes the question once cancelled', async () => {
      fakeShares()
      fakeEndpoint('delete', INVITATION)
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Cancel invitation?' })).getByRole('button', { name: 'Cancel invitation' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cancel invitation?' })).not.toBeInTheDocument())
    })

    it('takes it off the list when it was already gone', async () => {
      fakeShares()
      fakeEndpoint('delete', INVITATION, failure(404))
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Cancel invitation?' })).getByRole('button', { name: 'Cancel invitation' }))
      await waitFor(() => expect(screen.queryByText('sofia@example.com')).not.toBeInTheDocument())
    })

    it("says so, and keeps asking, when it can't be cancelled", async () => {
      fakeShares()
      fakeEndpoint('delete', INVITATION, failure())
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))
      const question = screen.getByRole('dialog', { name: 'Cancel invitation?' })
      await user.click(within(question).getByRole('button', { name: 'Cancel invitation' }))
      expect(await within(question).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(screen.getByText('sofia@example.com')).toBeInTheDocument()
    })

    it('Keep keeps it, and forgets the error for next time', async () => {
      fakeShares()
      const cancelled = fakeEndpoint('delete', INVITATION, failure())
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Cancel invitation?' })).getByRole('button', { name: 'Cancel invitation' }))
      await screen.findByText('Something went wrong. Please try again.')

      await user.click(screen.getByRole('button', { name: 'Keep' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cancel invitation?' })).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))

      expect(within(screen.getByRole('dialog', { name: 'Cancel invitation?' })).queryByRole('alert')).not.toBeInTheDocument()
      expect(cancelled.requests).toHaveLength(1)
    })

    it('takes nothing while cancelling', async () => {
      fakeShares()
      const held = heldAnswer()
      fakeEndpoint('delete', INVITATION, held.answer)
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.click(screen.getByRole('button', { name: 'Cancel invitation' }))
      const question = screen.getByRole('dialog', { name: 'Cancel invitation?' })
      await user.click(within(question).getByRole('button', { name: 'Cancel invitation' }))
      expect(within(question).getByRole('button', { name: 'Cancel invitation' })).toBeDisabled()
      expect(within(question).getByRole('button', { name: 'Keep' })).toBeDisabled()
      held.release()
      await waitFor(() => expect(screen.queryByText('sofia@example.com')).not.toBeInTheDocument())
    })
  })

  describe('inviting by e-mail', () => {
    async function invite(user: ReturnType<typeof renderDialog>['user'], email = 'zoe@example.com') {
      await screen.findByText('sofia@example.com')
      await user.type(emailField(), email)
      await user.click(sendButton())
    }

    it('sends an invitation in the language chosen, says so, and lists it', async () => {
      fakeShares()
      const zoe = { ...SOFIA, id: 'invitation-2', email: 'zoe@example.com', language: 'ca' }
      const invited = fakeEndpoint('post', INVITATIONS, () => HttpResponse.json(zoe, { status: 201 }))
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')

      await user.type(emailField(), '  zoe@example.com ')
      await user.click(screen.getByRole('combobox', { name: 'Email language' }))
      await user.click(screen.getByRole('option', { name: 'Català' }))
      await user.click(sendButton())

      expect(await screen.findByText('Invitation sent to zoe@example.com.')).toBeInTheDocument()
      expect(invited.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/invitations', { email: 'zoe@example.com', language: 'ca' }],
      ])
      expect(screen.getByText('zoe@example.com')).toBeInTheDocument()
      expect(screen.getByText('sofia@example.com')).toBeInTheDocument()
      expect(emailField()).toHaveValue('')
    })

    it("starts on the app's language", async () => {
      await i18n.changeLanguage('ca')
      fakeShares()
      renderDialog()
      expect(await screen.findByRole('combobox', { name: 'Idioma del correu' })).toHaveTextContent('Català')
    })

    it('sends with Enter too', async () => {
      fakeShares()
      const invited = fakeEndpoint('post', INVITATIONS, () => HttpResponse.json({ ...SOFIA, id: 'invitation-2', email: 'zoe@example.com' }, { status: 201 }))
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.type(emailField(), 'zoe@example.com{Enter}')
      await screen.findByText('Invitation sent to zoe@example.com.')
      expect(invited.requests.map((r) => r.body)).toEqual([{ email: 'zoe@example.com', language: 'en' }])
    })

    it("sends without leaving the page, as a browser would on a form's submit", async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json({ ...SOFIA, id: 'invitation-2', email: 'zoe@example.com' }, { status: 201 }))
      const submits: boolean[] = []
      // Runs after the dialog's own handler: was the page load stopped?
      const seeSubmit = (event: Event) => submits.push(event.defaultPrevented)
      window.addEventListener('submit', seeSubmit)
      onTestFinished(() => window.removeEventListener('submit', seeSubmit))
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')

      await user.type(emailField(), 'zoe@example.com')
      await user.click(sendButton())

      await screen.findByText('Invitation sent to zoe@example.com.')
      expect(submits).toEqual([true])
    })

    it("can't send what isn't an e-mail address, not even with Enter", async () => {
      fakeShares()
      const invited = fakeEndpoint('post', INVITATIONS)
      const { user } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.type(emailField(), 'zoe@example{Enter}')
      expect(sendButton()).toBeDisabled()
      expect(invited.requests).toEqual([])
    })

    it('offers to share with someone who already has an account, and does', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json(
        { detail: { code: 'user_exists', person: OLIVIA, already_shared: false } }, { status: 409 },
      ))
      const shared = fakeEndpoint('post', SHARES, () => HttpResponse.json(OLIVIA, { status: 201 }))
      const { user } = renderDialog()
      await invite(user, 'olivia@example.com')
      expect(await screen.findByText('olivia@example.com already has a KanbanMF account (Olivia Martin).')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Share with Olivia Martin' }))

      expect(await screen.findByRole('button', { name: 'Remove Olivia Martin from this board' })).toBeInTheDocument()
      expect(shared.requests.map((r) => r.body)).toEqual([{ user_id: 'user-4' }])
      expect(screen.queryByText(/already has a KanbanMF account/)).not.toBeInTheDocument()
      expect(emailField()).toHaveValue('')
    })

    it('keeps the offer and the address when that share fails', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json(
        { detail: { code: 'user_exists', person: OLIVIA, already_shared: false } }, { status: 409 },
      ))
      fakeEndpoint('post', SHARES, failure())
      const { user } = renderDialog()
      await invite(user, 'olivia@example.com')
      await user.click(await screen.findByRole('button', { name: 'Share with Olivia Martin' }))
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Share with Olivia Martin' })).toBeInTheDocument()
      expect(emailField()).toHaveValue('olivia@example.com')
    })

    it('says when that person already has the board, offering nothing', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json(
        { detail: { code: 'user_exists', person: LIAM, already_shared: true } }, { status: 409 },
      ))
      const { user } = renderDialog()
      await invite(user, 'liam@example.com')
      expect(await screen.findByText(
        'liam@example.com already has a KanbanMF account (Liam Chen), and this board is already shared with them.',
      )).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Share with/ })).not.toBeInTheDocument()
    })

    it('says when the address already has a pending invitation', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json({ detail: { code: 'already_invited' } }, { status: 409 }))
      const { user } = renderDialog()
      await invite(user, 'sofia@example.com')
      expect(await screen.findByText('sofia@example.com already has a pending invitation.')).toBeInTheDocument()
    })

    it.each([
      [503, "Email sending isn't configured on this server, so invitations can't be sent."],
      [502, "The invitation email couldn't be sent. Please try again later."],
      [429, 'Too many attempts. Please wait a few minutes and try again.'],
      [500, 'Something went wrong. Please try again.'],
    ])('says why a %i failed', async (status, message) => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, failure(status))
      const { user } = renderDialog()
      await invite(user)
      expect(await within(shareDialog()).findByRole('alert')).toHaveTextContent(message)
      expect(emailField()).toHaveValue('zoe@example.com')
    })

    it('says so when the invitation loses its connection', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.error())
      const { user } = renderDialog()
      await invite(user)
      expect(await within(shareDialog()).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(emailField()).toHaveValue('zoe@example.com')
    })

    it("lists the invitation sent even when the invitations couldn't be loaded", async () => {
      fakeShares({ invitations: failure() })
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json({ ...SOFIA, id: 'invitation-2', email: 'zoe@example.com' }, { status: 201 }))
      const { user } = renderDialog()
      await within(shareDialog()).findByRole('alert')
      await user.type(emailField(), 'zoe@example.com')

      await user.click(sendButton())

      await screen.findByText('Invitation sent to zoe@example.com.')
      expect(screen.getByText('zoe@example.com')).toBeInTheDocument()
    })

    it('stops offering to send once the server says e-mail is off', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, failure(503))
      const { user } = renderDialog()
      await invite(user)
      await within(shareDialog()).findByRole('alert')
      expect(sendButton()).toBeDisabled()
      expect(emailField()).toBeDisabled()
    })

    it('takes nothing while sending', async () => {
      fakeShares()
      const held = heldAnswer(() => HttpResponse.json({ ...SOFIA, id: 'invitation-2', email: 'zoe@example.com' }, { status: 201 }))
      fakeEndpoint('post', INVITATIONS, held.answer)
      const { user } = renderDialog()
      await invite(user)
      expect(sendButton()).toBeDisabled()
      expect(emailField()).toBeDisabled()
      expect(screen.getByRole('combobox', { name: 'Email language' })).toHaveAttribute('aria-disabled', 'true')
      held.release()
      await screen.findByText('Invitation sent to zoe@example.com.')
    })

    it('clears the last outcome when sending again', async () => {
      fakeShares()
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json({ detail: { code: 'already_invited' } }, { status: 409 }))
      const { user } = renderDialog()
      await invite(user, 'sofia@example.com')
      await screen.findByText('sofia@example.com already has a pending invitation.')
      const held = heldAnswer(() => HttpResponse.json({ ...SOFIA, id: 'invitation-2', email: 'zoe@example.com' }, { status: 201 }))
      fakeEndpoint('post', INVITATIONS, held.answer)

      await user.clear(emailField())
      await user.type(emailField(), 'zoe@example.com')
      await user.click(sendButton())

      expect(screen.queryByText('sofia@example.com already has a pending invitation.')).not.toBeInTheDocument()
      held.release()
      await screen.findByText('Invitation sent to zoe@example.com.')
    })

    it("says why it can't, when the server can't send e-mail", async () => {
      vi.mocked(fetchAppConfig).mockResolvedValue({ email_enabled: false })
      fakeShares()
      renderDialog()
      await screen.findByText('sofia@example.com')
      expect(screen.getByText("Email sending isn't configured on this server, so invitations can't be sent.")).toBeInTheDocument()
      expect(sendButton()).toBeDisabled()
      expect(emailField()).toBeDisabled()
    })
  })

  describe('templates', () => {
    it('offers no invitations, says why, and loads none', async () => {
      const loads = fakeShares()
      renderDialog({ board: TEMPLATE })
      await loaded()
      expect(screen.getByText('Templates can only be shared with people who already have an account.')).toBeInTheDocument()
      expect(screen.queryByText('Pending invitations')).not.toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Invite by email' })).not.toBeInTheDocument()
      expect(loads.invitations.requests).toEqual([])
      expect(loads.members.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-9/members'])
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })
  })

  describe('keeping up to date', () => {
    function openSocket() {
      setWebSocketToken('socket-token')
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      return socket
    }

    it.each(['board_invitations_changed', 'board_shared', 'board_unshared'])(
      'loads people and invitations again on %s from elsewhere',
      async (type) => {
        fakeShares()
        const socket = openSocket()
        renderDialog()
        await loaded()
        fakeShares({ members: [EMMA, LIAM, NOAH, OLIVIA], invitations: [] })

        socket.receive({ type, board_id: 'board-1', origin_client_id: null })

        expect(await screen.findByRole('button', { name: 'Remove Olivia Martin from this board' })).toBeInTheDocument()
        expect(await screen.findByText('No pending invitations.')).toBeInTheDocument()
      },
    )

    it("ignores its own changes, other boards', and other kinds", async () => {
      const loads = fakeShares()
      const socket = openSocket()
      renderDialog()
      await loaded()

      socket.receive({ type: 'board_shared', board_id: 'board-1', origin_client_id: getClientId() })
      socket.receive({ type: 'board_shared', board_id: 'board-2', origin_client_id: null })
      socket.receive({ type: 'card_updated', board_id: 'board-1', origin_client_id: null })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(loads.members.requests).toHaveLength(1)
      expect(loads.invitations.requests).toHaveLength(1)
    })

    it('stops listening once closed', async () => {
      const loads = fakeShares()
      const socket = openSocket()
      const { rerender } = renderDialog()
      await loaded()
      rerender(<ShareBoardDialog open={false} onClose={() => {}} board={BOARD} numberLocale="en_GB" dateFormat="numeric" />)

      socket.receive({ type: 'board_shared', board_id: 'board-1', origin_client_id: null })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(loads.members.requests).toHaveLength(1)
    })
  })

  describe('opening and closing', () => {
    it('loads people and invitations again on every opening', async () => {
      fakeShares()
      const { reopen } = renderDialog()
      await loaded()
      fakeShares({ members: [EMMA, NOAH], invitations: [] })

      reopen()

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Liam Chen from this board' })).not.toBeInTheDocument())
      expect(await screen.findByText('No pending invitations.')).toBeInTheDocument()
    })

    it('starts afresh: no search, address, outcome or error', async () => {
      fakeShares()
      fakeEndpoint('get', SEARCH, () => HttpResponse.json([OLIVIA]))
      fakeEndpoint('post', SHARES, failure())
      fakeEndpoint('post', INVITATIONS, () => HttpResponse.json({ detail: { code: 'already_invited' } }, { status: 409 }))
      const { user, reopen } = renderDialog()
      await screen.findByText('sofia@example.com')
      await user.type(searchField(), 'oli')
      await user.click(await screen.findByRole('option', { name: /Olivia Martin/ }))
      await within(shareDialog()).findByRole('alert')
      await user.type(emailField(), 'sofia@example.com')
      await user.click(sendButton())
      await screen.findByText('sofia@example.com already has a pending invitation.')
      await user.type(searchField(), 'ol')

      reopen()

      await loaded()
      expect(searchField()).toHaveValue('')
      expect(emailField()).toHaveValue('')
      expect(within(shareDialog()).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('loads nothing while closed', async () => {
      const loads = fakeShares()
      renderDialog({ open: false })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect([...loads.members.requests, ...loads.invitations.requests]).toEqual([])
    })

    it('closes on Close', async () => {
      fakeShares()
      const { user, onClose } = renderDialog()
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
