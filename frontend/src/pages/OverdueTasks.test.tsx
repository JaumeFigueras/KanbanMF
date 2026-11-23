import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { useLocation } from 'react-router-dom'
import type { OverdueBoardRead } from '../types/board'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeCard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import OverdueTasks from './OverdueTasks'

const WEBSITE: OverdueBoardRead = {
  board_id: 'board-1',
  board_name: 'Website redesign',
  color: null,
  card_colors: {},
  overdue_count: 1,
  lists: [{
    list_id: 'list-1',
    list_name: 'To do',
    color: null,
    cards: [makeCard({ id: 'card-1', list_id: 'list-1', name: 'Homepage layout', due_at: '2026-01-10T12:00:00Z' })],
  }],
}

// A second board, with two overdue cards in two lists.
const MOBILE: OverdueBoardRead = {
  board_id: 'board-2',
  board_name: 'Mobile app',
  color: null,
  card_colors: {},
  overdue_count: 2,
  lists: [
    { list_id: 'list-2', list_name: 'Backlog', color: null, cards: [makeCard({ id: 'card-2', list_id: 'list-2', name: 'Push notifications', due_at: '2026-01-12T12:00:00Z' })] },
    { list_id: 'list-3', list_name: 'Doing', color: null, cards: [makeCard({ id: 'card-3', list_id: 'list-3', name: 'Offline mode', due_at: '2026-01-14T12:00:00Z' })] },
  ],
}

const DEFAULT_PURPLE = '#9C27B0'

// The overdue cards as the server has them: one board's, unless told
// otherwise. `server.update()` changes them, `server.fail()` makes the load
// fail from then on (a server error, unless told otherwise), and
// `server.recover()` makes it work again.
function overdueServer(initial: OverdueBoardRead[] = [WEBSITE]) {
  let boards = initial
  let down: Answer | null = null
  const overdue = fakeEndpoint('get', '/api/v1/boards/overdue', (request) => (down ?? (() => HttpResponse.json(boards)))(request))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    loads: () => overdue.requests.length,
    update: (next: OverdueBoardRead[]) => { boards = next },
    fail: (answer: Answer = SERVER_ERROR) => { down = answer },
    recover: () => { down = null },
  }
}

const renderOverdue = () => renderWithProviders(<OverdueTasks />, { route: '/overdue', auth: true })

// The address the router is at, to see where a card leads.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}

// The page's WebSocket, open, to deliver notifications.
async function openSocket() {
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  socket.open()
  return socket
}

const changeElsewhere = { type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null }

// A board's section, by its heading, and a card it shows, by its name.
const section = (name: string) => screen.getByRole('button', { name })
const cardLink = (name: string) => screen.queryByRole('link', { name: new RegExp(`^${name}`) })

const listHeader = (name: string) => screen.getByText(name).parentElement!
const cardBox = (name: string) => screen.getByText(name).closest<HTMLElement>('.MuiCard-root')!

describe('OverdueTasks', () => {
  describe('what it shows', () => {
    it('shows each board folded, with how many cards are overdue, and its lists with their cards once unfolded', async () => {
      overdueServer([WEBSITE, MOBILE])
      const { user } = renderOverdue()

      expect(await screen.findByRole('button', { name: 'Website redesign (1)' })).toHaveAttribute('aria-expanded', 'false')
      expect(section('Mobile app (2)')).toHaveAttribute('aria-expanded', 'false')
      expect(cardLink('Homepage layout')).not.toBeInTheDocument()
      expect(cardLink('Push notifications')).not.toBeInTheDocument()

      await user.click(section('Mobile app (2)'))

      expect(section('Mobile app (2)')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Backlog')).toBeVisible()
      expect(screen.getByText('Doing')).toBeVisible()
      expect(cardLink('Push notifications')).toHaveAttribute('href', '/boards/board-2?card=card-2')
      expect(cardLink('Offline mode')).toHaveAttribute('href', '/boards/board-2?card=card-3')
      expect(section('Website redesign (1)')).toHaveAttribute('aria-expanded', 'false')
      expect(cardLink('Homepage layout')).not.toBeInTheDocument()
    })

    it('folds a board again', async () => {
      overdueServer([WEBSITE, MOBILE])
      const { user } = renderOverdue()
      await user.click(await screen.findByRole('button', { name: 'Mobile app (2)' }))
      await user.click(section('Website redesign (1)'))

      await user.click(section('Mobile app (2)'))

      expect(section('Mobile app (2)')).toHaveAttribute('aria-expanded', 'false')
      await waitFor(() => expect(cardLink('Push notifications')).not.toBeInTheDocument())
      expect(cardLink('Homepage layout')).toBeInTheDocument()
    })

    it('fetches the overdue tasks again on a change elsewhere, keeping the boards you unfolded open', async () => {
      const server = overdueServer([WEBSITE, MOBILE])
      const { user } = renderOverdue()
      await user.click(await screen.findByRole('button', { name: 'Website redesign (1)' }))
      const socket = await openSocket()
      const contactForm = makeCard({ id: 'card-4', list_id: 'list-1', name: 'Contact form', due_at: '2026-01-11T12:00:00Z' })
      server.update([{ ...WEBSITE, overdue_count: 2, lists: [{ ...WEBSITE.lists[0], cards: [...WEBSITE.lists[0].cards, contactForm] }] }, MOBILE])

      socket.receive(changeElsewhere)

      expect(await screen.findByRole('button', { name: 'Website redesign (2)' })).toHaveAttribute('aria-expanded', 'true')
      expect(cardLink('Contact form')).toBeInTheDocument()
      expect(cardLink('Homepage layout')).toBeInTheDocument()
      expect(section('Mobile app (2)')).toHaveAttribute('aria-expanded', 'false')
      expect(server.loads()).toBe(2)
    })

    it("paints the lists and cards in the viewer's colours for them, and the rest in the default", async () => {
      const contactForm = makeCard({ id: 'card-4', list_id: 'list-1', name: 'Contact form', due_at: '2026-01-11T12:00:00Z' })
      overdueServer([
        { ...WEBSITE, card_colors: { 'card-1': '#4CAF50' }, lists: [{ ...WEBSITE.lists[0], color: '#2196F3', cards: [...WEBSITE.lists[0].cards, contactForm] }] },
        MOBILE,
      ])
      const { user } = renderOverdue()
      await user.click(await screen.findByRole('button', { name: 'Website redesign (1)' }))
      await user.click(section('Mobile app (2)'))

      expect(listHeader('To do')).toHaveStyle({ borderBottomColor: '#2196F3' })
      expect(listHeader('Backlog')).toHaveStyle({ borderBottomColor: DEFAULT_PURPLE })
      expect(cardBox('Homepage layout')).toHaveStyle({ borderColor: '#4CAF50' })
      expect(cardBox('Contact form')).toHaveStyle({ borderColor: DEFAULT_PURPLE })
    })

    it("writes the due dates in the viewer's own format once their profile is in", async () => {
      overdueServer()
      const { user } = renderWithProviders(<OverdueTasks />, {
        route: '/overdue', auth: { number_locale: 'en_GB', date_format: 'textual' },
      })
      await user.click(await screen.findByRole('button', { name: 'Website redesign (1)' }))

      expect(await screen.findByText(/^Saturday.*10 January 2026\b.*\b13:00$/)).toBeInTheDocument()
    })
  })

  describe('loads that fail', () => {
    it("says the overdue tasks couldn't be loaded, rather than that there are none, and loads them with Try again", async () => {
      const server = overdueServer()
      server.fail()
      const { user } = renderOverdue()

      expect(await screen.findByRole('alert')).toHaveTextContent("The overdue tasks couldn't be loaded.")
      expect(screen.queryByText('No overdue tasks.')).not.toBeInTheDocument()
      server.recover()
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('Website redesign (1)')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.loads()).toBe(2)
    })

    it('takes the message away while Try again loads, and brings it back if it fails again', async () => {
      const server = overdueServer()
      server.fail()
      const { user } = renderOverdue()
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail(held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("The overdue tasks couldn't be loaded.")
    })

    it('says so when the connection drops', async () => {
      overdueServer().fail(DROPPED)
      renderOverdue()

      expect(await screen.findByRole('alert')).toHaveTextContent("The overdue tasks couldn't be loaded.")
    })

    it('says there are none only once the answer is in', async () => {
      fakeEndpoint('get', '/api/v1/boards/overdue', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
      renderOverdue()

      expect(screen.queryByText('No overdue tasks.')).not.toBeInTheDocument()
      expect(await screen.findByText('No overdue tasks.')).toBeInTheDocument()
    })

    it('takes the boards away when fetching them again fails', async () => {
      const server = overdueServer()
      renderOverdue()
      await screen.findByText('Website redesign (1)')
      const socket = await openSocket()
      server.fail()

      socket.receive(changeElsewhere)

      expect(await screen.findByRole('alert')).toHaveTextContent("The overdue tasks couldn't be loaded.")
      expect(screen.queryByText('Website redesign (1)')).not.toBeInTheDocument()
    })
  })

  describe('answers that come back out of order', () => {
    it('keeps the newer overdue tasks when an older answer comes last', async () => {
      overdueServer()
      renderOverdue()
      await screen.findByText('Homepage layout')
      const socket = await openSocket()
      // The first fetch on a change gets the older answer, last.
      const held = heldAnswer(() => HttpResponse.json([WEBSITE]))
      const renamed = makeCard({ id: 'card-1', list_id: 'list-1', name: 'Homepage layout, final', due_at: '2026-01-10T12:00:00Z' })
      let first = true
      fakeEndpoint('get', '/api/v1/boards/overdue', (request) => {
        const answer: Answer = first ? held.answer : () => HttpResponse.json([{ ...WEBSITE, lists: [{ ...WEBSITE.lists[0], cards: [renamed] }] }])
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
  })

  describe('opening a card (6J)', () => {
    it('opens a card on its board with the keyboard, from its board\'s section', async () => {
      overdueServer()
      const { user } = renderWithProviders(<><OverdueTasks /><Address /></>, { route: '/overdue', auth: true })
      const section = await screen.findByRole('button', { name: 'Website redesign (1)' })
      act(() => section.focus())
      await user.keyboard('{Enter}')

      await user.tab()
      const card = screen.getByRole('link', { name: /Homepage layout/ })
      expect(card).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(screen.getByTestId('address')).toHaveTextContent('/boards/board-1?card=card-1')
    })

    it('makes each card a link to it, so it can also open in a new tab', async () => {
      overdueServer()
      const { user } = renderOverdue()
      await user.click(await screen.findByRole('button', { name: 'Website redesign (1)' }))

      expect(screen.getByRole('link', { name: /Homepage layout/ })).toHaveAttribute('href', '/boards/board-1?card=card-1')
    })
  })

  // 6V: it was a button, which can't open in a new tab.
  describe('going back', () => {
    it('goes back to the boards from a link, which can also open them in a new tab', async () => {
      overdueServer()
      const { user } = renderWithProviders(<><OverdueTasks /><Address /></>, { route: '/overdue', auth: true })
      await screen.findByRole('button', { name: 'Website redesign (1)' })
      const back = screen.getByRole('link', { name: 'Back to Boards' })
      expect(back).toHaveAttribute('href', '/boards')

      await user.click(back)

      expect(screen.getByTestId('address')).toHaveTextContent(/^\/boards$/)
    })
  })
})
