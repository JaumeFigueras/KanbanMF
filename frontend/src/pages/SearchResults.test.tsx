import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { SearchBoardRead, SearchResults as SearchResultsData } from '../types/board'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeCard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { dropAndReconnect } from '../test/reconnect'
import SearchResults from './SearchResults'

// One matching card on one board.
const FOUND: SearchResultsData = {
  boards: [{
    board_id: 'board-1',
    board_name: 'Website redesign',
    color: null,
    card_colors: {},
    match_count: 1,
    matched_in: { 'card-1': ['name'] },
    lists: [{
      list_id: 'list-1',
      list_name: 'To do',
      color: null,
      cards: [makeCard({ id: 'card-1', list_id: 'list-1', name: 'Homepage layout' })],
    }],
  }],
  matching_boards: [],
  truncated: false,
}

// A second board with a matching card.
const MOBILE: SearchBoardRead = {
  board_id: 'board-2',
  board_name: 'Mobile app',
  color: null,
  card_colors: {},
  match_count: 1,
  matched_in: { 'card-2': ['description'] },
  lists: [{
    list_id: 'list-2',
    list_name: 'Backlog',
    color: null,
    cards: [makeCard({ id: 'card-2', list_id: 'list-2', name: 'Homepage banner' })],
  }],
}

const NOTHING: SearchResultsData = { boards: [], matching_boards: [], truncated: false }
const MATCHING_BOARD = { board_id: 'board-7', board_name: 'Homepage ideas', color: null }

// The search's answer with its one card renamed.
const foundCard = (name: string): SearchResultsData => ({
  ...FOUND,
  boards: [{ ...FOUND.boards[0], lists: [{ ...FOUND.boards[0].lists[0], cards: [makeCard({ id: 'card-1', list_id: 'list-1', name })] }] }],
})

// The search as the server runs it: every query finds the one card, unless
// told otherwise. `server.fail()` makes it fail from then on (a server
// error, unless told otherwise), and `server.recover()` makes it work again.
function searchServer(answer: Answer = () => HttpResponse.json(FOUND)) {
  let down: Answer | null = null
  let current = answer
  const search = fakeEndpoint('get', '/api/v1/search', (request) => (down ?? current)(request))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    // The queries searched for, in order.
    queries: () => search.requests.map((r) => r.url.searchParams.get('q')),
    // Each search's whole query string.
    params: () => search.requests.map((r) => r.url.searchParams.toString()),
    answer: (next: SearchResultsData) => { current = () => HttpResponse.json(next) },
    fail: (failure: Answer = SERVER_ERROR) => { down = failure },
    recover: () => { down = null },
  }
}

// Every query finds `results`.
const answering = (results: SearchResultsData): Answer => () => HttpResponse.json(results)

const renderSearch = (q = 'homepage') => renderWithProviders(<SearchResults />, { route: `/search?q=${q}`, auth: true })

// The address the router is at, to see where a result leads.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}

// The router's history: Go opens an address, as a link would, and Back goes
// back, as the browser's button does.
function History({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate(to)}>Go</button>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
    </>
  )
}

// The page's WebSocket, open, to deliver notifications.
async function openSocket() {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  socket.open()
  return socket
}

const changeElsewhere = { type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null }

// A board's section, by its heading, and a matching card, by its name.
const section = (name: string) => screen.getByRole('button', { name })
const cardLink = (name: string) => screen.queryByRole('link', { name: new RegExp(`^${name}`) })

const searchBox = () => screen.getByRole('textbox', { name: /^Search/ })

describe('SearchResults', () => {
  describe('what it shows', () => {
    it('says how many letters to type when the query is too short, and searches once there are enough', async () => {
      const server = searchServer()
      const { user } = renderSearch('%20h%20')

      expect(await screen.findByText('Type at least 2 characters.')).toBeInTheDocument()
      expect(searchBox()).toHaveValue('h')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      await user.type(searchBox(), 'o')

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.queryByText('Type at least 2 characters.')).not.toBeInTheDocument()
      expect(server.queries()).toEqual(['ho'])
    })

    it('says nothing matches when no card or board does', async () => {
      searchServer(answering(NOTHING))
      renderSearch('zebra')

      expect(await screen.findByText('Nothing matches "zebra".')).toBeInTheDocument()
      expect(screen.queryByText('Boards')).not.toBeInTheDocument()
      expect(screen.queryByText('Cards')).not.toBeInTheDocument()
    })

    it.each([
      ['only boards match', { ...NOTHING, matching_boards: [MATCHING_BOARD] }, ['Boards']],
      ['boards and cards match', { ...FOUND, matching_boards: [MATCHING_BOARD] }, ['Boards', 'Cards']],
      ['only cards match', FOUND, []],
    ])('heads the boards and the cards only when both show, when %s', async (_case, results: SearchResultsData, headings) => {
      searchServer(answering(results))
      renderSearch()

      await screen.findByRole('link', { name: results.matching_boards.length ? 'Homepage ideas' : /^Homepage layout/ })

      expect(['Boards', 'Cards'].filter((heading) => screen.queryByText(heading))).toEqual(headings)
      expect(screen.queryByText(/^Nothing matches/)).not.toBeInTheDocument()
    })

    it('paints each matching board in its own colour', async () => {
      searchServer(answering({
        ...NOTHING,
        matching_boards: [{ ...MATCHING_BOARD, color: '#4CAF50' }, { board_id: 'board-8', board_name: 'Homepage copy', color: null }],
      }))
      renderSearch()

      expect(await screen.findByRole('link', { name: 'Homepage ideas' })).toHaveStyle({ borderColor: '#4CAF50' })
      expect(screen.getByRole('link', { name: 'Homepage copy' })).not.toHaveStyle({ borderColor: '#4CAF50' })
    })

    it('says when only the most recently changed cards are shown, counting those shown', async () => {
      searchServer(answering({ boards: [{ ...FOUND.boards[0], match_count: 3 }, { ...MOBILE, match_count: 2 }], matching_boards: [], truncated: true }))
      renderSearch()

      expect(await screen.findByText(
        'Only the 5 most recently changed cards that match are shown. Add words to narrow the search.',
      )).toBeInTheDocument()
    })

    it('says nothing of the kind when every match is shown', async () => {
      searchServer(answering({ ...FOUND, boards: [...FOUND.boards, MOBILE] }))
      renderSearch()

      await screen.findByText('Homepage banner')

      expect(screen.queryByText(/most recently changed/)).not.toBeInTheDocument()
    })

    it('says under each card which of its fields matched', async () => {
      const description = makeCard({ id: 'card-3', list_id: 'list-1', name: 'Homepage copy' })
      searchServer(answering({
        ...FOUND,
        boards: [{
          ...FOUND.boards[0],
          match_count: 2,
          matched_in: { 'card-1': ['name', 'checklist', 'label'], 'card-3': [] },
          lists: [{ ...FOUND.boards[0].lists[0], cards: [...FOUND.boards[0].lists[0].cards, description] }],
        }],
      }))
      renderSearch()

      expect(await screen.findByRole('link', { name: /^Homepage layout/ })).toHaveTextContent('Found in: name, checklist, label')
      expect(cardLink('Homepage copy')).not.toHaveTextContent('Found in')
    })

    it("names the matching fields in the viewer's language", async () => {
      searchServer(answering({ ...FOUND, boards: [{ ...FOUND.boards[0], matched_in: { 'card-1': ['name', 'checklist'] } }] }))
      renderWithProviders(<SearchResults />, { route: '/search?q=homepage', auth: { language_locale: 'ca_ES' } })

      expect(await screen.findByText('Trobat a: nom, llista de verificació')).toBeInTheDocument()
    })

    it("paints the cards in the viewer's colours for them, and the rest in the default", async () => {
      const copy = makeCard({ id: 'card-3', list_id: 'list-1', name: 'Homepage copy' })
      searchServer(answering({
        ...FOUND,
        boards: [{
          ...FOUND.boards[0],
          card_colors: { 'card-1': '#4CAF50' },
          lists: [{ ...FOUND.boards[0].lists[0], cards: [...FOUND.boards[0].lists[0].cards, copy] }],
        }],
      }))
      renderSearch()

      expect((await screen.findByText('Homepage layout')).closest('.MuiCard-root')).toHaveStyle({ borderColor: '#4CAF50' })
      expect(screen.getByText('Homepage copy').closest('.MuiCard-root')).toHaveStyle({ borderColor: '#9C27B0' })
    })

    it("writes the cards' dates in the viewer's own format once their profile is in", async () => {
      searchServer(answering({
        ...FOUND,
        boards: [{ ...FOUND.boards[0], lists: [{ ...FOUND.boards[0].lists[0], cards: [makeCard({ id: 'card-1', list_id: 'list-1', name: 'Homepage layout', due_at: '2026-03-05T10:00:00Z' })] }] }],
      }))
      renderWithProviders(<SearchResults />, { route: '/search?q=homepage', auth: { number_locale: 'en_GB', date_format: 'textual' } })

      expect(await screen.findByText(/^Thursday.*5 March 2026\b.*\b11:00$/)).toBeInTheDocument()
    })
  })

  describe("folding a board's results", () => {
    it('shows every board open, and folds and unfolds each on its own', async () => {
      searchServer(answering({ ...FOUND, boards: [...FOUND.boards, MOBILE] }))
      const { user } = renderSearch()
      expect(await screen.findByRole('button', { name: 'Website redesign (1)' })).toHaveAttribute('aria-expanded', 'true')
      expect(section('Mobile app (1)')).toHaveAttribute('aria-expanded', 'true')
      expect(cardLink('Homepage layout')).toBeInTheDocument()
      expect(cardLink('Homepage banner')).toBeInTheDocument()

      await user.click(section('Website redesign (1)'))

      expect(section('Website redesign (1)')).toHaveAttribute('aria-expanded', 'false')
      await waitFor(() => expect(cardLink('Homepage layout')).not.toBeInTheDocument())
      expect(cardLink('Homepage banner')).toBeInTheDocument()

      await user.click(section('Mobile app (1)'))
      await user.click(section('Website redesign (1)'))

      expect(section('Website redesign (1)')).toHaveAttribute('aria-expanded', 'true')
      expect(cardLink('Homepage layout')).toBeInTheDocument()
      expect(section('Mobile app (1)')).toHaveAttribute('aria-expanded', 'false')
    })

    it('searches again once the connection comes back (7C)', async () => {
      const server = searchServer()
      renderSearch()
      await screen.findByRole('button', { name: 'Website redesign (1)' })
      const socket = await openSocket()

      dropAndReconnect(socket)

      await waitFor(() => expect(server.queries()).toEqual(['homepage', 'homepage']))
    })

    it('keeps a folded board folded when it searches again on a change elsewhere', async () => {
      const server = searchServer(answering({ ...FOUND, boards: [...FOUND.boards, MOBILE] }))
      const { user } = renderSearch()
      await user.click(await screen.findByRole('button', { name: 'Website redesign (1)' }))
      const socket = await openSocket()
      const copy = makeCard({ id: 'card-3', list_id: 'list-1', name: 'Homepage copy' })
      server.answer({
        ...FOUND,
        boards: [{ ...FOUND.boards[0], match_count: 2, lists: [{ ...FOUND.boards[0].lists[0], cards: [...FOUND.boards[0].lists[0].cards, copy] }] }, MOBILE],
      })

      socket.receive(changeElsewhere)

      expect(await screen.findByRole('button', { name: 'Website redesign (2)' })).toHaveAttribute('aria-expanded', 'false')
      expect(cardLink('Homepage copy')).not.toBeInTheDocument()
      expect(section('Mobile app (1)')).toHaveAttribute('aria-expanded', 'true')
      expect(server.queries()).toEqual(['homepage', 'homepage'])
    })
  })

  describe('the query and where it looks', () => {
    it.each([
      ['every board', '', 'q=homepage', 'in all your boards', 'Search all boards'],
      ['one board', '&board=board-1', 'q=homepage&board_id=board-1', 'in Website redesign', 'Search this board'],
      ["one board's archive", '&board=board-1&archived=1', 'q=homepage&board_id=board-1&archived=true', 'in the archive of Website redesign', "Search this board's archive"],
      ['the archived boards', '&archived=1', 'q=homepage&archived=true', 'in your archived boards', 'Search archived boards'],
    ])('searches %s for the query in the address, and says where', async (_scope, params, sent, where, box) => {
      const server = searchServer()
      fakeEndpoint('get', '/api/v1/boards/board-1', () => HttpResponse.json({ name: 'Website redesign' }))
      renderSearch(`homepage${params}`)

      expect(await screen.findByText(where)).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: box })).toHaveValue('homepage')
      await screen.findByText('Homepage layout')
      expect(server.params()).toEqual([sent])
    })

    it('puts what you type in the address in place, once you pause, so Back leaves the page', async () => {
      const server = searchServer()
      const { user } = renderWithProviders(
        <>
          <Routes><Route path="/search" element={<SearchResults />} /></Routes>
          <Address />
          <History to="/search?q=homepage" />
        </>,
        { route: '/boards', auth: true },
      )
      await user.click(screen.getByRole('button', { name: 'Go' }))
      await screen.findByText('Homepage layout')

      await user.type(searchBox(), ' layout')

      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('/search?q=homepage+layout'))
      await waitFor(() => expect(server.queries()).toEqual(['homepage', 'homepage layout']))
      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(screen.getByTestId('address').textContent).toBe('/boards')
    })

    it('follows the address when it changes from elsewhere, as Back between two searches', async () => {
      const server = searchServer((request) => HttpResponse.json(
        new URL(request.url).searchParams.get('q') === 'hero' ? foundCard('Hero banner') : FOUND,
      ))
      const { user } = renderWithProviders(
        <>
          <Routes><Route path="/search" element={<SearchResults />} /></Routes>
          <History to="/search?q=hero" />
        </>,
        { route: '/search?q=homepage', auth: true },
      )
      await screen.findByText('Homepage layout')

      await user.click(screen.getByRole('button', { name: 'Go' }))

      expect(await screen.findByText('Hero banner')).toBeInTheDocument()
      expect(searchBox()).toHaveValue('hero')

      await user.click(screen.getByRole('button', { name: 'Back' }))

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(searchBox()).toHaveValue('homepage')
      // Long enough for a box left behind to have put its own query back.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(server.queries()).toEqual(['homepage', 'hero', 'homepage'])
    })
  })

  describe('searching, and searches that fail', () => {
    it("shows that it's searching until the results are in", async () => {
      const held = heldAnswer(() => HttpResponse.json(FOUND))
      searchServer(held.answer)
      renderSearch()

      expect(await screen.findByRole('status')).toHaveTextContent('Searching…')
      held.release()

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
    })

    it("says the search couldn't be done, rather than show a blank page, and runs it again with Try again", async () => {
      const server = searchServer()
      server.fail()
      const { user } = renderSearch()

      expect(await screen.findByRole('alert')).toHaveTextContent("The search couldn't be done.")
      expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
      server.recover()
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.queries()).toEqual(['homepage', 'homepage'])
    })

    it("shows that it's searching while Try again runs, and says so again if it fails again", async () => {
      const server = searchServer()
      server.fail()
      const { user } = renderSearch()
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail(held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Searching…')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("The search couldn't be done.")
    })

    it('says so when the connection drops', async () => {
      searchServer().fail(DROPPED)
      renderSearch()

      expect(await screen.findByRole('alert')).toHaveTextContent("The search couldn't be done.")
    })

    it('searches a new query normally after one that failed', async () => {
      const server = searchServer()
      server.fail()
      const { user } = renderSearch()
      await screen.findByRole('alert')
      server.recover()

      await user.type(screen.getByRole('textbox', { name: 'Search all boards' }), ' layout')

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.queries()).toEqual(['homepage', 'homepage layout'])
    })

    it('shows the results by itself when it searches again on a change, and this time it works', async () => {
      const server = searchServer()
      server.fail()
      renderSearch()
      await screen.findByRole('alert')
      const socket = await openSocket()
      server.recover()

      socket.receive(changeElsewhere)

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('takes the results away when searching again on a change fails', async () => {
      const server = searchServer()
      renderSearch()
      await screen.findByText('Homepage layout')
      const socket = await openSocket()
      server.fail()

      socket.receive(changeElsewhere)

      expect(await screen.findByRole('alert')).toHaveTextContent("The search couldn't be done.")
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
    })
  })

  describe('answers that come back out of order', () => {
    it('keeps the newer results for the same query when an older answer comes last', async () => {
      searchServer()
      renderSearch()
      await screen.findByText('Homepage layout')
      const socket = await openSocket()
      const held = heldAnswer(() => HttpResponse.json(FOUND))
      let first = true
      fakeEndpoint('get', '/api/v1/search', (request) => {
        const answer: Answer = first ? held.answer : () => HttpResponse.json(foundCard('Homepage layout, final'))
        first = false
        return answer(request)
      })

      socket.receive(changeElsewhere)
      socket.receive(changeElsewhere)
      expect(await screen.findByText('Homepage layout, final')).toBeInTheDocument()
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(screen.getByText('Homepage layout, final')).toBeInTheDocument()
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
    })

    it("keeps the new query's results when the old query's answer comes after them", async () => {
      const held = heldAnswer(() => HttpResponse.json(FOUND))
      const server = searchServer((request) => (
        new URL(request.url).searchParams.get('q') === 'homepage' ? held.answer(request) : HttpResponse.json(foundCard('Homepage hero'))
      ))
      const { user } = renderSearch()
      await screen.findByText('Searching…')

      await user.type(screen.getByRole('textbox', { name: 'Search all boards' }), ' hero')
      expect(await screen.findByText('Homepage hero')).toBeInTheDocument()
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(server.queries()).toEqual(['homepage', 'homepage hero'])
      expect(screen.getByText('Homepage hero')).toBeInTheDocument()
      expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
    })
  })

  describe('opening a result (6J)', () => {
    it('opens a card on its board with the keyboard, from its board\'s section', async () => {
      searchServer()
      const { user } = renderWithProviders(<><SearchResults /><Address /></>, { route: '/search?q=homepage', auth: true })
      const section = await screen.findByRole('button', { name: 'Website redesign (1)' })
      act(() => section.focus())

      await user.tab()
      const card = screen.getByRole('link', { name: /Homepage layout/ })
      expect(card).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(screen.getByTestId('address')).toHaveTextContent('/boards/board-1?card=card-1')
    })

    // An archived card can't be opened, so it leads to where it's kept.
    it.each([
      ['every board', '', '/boards/board-1?card=card-1'],
      ['one board', '&board=board-1', '/boards/board-1?card=card-1'],
      ["one board's archive", '&board=board-1&archived=1', '/boards/board-1?archive=1&highlight=card-1'],
      ['the archived boards', '&archived=1', '/boards?archived=1'],
    ])('makes each card a link when searching %s, so it can also open in a new tab', async (_scope, params, href) => {
      searchServer()
      fakeEndpoint('get', '/api/v1/boards/board-1', () => HttpResponse.json({ name: 'Website redesign' }))
      renderSearch(`homepage${params}`)

      expect(await screen.findByRole('link', { name: /Homepage layout/ })).toHaveAttribute('href', href)
    })
  })

  // 6V: the back button and the matching boards were buttons, which can't
  // open in a new tab.
  describe('where the links lead', () => {
    it.each([
      ['every board', '', 'Back to Boards', '/boards'],
      ['one board', '&board=board-1', 'Back to Website redesign', '/boards/board-1'],
      ["one board's archive", '&board=board-1&archived=1', 'Back to the archive', '/boards/board-1?archive=1'],
      ['the archived boards', '&archived=1', 'Back to Boards', '/boards?archived=1'],
    ])('goes back from a link when searching %s', async (_scope, params, name, href) => {
      searchServer()
      fakeEndpoint('get', '/api/v1/boards/board-1', () => HttpResponse.json({ name: 'Website redesign' }))
      const { user } = renderWithProviders(<><SearchResults /><Address /></>, { route: `/search?q=homepage${params}`, auth: true })
      const back = await screen.findByRole('link', { name })
      expect(back).toHaveAttribute('href', href)

      await user.click(back)

      expect(screen.getByTestId('address').textContent).toBe(href)
    })

    // An archived board can't be opened, so it leads to where it's kept.
    it.each([
      ['every board', '', '/boards/board-7'],
      ['the archived boards', '&archived=1', '/boards?archived=1'],
    ])('makes each matching board a link when searching %s', async (_scope, params, href) => {
      searchServer(() => HttpResponse.json({
        ...FOUND,
        matching_boards: [{ board_id: 'board-7', board_name: 'Homepage ideas', color: null }],
      }))
      const { user } = renderWithProviders(<><SearchResults /><Address /></>, { route: `/search?q=homepage${params}`, auth: true })
      const board = await screen.findByRole('link', { name: 'Homepage ideas' })
      expect(board).toHaveAttribute('href', href)

      await user.click(board)

      expect(screen.getByTestId('address').textContent).toBe(href)
    })
  })

  // 6Y: until the name was in, and for good if it couldn't be loaded, the
  // page said "Back to " and "in ", with nothing after them.
  describe("the board's name (6Y)", () => {
    // Each board's name as the server has it: board-1 is Website redesign,
    // board-2 Mobile app, unless the test holds or refuses the answer.
    function boardNames(answers: Record<string, Answer> = {}) {
      const names: Record<string, string> = { 'board-1': 'Website redesign', 'board-2': 'Mobile app' }
      return fakeEndpoint('get', '/api/v1/boards/:boardId', (request) => {
        const id = new URL(request.url).pathname.split('/').pop()!
        return (answers[id] ?? (() => HttpResponse.json({ name: names[id] })))(request)
      })
    }

    it.each([
      ['refused', SERVER_ERROR],
      ['cut off', DROPPED],
    ])("says \"this board\" when its name can't be loaded (%s), and still searches it and goes back to it", async (_case, answer: Answer) => {
      const server = searchServer()
      const board = boardNames({ 'board-1': answer })
      const { user } = renderWithProviders(<><SearchResults /><Address /></>, { route: '/search?q=homepage&board=board-1', auth: true })

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      await waitFor(() => expect(board.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1']))
      expect(server.params()).toEqual(['q=homepage&board_id=board-1'])
      expect(screen.getByText('in this board')).toBeInTheDocument()
      const back = screen.getByRole('link', { name: 'Back to the board' })
      expect(back).toHaveAttribute('href', '/boards/board-1')

      await user.click(back)

      expect(screen.getByTestId('address').textContent).toBe('/boards/board-1')
    })

    it("says \"this board's archive\" when the name of the board whose archive is searched can't be loaded", async () => {
      searchServer()
      boardNames({ 'board-1': SERVER_ERROR })
      renderSearch('homepage&board=board-1&archived=1')

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.getByText("in this board's archive")).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to the archive' })).toHaveAttribute('href', '/boards/board-1?archive=1')
    })

    it('says "this board" until its name is in, then its name', async () => {
      searchServer()
      const held = heldAnswer(() => HttpResponse.json({ name: 'Website redesign' }))
      boardNames({ 'board-1': held.answer })
      renderSearch('homepage&board=board-1')
      await screen.findByText('Homepage layout')
      expect(screen.getByText('in this board')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to the board' })).toBeInTheDocument()

      held.release()

      expect(await screen.findByText('in Website redesign')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to Website redesign' })).toBeInTheDocument()
      expect(screen.queryByText('in this board')).not.toBeInTheDocument()
    })

    it("never shows one board's name for another, on going between two boards' searches", async () => {
      searchServer()
      const held = heldAnswer(() => HttpResponse.json({ name: 'Mobile app' }))
      boardNames({ 'board-2': held.answer })
      const { user } = renderWithProviders(
        <>
          <Routes><Route path="/search" element={<SearchResults />} /></Routes>
          <History to="/search?q=homepage&board=board-2" />
        </>,
        { route: '/search?q=homepage&board=board-1', auth: true },
      )
      await screen.findByRole('link', { name: 'Back to Website redesign' })

      await user.click(screen.getByRole('button', { name: 'Go' }))

      expect(await screen.findByRole('link', { name: 'Back to the board' })).toHaveAttribute('href', '/boards/board-2')
      expect(screen.getByText('in this board')).toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('link', { name: 'Back to Mobile app' })).toBeInTheDocument()
    })

    it("keeps the board's name when another board's answer comes after it, on Back", async () => {
      searchServer()
      const held = heldAnswer(() => HttpResponse.json({ name: 'Mobile app' }))
      const board = boardNames({ 'board-2': held.answer })
      const { user } = renderWithProviders(
        <>
          <Routes><Route path="/search" element={<SearchResults />} /></Routes>
          <History to="/search?q=homepage&board=board-2" />
        </>,
        { route: '/search?q=homepage&board=board-1', auth: true },
      )
      await screen.findByRole('link', { name: 'Back to Website redesign' })
      await user.click(screen.getByRole('button', { name: 'Go' }))
      await screen.findByRole('link', { name: 'Back to the board' })

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByRole('link', { name: 'Back to Website redesign' })).toBeInTheDocument()
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(board.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1', '/api/v1/boards/board-2', '/api/v1/boards/board-1'])
      expect(screen.getByRole('link', { name: 'Back to Website redesign' })).toBeInTheDocument()
      expect(screen.getByText('in Website redesign')).toBeInTheDocument()
    })
  })
})
