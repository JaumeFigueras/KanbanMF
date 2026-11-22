import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import { getClientId } from '../api/client'
import { blockSiteData } from '../test/blockSiteData'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeBoard, makeUser } from '../test/fixtures'
import { renderWithProviders, type RenderOptions } from '../test/render'
import type { UserEvent } from '@testing-library/user-event'
import type { BoardRead } from '../types/board'
import Boards from './Boards'

const WEBSITE = makeBoard({ id: 'board-1', name: 'Website redesign', owner_id: 'user-1' })
const OLD_SITE = makeBoard({ id: 'board-2', name: 'Old site', owner_id: 'user-1', is_archived: true })
const SPRINT = makeBoard({ id: 'board-3', name: 'Sprint template', owner_id: 'user-1', is_template: true })
const ROADMAP = makeBoard({ id: 'board-5', name: 'Roadmap', owner_id: 'user-2', owner_display_name: 'Liam Chen' })

// What can be made to fail: the boards (with their order), and the archived
// boards.
type Failing = 'boards' | 'order' | 'archived'

// The boards page's requests: one board of the user's own, starred or not,
// any boards shared with the user and templates, and one archived board. `server.restored()` moves the archived board among
// the user's own from then on. `server.fail(...)` makes a load fail from then
// on (a server error, unless told otherwise), and `server.recover(...)` makes
// it work again.
function boardsServer(
  { starred = false, shared = [], templates = [] }: { starred?: boolean, shared?: BoardRead[], templates?: BoardRead[] } = {},
) {
  let restored = false
  const down = new Map<Failing, Answer>()
  const unless = (what: Failing, answer: Answer): Answer => (request) => (down.get(what) ?? answer)(request)
  const owned = () => [{ ...WEBSITE, is_starred: starred }, ...(restored ? [{ ...OLD_SITE, is_archived: false }] : [])]
  const boards = fakeEndpoint('get', '/api/v1/boards', unless('boards', () => HttpResponse.json({ owned: owned(), shared, templates })))
  fakeEndpoint('get', '/api/v1/boards/order', unless('order', () => HttpResponse.json({
    starred_ids: starred ? ['board-1'] : [], owned_ids: owned().map((b) => b.id), shared_ids: shared.map((b) => b.id),
    template_ids: templates.map((b) => b.id),
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
  // Shown on /boards only, as the app does: on any other address it's gone.
  const page = (
    <>
      <Routes>
        <Route path="/boards" element={<Boards />} />
        <Route path="*" element={null} />
      </Routes>
      <Address />
    </>
  )
  const rendered = renderWithProviders(page, { route: archived ? '/boards?archived=1' : '/boards', auth: true })
  await screen.findAllByText('Website redesign')
  if (archived) await screen.findByText('Old site')
  return rendered
}

const sectionTitle = (title: string) => screen.getByText(new RegExp(`^${title} \\(\\d+\\)$`)).textContent

// The message at the foot of the page.
const failure = () => screen.findByRole('alert')

// A board's menu entry, picked from its tile's menu (the first tile of
// that name: a starred board shows twice).
async function fromBoardMenu(user: UserEvent, board: string, entry: string) {
  await user.click(screen.getAllByRole('button', { name: `Menu for ${board}` })[0])
  await user.click(await screen.findByRole('menuitem', { name: entry }))
}

// A section's header, which folds and unfolds it.
const sectionHeader = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title} \\(\\d+\\)$`) })

// The address the router is at, to see where a button leads.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}
const address = () => screen.getByTestId('address').textContent

// Gives a request, were there one, time to be sent.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

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

  describe('creating', () => {
    it('creates a board, starred if asked, and shows it in its sections', async () => {
      boardsServer()
      const NEW = makeBoard({ id: 'board-9', name: 'Launch plan', owner_id: 'user-1', is_starred: true })
      const created = fakeEndpoint('post', '/api/v1/boards', () => HttpResponse.json(NEW, { status: 201 }))
      const { user } = await renderBoards()

      await user.click(screen.getByRole('button', { name: 'Create a new Board' }))
      const dialog = await screen.findByRole('dialog', { name: 'Create a new Board' })
      await user.type(within(dialog).getByRole('textbox', { name: /^Board name/ }), '  Launch plan ')
      await user.click(within(dialog).getByRole('checkbox', { name: 'Starred' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(sectionTitle('My Boards')).toBe('My Boards (2)'))
      expect(sectionTitle('Starred')).toBe('Starred (1)')
      expect(screen.getAllByText('Launch plan')).toHaveLength(2)
      expect(created.requests.map((r) => r.body)).toEqual([{ name: 'Launch plan', is_starred: true, template_id: null }])
    })

    it('creates a template from the Templates section', async () => {
      boardsServer()
      const NEW = makeBoard({ id: 'board-8', name: 'Sprint', owner_id: 'user-1', is_template: true })
      const created = fakeEndpoint('post', '/api/v1/boards', () => HttpResponse.json(NEW, { status: 201 }))
      const { user } = await renderBoards()

      await user.click(screen.getByRole('button', { name: 'New Template' }))
      const dialog = await screen.findByRole('dialog', { name: 'Create a new Template' })
      await user.type(within(dialog).getByRole('textbox', { name: /^Template name/ }), 'Sprint')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(sectionTitle('Templates')).toBe('Templates (1)'))
      expect(screen.getByText('Sprint')).toBeInTheDocument()
      expect(sectionTitle('My Boards')).toBe('My Boards (1)')
      expect(created.requests.map((r) => r.body)).toEqual([{ name: 'Sprint', is_template: true }])
    })

    it.each([
      ['Create a new Board', 'Create a new Board'],
      ['New Template', 'Create a new Template'],
    ])('closes the dialog of %s with Cancel, creating nothing', async (button, dialogName) => {
      boardsServer()
      const created = fakeEndpoint('post', '/api/v1/boards')
      const { user } = await renderBoards()
      await user.click(screen.getByRole('button', { name: button }))
      const dialog = await screen.findByRole('dialog', { name: dialogName })

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(created.requests).toEqual([])
    })
  })

  describe("a board's menu", () => {
    it('renames the board in every section that shows it', async () => {
      boardsServer({ starred: true })
      const renamed = fakeEndpoint('patch', '/api/v1/boards/:boardId', () => HttpResponse.json({ ...WEBSITE, name: 'Website relaunch' }))
      const { user } = await renderBoards()

      await fromBoardMenu(user, 'Website redesign', 'Change Name')
      const dialog = await screen.findByRole('dialog', { name: 'Change Name' })
      const name = within(dialog).getByRole('textbox')
      await user.clear(name)
      await user.type(name, 'Website relaunch')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.getAllByText('Website relaunch')).toHaveLength(2))
      expect(screen.queryByText('Website redesign')).not.toBeInTheDocument()
      expect(renamed.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-1', { name: 'Website relaunch' }]])
    })

    it("tints the tile with the colour saved, on every tile of that board", async () => {
      boardsServer({ starred: true })
      const coloured = fakeEndpoint('put', '/api/v1/boards/:boardId/color', () => HttpResponse.json({ color: '#1976D2' }))
      const { user } = await renderBoards()
      const tiles = () => screen.getAllByText('Website redesign').map((name) => name.closest<HTMLElement>('.MuiCard-root')!)
      const plain = getComputedStyle(tiles()[0]).backgroundColor

      await fromBoardMenu(user, 'Website redesign', 'Change Color')
      const dialog = await screen.findByRole('dialog', { name: 'Change Color' })
      await user.click(within(dialog).getByRole('button', { name: '#1976D2' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(getComputedStyle(tiles()[0]).backgroundColor).not.toBe(plain))
      expect(getComputedStyle(tiles()[1]).backgroundColor).toBe(getComputedStyle(tiles()[0]).backgroundColor)
      expect(coloured.requests.map((r) => r.body)).toEqual([{ color: '#1976D2' }])
    })

    it("opens the share dialog for that board, and closes it", async () => {
      boardsServer()
      const members = fakeEndpoint('get', '/api/v1/boards/:boardId/members', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/boards/:boardId/invitations', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/config', () => HttpResponse.json({ email_enabled: false }))
      const { user } = await renderBoards()

      await fromBoardMenu(user, 'Website redesign', 'Share')

      const dialog = await screen.findByRole('dialog', { name: 'Share board' })
      await waitFor(() => expect(members.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/members']))
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('opens the e-mail notifications for that board, and closes them', async () => {
      boardsServer()
      const settings = fakeEndpoint('get', '/api/v1/boards/:boardId/notifications', () => HttpResponse.json({ enabled: false, offsets: [] }))
      fakeEndpoint('get', '/api/v1/config', () => HttpResponse.json({ email_enabled: true }))
      const { user } = await renderBoards()

      await fromBoardMenu(user, 'Website redesign', 'E-Mail notification')

      const dialog = await screen.findByRole('dialog', { name: 'My e-mail notifications' })
      await waitFor(() => expect(settings.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/notifications']))
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('archives the board, taking it out of every section and leaving the others', async () => {
      boardsServer({ starred: true, shared: [ROADMAP], templates: [SPRINT] })
      const archived = fakeEndpoint('patch', '/api/v1/boards/:boardId', () => HttpResponse.json({ ...WEBSITE, is_archived: true }))
      const { user } = await renderBoards()

      await fromBoardMenu(user, 'Website redesign', 'Archive Board')
      const dialog = await screen.findByRole('dialog', { name: 'Archive Board' })
      await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

      await waitFor(() => expect(screen.queryByText('Website redesign')).not.toBeInTheDocument())
      expect(sectionTitle('My Boards')).toBe('My Boards (0)')
      expect(sectionTitle('Starred')).toBe('Starred (0)')
      expect(sectionTitle('Shared with me')).toBe('Shared with me (1)')
      expect(sectionTitle('Templates')).toBe('Templates (1)')
      expect(archived.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-1', { is_archived: true }]])
    })

    it('puts the board it archives first among the archived boards, when they show', async () => {
      boardsServer()
      fakeEndpoint('patch', '/api/v1/boards/:boardId', () => HttpResponse.json({ ...WEBSITE, is_archived: true }))
      const { user } = await renderBoards({ archived: true })

      await fromBoardMenu(user, 'Website redesign', 'Archive Board')
      await user.click(within(await screen.findByRole('dialog', { name: 'Archive Board' })).getByRole('button', { name: 'Archive' }))

      await waitFor(() => expect(screen.getByText(/^Archived Boards/)).toHaveTextContent('Archived Boards (2)'))
      // The page behind the dialog is hidden from screen readers until it has gone.
      await waitFor(() => expect(screen.getAllByRole('button', { name: /^Menu for / }).map((b) => b.getAttribute('aria-label')))
        .toEqual(['Menu for Website redesign', 'Menu for Old site']))
    })

    it('duplicates a template into the Templates section', async () => {
      const SPRINT = makeBoard({ id: 'board-3', name: 'Sprint', owner_id: 'user-1', is_template: true })
      boardsServer({ templates: [SPRINT] })
      const COPY = makeBoard({ id: 'board-4', name: 'Sprint (copy)', owner_id: 'user-1', is_template: true })
      const duplicated = fakeEndpoint('post', '/api/v1/boards/:boardId/duplicate', () => HttpResponse.json(COPY, { status: 201 }))
      const { user } = await renderBoards()

      await fromBoardMenu(user, 'Sprint', 'Duplicate')
      const dialog = await screen.findByRole('dialog', { name: 'Duplicate template' })
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(sectionTitle('Templates')).toBe('Templates (2)'))
      expect(screen.getByText('Sprint (copy)')).toBeInTheDocument()
      expect(duplicated.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-3/duplicate'])
    })

    it.each([
      ['Change Name', 'Change Name'],
      ['Archive Board', 'Archive Board'],
    ])('closes %s with Cancel, changing nothing', async (entry, dialogName) => {
      boardsServer()
      const changed = fakeEndpoint('patch', '/api/v1/boards/:boardId')
      const { user } = await renderBoards()
      await fromBoardMenu(user, 'Website redesign', entry)
      const dialog = await screen.findByRole('dialog', { name: dialogName })

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(changed.requests).toEqual([])
      expect(screen.getByText('Website redesign')).toBeInTheDocument()
    })

    it('closes the duplicate dialog with Cancel', async () => {
      boardsServer({ templates: [makeBoard({ id: 'board-3', name: 'Sprint', owner_id: 'user-1', is_template: true })] })
      const duplicated = fakeEndpoint('post', '/api/v1/boards/:boardId/duplicate')
      const { user } = await renderBoards()
      await fromBoardMenu(user, 'Sprint', 'Duplicate')

      await user.click(within(await screen.findByRole('dialog', { name: 'Duplicate template' })).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(duplicated.requests).toEqual([])
    })

    it("shows a tile in no colour when its colour can't be loaded", async () => {
      boardsServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId/color', DROPPED)
      await renderBoards()

      expect(screen.getByText('Website redesign').closest('.MuiCard-root')).toBeInTheDocument()
    })
  })

  describe('the archived boards', () => {
    it('deletes one for good, after asking, leaving the other boards', async () => {
      const server = boardsServer({ starred: true, shared: [ROADMAP], templates: [SPRINT] })
      const deleted = fakeEndpoint('delete', '/api/v1/boards/:boardId')
      const { user } = await renderBoards({ archived: true })

      await fromArchivedMenu(user, 'Delete Board')
      const dialog = await screen.findByRole('dialog', { name: 'Delete Board' })
      expect(dialog).toHaveTextContent('Are you sure you want to permanently delete "Old site"?')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(screen.queryByText('Old site')).not.toBeInTheDocument())
      expect(screen.getByText(/^Archived Boards/)).toHaveTextContent('Archived Boards (0)')
      expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-2'])
      expect(server.archivedLoads()).toBe(1)
      expect(sectionTitle('Starred')).toBe('Starred (1)')
      expect(sectionTitle('Shared with me')).toBe('Shared with me (1)')
      expect(sectionTitle('Templates')).toBe('Templates (1)')
    })

    it('opens nothing from a click on an archived tile', async () => {
      boardsServer()
      const { user } = await renderBoards({ archived: true })
      const tile = screen.getByText('Old site').closest<HTMLElement>('.MuiCard-root')!

      await user.click(within(tile).getAllByText(/./)[0])
      await user.click(screen.getByText('Old site'))

      expect(address()).toBe('/boards')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('keeps the board when the question is cancelled, and when its menu closes with Escape', async () => {
      boardsServer()
      const deleted = fakeEndpoint('delete', '/api/v1/boards/:boardId')
      const { user } = await renderBoards({ archived: true })
      await fromArchivedMenu(user, 'Delete Board')

      await user.click(within(await screen.findByRole('dialog', { name: 'Delete Board' })).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Menu for Old site' }))
      await screen.findByRole('menu')
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      expect(screen.getByText('Old site')).toBeInTheDocument()
      expect(deleted.requests).toEqual([])
    })

    it('hides the section with its chevron, bringing back its button', async () => {
      boardsServer()
      const { user } = await renderBoards({ archived: true })

      await user.click(screen.getByRole('button', { name: /^Archived Boards/ }))

      await waitFor(() => expect(screen.queryByText('Old site')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Show Archived Boards' })).toBeInTheDocument()
    })

    it('searches them with Enter, from two letters, without the spaces around', async () => {
      boardsServer()
      const { user } = await renderBoards({ archived: true })
      const box = screen.getByRole('textbox', { name: 'Search archived boards' })

      await user.type(box, ' o {Enter}')
      expect(address()).toBe('/boards')
      await user.type(box, 'ld {Enter}')

      expect(address()).toBe('/search?q=o+ld&archived=1')
    })
  })

  describe('folding the sections', () => {
    it.each(['Starred', 'Shared with me', 'Templates'])('folds and unfolds %s', async (title) => {
      boardsServer()
      const { user } = await renderBoards()
      expect(sectionHeader(title)).toHaveAttribute('aria-expanded', 'true')

      await user.click(sectionHeader(title))

      expect(sectionHeader(title)).toHaveAttribute('aria-expanded', 'false')
      await user.click(sectionHeader(title))
      expect(sectionHeader(title)).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('where it leads', () => {
    it('opens a board from its tile', async () => {
      boardsServer()
      const { user } = await renderBoards()

      await user.click(screen.getByText('Website redesign'))

      expect(address()).toBe('/boards/board-1')
    })

    it('opens the overdue tasks', async () => {
      boardsServer()
      const { user } = await renderBoards()

      await user.click(screen.getByRole('link', { name: 'Show Overdue Tasks' }))

      expect(address()).toBe('/overdue')
    })

    // 6V: the tiles and Show Overdue Tasks were buttons, which can't.
    it('makes each tile and Show Overdue Tasks a link, so they can also open in a new tab', async () => {
      boardsServer({ starred: true, shared: [ROADMAP], templates: [SPRINT] })
      await renderBoards()

      expect(screen.getByRole('link', { name: 'Show Overdue Tasks' })).toHaveAttribute('href', '/overdue')
      // A starred board has a tile in Starred and one in its own section.
      const tiles = screen.getAllByRole('link', { name: /Website redesign/ })
      expect(tiles).toHaveLength(2)
      for (const tile of tiles) expect(tile).toHaveAttribute('href', '/boards/board-1')
      expect(screen.getByRole('link', { name: /Roadmap/ })).toHaveAttribute('href', '/boards/board-5')
      expect(screen.getByRole('link', { name: /Sprint template/ })).toHaveAttribute('href', '/boards/board-3')
    })

    it('opens a board from its tile with the keyboard', async () => {
      boardsServer()
      const { user } = await renderBoards()
      act(() => screen.getByRole('link', { name: /Website redesign/ }).focus())

      await user.keyboard('{Enter}')

      expect(address()).toBe('/boards/board-1')
    })
  })

  describe('notifications', () => {
    it('fetches the boards, and the archived ones while they show, again when your avatar changes', async () => {
      const server = boardsServer()
      fakeEndpoint('delete', '/api/v1/users/me/avatar')
      URL.createObjectURL = vi.fn(() => 'blob:avatar-1')
      URL.revokeObjectURL = vi.fn()
      onTestFinished(() => {
        // @ts-expect-error -- jsdom doesn't have them; put it back that way.
        delete URL.createObjectURL
        // @ts-expect-error -- as above.
        delete URL.revokeObjectURL
      })
      fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(new Blob(['png'], { type: 'image/png' })))
      const { user } = await renderBoards({ archived: true })

      await user.click(screen.getByRole('button', { name: 'User profile' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Change / Remove avatar' }))
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove avatar' }))

      await waitFor(() => expect(server.boardLoads()).toBe(2))
      expect(server.archivedLoads()).toBe(2)
    })

    it('ignores a change it made itself, and a change to invitations', async () => {
      const server = boardsServer()
      await renderBoards()
      const socket = await openSocket()

      socket.receive({ type: 'board_shared', board_id: 'board-1', list_id: null, origin_client_id: getClientId() })
      socket.receive({ type: 'board_invitations_changed', board_id: 'board-1', list_id: null, origin_client_id: null })

      await settle()
      expect(server.boardLoads()).toBe(1)
    })

    it('fetches the archived boards again too, while they show', async () => {
      const server = boardsServer()
      await renderBoards({ archived: true })
      const socket = await openSocket()

      socket.receive({ type: 'board_archived', board_id: 'board-1', list_id: null, origin_client_id: null })

      await waitFor(() => expect(server.archivedLoads()).toBe(2))
      expect(server.boardLoads()).toBe(2)
    })

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
    it('closes its message with the close button', async () => {
      boardsServer()
      fakeEndpoint('post', '/api/v1/boards/:boardId/star', SERVER_ERROR)
      const { user } = await renderBoards()
      await user.click(screen.getByRole('button', { name: 'Star Website redesign' }))
      const message = await failure()

      await user.click(within(message).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })

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

  describe('answers that come back out of order', () => {
    // From now on, the first request to an endpoint gets the older answer,
    // held until released; the ones after it get the newer one at once.
    function olderAnswerLast(url: string, older: Answer, newer: Answer) {
      const held = heldAnswer(older)
      let first = true
      fakeEndpoint('get', url, (request) => {
        const answer = first ? held.answer : newer
        first = false
        return answer(request)
      })
      return held
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
    const change = { type: 'board_renamed', board_id: 'board-1', list_id: null, origin_client_id: null }

    it('keeps the newer boards when an older answer comes last', async () => {
      boardsServer()
      await renderBoards()
      const socket = await openSocket()
      const boardsAnswer = (board: BoardRead): Answer => () => HttpResponse.json({ owned: [board], shared: [], templates: [] })
      const held = olderAnswerLast('/api/v1/boards', boardsAnswer(WEBSITE), boardsAnswer({ ...WEBSITE, name: 'Website relaunch' }))

      socket.receive(change)
      socket.receive(change)
      expect(await screen.findByText('Website relaunch')).toBeInTheDocument()
      held.release()
      await settle()

      expect(screen.getByText('Website relaunch')).toBeInTheDocument()
      expect(screen.queryByText('Website redesign')).not.toBeInTheDocument()
    })

    it('keeps the newer archived boards when an older answer comes last', async () => {
      boardsServer()
      await renderBoards({ archived: true })
      const socket = await openSocket()
      const held = olderAnswerLast(
        '/api/v1/boards/archived',
        () => HttpResponse.json([OLD_SITE]),
        () => HttpResponse.json([{ ...OLD_SITE, name: 'Old site, 2019' }]),
      )

      socket.receive(change)
      socket.receive(change)
      expect(await screen.findByText('Old site, 2019')).toBeInTheDocument()
      held.release()
      await settle()

      expect(screen.getByText('Old site, 2019')).toBeInTheDocument()
      expect(screen.queryByText('Old site')).not.toBeInTheDocument()
    })
  })

  describe('who you are (6Q)', () => {
    // The page asks who you are itself, as does its top bar: signed out, the
    // test answers both.
    function whoYouAre(first: Answer) {
      let answer = first
      fakeEndpoint('get', '/api/v1/users/me', (request) => answer(request))
      return { answers: (next: Answer) => { answer = next } }
    }
    const YOU: Answer = () => HttpResponse.json(makeUser({ id: 'user-1' }))

    // The entries of a board tile's menu, which closes again.
    async function menuOf(user: UserEvent, board: string) {
      await user.click(screen.getByRole('button', { name: `Menu for ${board}` }))
      const entries = (await screen.findAllByRole('menuitem')).map((e) => e.textContent)
      await user.keyboard('{Escape}')
      return entries
    }

    it.each([
      ['a server error', SERVER_ERROR],
      ['a dropped connection', DROPPED],
    ])("says the boards couldn't be loaded when it fails with %s, rather than show your templates as someone else's", async (_case, answer) => {
      const server = boardsServer({ templates: [SPRINT] })
      const me = whoYouAre(answer)
      const { user } = renderWithProviders(<Boards />, { route: '/boards' })

      expect(await screen.findByRole('alert')).toHaveTextContent("Your boards couldn't be loaded.")
      expect(screen.queryByText('Sprint template')).not.toBeInTheDocument()
      expect(screen.queryByText('Website redesign')).not.toBeInTheDocument()
      me.answers(YOU)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Sprint template')
      expect(await menuOf(user, 'Sprint template')).toEqual(['Change Name', 'Change Color', 'Share', 'Duplicate', 'Archive Template'])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      // The boards had come: only who you are is asked again.
      expect(server.boardLoads()).toBe(1)
    })

    it('asks again for the boards too when both failed', async () => {
      const server = boardsServer()
      server.fail('boards')
      const me = whoYouAre(SERVER_ERROR)
      const { user } = renderWithProviders(<Boards />, { route: '/boards' })
      await screen.findByText("Your boards couldn't be loaded.")
      server.recover('boards')
      me.answers(YOU)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Website redesign')
      expect(server.boardLoads()).toBe(2)
    })

    it('brings the message back if who you are fails again', async () => {
      boardsServer()
      const me = whoYouAre(SERVER_ERROR)
      const { user } = renderWithProviders(<Boards />, { route: '/boards' })
      await screen.findByText("Your boards couldn't be loaded.")
      const held = heldAnswer(SERVER_ERROR)
      me.answers(held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByText("Your boards couldn't be loaded.")).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByText("Your boards couldn't be loaded.")).toBeInTheDocument()
    })

    it('shows no sections until it knows who you are, and then your templates as yours', async () => {
      const server = boardsServer({ templates: [SPRINT] })
      const held = heldAnswer(YOU)
      whoYouAre(held.answer)
      const { user } = renderWithProviders(<Boards />, { route: '/boards' })
      await waitFor(() => expect(server.boardLoads()).toBe(1))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(screen.queryByText('Sprint template')).not.toBeInTheDocument()
      expect(screen.queryByText(/^Templates \(/)).not.toBeInTheDocument()
      held.release()

      await screen.findByText('Sprint template')
      expect(await menuOf(user, 'Sprint template')).toContain('Archive Template')
    })

    it("keeps someone else's template theirs", async () => {
      boardsServer({ templates: [{ ...SPRINT, owner_id: 'user-2' }] })
      whoYouAre(YOU)
      const { user } = renderWithProviders(<Boards />, { route: '/boards' })
      await screen.findByText('Sprint template')

      expect(await menuOf(user, 'Sprint template')).toEqual(['Change Color', 'Duplicate'])
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
