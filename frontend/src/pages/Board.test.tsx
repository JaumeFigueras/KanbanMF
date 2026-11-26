import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import type { BoardColorsRead, CardRead, ChecklistRead, LabelRead } from '../types/board'
import { getClientId } from '../api/client'
import { blockSiteData } from '../test/blockSiteData'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeBoard, makeCard, makeLabel, makeList, makeUser } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { heard, pickUp } from '../test/drag'
import { dropAndReconnect } from '../test/reconnect'
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
  const board = fakeEndpoint('get', '/api/v1/boards/:boardId', unless('board', () => HttpResponse.json(BOARD)))
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
    boardLoads: () => board.requests.length,
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

// The address the router is at.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}
const address = () => screen.getByTestId('address').textContent

// The board page at an address (as /boards/board-1?card=…), shown on
// /boards/:boardId only, as the app does, with the address beside it.
function renderBoardAt(route: string) {
  const page = (
    <>
      <Routes>
        <Route path="/boards/:boardId" element={<Board />} />
        <Route path="*" element={null} />
      </Routes>
      <Address />
    </>
  )
  return renderWithProviders(page, { route, auth: true })
}

// The colours the viewer has chosen on the board, as the server has them
// from now on.
function coloursAre(colors: Partial<BoardColorsRead>) {
  fakeEndpoint('get', '/api/v1/boards/:boardId/colors', () => HttpResponse.json({ board: null, lists: {}, cards: {}, ...colors }))
}

// The list whose cards a request asks for.
const listOfCards = (url: string) => new URL(url).pathname.split('/').at(-2)!

// A list's header, underlined in the list's colour, and a card, outlined
// in its own.
const listHeader = (name: string) => screen.getByText(name).parentElement!
const cardBox = (name: string) => screen.getByText(name).closest<HTMLElement>('.MuiCard-root')!
const DEFAULT_PURPLE = '#9C27B0'

// The lists, by name, in the order the page shows them.
const listOrder = () => screen.getAllByRole('button', { name: /^Menu for the list / })
  .map((button) => button.getAttribute('aria-label')!.replace('Menu for the list ', ''))

// What the card dialog asks for (the board's people, and the card's
// checklists once saved), and the card it saves, created or changed.
function cardSaves(saved: CardRead) {
  fakeEndpoint('get', '/api/v1/boards/:boardId/members', () => HttpResponse.json([]))
  fakeEndpoint('get', `${CARD_URL}/checklists`, () => HttpResponse.json([]))
  return {
    created: fakeEndpoint('post', CARDS_URL, () => HttpResponse.json(saved, { status: 201 })),
    updated: fakeEndpoint('patch', CARD_URL, () => HttpResponse.json(saved)),
  }
}

// Adds a card to a list from its header's button, under the name given.
async function addCard(user: UserEvent, list: string, name: string) {
  await user.click(screen.getByRole('button', { name: `Add a card to ${list}` }))
  await user.type(screen.getByRole('textbox', { name: /^Card name/ }), name)
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

// The board's archive: no archived lists, and the archived cards given.
function archiveHolds(cards: CardRead[]) {
  fakeEndpoint('get', '/api/v1/boards/:boardId/lists/archived', () => HttpResponse.json([]))
  fakeEndpoint('get', '/api/v1/boards/:boardId/cards/archived', () => HttpResponse.json(cards))
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
      await user.click(await within(dialog).findByRole('button', { name: 'Edit the label Urgent' }))
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
      await user.click(await within(screen.getByRole('dialog', { name: 'Labels' })).findByRole('button', { name: 'Delete the label Urgent' }))
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

  describe('who you are (6Q)', () => {
    // The page asks who you are itself, as does its top bar: signed out, the
    // test answers both.
    function whoYouAre(first: Answer) {
      let answer = first
      fakeEndpoint('get', '/api/v1/users/me', (request) => answer(request))
      return { answers: (next: Answer) => { answer = next } }
    }
    const renderSignedOut = () => renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId' })

    it.each([
      ['a server error', SERVER_ERROR],
      ['a dropped connection', DROPPED],
    ])("says the board couldn't be loaded when it fails with %s, and loads it with Try again", async (_case, answer) => {
      boardServer()
      const me = whoYouAre(answer)
      const { user } = renderSignedOut()

      expect(await screen.findByRole('alert')).toHaveTextContent("This board couldn't be loaded.")
      expect(screen.queryByText('To do')).not.toBeInTheDocument()
      me.answers(() => HttpResponse.json(makeUser({ id: 'user-1' })))

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Homepage layout')
      expect(screen.getByText('Footer links')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('brings the message back if who you are fails again', async () => {
      boardServer()
      const me = whoYouAre(SERVER_ERROR)
      const { user } = renderSignedOut()
      await screen.findByText("This board couldn't be loaded.")
      const held = heldAnswer(SERVER_ERROR)
      me.answers(held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByText("This board couldn't be loaded.")).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByText("This board couldn't be loaded.")).toBeInTheDocument()
    })
  })

  describe('a board you have lost (6Q)', () => {
    it.each([
      ['refused (403)', 403],
      ['gone (404)', 404],
    ])('goes straight to Forbidden when its lists are %s before the board is', async (_case, status) => {
      const server = boardServer()
      const refused: Answer = () => HttpResponse.json({ detail: 'No' }, { status })
      const held = heldAnswer(refused)
      server.fail('board', held.answer)
      server.fail('lists', refused)
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      // The lists are refused; the board's answer is still to come.
      await waitFor(() => expect(server.listLoads()).toBe(1))
      await settle()

      expect(screen.queryByText("This board couldn't be loaded.")).not.toBeInTheDocument()
      held.release()

      expect(await screen.findByText('Forbidden')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("asks for the board again when its lists are refused, and says they couldn't be loaded if it still opens", async () => {
      const server = boardServer()
      const held = heldAnswer(() => HttpResponse.json(BOARD))
      server.fail('board', held.answer)
      server.fail('lists', REFUSED)
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })
      await waitFor(() => expect(server.boardLoads()).toBe(2))
      await settle()

      expect(screen.queryByText("This board couldn't be loaded.")).not.toBeInTheDocument()
      held.release()

      expect(await screen.findByRole('alert')).toHaveTextContent("This board couldn't be loaded.")
      expect(screen.queryByText('Forbidden')).not.toBeInTheDocument()
    })

    it("asks for the board once when its lists fail otherwise, and says so at once", async () => {
      const server = boardServer()
      server.fail('lists')
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true })

      expect(await screen.findByRole('alert')).toHaveTextContent("This board couldn't be loaded.")
      await settle()
      expect(server.boardLoads()).toBe(1)
    })

    it('shows Forbidden when a change to its lists finds them refused, as the board is', async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()
      server.fail('board', REFUSED)
      server.fail('lists', REFUSED)

      socket.receive({ type: 'list_renamed', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      expect(await screen.findByText('Forbidden')).toBeInTheDocument()
      expect(screen.queryByText("This board couldn't be loaded.")).not.toBeInTheDocument()
    })
  })

  describe('answers that come back out of order (6R)', () => {
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
    const card = (name: string) => screen.getByText(name).closest<HTMLElement>('.MuiCard-root')!

    it('keeps the newer lists when an older answer comes last', async () => {
      boardServer()
      await renderBoard()
      const socket = await openSocket()
      const held = olderAnswerLast(
        '/api/v1/boards/:boardId/lists',
        () => HttpResponse.json([TODO, DOING]),
        () => HttpResponse.json([{ ...TODO, name: 'Backlog' }, DOING]),
      )

      socket.receive({ type: 'list_renamed', board_id: 'board-1', list_id: null, origin_client_id: null })
      socket.receive({ type: 'list_renamed', board_id: 'board-1', list_id: null, origin_client_id: null })
      expect(await screen.findByText('Backlog')).toBeInTheDocument()
      held.release()
      await settle()

      expect(screen.getByText('Backlog')).toBeInTheDocument()
      expect(screen.queryByText('To do')).not.toBeInTheDocument()
    })

    it("keeps a list's newer cards when an older answer comes last", async () => {
      boardServer()
      await renderBoard()
      const socket = await openSocket()
      const cardNamed = (name: string) => makeCard({ id: 'card-list-1', list_id: 'list-1', name })
      const held = olderAnswerLast(
        CARDS_URL,
        () => HttpResponse.json([cardNamed('Homepage layout')]),
        () => HttpResponse.json([cardNamed('Homepage layout, final')]),
      )

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      expect(await screen.findByText('Homepage layout, final')).toBeInTheDocument()
      held.release()
      await settle()

      expect(screen.getByText('Homepage layout, final')).toBeInTheDocument()
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
    })

    it.each([
      ['', false],
      [', in StrictMode as in development', true],
    ])("asks once for each list's cards when they come back one at a time%s", async (_case, strictMode) => {
      const server = boardServer()
      const held = heldAnswer(() => HttpResponse.json([
        makeCard({ id: 'card-list-2', list_id: 'list-2', name: 'Footer links', labels: [URGENT] }),
      ]))
      server.fail('cards:list-2', held.answer)
      renderWithProviders(<Board />, { route: '/boards/board-1', path: '/boards/:boardId', auth: true, strictMode })

      // "To do" has its cards; "Doing" is still waiting for its own.
      await screen.findByText('Homepage layout')
      await settle()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
      held.release()

      expect(await screen.findByText('Footer links')).toBeInTheDocument()
      await settle()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
    })

    it("asks again for every list's cards on the way back from the archive", async () => {
      const server = boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId/lists/archived', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/boards/:boardId/cards/archived', () => HttpResponse.json([]))
      const { user } = await renderBoard()
      await user.click(screen.getByRole('button', { name: 'Archive' }))
      server.archived('card-list-1')

      await user.click(await screen.findByRole('button', { name: 'Return to Board' }))

      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 }))
      expect(await screen.findByText('Footer links')).toBeInTheDocument()
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
    })

    it("still takes each list's own answer when both lists are fetched again", async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()
      server.archived('card-list-1')
      server.archived('card-list-2')

      socket.receive({ type: 'card_moved', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      socket.receive({ type: 'card_moved', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })

      await waitFor(() => expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument())
      await waitFor(() => expect(screen.queryByText('Footer links')).not.toBeInTheDocument())
    })

    it('keeps the newer colours when an older answer comes last', async () => {
      boardServer()
      await renderBoard()
      const socket = await openSocket()
      const uncoloured = getComputedStyle(card('Homepage layout')).backgroundColor
      const held = olderAnswerLast(
        '/api/v1/boards/:boardId/colors',
        () => HttpResponse.json({ board: null, lists: {}, cards: {} }),
        () => HttpResponse.json({ board: null, lists: {}, cards: { 'card-list-1': '#1976D2' } }),
      )

      socket.receive({ type: 'card_created', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      socket.receive({ type: 'card_created', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      await waitFor(() => expect(getComputedStyle(card('Homepage layout')).backgroundColor).not.toBe(uncoloured))
      const coloured = getComputedStyle(card('Homepage layout')).backgroundColor
      held.release()
      await settle()

      expect(getComputedStyle(card('Homepage layout')).backgroundColor).toBe(coloured)
    })
  })

  describe('moving with the keyboard (7A)', () => {
    it('puts a card back on Escape, saving nothing', async () => {
      boardServer()
      const moved = fakeEndpoint('patch', CARD_URL)
      const ordered = fakeEndpoint('put', `${CARDS_URL}/order`)
      const { user } = await renderBoard()
      // jsdom has no layout, so every place is as near as any other: the
      // card at once reads as over a list, which talks over "Picked up". The
      // e2e tests check what is said in a browser; here, that the move began.
      const handle = screen.getByRole('button', { name: 'Move Homepage layout' })
      handle.focus()
      await user.keyboard('[Space]')
      await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'))
      await user.keyboard('{Escape}')
      await heard('Move cancelled: Homepage layout is back in its place.')
      expect(within(column('To do')).getByText('Homepage layout')).toBeInTheDocument()
      await settle()
      expect([...moved.requests, ...ordered.requests]).toEqual([])
    })

    it('names a list as a list', async () => {
      boardServer()
      const ordered = fakeEndpoint('put', '/api/v1/boards/:boardId/lists/order')
      const { user } = await renderBoard()
      await pickUp(user, screen.getByRole('button', { name: 'Move the list To do' }), 'the list To do')
      await user.keyboard('{Escape}')
      await heard('Move cancelled: the list To do is back in its place.')
      await settle()
      expect(ordered.requests).toEqual([])
    })
  })

  describe('changes made elsewhere while a card is moved (7B)', () => {
    // Their answers would put a list back as the server has it: without the
    // card the move put in it, which then showed nowhere and was never saved,
    // or with the card it took out, which then showed twice.
    async function pickUpHomepage(user: UserEvent) {
      const handle = screen.getByRole('button', { name: 'Move Homepage layout' })
      handle.focus()
      await user.keyboard('[Space]')
      await waitFor(() => expect(handle).toHaveAttribute('aria-pressed', 'true'))
    }

    it("fetches no list's cards while it is moved, then the lists asked for once it is put back", async () => {
      const server = boardServer()
      const { user } = await renderBoard()
      const socket = await openSocket()
      await pickUpHomepage(user)

      socket.receive({ type: 'card_created', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })
      await settle()
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })

      // Its own list too, which putting it back always fetches.
      await user.keyboard('{Escape}')
      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 }))
    })

    it.each([
      ['an answer', () => HttpResponse.json([makeCard({ id: 'card-new', list_id: 'list-2', name: 'Added elsewhere' })])],
      ['a failure', SERVER_ERROR],
    ])('holds back %s asked for before the move began, and asks again once it is over', async (_case, answer) => {
      const server = boardServer()
      const { user } = await renderBoard()
      const socket = await openSocket()
      const late = heldAnswer(answer)
      server.fail('cards:list-2', late.answer)
      socket.receive({ type: 'card_created', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })
      await waitFor(() => expect(server.cardLoads()['list-2']).toBe(2))
      await pickUpHomepage(user)

      late.release()
      await settle()
      expect(within(column('Doing')).getByText('Footer links')).toBeInTheDocument()

      server.recover('cards:list-2')
      await user.keyboard('{Escape}')
      await waitFor(() => expect(server.cardLoads()['list-2']).toBe(3))
    })

    it('waits for every move under way, when one starts before the last drop is saved', async () => {
      const server = boardServer()
      const save = heldAnswer()
      fakeEndpoint('patch', CARD_URL, save.answer)
      const ordered = fakeEndpoint('put', `${CARDS_URL}/order`, save.answer)
      const { user } = await renderBoard()
      const socket = await openSocket()
      await pickUpHomepage(user)
      await user.keyboard('[Space]')
      await waitFor(() => expect(ordered.requests.length).toBeGreaterThan(0))
      await pickUpHomepage(user)

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })
      save.release()
      await settle()
      expect(server.cardLoads()['list-2']).toBe(1)

      await user.keyboard('{Escape}')
      await waitFor(() => expect(server.cardLoads()['list-2']).toBe(2))
    })

    it('fetches them once the drop is saved, not before', async () => {
      const server = boardServer()
      const save = heldAnswer()
      const moved = fakeEndpoint('patch', CARD_URL, save.answer)
      const ordered = fakeEndpoint('put', `${CARDS_URL}/order`, save.answer)
      const { user } = await renderBoard()
      const socket = await openSocket()
      await pickUpHomepage(user)
      await user.keyboard('[Space]')
      await waitFor(() => expect(moved.requests.length + ordered.requests.length).toBeGreaterThan(0))

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })
      await settle()
      expect(server.cardLoads()['list-2']).toBe(1)

      save.release()
      await waitFor(() => expect(server.cardLoads()['list-2']).toBe(2))
    })
  })

  describe('after the connection comes back (7C)', () => {
    it('fetches the board, its lists and their cards again, showing what changed meanwhile', async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()
      const [boardLoads, listLoads] = [server.boardLoads(), server.listLoads()]
      server.archived('card-list-2')

      dropAndReconnect(socket)

      await waitFor(() => expect(screen.queryByText('Footer links')).not.toBeInTheDocument())
      expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 })
      expect(server.boardLoads()).toBe(boardLoads + 1)
      expect(server.listLoads()).toBe(listLoads + 1)
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

  // 6V: it was a button, which can't open the boards in a new tab.
  describe('going back to the boards', () => {
    it.each([
      ['refused', 'Forbidden', () => HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })],
      ['archived', 'Board Archived', () => HttpResponse.json({ ...BOARD, is_archived: true })],
    ])('goes back from a link when the board is %s', async (_case, title, answer: Answer) => {
      boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId', answer)
      const { user } = renderBoardAt('/boards/board-1')
      expect(await screen.findByText(title)).toBeInTheDocument()
      const back = screen.getByRole('link', { name: 'Back to Boards' })
      expect(back).toHaveAttribute('href', '/boards')

      await user.click(back)

      expect(address()).toBe('/boards')
    })
  })
  // 5G: a list's colour, like a card's, lives in the board's colours only,
  // which is what the floating copy of a dragged list or card is drawn from.
  describe('colours (5G)', () => {
    it("repaints a list in the colour chosen from its menu, and gives it to the cards added to it", async () => {
      boardServer()
      const saved = fakeEndpoint('put', `${LIST_URL}/color`)
      const { created } = cardSaves(makeCard({ id: 'card-new', list_id: 'list-1', name: 'Contact form' }))
      const { user } = await renderBoard()

      await fromListMenu(user, 'To do', 'Change Color')
      await user.click(screen.getByRole('button', { name: '#4CAF50' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(listHeader('To do')).toHaveStyle({ borderBottomColor: '#4CAF50' }))
      expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-1/lists/list-1/color', { color: '#4CAF50' }]])
      expect(listHeader('Doing')).toHaveStyle({ borderBottomColor: DEFAULT_PURPLE })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      await addCard(user, 'To do', 'Contact form')

      expect(await screen.findByText('Contact form')).toBeInTheDocument()
      expect(created.requests).toHaveLength(1)
      expect(cardBox('Contact form')).toHaveStyle({ borderColor: '#4CAF50' })
    })

    it("goes back to the default colour once a list's colour is reset", async () => {
      boardServer()
      coloursAre({ lists: { 'list-1': '#2196F3' } })
      fakeEndpoint('delete', `${LIST_URL}/color`)
      const { user } = await renderBoard()
      expect(listHeader('To do')).toHaveStyle({ borderBottomColor: '#2196F3' })

      await fromListMenu(user, 'To do', 'Change Color')
      await user.click(screen.getByRole('button', { name: 'Reset to default' }))

      await waitFor(() => expect(listHeader('To do')).toHaveStyle({ borderBottomColor: DEFAULT_PURPLE }))
    })

    it("keeps none of its own: a list shows the colour fetched again on a change", async () => {
      boardServer()
      await renderBoard()
      const socket = await openSocket()
      expect(listHeader('To do')).toHaveStyle({ borderBottomColor: DEFAULT_PURPLE })
      coloursAre({ lists: { 'list-1': '#F44336' } })

      socket.receive({ type: 'list_renamed', board_id: 'board-1', list_id: null, origin_client_id: null })

      await waitFor(() => expect(listHeader('To do')).toHaveStyle({ borderBottomColor: '#F44336' }))
    })

    it("keeps a card's colour chosen from its menu when the card is drawn afresh in another list", async () => {
      boardServer()
      fakeEndpoint('put', `${CARD_URL}/color`)
      const { user } = await renderBoard()
      const socket = await openSocket()

      await user.click(screen.getByRole('button', { name: 'Menu for Homepage layout' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Change Color' }))
      await user.click(screen.getByRole('button', { name: '#4CAF50' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(cardBox('Homepage layout')).toHaveStyle({ borderColor: '#4CAF50' }))

      // Moved to Doing in another tab, so drawn there by a column of its own.
      fakeEndpoint('get', CARDS_URL, ({ url }) => HttpResponse.json(listOfCards(url) === 'list-1' ? [] : [
        makeCard({ id: 'card-list-2', list_id: 'list-2', name: 'Footer links' }),
        makeCard({ id: 'card-list-1', list_id: 'list-2', name: 'Homepage layout' }),
      ]))
      socket.receive({ type: 'card_moved', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      socket.receive({ type: 'card_moved', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })

      await waitFor(() => expect(within(column('Doing')).getByText('Homepage layout')).toBeInTheDocument())
      expect(cardBox('Homepage layout')).toHaveStyle({ borderColor: '#4CAF50' })
    })
  })

  describe('the address', () => {
    it("opens the card ?card= names once its list is in, and takes it off the address on closing", async () => {
      boardServer()
      cardSaves(makeCard())
      const { user } = renderBoardAt('/boards/board-1?card=card-list-2')

      const dialog = await screen.findByRole('dialog', { name: 'Edit Card' })
      expect(within(dialog).getByRole('textbox', { name: /^Card name/ })).toHaveValue('Footer links')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(address()).toBe('/boards/board-1')
    })

    it('opens nothing for a card that isn\'t on the board', async () => {
      boardServer()
      renderBoardAt('/boards/board-1?card=card-elsewhere')
      await screen.findByText('Homepage layout')
      await screen.findByText('Footer links')
      await settle()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('shows on the board what is saved in the card it opened', async () => {
      boardServer()
      const { updated } = cardSaves(makeCard({ id: 'card-list-2', list_id: 'list-2', name: 'Footer links v2' }))
      const { user } = renderBoardAt('/boards/board-1?card=card-list-2')
      const dialog = await screen.findByRole('dialog', { name: 'Edit Card' })

      await user.type(within(dialog).getByRole('textbox', { name: /^Card name/ }), ' v2')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(await within(column('Doing')).findByText('Footer links v2')).toBeInTheDocument()
      expect(updated.requests[0].url.pathname).toBe('/api/v1/boards/board-1/lists/list-2/cards/card-list-2')
    })

    it('opens the archive for ?archive=1, outlines the card &highlight= names, and takes both off the address', async () => {
      boardServer()
      archiveHolds([makeCard({ id: 'card-old', list_id: 'list-1', name: 'Old hero', is_archived: true })])
      const scrolled = vi.fn()
      Element.prototype.scrollIntoView = scrolled
      // @ts-expect-error -- jsdom has none; put it back that way.
      onTestFinished(() => { delete Element.prototype.scrollIntoView })
      renderBoardAt('/boards/board-1?archive=1&highlight=card-old')

      expect(await screen.findByRole('button', { name: 'Return to Board' })).toBeInTheDocument()
      await waitFor(() => expect(scrolled).toHaveBeenCalled())
      expect(scrolled.mock.contexts[0]).toBe(cardBox('Old hero'))
      expect(cardBox('Old hero')).toHaveStyle({ outlineColor: '#1976d2' })
      expect(address()).toBe('/boards/board-1')
    })

    it('searches the board from the bar', async () => {
      boardServer()
      const { user } = renderBoardAt('/boards/board-1')
      await screen.findByText('Homepage layout')

      await user.type(screen.getByRole('textbox', { name: 'Search this board' }), 'hero{Enter}')

      expect(address()).toBe('/search?q=hero&board=board-1')
    })

    it("searches the board's archive from the archive's bar", async () => {
      boardServer()
      archiveHolds([])
      const { user } = renderBoardAt('/boards/board-1?archive=1')
      await screen.findByRole('button', { name: 'Return to Board' })

      await user.type(screen.getByRole('textbox', { name: "Search this board's archive" }), 'hero{Enter}')

      expect(address()).toBe('/search?q=hero&board=board-1&archived=1')
    })

    it("opens the card that replaced an archived one, when the archive can't restore it", async () => {
      boardServer()
      archiveHolds([makeCard({ id: 'card-old', list_id: 'list-1', name: 'Old hero', is_archived: true })])
      cardSaves(makeCard())
      // After cardSaves, whose own answer to a card's PATCH it replaces.
      fakeEndpoint('patch', CARD_URL, () => HttpResponse.json(
        { detail: { code: 'card_replaced', replaced_by_id: 'card-list-2' } }, { status: 409 },
      ))
      const { user } = renderBoardAt('/boards/board-1?archive=1')
      await user.click(await screen.findByRole('button', { name: 'Menu for Old hero' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))

      await user.click(await screen.findByRole('button', { name: 'Open the current card' }))

      const dialog = await screen.findByRole('dialog', { name: 'Edit Card' })
      expect(within(dialog).getByRole('textbox', { name: /^Card name/ })).toHaveValue('Footer links')
      expect(address()).toBe('/boards/board-1?card=card-list-2')
    })
  })

  describe('lists', () => {
    it.each([
      ["the board's colour", '#4CAF50', '#4CAF50'],
      ['the default colour, the board having none', null, DEFAULT_PURPLE],
    ])('adds a list at the end, in %s', async (_case, boardColour, shown) => {
      boardServer()
      coloursAre({ board: boardColour })
      const created = fakeEndpoint('post', '/api/v1/boards/:boardId/lists', () => HttpResponse.json(
        makeList({ id: 'list-3', board_id: 'board-1', name: 'Done' }), { status: 201 },
      ))
      fakeEndpoint('get', CARDS_URL, ({ url }) => {
        const listId = listOfCards(url)
        return HttpResponse.json(listId === 'list-3' ? [] : [
          makeCard({ id: `card-${listId}`, list_id: listId, name: listId === 'list-1' ? 'Homepage layout' : 'Footer links' }),
        ])
      })
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Add List' }))
      await user.type(screen.getByRole('textbox', { name: 'List name' }), 'Done{Enter}')

      await waitFor(() => expect(listOrder()).toEqual(['To do', 'Doing', 'Done']))
      expect(created.requests.map((r) => r.body)).toEqual([{ name: 'Done' }])
      expect(listHeader('Done')).toHaveStyle({ borderBottomColor: shown })
    })

    it('adds no list when the dialog is cancelled', async () => {
      boardServer()
      const created = fakeEndpoint('post', '/api/v1/boards/:boardId/lists', () => HttpResponse.json({}, { status: 201 }))
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Add List' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Create a new List' })).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(created.requests).toHaveLength(0)
      expect(listOrder()).toEqual(['To do', 'Doing'])
    })

    it('renames a list from its menu', async () => {
      boardServer()
      const renamed = fakeEndpoint('patch', LIST_URL, () => HttpResponse.json({ ...TODO, name: 'Backlog' }))
      const { user } = await renderBoard()

      await fromListMenu(user, 'To do', 'Rename List')
      const name = screen.getByRole('textbox', { name: 'List name' })
      await user.clear(name)
      await user.type(name, 'Backlog{Enter}')

      await waitFor(() => expect(listOrder()).toEqual(['Backlog', 'Doing']))
      expect(renamed.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-1/lists/list-1', { name: 'Backlog' }]])
    })

    it.each([
      ['Rename List', 'Rename List'],
      ['Change Color', 'Change Color'],
    ])('changes nothing when %s is cancelled', async (entry, title) => {
      boardServer()
      const sent = [fakeEndpoint('patch', LIST_URL), fakeEndpoint('put', `${LIST_URL}/color`)]
      const { user } = await renderBoard()

      await fromListMenu(user, 'To do', entry)
      await user.click(within(screen.getByRole('dialog', { name: title })).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(sent.map((endpoint) => endpoint.requests.length)).toEqual([0, 0])
      expect(listOrder()).toEqual(['To do', 'Doing'])
    })

    it('archives a list from its menu, taking it off the board', async () => {
      const server = boardServer()
      const archived = fakeEndpoint('patch', LIST_URL, () => HttpResponse.json({}))
      const { user } = await renderBoard()

      await fromListMenu(user, 'To do', 'Archive List')

      await waitFor(() => expect(listOrder()).toEqual(['Doing']))
      expect(archived.requests.map((r) => r.body)).toEqual([{ is_archived: true }])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.listLoads()).toBe(1)
    })
  })

  describe('cards', () => {
    it("adds a card to a list in the default colour, the list having none", async () => {
      boardServer()
      cardSaves(makeCard({ id: 'card-new', list_id: 'list-2', name: 'Contact form' }))
      const { user } = await renderBoard()

      await addCard(user, 'Doing', 'Contact form')

      expect(await within(column('Doing')).findByText('Contact form')).toBeInTheDocument()
      expect(cardBox('Contact form')).toHaveStyle({ borderColor: DEFAULT_PURPLE })
    })

    it("adds a card in its list's colour, as the board's colours hold it", async () => {
      boardServer()
      coloursAre({ lists: { 'list-2': '#2196F3' } })
      cardSaves(makeCard({ id: 'card-new', list_id: 'list-2', name: 'Contact form' }))
      const { user } = await renderBoard()

      await addCard(user, 'Doing', 'Contact form')

      expect(await within(column('Doing')).findByText('Contact form')).toBeInTheDocument()
      expect(cardBox('Contact form')).toHaveStyle({ borderColor: '#2196F3' })
    })

    it('copies a card into another list, in the colour it was copied with', async () => {
      boardServer()
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [BOARD], shared: [], templates: [] }))
      const copied = fakeEndpoint('post', `${CARD_URL}/copy`, () => HttpResponse.json(
        makeCard({ id: 'card-copy', list_id: 'list-2', name: 'Homepage layout v2' }), { status: 201 },
      ))
      fakeEndpoint('get', `${CARD_URL}/color`, () => HttpResponse.json({ color: '#4CAF50' }))
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Menu for Homepage layout' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Copy Card' }))
      const dialog = screen.getByRole('dialog', { name: 'Copy Card' })
      await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'List' })).toHaveTextContent('To do'))
      await user.click(within(dialog).getByRole('combobox', { name: 'List' }))
      await user.click(screen.getByRole('option', { name: 'Doing' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'Card name' }), ' v2')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      expect(await within(column('Doing')).findByText('Homepage layout v2')).toBeInTheDocument()
      expect(cardBox('Homepage layout v2')).toHaveStyle({ borderColor: '#4CAF50' })
      expect(copied.requests[0].url.pathname).toBe('/api/v1/boards/board-1/lists/list-1/cards/card-list-1/copy')
    })

    it('shows what is saved in a card opened from its list', async () => {
      boardServer()
      cardSaves(makeCard({ id: 'card-list-1', list_id: 'list-1', name: 'Homepage layout v2' }))
      const { user } = await renderBoard()
      await user.click(screen.getByText('Homepage layout'))
      const dialog = screen.getByRole('dialog', { name: 'Edit Card' })

      await user.type(within(dialog).getByRole('textbox', { name: /^Card name/ }), ' v2')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(await within(column('To do')).findByText('Homepage layout v2')).toBeInTheDocument()
    })
  })

  // Checklist writes send no notification, so the board fetches the list a
  // checklist was copied to itself.
  describe('a checklist copied onto another card', () => {
    const AT = '2026-01-01T00:00:00Z'
    const LAUNCH: ChecklistRead = {
      id: 'checklist-1', card_id: 'card-post', name: 'Launch', position: 0, created_at: AT, updated_at: AT,
      items: [{ id: 'item-1', checklist_id: 'checklist-1', text: 'Write copy', is_done: false, position: 0, created_at: AT, updated_at: AT }],
    }
    const POST = makeCard({ id: 'card-post', list_id: 'list-2', name: 'Launch post', checklists: [LAUNCH] })
    const MARKETING = makeBoard({ id: 'board-2', name: 'Marketing' })

    async function copyLaunch(user: UserEvent, toBoard?: string) {
      await user.click(screen.getByText('Launch post'))
      await user.click(screen.getByRole('button', { name: 'Menu for the checklist Launch' }))
      await user.click(screen.getByRole('menuitem', { name: 'Copy checklist to another card' }))
      const dialog = screen.getByRole('dialog', { name: 'Copy Checklist' })
      await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Card' })).toHaveTextContent('Launch post'))
      if (toBoard) {
        await user.click(within(dialog).getByRole('combobox', { name: 'Board' }))
        await user.click(screen.getByRole('option', { name: toBoard }))
        await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Card' })).toHaveTextContent('Homepage layout'))
      }
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copy Checklist' })).not.toBeInTheDocument())
    }

    // The copy dialog asks for the cards it offers at the same address as
    // the board does, so the board's own loads are told by the order it asks
    // for alongside them, which the dialog doesn't.
    function copies() {
      cardSaves(POST)
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [BOARD, MARKETING], shared: [], templates: [] }))
      fakeEndpoint('post', `${CARD_URL}/checklists`, () => HttpResponse.json({ id: 'checklist-9' }, { status: 201 }))
      const orders = fakeEndpoint('get', `${CARDS_URL}/order`, ({ url }) => HttpResponse.json({ list_id: new URL(url).pathname.split('/').at(-3), card_ids: [] }))
      return {
        items: fakeEndpoint('post', `${CARD_URL}/checklists/:checklistId/items`, () => HttpResponse.json({}, { status: 201 })),
        boardLoads: () => orders.requests.map((r) => r.url.pathname.split('/').at(-3)),
      }
    }

    it("fetches the list's cards again when it's on this board", async () => {
      boardServer({ more: [POST] })
      const { items, boardLoads } = copies()
      const { user } = await renderBoard()
      expect(boardLoads().sort()).toEqual(['list-1', 'list-2'])

      await copyLaunch(user)

      await waitFor(() => expect(boardLoads().sort()).toEqual(['list-1', 'list-2', 'list-2']))
      expect(items.requests[0].url.pathname).toBe('/api/v1/boards/board-1/lists/list-2/cards/card-post/checklists/checklist-9/items')
    })

    it("fetches nothing when it's on another board, even a list there of the same id", async () => {
      boardServer({ more: [POST] })
      const { items, boardLoads } = copies()
      const { user } = await renderBoard()

      await copyLaunch(user, 'Marketing')

      await waitFor(() => expect(items.requests).toHaveLength(1))
      expect(items.requests[0].url.pathname).toMatch(/^\/api\/v1\/boards\/board-2\/lists\/list-1\//)
      await settle()
      expect(boardLoads().sort()).toEqual(['list-1', 'list-2'])
    })
  })

  describe('changes made elsewhere', () => {
    it("fetches the lists again on a list change made elsewhere, and a restored list's cards", async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()

      socket.receive({ type: 'list_renamed', board_id: 'board-1', list_id: null, origin_client_id: null })
      await waitFor(() => expect(server.listLoads()).toBe(2))
      socket.receive({ type: 'list_unarchived', board_id: 'board-1', list_id: 'list-2', origin_client_id: null })

      await waitFor(() => expect(server.listLoads()).toBe(3))
      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 2 }))
    })

    it("fetches a list's cards again on a card change made elsewhere", async () => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 1 }))
      expect(server.listLoads()).toBe(1)
    })

    it.each([
      ['list', 'list_renamed'],
      ['card', 'card_updated'],
    ])('ignores its own %s changes, those on another board, and other kinds', async (_kind, type) => {
      const server = boardServer()
      await renderBoard()
      const socket = await openSocket()

      socket.receive({ type, board_id: 'board-1', list_id: 'list-1', origin_client_id: getClientId() })
      socket.receive({ type, board_id: 'board-2', list_id: 'list-1', origin_client_id: null })
      socket.receive({ type: 'board_shared', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      await settle()
      expect(server.listLoads()).toBe(1)
      expect(server.cardLoads()).toEqual({ 'list-1': 1, 'list-2': 1 })
    })

    it('fetches every list\'s cards again when you change your avatar, which their people show', async () => {
      const server = boardServer()
      fakeEndpoint('delete', '/api/v1/users/me/avatar')
      fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(new Blob(['png'], { type: 'image/png' })))
      URL.createObjectURL = vi.fn(() => 'blob:avatar-1')
      URL.revokeObjectURL = vi.fn()
      onTestFinished(() => {
        // @ts-expect-error -- jsdom doesn't have them; put it back that way.
        delete URL.createObjectURL
        // @ts-expect-error -- as above.
        delete URL.revokeObjectURL
      })
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'User profile' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Change / Remove avatar' }))
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove avatar' }))

      await waitFor(() => expect(server.cardLoads()).toEqual({ 'list-1': 2, 'list-2': 2 }))
    })
  })

  describe('the board menu', () => {
    it("opens your e-mail notifications for the board, and closes them", async () => {
      boardServer()
      const settings = fakeEndpoint('get', '/api/v1/boards/:boardId/notifications', () => HttpResponse.json({
        board_id: 'board-1', is_enabled: false, notify_hour: 9, notify_weekdays: [1, 2, 3, 4, 5], offset_days: [], overdue_repeat_after_days: null,
      }))
      const { user } = await renderBoard()

      await user.click(screen.getByRole('button', { name: 'Board menu' }))
      await user.click(await screen.findByRole('menuitem', { name: 'E-Mail notification' }))

      const dialog = await screen.findByRole('dialog', { name: 'My e-mail notifications' })
      await waitFor(() => expect(settings.requests).toHaveLength(1))
      expect(settings.requests[0].url.pathname).toBe('/api/v1/boards/board-1/notifications')
      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })

  describe('a template', () => {
    it('shows its lists, without what a template holds none of: cards, labels, notifications, search', async () => {
      boardServer()
      fakeEndpoint('get', '/api/v1/boards/:boardId', () => HttpResponse.json({ ...BOARD, is_template: true }))
      fakeEndpoint('get', CARDS_URL, () => HttpResponse.json([]))
      renderBoardAt('/boards/board-1')

      expect(await screen.findByText('Template')).toBeInTheDocument()
      await waitFor(() => expect(listOrder()).toEqual(['To do', 'Doing']))
      expect(screen.getByRole('button', { name: 'Add List' })).toBeInTheDocument()
      for (const name of ['Labels', 'Sort cards', 'Board menu', 'Add a card to To do']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
      expect(screen.queryByRole('textbox', { name: /^Search/ })).not.toBeInTheDocument()
    })
  })

  describe("the viewer's formats", () => {
    it("writes the cards' dates in the viewer's own format once their profile is in", async () => {
      boardServer({ more: [makeCard({ id: 'card-due', list_id: 'list-2', name: 'Launch', due_at: '2026-03-05T10:00:00Z' })] })
      renderWithProviders(<Board />, {
        route: '/boards/board-1', path: '/boards/:boardId', auth: { number_locale: 'en_GB', date_format: 'textual' },
      })

      expect(await screen.findByText(/^Thursday.*5 March 2026\b.*\b11:00$/)).toBeInTheDocument()
    })
  })

  describe('without a board in the address', () => {
    it('asks the server for nothing about a board', async () => {
      const fetched = vi.spyOn(globalThis, 'fetch')
      renderWithProviders(<Board />, { route: '/boards', path: '/boards', auth: true })
      await screen.findByRole('button', { name: 'User profile' })
      await settle()

      const urls = fetched.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)))
      expect(urls.filter((url) => url.includes('/api/v1/boards'))).toEqual([])
    })
  })
})
