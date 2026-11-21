import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { blockSiteData } from '../test/blockSiteData'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders, type RenderOptions } from '../test/render'
import type { UserEvent } from '@testing-library/user-event'
import Boards from './Boards'

const WEBSITE = makeBoard({ id: 'board-1', name: 'Website redesign', owner_id: 'user-1' })
const OLD_SITE = makeBoard({ id: 'board-2', name: 'Old site', owner_id: 'user-1', is_archived: true })

// What can be made to fail: the boards (with their order), and the archived
// boards.
type Failing = 'boards' | 'order' | 'archived'

// The boards page's requests: one board of the user's own, starred or not,
// and one archived board. `server.restored()` moves the archived board among
// the user's own from then on. `server.fail(...)` makes a load fail from then
// on (a server error, unless told otherwise), and `server.recover(...)` makes
// it work again.
function boardsServer({ starred = false }: { starred?: boolean } = {}) {
  let restored = false
  const down = new Map<Failing, Answer>()
  const unless = (what: Failing, answer: Answer): Answer => (request) => (down.get(what) ?? answer)(request)
  const owned = () => [{ ...WEBSITE, is_starred: starred }, ...(restored ? [{ ...OLD_SITE, is_archived: false }] : [])]
  const boards = fakeEndpoint('get', '/api/v1/boards', unless('boards', () => HttpResponse.json({ owned: owned(), shared: [], templates: [] })))
  fakeEndpoint('get', '/api/v1/boards/order', unless('order', () => HttpResponse.json({
    starred_ids: starred ? ['board-1'] : [], owned_ids: owned().map((b) => b.id), shared_ids: [], template_ids: [],
  })))
  const archived = fakeEndpoint('get', '/api/v1/boards/archived', unless('archived', () => HttpResponse.json(restored ? [] : [OLD_SITE])))
  fakeEndpoint('get', '/api/v1/boards/:boardId/color', () => HttpResponse.json({ color: null }))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    fail: (what: Failing, answer: Answer = SERVER_ERROR) => { down.set(what, answer) },
    recover: (what: Failing) => { down.delete(what) },
    boardLoads: () => boards.requests.length,
    archivedLoads: () => archived.requests.length,
    restored: () => { restored = true },
  }
}

// The boards page, with the archived boards unfolded (as ?archived=1 does) or
// not, once the user's own board shows.
async function renderBoards({ archived = false }: { archived?: boolean } = {}) {
  const rendered = renderWithProviders(<Boards />, { route: archived ? '/boards?archived=1' : '/boards', auth: true })
  await screen.findAllByText('Website redesign')
  if (archived) await screen.findByText('Old site')
  return rendered
}

const sectionTitle = (title: string) => screen.getByText(new RegExp(`^${title} \\(\\d+\\)$`)).textContent

// The message at the foot of the page.
const failure = () => screen.findByRole('alert')

// The archived board's menu entry, picked from its menu.
async function fromArchivedMenu(user: UserEvent, entry: string) {
  await user.click(screen.getByRole('button', { name: 'Menu for Old site' }))
  await user.click(await screen.findByRole('menuitem', { name: entry }))
}

// The notification socket the signed-in page opened, connected.
async function openSocket() {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  socket.open()
  return socket
}

describe('Boards', () => {
  describe('folded sections, as the browser keeps them (6I)', () => {
    const KEY = 'kanbanmf.boards.accordions'
    // A section's header, which folds and unfolds it.
    const section = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title} \\(\\d+\\)$`) })

    it('folds the sections the browser kept folded', async () => {
      localStorage.setItem(KEY, JSON.stringify({ myBoards: false }))
      boardsServer({ starred: true })
      await renderBoards()

      expect(section('My Boards')).toHaveAttribute('aria-expanded', 'false')
      expect(section('Starred')).toHaveAttribute('aria-expanded', 'true')
    })

    it.each([
      ['text that isn\'t JSON', '{myBoards: false'],
      ['values that aren\'t true or false', JSON.stringify({ myBoards: 0, starred: 'no' })],
      ['something that isn\'t a set of sections', JSON.stringify([false, false])],
    ])('unfolds every section when what the browser kept is %s', async (_case, stored) => {
      localStorage.setItem(KEY, stored)
      boardsServer({ starred: true })
      await renderBoards()

      expect(section('My Boards')).toHaveAttribute('aria-expanded', 'true')
      expect(section('Starred')).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens, and folds all the same, when the browser blocks site data', async () => {
      blockSiteData()
      boardsServer()
      const { user } = await renderBoards()
      expect(section('My Boards')).toHaveAttribute('aria-expanded', 'true')

      await user.click(section('My Boards'))

      expect(section('My Boards')).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps a folded section', async () => {
      boardsServer()
      const { user } = await renderBoards()

      await user.click(section('My Boards'))

      expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ myBoards: false, starred: true })
    })
  })

  describe('notifications', () => {
    it('fetches the boards again on a change made elsewhere', async () => {
      const server = boardsServer()
      await renderBoards()
      const socket = await openSocket()

      socket.receive({ type: 'board_shared', board_id: 'board-1', list_id: null, origin_client_id: null })

      await waitFor(() => expect(server.boardLoads()).toBe(2))
    })

    it("ignores a label change, which only the cards on a board show", async () => {
      const server = boardsServer()
      await renderBoards()
      const socket = await openSocket()

      socket.receive({ type: 'labels_changed', board_id: 'board-1', list_id: null, origin_client_id: null })

      // Gives a refetch, were there one, time to be asked for.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.boardLoads()).toBe(1)
    })
  })

  describe('changes that fail', () => {
    it('takes the star off again, and says so, when starring a board is refused', async () => {
      boardsServer()
      const star = fakeEndpoint('post', '/api/v1/boards/:boardId/star', () => HttpResponse.json({ detail: 'Not found' }, { status: 404 }))
      const { user } = await renderBoards()

      await user.click(screen.getByRole('button', { name: 'Star Website redesign' }))

      expect(await failure()).toHaveTextContent('The board "Website redesign" couldn\'t be starred. Please try again.')
      expect(star.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/star'])
      expect(sectionTitle('Starred')).toBe('Starred (0)')
      expect(screen.getByRole('button', { name: 'Star Website redesign' })).toBeInTheDocument()
    })

    it('takes the star off again, and says so, when the connection drops', async () => {
      boardsServer()
      fakeEndpoint('post', '/api/v1/boards/:boardId/star', () => HttpResponse.error())
      const { user } = await renderBoards()

      await user.click(screen.getByRole('button', { name: 'Star Website redesign' }))

      expect(await failure()).toHaveTextContent('The board "Website redesign" couldn\'t be starred. Please try again.')
      expect(sectionTitle('Starred')).toBe('Starred (0)')
      expect(screen.getByRole('button', { name: 'Star Website redesign' })).toBeInTheDocument()
    })

    it('puts the star back, and says so, when unstarring a board fails', async () => {
      boardsServer({ starred: true })
      const unstar = fakeEndpoint('delete', '/api/v1/boards/:boardId/star', () => HttpResponse.error())
      const { user } = await renderBoards()
      expect(sectionTitle('Starred')).toBe('Starred (1)')

      await user.click(screen.getAllByRole('button', { name: 'Unstar Website redesign' })[0])

      expect(await failure()).toHaveTextContent('The board "Website redesign" couldn\'t be unstarred. Please try again.')
      expect(unstar.requests).toHaveLength(1)
      expect(sectionTitle('Starred')).toBe('Starred (1)')
      expect(screen.getAllByRole('button', { name: 'Unstar Website redesign' })).toHaveLength(2)
    })

    it('says nothing when the star is saved', async () => {
      boardsServer()
      fakeEndpoint('post', '/api/v1/boards/:boardId/star')
      const { user } = await renderBoards()

      await user.click(screen.getByRole('button', { name: 'Star Website redesign' }))

      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Unstar Website redesign' })).toHaveLength(2))
      expect(sectionTitle('Starred')).toBe('Starred (1)')
      // Gives a late revert, were there one, time to show.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sectionTitle('Starred')).toBe('Starred (1)')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("says an archived board couldn't be restored when it is refused, and fetches the archived boards again", async () => {
      const server = boardsServer()
      const restore = fakeEndpoint('patch', '/api/v1/boards/:boardId', () => HttpResponse.json({ detail: 'Not found' }, { status: 404 }))
      const { user } = await renderBoards({ archived: true })
      expect(server.archivedLoads()).toBe(1)

      await fromArchivedMenu(user, 'Restore Board')

      expect(await failure()).toHaveTextContent('The board "Old site" couldn\'t be restored. Please try again.')
      expect(restore.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-2', { is_archived: false }]])
      await waitFor(() => expect(server.archivedLoads()).toBe(2))
      expect(sectionTitle('Archived Boards')).toBe('Archived Boards (1)')
      expect(server.boardLoads()).toBe(1)
    })

    it("says an archived board couldn't be restored when the connection drops", async () => {
      boardsServer()
      fakeEndpoint('patch', '/api/v1/boards/:boardId', () => HttpResponse.error())
      const { user } = await renderBoards({ archived: true })

      await fromArchivedMenu(user, 'Restore Board')

      expect(await failure()).toHaveTextContent('The board "Old site" couldn\'t be restored. Please try again.')
      expect(sectionTitle('Archived Boards')).toBe('Archived Boards (1)')
    })

    it('says nothing when a board is restored, and moves it among your boards', async () => {
      const server = boardsServer()
      fakeEndpoint('patch', '/api/v1/boards/:boardId', () => {
        server.restored()
        return HttpResponse.json({ ...OLD_SITE, is_archived: false })
      })
      const { user } = await renderBoards({ archived: true })

      await fromArchivedMenu(user, 'Restore Board')

      await waitFor(() => expect(sectionTitle('Archived Boards')).toBe('Archived Boards (0)'))
      await waitFor(() => expect(sectionTitle('My Boards')).toBe('My Boards (2)'))
      expect(server.boardLoads()).toBe(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('loads that fail', () => {
    it("says the boards couldn't be loaded, rather than show empty sections, and loads them with Try again", async () => {
      const server = boardsServer()
      server.fail('boards')
      const { user } = renderWithProviders(<Boards />, { route: '/boards', auth: true })

      expect(await screen.findByRole('alert')).toHaveTextContent("Your boards couldn't be loaded.")
      expect(screen.queryByText(/^My Boards/)).not.toBeInTheDocument()
      expect(screen.queryByText('No boards here yet.')).not.toBeInTheDocument()
      server.recover('boards')
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Website redesign')
      expect(sectionTitle('My Boards')).toBe('My Boards (1)')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.boardLoads()).toBe(2)
    })

    it('takes the message away while Try again loads, and brings it back if it fails again', async () => {
      const server = boardsServer()
      server.fail('boards')
      const { user } = renderWithProviders(<Boards />, { route: '/boards', auth: true })
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail('boards', held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("Your boards couldn't be loaded.")
    })

    it("takes the archived boards' message away while Try again loads, and brings it back if it fails again", async () => {
      const server = boardsServer()
      server.fail('archived')
      const { user } = renderWithProviders(<Boards />, { route: '/boards?archived=1', auth: true })
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail('archived', held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("The archived boards couldn't be loaded.")
    })

    it("says so when only the boards' order can't be reached", async () => {
      const server = boardsServer()
      server.fail('order', DROPPED)
      renderWithProviders(<Boards />, { route: '/boards', auth: true })

      expect(await screen.findByRole('alert')).toHaveTextContent("Your boards couldn't be loaded.")
      expect(screen.queryByText('Website redesign')).not.toBeInTheDocument()
    })

    it('shows no sections while the boards are loading, so none reads as empty', async () => {
      boardsServer()
      renderWithProviders(<Boards />, { route: '/boards', auth: true })

      expect(screen.queryByText(/^My Boards/)).not.toBeInTheDocument()
      expect(screen.queryByText('No boards here yet.')).not.toBeInTheDocument()
      await screen.findByText('Website redesign')
    })

    it('takes the boards away when fetching them again fails', async () => {
      const server = boardsServer()
      await renderBoards()
      const socket = await openSocket()
      server.fail('boards', DROPPED)

      socket.receive({ type: 'board_shared', board_id: 'board-1', list_id: null, origin_client_id: null })

      expect(await screen.findByRole('alert')).toHaveTextContent("Your boards couldn't be loaded.")
      expect(screen.queryByText('Website redesign')).not.toBeInTheDocument()
    })

    it("says the archived boards couldn't be loaded, with no count, and loads them with Try again", async () => {
      const server = boardsServer()
      server.fail('archived')
      const { user } = renderWithProviders(<Boards />, { route: '/boards?archived=1', auth: true })
      await screen.findByText('Website redesign')

      expect(await screen.findByRole('alert')).toHaveTextContent("The archived boards couldn't be loaded.")
      expect(screen.getByText('Archived Boards')).toBeInTheDocument()
      server.recover('archived')
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Old site')
      expect(sectionTitle('Archived Boards')).toBe('Archived Boards (1)')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.archivedLoads()).toBe(2)
    })

    it('says so too when the archived boards are opened from the button', async () => {
      const server = boardsServer()
      server.fail('archived', DROPPED)
      const { user } = await renderBoards()

      await user.click(screen.getByRole('button', { name: 'Show Archived Boards' }))

      expect(await screen.findByRole('alert')).toHaveTextContent("The archived boards couldn't be loaded.")
      const section = screen.getByText('Archived Boards').closest<HTMLElement>('.MuiAccordion-root')!
      expect(within(section).queryByText('No boards here yet.')).not.toBeInTheDocument()
    })
  })

  describe('buttons named after their board (6K)', () => {
    const MOBILE = makeBoard({ id: 'board-3', name: 'Mobile app', owner_id: 'user-1', is_starred: true })
    const WEEKLY = makeBoard({ id: 'board-4', name: 'Weekly review', owner_id: 'user-1', is_template: true })
    const OLD_BLOG = makeBoard({ id: 'board-5', name: 'Old blog', owner_id: 'user-1', is_archived: true })

    // Two boards of the user's own, one of them starred, a template, and two
    // archived boards, unfolded.
    async function renderNamed(auth: RenderOptions['auth'] = true) {
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [WEBSITE, MOBILE], shared: [], templates: [WEEKLY] }))
      fakeEndpoint('get', '/api/v1/boards/order', () => HttpResponse.json({
        starred_ids: ['board-3'], owned_ids: ['board-1', 'board-3'], shared_ids: [], template_ids: ['board-4'],
      }))
      fakeEndpoint('get', '/api/v1/boards/archived', () => HttpResponse.json([OLD_SITE, OLD_BLOG]))
      fakeEndpoint('get', '/api/v1/boards/:boardId/color', () => HttpResponse.json({ color: null }))
      fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
      const rendered = renderWithProviders(<Boards />, { route: '/boards?archived=1', auth })
      await screen.findByText('Old blog')
      return rendered
    }

    it("names each tile's handle, star and menu after its board, and leaves no button unnamed", async () => {
      await renderNamed()

      for (const name of ['Move Website redesign', 'Star Website redesign', 'Menu for Website redesign']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
      // A starred board shows twice, under Starred and among the user's own.
      for (const name of ['Move Mobile app', 'Unstar Mobile app', 'Menu for Mobile app']) {
        expect(screen.getAllByRole('button', { name })).toHaveLength(2)
      }
      // A template has no star.
      expect(screen.getByRole('button', { name: 'Move Weekly review' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Menu for Weekly review' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Star Weekly review/ })).not.toBeInTheDocument()
      // The archived boards have a menu only.
      expect(screen.getByRole('button', { name: 'Menu for Old site' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Menu for Old blog' })).toBeInTheDocument()
      for (const button of screen.getAllByRole('button')) expect(button).toHaveAccessibleName()
    })

    it('opens the menu of the board it is named after', async () => {
      const { user } = await renderNamed()

      await user.click(screen.getAllByRole('button', { name: 'Menu for Mobile app' })[0])
      await user.click(await screen.findByRole('menuitem', { name: 'Change Name' }))

      expect(within(await screen.findByRole('dialog')).getByRole('textbox')).toHaveValue('Mobile app')
    })

    it('names them in Catalan for a user who reads Catalan', async () => {
      await renderNamed({ language_locale: 'ca_ES' })

      expect(await screen.findByRole('button', { name: 'Menú de Website redesign' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Destaca Website redesign' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mou Website redesign' })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Treu Mobile app de destacats' })).toHaveLength(2)
      expect(screen.getByRole('button', { name: 'Menú de Old blog' })).toBeInTheDocument()
    })
  })
})
