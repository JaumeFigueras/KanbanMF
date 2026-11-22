import type { ComponentProps } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { makeBoard, makeCard, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import i18n from '../i18n'
import ArchivedListsView, { HIGHLIGHT_MS } from './ArchivedListsView'

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

type ViewProps = Partial<ComponentProps<typeof ArchivedListsView>>

// The view, as the board shows it to its owner, unless told otherwise, with
// the callbacks it was given.
function theView(props: ViewProps = {}) {
  const onReturn = vi.fn()
  const onOpenCard = vi.fn()
  const rendered = renderWithProviders(
    <ArchivedListsView boardId="board-1" boardName="Website redesign" activeLists={[TODO]} numberLocale="en_GB"
      dateFormat="numeric" isOwner highlightCardId={null} onReturn={onReturn} onOpenCard={onOpenCard} {...props} />,
  )
  return { ...rendered, onReturn, onOpenCard }
}

// The view once the archive shows.
async function renderView(props: ViewProps = {}) {
  const rendered = theView(props)
  await screen.findByText('Footer links')
  return rendered
}

// The columns, each by the name in its header, in the order shown.
const columns = () => [...document.querySelectorAll<HTMLElement>('.MuiPaper-elevation2')]
const columnNames = () => columns().map((column) => column.firstElementChild!.textContent)
const columnOf = (name: string) => columns().find((column) => column.firstElementChild!.textContent === name)!
const cardBox = (name: string) => screen.getByText(name).closest<HTMLElement>('.MuiCard-root')!

// The restore of Footer links, refused for the reason given.
function restoreRefused(detail: object) {
  return fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ detail }, { status: 409 }))
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

    it('takes the message at the foot away with its close button', async () => {
      archiveServer()
      fakeEndpoint('patch', LIST_URL, () => HttpResponse.error())
      const { user } = await renderView()
      await fromMenu(user, 'Menu for the list Old ideas', 'Restore')

      await user.click(within(await failure()).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
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

  describe('what it shows', () => {
    const EMPTY = makeList({ id: 'list-8', board_id: 'board-1', name: 'Empty ideas', is_archived: true })
    const REPLACED = makeCard({ id: 'card-3', list_id: 'list-1', name: 'Hero', is_archived: true, replaced_by_id: 'card-4' })
    // Archived on its own from a list that has gone since.
    const STRAY = makeCard({ id: 'card-5', list_id: 'list-gone', name: 'Stray', is_archived: true })

    it('shows the archived lists first, in red, with their cards, then each list whose cards were archived on their own', async () => {
      fakeEndpoint('get', '/api/v1/boards/:boardId/lists/archived', () => HttpResponse.json([OLD_IDEAS, EMPTY]))
      fakeEndpoint('get', '/api/v1/boards/:boardId/cards/archived', () => HttpResponse.json([FOOTER, BLOG, REPLACED, STRAY]))
      await renderView()

      expect(columnNames()).toEqual(['Old ideas', 'Empty ideas', 'To do', ''])
      expect(columnOf('Old ideas').firstElementChild).toHaveStyle({ backgroundColor: '#d32f2f' })
      expect(columnOf('To do').firstElementChild).not.toHaveStyle({ backgroundColor: '#d32f2f' })
      expect(within(columnOf('Old ideas')).getByText('Blog')).toBeInTheDocument()
      expect(within(columnOf('Empty ideas')).getByText('No cards in this list.')).toBeInTheDocument()
      expect(within(columnOf('To do')).getAllByText(/^(Footer links|Hero)$/).map((e) => e.textContent)).toEqual(['Footer links', 'Hero'])
      expect(within(columnOf('')).getByText('Stray')).toBeInTheDocument()
      // A replaced card says so, and only it.
      expect(within(cardBox('Hero')).getByText('Replaced')).toBeInTheDocument()
      expect(within(cardBox('Footer links')).queryByText('Replaced')).not.toBeInTheDocument()
    })

    it.each([
      ['the owner', true, ['Restore', 'Delete']],
      ['anyone else', false, ['Restore']],
    ])('offers %s these entries in a menu', async (_who, isOwner, entries) => {
      archiveServer()
      const { user } = await renderView({ isOwner })

      for (const menu of ['Menu for the list Old ideas', 'Menu for Footer links']) {
        await user.click(screen.getByRole('button', { name: menu }))
        expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(entries)
        await user.keyboard('{Escape}')
        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      }
    })

    it('goes back to the board with Return to Board', async () => {
      archiveServer()
      const { user, onReturn } = await renderView()

      await user.click(screen.getByRole('button', { name: 'Return to Board' }))

      expect(onReturn).toHaveBeenCalledTimes(1)
    })
  })

  describe('restoring', () => {
    it('restores a list, taking it out of the archive with its cards, and says nothing', async () => {
      archiveServer()
      const restored = fakeEndpoint('patch', LIST_URL, () => HttpResponse.json({ ...OLD_IDEAS, is_archived: false }))
      const { user } = await renderView()

      await fromMenu(user, 'Menu for the list Old ideas', 'Restore')

      await waitFor(() => expect(columnNames()).toEqual(['To do']))
      expect(screen.queryByText('Blog')).not.toBeInTheDocument()
      expect(restored.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/boards/board-1/lists/list-9', { is_archived: false }]])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('sends a restore once, however quickly Restore is clicked twice', async () => {
      archiveServer()
      const restored = fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ ...FOOTER, is_archived: false }))
      const { user } = await renderView()
      await user.click(screen.getByRole('button', { name: 'Menu for Footer links' }))

      await user.dblClick(await screen.findByRole('menuitem', { name: 'Restore' }))

      await waitFor(() => expect(screen.queryByText('Footer links')).not.toBeInTheDocument())
      expect(restored.requests).toHaveLength(1)
    })

    it('explains why a replaced card can\'t be restored, and opens the card that replaced it', async () => {
      archiveServer()
      restoreRefused({ code: 'card_replaced', replaced_by_id: 'card-2' })
      const { user, onOpenCard } = await renderView()
      await fromMenu(user, 'Menu for Footer links', 'Restore')
      const dialog = await screen.findByRole('dialog', { name: 'This card was replaced' })
      expect(dialog).toHaveTextContent('a copy without them took its place')
      expect(dialog).not.toHaveTextContent('no longer on the board')

      await user.click(within(dialog).getByRole('button', { name: 'Open the current card' }))

      expect(onOpenCard.mock.calls).toEqual([['card-2']])
    })

    it("says when the card that replaced it has gone too, and offers only to close", async () => {
      archiveServer()
      restoreRefused({ code: 'card_replaced', replaced_by_id: null })
      const { user, onOpenCard } = await renderView()
      await fromMenu(user, 'Menu for Footer links', 'Restore')
      const dialog = await screen.findByRole('dialog', { name: 'This card was replaced' })
      expect(dialog).toHaveTextContent('The copy that replaced it is no longer on the board.')
      expect(within(dialog).queryByRole('button', { name: 'Open the current card' })).not.toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(onOpenCard).not.toHaveBeenCalled()
      expect(screen.getByText('Footer links')).toBeInTheDocument()
    })

    it('closes the explanation with Escape', async () => {
      archiveServer()
      restoreRefused({ code: 'card_replaced', replaced_by_id: 'card-2' })
      const { user } = await renderView()
      await fromMenu(user, 'Menu for Footer links', 'Restore')
      await screen.findByRole('dialog', { name: 'This card was replaced' })

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    describe('a card with people who have left the board', () => {
      // What the copy dialog asks for, and the copy it makes.
      function copies() {
        fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [makeBoard({ id: 'board-1', name: 'Website redesign' })], shared: [], templates: [] }))
        fakeEndpoint('get', '/api/v1/boards/:boardId/lists', () => HttpResponse.json([TODO]))
        fakeEndpoint('get', `${CARD_URL}/color`, () => HttpResponse.json({ color: null }))
        return fakeEndpoint('post', `${CARD_URL}/copy`, () => HttpResponse.json(makeCard({ id: 'card-copy', name: 'Footer links' }), { status: 201 }))
      }

      async function askForACopy(user: UserEvent) {
        await fromMenu(user, 'Menu for Footer links', 'Restore')
        const dialog = await screen.findByRole('dialog', { name: "This card can't be restored" })
        expect(dialog).toHaveTextContent('no longer have access to the board: Liam Chen, Sofia Lopez.')
        await user.click(within(dialog).getByRole('button', { name: 'Copy Card' }))
        const copyDialog = await screen.findByRole('dialog', { name: 'Copy Card' })
        await waitFor(() => expect(within(copyDialog).getByRole('combobox', { name: 'List' })).toHaveTextContent('To do'))
        return copyDialog
      }

      it('names them, and copies the card without them instead', async () => {
        archiveServer()
        restoreRefused({ code: 'former_people', names: ['Liam Chen', 'Sofia Lopez'] })
        const copied = copies()
        const { user } = await renderView()

        const copyDialog = await askForACopy(user)
        expect(screen.queryByRole('dialog', { name: "This card can't be restored" })).not.toBeInTheDocument()
        expect(within(copyDialog).getByRole('textbox', { name: 'Card name' })).toHaveValue('Footer links')
        await user.click(within(copyDialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(copied.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-1/cards/card-1/copy'])
        // The card itself can't be restored, so it stays.
        expect(screen.getByText('Footer links')).toBeInTheDocument()
      })

      it('copies nothing when the copy is cancelled', async () => {
        archiveServer()
        restoreRefused({ code: 'former_people', names: ['Liam Chen', 'Sofia Lopez'] })
        const copied = copies()
        const { user } = await renderView()

        const copyDialog = await askForACopy(user)
        await user.click(within(copyDialog).getByRole('button', { name: 'Cancel' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(copied.requests).toHaveLength(0)
      })
    })
  })

  describe('deleting', () => {
    it.each([
      ['a list, with its cards', 'Menu for the list Old ideas', 'Old ideas', LIST_URL, '/api/v1/boards/board-1/lists/list-9', ['Old ideas', 'Blog'], ['Footer links']],
      ['a card', 'Menu for Footer links', 'Footer links', CARD_URL, '/api/v1/boards/board-1/lists/list-1/cards/card-1', ['Footer links'], ['Old ideas', 'Blog']],
    ] as const)('deletes %s for good, once asked', async (_what, menu, name, url, path, gone, kept) => {
      archiveServer()
      const deleted = fakeEndpoint('delete', url)
      const { user } = await renderView()
      await fromMenu(user, menu, 'Delete')
      const dialog = await screen.findByRole('dialog', { name: 'Delete permanently?' })
      expect(dialog).toHaveTextContent(`Are you sure you want to permanently delete "${name}"? This cannot be undone.`)
      expect(deleted.requests).toHaveLength(0)

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deleted.requests.map((r) => r.url.pathname)).toEqual([path])
      for (const text of gone) expect(screen.queryByText(text)).not.toBeInTheDocument()
      for (const text of kept) expect(screen.getByText(text)).toBeInTheDocument()
    })

    it.each([
      ['Cancel', (user: UserEvent, dialog: HTMLElement) => user.click(within(dialog).getByRole('button', { name: 'Cancel' }))],
      ['Escape', (user: UserEvent) => user.keyboard('{Escape}')],
    ])('deletes nothing when the question is closed with %s', async (_how, close) => {
      archiveServer()
      const deleted = fakeEndpoint('delete', CARD_URL)
      const { user } = await renderView()
      await fromMenu(user, 'Menu for Footer links', 'Delete')

      await close(user, await screen.findByRole('dialog', { name: 'Delete permanently?' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deleted.requests).toHaveLength(0)
      expect(screen.getByText('Footer links')).toBeInTheDocument()
    })
  })

  // Where a search of the board's archive leads: the card found, pointed out.
  describe('the highlighted card', () => {
    // `transparent`, as jsdom computes it.
    const TRANSPARENT = 'rgba(0, 0, 0, 0)'

    function scrolls() {
      const scrolled = vi.fn()
      Element.prototype.scrollIntoView = scrolled
      // @ts-expect-error -- jsdom has none; put it back that way.
      onTestFinished(() => { delete Element.prototype.scrollIntoView })
      return scrolled
    }

    it('brings it into view once it is in, outlined, and lets the outline fade after a few seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      onTestFinished(() => { vi.useRealTimers() })
      archiveServer()
      const scrolled = scrolls()
      await renderView({ highlightCardId: 'card-1' })

      await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1))
      expect(scrolled.mock.contexts[0]).toBe(cardBox('Footer links'))
      expect(scrolled.mock.calls[0]).toEqual([{ behavior: 'smooth', block: 'center' }])
      expect(cardBox('Footer links')).toHaveStyle({ outlineColor: '#1976d2' })
      expect(cardBox('Blog')).toHaveStyle({ outlineColor: TRANSPARENT })

      act(() => vi.advanceTimersByTime(HIGHLIGHT_MS - 500))
      expect(cardBox('Footer links')).toHaveStyle({ outlineColor: '#1976d2' })
      act(() => vi.advanceTimersByTime(600))
      expect(cardBox('Footer links')).toHaveStyle({ outlineColor: TRANSPARENT })
    })

    it("scrolls to nothing when the card isn't in the archive", async () => {
      archiveServer()
      const scrolled = scrolls()
      await renderView({ highlightCardId: 'card-gone' })
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(scrolled).not.toHaveBeenCalled()
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
