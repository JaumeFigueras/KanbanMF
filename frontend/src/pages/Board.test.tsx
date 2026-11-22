import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import type { CardRead, LabelRead } from '../types/board'
import { getClientId } from '../api/client'
import { blockSiteData } from '../test/blockSiteData'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeBoard, makeCard, makeLabel, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import Board from './Board'

const BOARD = makeBoard({ id: 'board-1', name: 'Website redesign', owner_id: 'user-1' })
const TODO = makeList({ id: 'list-1', board_id: 'board-1', name: 'To do' })
const DOING = makeList({ id: 'list-2', board_id: 'board-1', name: 'Doing' })
const URGENT = makeLabel({ id: 'label-1', board_id: 'board-1', name: 'Urgent', color: '#D32F2F' })
const CARDS_URL = '/api/v1/boards/:boardId/lists/:listId/cards'

// What can be made to fail: the board, its lists (with their order and
// colours), and one list's cards.
type Failing = 'board' | 'lists' | 'cards:list-1' | 'cards:list-2'

// The board as the server has it: two lists, a card in each, both with the
// label given, plus any `more` cards. `server.labelIs(...)` changes the label
// the two cards come back with from then on, as a rename would, and
// `server.archived(...)` leaves a card out from then on. `server.fail(...)`
// makes a load fail from then on (a server error, unless told otherwise),
// and `server.recover(...)` makes it work again.
function boardServer({ more = [] }: { more?: CardRead[] } = {}) {
  let label: LabelRead = URGENT
  const archived = new Set<string>()
  const down = new Map<Failing, Answer>()
  const unless = (what: Failing, answer: Answer): Answer => (request) => (down.get(what) ?? answer)(request)
  const cardsOf = (listId: string): CardRead[] => [
    makeCard({ id: `card-${listId}`, list_id: listId, name: listId === 'list-1' ? 'Homepage layout' : 'Footer links', labels: [label] }),
    ...more.filter((c) => c.list_id === listId),
  ].filter((c) => !archived.has(c.id))
  const listOf = (url: string, from: number) => new URL(url).pathname.split('/').at(from)!
  fakeEndpoint('get', '/api/v1/boards/:boardId', unless('board', () => HttpResponse.json(BOARD)))
  const lists = fakeEndpoint('get', '/api/v1/boards/:boardId/lists', unless('lists', () => HttpResponse.json([TODO, DOING])))
  fakeEndpoint('get', '/api/v1/boards/:boardId/lists/order', () => HttpResponse.json({ board_id: 'board-1', list_ids: ['list-1', 'list-2'] }))
  fakeEndpoint('get', '/api/v1/boards/:boardId/colors', () => HttpResponse.json({ board: null, lists: {}, cards: {} }))
  fakeEndpoint('get', `${CARDS_URL}/order`, ({ url }) => HttpResponse.json({ list_id: listOf(url, -3), card_ids: [] }))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  const cards = fakeEndpoint('get', CARDS_URL, (request) => {
    const listId = listOf(request.url, -2)
    return unless(`cards:${listId}` as Failing, () => HttpResponse.json(cardsOf(listId)))(request)
  })
  return {
    fail: (what: Failing, answer: Answer = SERVER_ERROR) => { down.set(what, answer) },
    recover: (what: Failing) => { down.delete(what) },
    // How many times each list's cards were asked for. A count, not a
    // sequence: the lists load at the same time, and their requests can
    // reach the fake server either way round.
    cardLoads: () => {
      const loads: Record<string, number> = {}
      for (const request of cards.requests) {
        const listId = request.url.pathname.split('/').at(-2)!
        loads[listId] = (loads[listId] ?? 0) + 1
      }
      return loads
    },
    listLoads: () => lists.requests.length,
    labelIs: (next: LabelRead) => { label = next },
    archived: (cardId: string) => { archived.add(cardId) },
  }
}

// The board page, signed in, once both lists show their cards.
async function renderBoard() {
  const rendered = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
  await screen.findByText('Homepage layout')
  await screen.findByText('Footer links')
  return rendered
}

// The notification socket the signed-in page opened, connected.
async function openSocket() {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  socket.open()
  return socket
}

// The label chips the two cards show, by name.
const shownLabels = () => ['Homepage layout', 'Footer links'].map(
  (card) => within(screen.getByText(card).closest<HTMLElement>('.MuiCard-root')!).queryAllByText(/Urgent|Blocker/).map((e) => e.textContent),
)

const BLOCKER = { ...URGENT, name: 'Blocker' }

const CARD_URL = `${CARDS_URL}/:cardId`
const LIST_URL = '/api/v1/boards/:boardId/lists/:listId'
const REFUSED = () => HttpResponse.json({ detail: 'Not allowed' }, { status: 403 })
const CONTACT = makeCard({ id: 'card-contact', list_id: 'list-1', name: 'Contact form' })
const SEARCH = makeCard({ id: 'card-search', list_id: 'list-1', name: 'Search page' })

// The message at the foot of the page.
const failure = () => screen.findByRole('alert')

// A list's column, by its name.
const column = (name: string) => screen.getByText(name).closest<HTMLElement>('.MuiPaper-root')!

// Gives a request, were there one, time to be sent.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

// Opens a list's menu, named after the list, and picks an entry.
async function fromListMenu(user: UserEvent, list: string, entry: string) {
  await user.click(screen.getByRole('button', { name: `Menu for the list ${list}` }))
  await user.click(await screen.findByRole('menuitem', { name: entry }))
}

// "Archive All Cards" from a list's menu, then Archive in the question it asks.
async function archiveAllCards(user: UserEvent, list: string) {
  await fromListMenu(user, list, 'Archive All Cards')
  await user.click(within(await screen.findByRole('dialog', { name: 'Archive all cards?' })).getByRole('button', { name: 'Archive' }))
}

describe('Board', () => {
  describe('the sort mode, as the browser keeps it (6I)', () => {
    const ABOUT = makeCard({ id: 'card-about', list_id: 'list-1', name: 'About page' })

    // "To do" holds Homepage layout and About page, in the custom order
    // About page first; the server sends them the other way round.
    function sortedServer() {
      boardServer({ more: [ABOUT] })
      fakeEndpoint('get', `${CARDS_URL}/order`, (request) => {
        const listId = new URL(request.url).pathname.split('/').at(-3)
        return HttpResponse.json({ list_id: listId, card_ids: listId === 'list-1' ? ['card-about', 'card-list-1'] : [] })
      })
    }

    const toDoOrder = () => within(column('To do')).getAllByText(/^(Homepage layout|About page)$/).map((e) => e.textContent)

    async function sortBy(user: UserEvent, mode: string) {
      await user.click(screen.getByRole('button', { name: 'Sort cards' }))
      await user.click(await screen.findByRole('menuitem', { name: mode }))
    }

    it('uses the sort the browser kept for the board', async () => {
      localStorage.setItem('kanbanmf:sort:board-1', 'alpha_desc')
      sortedServer()
      await renderBoard()

      expect(toDoOrder()).toEqual(['Homepage layout', 'About page'])
    })

    it('takes a kept sort that is no sort mode as the custom order', async () => {
      localStorage.setItem('kanbanmf:sort:board-1', 'bogus')
      sortedServer()
      const { user } = await renderBoard()

      await waitFor(() => expect(toDoOrder()).toEqual(['About page', 'Homepage layout']))
      await user.click(screen.getByRole('button', { name: 'Sort cards' }))
      expect(within(await screen.findByRole('menuitem', { name: 'Custom order' })).getByTestId('CheckIcon')).toBeInTheDocument()
    })

    it('opens, and sorts all the same, when the browser blocks site data', async () => {
      blockSiteData()
      sortedServer()
      const { user } = await renderBoard()
      await waitFor(() => expect(toDoOrder()).toEqual(['About page', 'Homepage layout']))

      await sortBy(user, 'Alphabetically (Z-A)')

      expect(toDoOrder()).toEqual(['Homepage layout', 'About page'])
    })

    it('keeps the chosen sort for the board', async () => {
      sortedServer()
      const { user } = await renderBoard()

      await sortBy(user, 'Alphabetically (Z-A)')

      expect(localStorage.getItem('kanbanmf:sort:board-1')).toBe('alpha_desc')
    })
  })

  describe('a label changed', () => {
    it("fetches every list's cards again when a label is changed elsewhere", async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
      server.labelIs(BLOCKER)

      socket.receive({ type: 'labels_changed', board_id: 'board-1', list_id: null, origin_client_id: null })

      await waitFor(() => expect(shownLabels()).toEqual([['Blocker'], ['Blocker']]))
      expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 })
    })

    it('ignores its own label change, and one on another board', async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()

      socket.receive({ type: 'labels_changed', board_id: 'board-1', list_id: null, origin_client_id: getClientId() })
      socket.receive({ type: 'labels_changed', board_id: 'board-2', list_id: null, origin_client_id: null })

      // Gives a refetch, were there one, time to be asked for.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
    })

    it('fetches the cards again once the Labels dialog closes after a label was changed in it', async () => {
      const server = boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId/labels', () => HttpResponse.json([URGENT]))
      fakeEndpoint('patch', '/api/v1/boards/:boardId/labels/:labelId', () => HttpResponse.json(BLOCKER))
      const { user } = await renderBoard()
      await user.click(screen.getByRole('button', { name: 'Labels' }))
      const dialog = screen.getByRole('dialog', { name: 'Labels' })
      await user.click(await within(dialog).findByRole('button', { name: 'Edit label' }))
      const name = within(screen.getByRole('dialog', { name: 'Edit label' })).getByRole('textbox', { name: 'Label name' })
      await user.clear(name)
      await user.type(name, 'Blocker{Enter}')
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit label' })).not.toBeInTheDocument())
      server.labelIs(BLOCKER)
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(shownLabels()).toEqual([['Blocker'], ['Blocker']]))
      expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 })
    })

    it('fetches them only once for that change: closing the dialog again with nothing changed fetches nothing', async () => {
      const server = boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId/labels', () => HttpResponse.json([URGENT]))
      fakeEndpoint('delete', '/api/v1/boards/:boardId/labels/:labelId')
      const { user } = await renderBoard()
      await user.click(screen.getByRole('button', { name: 'Labels' }))
      await user.click(await within(screen.getByRole('dialog', { name: 'Labels' })).findByRole('button', { name: 'Delete label' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Delete label?' })).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete label?' })).not.toBeInTheDocument())
      await user.click(within(screen.getByRole('dialog', { name: 'Labels' })).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Labels' })).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Labels' }))
      await within(screen.getByRole('dialog', { name: 'Labels' })).findByText('Urgent')
      await user.click(within(screen.getByRole('dialog', { name: 'Labels' })).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Labels' })).not.toBeInTheDocument())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 })
    })

    it("doesn't fetch them again when the Labels dialog closes with nothing changed", async () => {
      const server = boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId/labels', () => HttpResponse.json([URGENT]))
      const { user } = await renderBoard()
      await user.click(screen.getByRole('button', { name: 'Labels' }))
      const dialog = screen.getByRole('dialog', { name: 'Labels' })
      await within(dialog).findByText('Urgent')

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Labels' })).not.toBeInTheDocument())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
    })
  })

  describe('changes that fail', () => {
    it("says a card couldn't be archived when it is refused, and fetches its list again", async () => {
      const server = boardServer()
      fakeEndpoint('patch', CARD_URL, REFUSED)
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Menu for Homepage layout' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Archive card' }))

      expect(await failure()).toHaveTextContent('The card "Homepage layout" couldn\'t be archived. Please try again.')
      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 1 }))
      expect(screen.getByText('Homepage layout')).toBeInTheDocument()
    })

    it("says a card couldn't be archived when the connection drops, and the card stays", async () => {
      boardServer()
      fakeEndpoint('patch', CARD_URL, () => HttpResponse.error())
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Menu for Homepage layout' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Archive card' }))

      expect(await failure()).toHaveTextContent('The card "Homepage layout" couldn\'t be archived. Please try again.')
      expect(screen.getByText('Homepage layout')).toBeInTheDocument()
    })

    it('says nothing when a card is archived, and takes it off the board', async () => {
      const server = boardServer()
      fakeEndpoint('patch', CARD_URL, ({ url }) => {
        server.archived(new URL(url).pathname.split('/').at(-1)!)
        return HttpResponse.json({})
      })
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Menu for Homepage layout' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Archive card' }))

      await waitFor(() => expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
    })

    it("says a list couldn't be archived, and fetches the lists again", async () => {
      const server = boardServer()
      const archived = fakeEndpoint('patch', LIST_URL, REFUSED)
      const { user } = await renderBoard()
      expect(server.listLoads()).toBe(1)

      await fromListMenu(user, 'To do', 'Archive List')

      expect(await failure()).toHaveTextContent('The list "To do" couldn\'t be archived. Please try again.')
      expect(archived.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/lists/list-1', { is_archived: true }],
      ])
      await waitFor(() => expect(server.listLoads()).toBe(2))
      expect(screen.getByText('To do')).toBeInTheDocument()
    })

    it("says a list couldn't be archived when the connection drops", async () => {
      boardServer()
      fakeEndpoint('patch', LIST_URL, () => HttpResponse.error())
      const { user } = await renderBoard()

      await fromListMenu(user, 'Doing', 'Archive List')

      expect(await failure()).toHaveTextContent('The list "Doing" couldn\'t be archived. Please try again.')
      expect(screen.getByText('Doing')).toBeInTheDocument()
    })

    it("says how many cards couldn't be archived when archiving them all, and fetches the list again", async () => {
      const server = boardServer({ more: [CONTACT, SEARCH] })
      fakeEndpoint('patch', CARD_URL, ({ url }) => {
        const cardId = new URL(url).pathname.split('/').at(-1)!
        if (cardId === 'card-search') return HttpResponse.error()
        if (cardId === 'card-contact') return REFUSED()
        server.archived(cardId)
        return HttpResponse.json({})
      })
      const { user } = await renderBoard()

      await archiveAllCards(user, 'To do')

      expect(await failure()).toHaveTextContent('2 cards in "To do" couldn\'t be archived. Please try again.')
      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 1 }))
      await waitFor(() => expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument())
      expect(screen.getByText('Contact form')).toBeInTheDocument()
      expect(screen.getByText('Search page')).toBeInTheDocument()
    })

    it("says so in the singular when one card couldn't be archived", async () => {
      const server = boardServer({ more: [CONTACT] })
      fakeEndpoint('patch', CARD_URL, ({ url }) => {
        const cardId = new URL(url).pathname.split('/').at(-1)!
        if (cardId === 'card-contact') return REFUSED()
        server.archived(cardId)
        return HttpResponse.json({})
      })
      const { user } = await renderBoard()

      await archiveAllCards(user, 'To do')

      expect(await failure()).toHaveTextContent('1 card in "To do" couldn\'t be archived. Please try again.')
    })

    it('says nothing when every card is archived', async () => {
      const server = boardServer({ more: [CONTACT] })
      const archived = fakeEndpoint('patch', CARD_URL, ({ url }) => {
        server.archived(new URL(url).pathname.split('/').at(-1)!)
        return HttpResponse.json({})
      })
      const { user } = await renderBoard()

      await archiveAllCards(user, 'To do')

      await waitFor(() => expect(screen.queryByText('Contact form')).not.toBeInTheDocument())
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
      expect(archived.requests).toHaveLength(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
    })

    it('takes the message away with its close button', async () => {
      boardServer()
      fakeEndpoint('patch', CARD_URL, REFUSED)
      const { user } = await renderBoard()
      await user.click(screen.getByRole('button', { name: 'Menu for Homepage layout' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Archive card' }))

      await user.click(within(await failure()).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })
  })

  describe('loads that fail', () => {
    it("says the board couldn't be loaded when its lists fail, rather than show no lists, and loads it with Try again", async () => {
      const server = boardServer()
      server.fail('lists')
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })

      expect(await screen.findByRole('alert')).toHaveTextContent("This board couldn't be loaded.")
      expect(screen.queryByText('To do')).not.toBeInTheDocument()
      server.recover('lists')
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Homepage layout')
      expect(screen.getByText('Footer links')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.listLoads()).toBe(2)
    })

    it('takes the message away while Try again loads, and brings it back if it fails again', async () => {
      const server = boardServer()
      server.fail('lists')
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText("This board couldn't be loaded.")
      const held = heldAnswer(SERVER_ERROR)
      server.fail('lists', held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByText("This board couldn't be loaded.")).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByText("This board couldn't be loaded.")).toBeInTheDocument()
    })

    it("takes a list's message away while its Try again loads, and brings it back if it fails again", async () => {
      const server = boardServer()
      server.fail('cards:list-1')
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText('Footer links')
      await within(column('To do')).findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail('cards:list-1', held.answer)

      await user.click(within(column('To do')).getByRole('button', { name: 'Try again' }))

      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 1 }))
      expect(within(column('To do')).queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await within(column('To do')).findByRole('alert')).toHaveTextContent("This list's cards couldn't be loaded.")
    })

    it("says so when the board itself can't be reached, though its lists came", async () => {
      const server = boardServer()
      server.fail('board', DROPPED)
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })

      expect(await screen.findByRole('alert')).toHaveTextContent("This board couldn't be loaded.")
      await settle()
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
    })

    it("still says a board that isn't yours, or doesn't exist, is out of reach", async () => {
      boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId', () => HttpResponse.json({ detail: 'Not found' }, { status: 404 }))
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })

      expect(await screen.findByText('Forbidden')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("says in its column that a list's cards couldn't be loaded, shows the other list's, and loads them with Try again", async () => {
      const server = boardServer()
      server.fail('cards:list-1')
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText('Footer links')

      expect(await within(column('To do')).findByRole('alert')).toHaveTextContent("This list's cards couldn't be loaded.")
      expect(within(column('Doing')).queryByRole('alert')).not.toBeInTheDocument()
      // It waits for Try again rather than ask on its own.
      await settle()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
      server.recover('cards:list-1')
      await user.click(within(column('To do')).getByRole('button', { name: 'Try again' }))

      await screen.findByText('Homepage layout')
      expect(within(column('To do')).queryByRole('alert')).not.toBeInTheDocument()
      expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 1 })
    })

    it('takes the cards away when fetching them again fails, as they may be out of date', async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()
      server.fail('cards:list-1', DROPPED)

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      expect(await within(column('To do')).findByRole('alert')).toHaveTextContent("This list's cards couldn't be loaded.")
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
      expect(screen.getByText('Footer links')).toBeInTheDocument()
    })

    it("loads the cards that failed again when the board's own Try again brings it back", async () => {
      const server = boardServer()
      server.fail('cards:list-1')
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText('Footer links')
      await within(column('To do')).findByRole('alert')
      const socket = await openSocket()
      server.fail('lists')
      socket.receive({ type: 'list_created', board_id: 'board-1', list_id: null, origin_client_id: null })
      await screen.findByText("This board couldn't be loaded.")
      server.recover('lists')
      server.recover('cards:list-1')

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Homepage layout')
      expect(screen.getByText('Footer links')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('comes back by itself when the lists are fetched again on a change, and this time come', async () => {
      const server = boardServer()
      server.fail('lists')
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText("This board couldn't be loaded.")
      const socket = await openSocket()
      server.recover('lists')

      socket.receive({ type: 'list_renamed', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      await screen.findByText('Homepage layout')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('comes back by itself when the board is fetched again on a change, and this time comes', async () => {
      const server = boardServer()
      server.fail('board')
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText("This board couldn't be loaded.")
      const socket = await openSocket()
      server.recover('board')

      socket.receive({ type: 'board_unshared', board_id: 'board-1', list_id: null, origin_client_id: null })

      await screen.findByText('Homepage layout')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("shows a list's cards by themselves when they're fetched again on a change, and this time come", async () => {
      const server = boardServer()
      server.fail('cards:list-1')
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText('Footer links')
      await within(column('To do')).findByRole('alert')
      const socket = await openSocket()
      server.recover('cards:list-1')

      socket.receive({ type: 'card_created', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      await screen.findByText('Homepage layout')
      expect(within(column('To do')).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('loads the cards with Try again even after a card was added to the list meanwhile', async () => {
      const server = boardServer()
      server.fail('cards:list-1')
      fakeEndpoint('get', '/api/v1/boards/:boardId/members', () => HttpResponse.json([]))
      fakeEndpoint('post', CARDS_URL, () => HttpResponse.json(makeCard({ id: 'card-new', list_id: 'list-1', name: 'Contact form' }), { status: 201 }))
      fakeEndpoint('get', `${CARD_URL}/checklists`, () => HttpResponse.json([]))
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText('Footer links')
      await within(column('To do')).findByRole('alert')
      await user.click(within(column('To do')).getByRole('button', { name: 'Add a card to To do' }))
      await user.type(screen.getByRole('textbox', { name: /^Card name/ }), 'Contact form')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(within(column('To do')).getByText('Contact form')).toBeInTheDocument()
      server.recover('cards:list-1')

      await user.click(within(column('To do')).getByRole('button', { name: 'Try again' }))

      await screen.findByText('Homepage layout')
      expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 1 })
    })

    it("loads the cards that failed again on coming back from the archive", async () => {
      const server = boardServer()
      server.fail('cards:list-1')
      fakeEndpoint('get', '/api/v1/boards/:boardId/lists/archived', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/boards/:boardId/cards/archived', () => HttpResponse.json([]))
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await screen.findByText('Footer links')
      await within(column('To do')).findByRole('alert')
      server.recover('cards:list-1')

      await user.click(screen.getByRole('button', { name: 'Archive' }))
      await user.click(await screen.findByRole('button', { name: 'Return to Board' }))

      await screen.findByText('Homepage layout')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('buttons named after their list (6K)', () => {
    it("names each list's handle, add-card button and menu after the list", async () => {
      boardServer()
      await renderBoard()

      for (const list of ['To do', 'Doing']) {
        for (const name of [`Move the list ${list}`, `Add a card to ${list}`, `Menu for the list ${list}`]) {
          expect(within(column(list)).getByRole('button', { name })).toBeInTheDocument()
        }
      }
    })

    it('adds the card to the list the button is named after', async () => {
      boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId/members', () => HttpResponse.json([]))
      const created = fakeEndpoint('post', CARDS_URL, () => HttpResponse.json(makeCard({ id: 'card-new', list_id: 'list-2', name: 'Contact form' }), { status: 201 }))
      fakeEndpoint('get', `${CARD_URL}/checklists`, () => HttpResponse.json([]))
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Add a card to Doing' }))
      await user.type(screen.getByRole('textbox', { name: /^Card name/ }), 'Contact form')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(created.requests).toHaveLength(1))
      expect(created.requests[0].url.pathname).toBe('/api/v1/boards/board-1/lists/list-2/cards')
    })

    it('names them in Catalan for a user who reads Catalan', async () => {
      boardServer()
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: { language_locale: 'ca_ES' } })

      expect(await screen.findByRole('button', { name: 'Menú de la llista To do' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Afegeix una targeta a To do' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mou la llista To do' })).toBeInTheDocument()
    })
  })

  describe('asking before archiving all cards (6L)', () => {
    const question = () => screen.findByRole('dialog', { name: 'Archive all cards?' })
    const THREE = 'Archive the 3 cards in "To do"? To get them back, you restore them one by one from the board\'s archive.'

    // Archiving a card works, and takes it out of the list.
    function archiving(server: ReturnType<typeof boardServer>) {
      return fakeEndpoint('patch', CARD_URL, ({ url }) => {
        server.archived(new URL(url).pathname.split('/').at(-1)!)
        return HttpResponse.json({})
      })
    }

    it('asks first, saying how many cards and from which list, and archives nothing until told to', async () => {
      const server = boardServer({ more: [CONTACT, SEARCH] })
      const archived = archiving(server)
      const { user } = await renderBoard()

      await fromListMenu(user, 'To do', 'Archive All Cards')

      expect(await question()).toHaveTextContent(THREE)
      await settle()
      expect(archived.requests).toHaveLength(0)
      expect(screen.getByText('Contact form')).toBeInTheDocument()
      await user.click(within(await question()).getByRole('button', { name: 'Archive' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(screen.queryByText('Contact form')).not.toBeInTheDocument())
      expect(archived.requests.map((r) => r.url.pathname.split('/').at(-1)).sort()).toEqual(['card-contact', 'card-list-1', 'card-search'])
      expect(screen.getByText('Footer links')).toBeInTheDocument()
    })

    it('says it in the singular for a list of one card', async () => {
      boardServer()
      const { user } = await renderBoard()

      await fromListMenu(user, 'To do', 'Archive All Cards')

      expect(await question()).toHaveTextContent('Archive the only card in "To do"? To get it back, you restore it from the board\'s archive.')
    })

    it.each([
      ['Cancel', async (user: UserEvent) => user.click(within(await question()).getByRole('button', { name: 'Cancel' }))],
      ['Escape', async (user: UserEvent) => { await question(); await user.keyboard('{Escape}') }],
    ])('archives nothing when told not to with %s', async (_way, cancel) => {
      const server = boardServer({ more: [CONTACT] })
      const archived = archiving(server)
      const { user } = await renderBoard()
      await fromListMenu(user, 'To do', 'Archive All Cards')

      await cancel(user)

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await settle()
      expect(archived.requests).toHaveLength(0)
      expect(screen.getByText('Homepage layout')).toBeInTheDocument()
      expect(screen.getByText('Contact form')).toBeInTheDocument()
    })

    it('counts the cards as they are when someone else archives one meanwhile, and archives the ones left', async () => {
      const server = boardServer({ more: [CONTACT, SEARCH] })
      const archived = archiving(server)
      const { user } = await renderBoard()
      const socket = await openSocket()
      await fromListMenu(user, 'To do', 'Archive All Cards')
      expect(await question()).toHaveTextContent(THREE)

      server.archived('card-search')
      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      await waitFor(async () => expect(await question()).toHaveTextContent('Archive the 2 cards in "To do"?'))
      await user.click(within(await question()).getByRole('button', { name: 'Archive' }))
      await waitFor(() => expect(screen.queryByText('Contact form')).not.toBeInTheDocument())
      expect(archived.requests.map((r) => r.url.pathname.split('/').at(-1)).sort()).toEqual(['card-contact', 'card-list-1'])
    })

    it("goes by itself when the list empties meanwhile, and doesn't come back when a card arrives", async () => {
      const more: CardRead[] = []
      const server = boardServer({ more })
      const { user } = await renderBoard()
      const socket = await openSocket()
      await fromListMenu(user, 'To do', 'Archive All Cards')
      await question()

      server.archived('card-list-1')
      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      more.push(CONTACT)
      socket.receive({ type: 'card_created', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      expect(await screen.findByText('Contact form')).toBeInTheDocument()
      await settle()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it.each<[string, CardRead[], string]>([
      ['one card', [], 'Vols arxivar l\'única targeta de "To do"? Per recuperar-la, l\'has de restaurar des de l\'arxiu del tauler.'],
      ['two cards', [CONTACT], 'Vols arxivar les 2 targetes de "To do"? Per recuperar-les, les has de restaurar una per una des de l\'arxiu del tauler.'],
      ['three cards', [CONTACT, SEARCH], 'Vols arxivar les 3 targetes de "To do"? Per recuperar-les, les has de restaurar una per una des de l\'arxiu del tauler.'],
    ])('asks in Catalan for a user who reads Catalan (%s)', async (_case, more, message) => {
      boardServer({ more })
      const { user } = renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: { language_locale: 'ca_ES' } })

      await user.click(await screen.findByRole('button', { name: 'Menú de la llista To do' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Arxiva totes les targetes' }))

      const dialog = await screen.findByRole('dialog', { name: 'Arxivar totes les targetes?' })
      expect(dialog).toHaveTextContent(message)
      expect(within(dialog).getByRole('button', { name: 'Arxiva' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Cancel·la' })).toBeInTheDocument()
    })
  })
})
