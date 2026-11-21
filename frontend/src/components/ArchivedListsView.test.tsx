import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { makeCard, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import i18n from '../i18n'
import ArchivedListsView from './ArchivedListsView'

const TODO = makeList({ id: 'list-1', board_id: 'board-1', name: 'To do' })
const OLD_IDEAS = makeList({ id: 'list-9', board_id: 'board-1', name: 'Old ideas', is_archived: true })
// A card archived on its own from "To do", and one in the archived list.
const FOOTER = makeCard({ id: 'card-1', list_id: 'list-1', name: 'Footer links', is_archived: true })
const BLOG = makeCard({ id: 'card-9', list_id: 'list-9', name: 'Blog', is_archived: true })
const CARD_URL = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId'
const LIST_URL = '/api/v1/boards/:boardId/lists/:listId'

// The board's archive as the server has it. `server.loads()` counts how many
// times it was fetched; `server.fail(...)` makes its lists or its cards fail
// from then on (a server error, unless told otherwise), and
// `server.recover()` makes both work again.
function archiveServer() {
  const down = new Map<'lists' | 'cards', Answer>()
  const lists = fakeEndpoint('get', '/api/v1/boards/:boardId/lists/archived',
    (request) => (down.get('lists') ?? (() => HttpResponse.json([OLD_IDEAS])))(request))
  fakeEndpoint('get', '/api/v1/boards/:boardId/cards/archived',
    (request) => (down.get('cards') ?? (() => HttpResponse.json([FOOTER, BLOG])))(request))
  return {
    loads: () => lists.requests.length,
    fail: (what: 'lists' | 'cards', answer: Answer = SERVER_ERROR) => { down.set(what, answer) },
    recover: () => { down.clear() },
  }
}

// The view, as the board shows it.
const theView = () => renderWithProviders(
  <ArchivedListsView boardId="board-1" boardName="Website redesign" activeLists={[TODO]} numberLocale="en_GB"
    dateFormat="numeric" isOwner highlightCardId={null} onReturn={vi.fn()} onOpenCard={vi.fn()} />,
)

// The view once the archive shows.
async function renderView() {
  const rendered = theView()
  await screen.findByText('Footer links')
  return rendered
}

// Opens the menu of the archived list, or of the card archived on its own
// (each named after it), and picks an entry.
async function fromMenu(user: UserEvent, menu: 'Menu for the list Old ideas' | 'Menu for Footer links', entry: string) {
  await user.click(screen.getByRole('button', { name: menu }))
  await user.click(await screen.findByRole('menuitem', { name: entry }))
}

// The message at the foot of the page.
const failure = () => screen.findByRole('alert')

describe('ArchivedListsView', () => {
  describe('changes that fail', () => {
    it("says a card couldn't be restored when it is refused, and fetches the archive again", async () => {
      const server = archiveServer()
      const restore = fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ detail: 'Card not found' }, { status: 404 }))
      const { user } = await renderView()
      expect(server.loads()).toBe(1)

      await fromMenu(user, 'Menu for Footer links', 'Restore')

      expect(await failure()).toHaveTextContent('The card "Footer links" couldn\'t be restored. Please try again.')
      expect(restore.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/lists/list-1/cards/card-1', { is_archived: false }],
      ])
      await waitFor(() => expect(server.loads()).toBe(2))
      expect(screen.getByText('Footer links')).toBeInTheDocument()
    })

    it("says a list couldn't be restored when the connection drops", async () => {
      archiveServer()
      fakeEndpoint('patch', LIST_URL, () => HttpResponse.error())
      const { user } = await renderView()

      await fromMenu(user, 'Menu for the list Old ideas', 'Restore')

      expect(await failure()).toHaveTextContent('The list "Old ideas" couldn\'t be restored. Please try again.')
      expect(screen.getByText('Old ideas')).toBeInTheDocument()
      expect(screen.getByText('Blog')).toBeInTheDocument()
    })

    it('explains a refused restore of a replaced card in its dialog, with no message at the foot', async () => {
      const server = archiveServer()
      fakeEndpoint('patch', CARD_URL, () => HttpResponse.json(
        { detail: { code: 'card_replaced', replaced_by_id: 'card-2' } }, { status: 409 },
      ))
      const { user } = await renderView()

      await fromMenu(user, 'Menu for Footer links', 'Restore')

      expect(await screen.findByRole('dialog', { name: 'This card was replaced' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.loads()).toBe(1)
    })

    it('says nothing when a card is restored, and takes it out of the archive', async () => {
      archiveServer()
      fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ ...FOOTER, is_archived: false }))
      const { user } = await renderView()

      await fromMenu(user, 'Menu for Footer links', 'Restore')

      await waitFor(() => expect(screen.queryByText('Footer links')).not.toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('says in the dialog that a deletion failed when the connection drops, and keeps it open', async () => {
      archiveServer()
      const deleted = fakeEndpoint('delete', CARD_URL, () => HttpResponse.error())
      const { user } = await renderView()
      await fromMenu(user, 'Menu for Footer links', 'Delete')
      const dialog = await screen.findByRole('dialog', { name: 'Delete permanently?' })

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-1/cards/card-1'])
      expect(screen.getByRole('dialog', { name: 'Delete permanently?' })).toBeInTheDocument()
      expect(screen.getByText('Footer links')).toBeInTheDocument()
    })
  })

  describe('loads that fail', () => {
    it("says the archive couldn't be loaded, rather than that nothing is archived, and loads it with Try again", async () => {
      const server = archiveServer()
      server.fail('cards')
      const { user } = theView()

      expect(await screen.findByRole('alert')).toHaveTextContent("The board's archive couldn't be loaded.")
      expect(screen.queryByText('No archived lists.')).not.toBeInTheDocument()
      expect(screen.queryByText('Old ideas')).not.toBeInTheDocument()
      server.recover()
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      await screen.findByText('Footer links')
      expect(screen.getByText('Old ideas')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.loads()).toBe(2)
    })

    it('takes the message away while Try again loads, and brings it back if it fails again', async () => {
      const server = archiveServer()
      server.fail('cards')
      const { user } = theView()
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail('cards', held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("The board's archive couldn't be loaded.")
    })

    it("says so when the archived lists can't be reached", async () => {
      const server = archiveServer()
      server.fail('lists', DROPPED)
      theView()

      expect(await screen.findByRole('alert')).toHaveTextContent("The board's archive couldn't be loaded.")
    })

    it('says nothing is archived only once the archive is in', async () => {
      fakeEndpoint('get', '/api/v1/boards/:boardId/lists/archived', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/boards/:boardId/cards/archived', () => HttpResponse.json([]))
      theView()

      expect(screen.queryByText('No archived lists.')).not.toBeInTheDocument()
      expect(await screen.findByText('No archived lists.')).toBeInTheDocument()
    })
  })

  describe('menus named after their list or card (6K)', () => {
    it('names the archived list\'s menu and the menu of the card archived on its own after them', async () => {
      archiveServer()
      await renderView()

      expect(screen.getByRole('button', { name: 'Menu for the list Old ideas' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Menu for Footer links' })).toBeInTheDocument()
      // A card of the archived list goes with the list: no menu of its own.
      expect(screen.queryByRole('button', { name: 'Menu for Blog' })).not.toBeInTheDocument()
    })

    it('names them in Catalan', async () => {
      await i18n.changeLanguage('ca')
      archiveServer()
      await renderView()

      expect(screen.getByRole('button', { name: 'Menú de la llista Old ideas' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Menú de Footer links' })).toBeInTheDocument()
    })
  })
})
