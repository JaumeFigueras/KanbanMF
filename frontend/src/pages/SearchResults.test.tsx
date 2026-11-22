import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { useLocation } from 'react-router-dom'
import type { SearchResults as SearchResultsData } from '../types/board'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeCard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
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

// The search as the server runs it: every query finds the one card.
// `server.fail()` makes it fail from then on (a server error, unless told
// otherwise), and `server.recover()` makes it work again.
function searchServer(answer: Answer = () => HttpResponse.json(FOUND)) {
  let down: Answer | null = null
  const search = fakeEndpoint('get', '/api/v1/search', (request) => (down ?? answer)(request))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    // The queries searched for, in order.
    queries: () => search.requests.map((r) => r.url.searchParams.get('q')),
    fail: (failure: Answer = SERVER_ERROR) => { down = failure },
    recover: () => { down = null },
  }
}

const renderSearch = (q = 'homepage') => renderWithProviders(<SearchResults />, { route: `/search?q=${q}`, auth: true })

// The address the router is at, to see where a result leads.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}

describe('SearchResults', () => {
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
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      server.recover()

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      expect(await screen.findByText('Homepage layout')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('takes the results away when searching again on a change fails', async () => {
      const server = searchServer()
      renderSearch()
      await screen.findByText('Homepage layout')
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      server.fail()

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      expect(await screen.findByRole('alert')).toHaveTextContent("The search couldn't be done.")
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
    })
  })

  describe('answers that come back out of order', () => {
    // The search's answer with its one card renamed.
    const foundCard = (name: string): SearchResultsData => ({
      ...FOUND,
      boards: [{ ...FOUND.boards[0], lists: [{ ...FOUND.boards[0].lists[0], cards: [makeCard({ id: 'card-1', list_id: 'list-1', name })] }] }],
    })

    it('keeps the newer results for the same query when an older answer comes last', async () => {
      searchServer()
      renderSearch()
      await screen.findByText('Homepage layout')
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      const held = heldAnswer(() => HttpResponse.json(FOUND))
      let first = true
      fakeEndpoint('get', '/api/v1/search', (request) => {
        const answer: Answer = first ? held.answer : () => HttpResponse.json(foundCard('Homepage layout, final'))
        first = false
        return answer(request)
      })

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })
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
})
