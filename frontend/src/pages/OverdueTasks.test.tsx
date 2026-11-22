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

// The overdue cards as the server has them: one board's. `server.fail()`
// makes the load fail from then on (a server error, unless told otherwise),
// and `server.recover()` makes it work again.
function overdueServer() {
  let down: Answer | null = null
  const overdue = fakeEndpoint('get', '/api/v1/boards/overdue', (request) => (down ?? (() => HttpResponse.json([WEBSITE])))(request))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    loads: () => overdue.requests.length,
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

describe('OverdueTasks', () => {
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
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      server.fail()

      socket.receive({ type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null })

      expect(await screen.findByRole('alert')).toHaveTextContent("The overdue tasks couldn't be loaded.")
      expect(screen.queryByText('Website redesign (1)')).not.toBeInTheDocument()
    })
  })

  describe('answers that come back out of order', () => {
    it('keeps the newer overdue tasks when an older answer comes last', async () => {
      overdueServer()
      renderOverdue()
      await screen.findByText('Homepage layout')
      await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      socket.open()
      // The first fetch on a change gets the older answer, last.
      const held = heldAnswer(() => HttpResponse.json([WEBSITE]))
      const renamed = makeCard({ id: 'card-1', list_id: 'list-1', name: 'Homepage layout, final', due_at: '2026-01-10T12:00:00Z' })
      let first = true
      fakeEndpoint('get', '/api/v1/boards/overdue', (request) => {
        const answer: Answer = first ? held.answer : () => HttpResponse.json([{ ...WEBSITE, lists: [{ ...WEBSITE.lists[0], cards: [renamed] }] }])
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
})
