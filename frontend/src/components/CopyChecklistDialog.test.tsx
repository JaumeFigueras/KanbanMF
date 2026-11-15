import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardListRead, CardRead, ChecklistData } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard, makeCard, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CopyChecklistDialog from './CopyChecklistDialog'

const BOARDS = '/api/v1/boards'
const LISTS = '/api/v1/boards/:boardId/lists'
const CARDS = '/api/v1/boards/:boardId/lists/:listId/cards'
const CHECKLISTS = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId/checklists'
const ITEMS = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId/checklists/:checklistId/items'

const WEBSITE = makeBoard({ id: 'board-1', name: 'Website redesign' })
const MARKETING = makeBoard({ id: 'board-2', name: 'Marketing', owner_id: 'user-2' })
const EMPTY = makeBoard({ id: 'board-3', name: 'Empty board' })
const LISTS_OF: Record<string, BoardListRead[]> = {
  'board-1': [
    makeList({ id: 'list-1', board_id: 'board-1', name: 'To do' }),
    makeList({ id: 'list-2', board_id: 'board-1', name: 'Doing' }),
  ],
  'board-2': [
    makeList({ id: 'list-5', board_id: 'board-2', name: 'Ideas' }),
    makeList({ id: 'list-6', board_id: 'board-2', name: 'Done' }),
  ],
  'board-3': [],
}
const CARDS_OF: Record<string, CardRead[]> = {
  'list-1': [makeCard({ id: 'card-3', list_id: 'list-1', name: 'Contact form' })],
  'list-2': [
    makeCard({ id: 'card-8', list_id: 'list-2', name: 'Footer' }),
    makeCard({ id: 'card-7', list_id: 'list-2', name: 'Homepage layout' }),
  ],
  'list-5': [makeCard({ id: 'card-20', list_id: 'list-5', name: 'Spring campaign' })],
  'list-6': [],
}

const LAUNCH: ChecklistData = {
  id: 'checklist-1',
  name: 'Launch',
  items: [
    { id: 'item-1', text: 'Write the post', is_done: true },
    { id: 'item-2', text: 'Send the newsletter', is_done: false },
  ],
}

// The boards the user can copy to, each board's lists, each list's cards.
function boardsListsAndCards() {
  return {
    boards: fakeEndpoint('get', BOARDS, () => HttpResponse.json({ owned: [WEBSITE, EMPTY], shared: [MARKETING], templates: [] })),
    lists: fakeEndpoint('get', LISTS, (request) => HttpResponse.json(LISTS_OF[new URL(request.url).pathname.split('/')[4]])),
    cards: fakeEndpoint('get', CARDS, (request) => HttpResponse.json(CARDS_OF[new URL(request.url).pathname.split('/')[6]])),
  }
}

// The checklist is created on the target card, then its items one by one.
function copies() {
  return {
    created: fakeEndpoint('post', CHECKLISTS, () => HttpResponse.json({ id: 'checklist-9' }, { status: 201 })),
    items: fakeEndpoint('post', ITEMS, () => HttpResponse.json({}, { status: 201 })),
  }
}

// `cardId: undefined` stands for a card not created yet, so it's told apart
// from leaving cardId out, which means the checklist's card-7.
function renderDialog(options: { cardId?: string; checklist?: ChecklistData | null } = {}) {
  const cardId = 'cardId' in options ? options.cardId : 'card-7'
  const checklist = options.checklist === undefined ? LAUNCH : options.checklist
  const onClose = vi.fn()
  const onCopied = vi.fn()
  const dialog = (open: boolean, shown: ChecklistData | null) => (
    <CopyChecklistDialog
      open={open}
      onClose={onClose}
      boardId="board-1"
      listId="list-2"
      cardId={cardId}
      checklist={shown}
      onCopied={onCopied}
    />
  )
  const result = renderWithProviders(dialog(true, checklist))
  // Closes the dialog and opens it again, as the card dialog does, with the
  // checklist as it is by then.
  let shown = checklist
  function reopen(next: ChecklistData | null) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onCopied, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Checklist name' })
}

function select(name: 'Board' | 'List' | 'Card') {
  return screen.getByRole('combobox', { name })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

async function choose(user: ReturnType<typeof renderDialog>['user'], from: 'Board' | 'List' | 'Card', option: string) {
  await user.click(select(from))
  await user.click(screen.getByRole('option', { name: option }))
}

async function shows(from: 'Board' | 'List' | 'Card', text: string) {
  await waitFor(() => expect(select(from)).toHaveTextContent(text))
}

// The selects show the checklist's own card once everything has loaded.
async function loaded() {
  await shows('Card', 'Homepage layout')
  await shows('List', 'Doing')
  await shows('Board', 'Website redesign')
}

const ERROR = "The boards, lists or cards to copy to couldn't be loaded. Please close this and try again."

describe('CopyChecklistDialog', () => {
  it("opens with the checklist's name, on its own card", async () => {
    boardsListsAndCards()
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Copy Checklist' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Launch')
    await loaded()
  })

  it('offers the cards of the chosen list', async () => {
    boardsListsAndCards()
    const { user } = renderDialog()
    await loaded()
    await user.click(select('Card'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Footer', 'Homepage layout'])
  })

  it('creates the checklist, with the name trimmed, on the card, then its items with their ticks, and closes', async () => {
    boardsListsAndCards()
    const { created, items } = copies()
    const { user, onCopied, onClose } = renderDialog()
    await loaded()

    await user.type(nameField(), ' copy  ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-1/lists/list-2/cards/card-7/checklists', { name: 'Launch copy' }],
    ])
    expect(items.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-1/lists/list-2/cards/card-7/checklists/checklist-9/items', { text: 'Write the post', is_done: true }],
      ['/api/v1/boards/board-1/lists/list-2/cards/card-7/checklists/checklist-9/items', { text: 'Send the newsletter', is_done: false }],
    ])
    expect(onCopied).toHaveBeenCalledWith('board-1', 'list-2')
  })

  it('sends each item only once the one before is in, so they keep their order', async () => {
    boardsListsAndCards()
    fakeEndpoint('post', CHECKLISTS, () => HttpResponse.json({ id: 'checklist-9' }, { status: 201 }))
    const held = heldAnswer(() => HttpResponse.json({}, { status: 201 }))
    const items = fakeEndpoint('post', ITEMS, held.answer)
    const { user, onClose } = renderDialog()
    await loaded()

    await user.click(button('Save'))
    await waitFor(() => expect(items.requests).toHaveLength(1))
    // Gives a second request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(items.requests).toHaveLength(1)

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(items.requests.map((r) => (r.body as { text: string }).text)).toEqual(['Write the post', 'Send the newsletter'])
  })

  it("copies to another board, onto its first list's first card", async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user, onCopied, onClose } = renderDialog()
    await loaded()

    await choose(user, 'Board', 'Marketing')
    await shows('List', 'Ideas')
    await shows('Card', 'Spring campaign')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-2/lists/list-5/cards/card-20/checklists'])
    expect(onCopied).toHaveBeenCalledWith('board-2', 'list-5')
  })

  it("picks another list's first card, and the checklist's own card again back on its list", async () => {
    boardsListsAndCards()
    const { user } = renderDialog()
    await loaded()
    await choose(user, 'List', 'To do')
    await shows('Card', 'Contact form')
    await choose(user, 'List', 'Doing')
    await shows('Card', 'Homepage layout')
  })

  it('copies onto the card chosen', async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user, onClose } = renderDialog()
    await loaded()
    await choose(user, 'Card', 'Footer')
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-2/cards/card-8/checklists'])
  })

  it("offers no list or card on a board without lists, and says it can't take the copy", async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user } = renderDialog()
    await loaded()

    await choose(user, 'Board', 'Empty board')

    expect(await screen.findByText('This board has no lists yet.')).toBeInTheDocument()
    expect(select('List')).toHaveAttribute('aria-disabled', 'true')
    expect(select('Card')).toHaveAttribute('aria-disabled', 'true')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('This board has no lists yet.')
    expect(created.requests).toEqual([])
  })

  it("picks the checklist's own card again on going back to its board", async () => {
    boardsListsAndCards()
    const { user } = renderDialog()
    await loaded()
    await choose(user, 'Board', 'Marketing')
    await shows('Card', 'Spring campaign')
    await choose(user, 'Board', 'Website redesign')
    await shows('List', 'Doing')
    await shows('Card', 'Homepage layout')
  })


  it("picks the list's first card for a card not yet created", async () => {
    boardsListsAndCards()
    renderDialog({ cardId: undefined })
    await shows('Card', 'Footer')
  })

  it("picks the list's first card again on going back to its board, for a card not yet created", async () => {
    boardsListsAndCards()
    const { user } = renderDialog({ cardId: undefined })
    await shows('Card', 'Footer')
    await choose(user, 'Board', 'Marketing')
    await shows('List', 'Ideas')

    await choose(user, 'Board', 'Website redesign')

    await shows('Card', 'Footer')
  })

  it("picks the list's first card again on going back to its list, for a card not yet created", async () => {
    boardsListsAndCards()
    const { user } = renderDialog({ cardId: undefined })
    await shows('Card', 'Footer')
    await choose(user, 'List', 'To do')
    await shows('Card', 'Contact form')

    await choose(user, 'List', 'Doing')

    await shows('Card', 'Footer')
  })

  it("says a list without cards can't take the copy", async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user } = renderDialog()
    await loaded()

    await choose(user, 'Board', 'Marketing')
    await shows('List', 'Ideas')
    await choose(user, 'List', 'Done')

    expect(await screen.findByText('No cards in this list.')).toBeInTheDocument()
    expect(select('Card')).toHaveAttribute('aria-disabled', 'true')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('No cards in this list.')
    expect(created.requests).toEqual([])
  })

  it('refuses a blank name, saying so under the field', async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user } = renderDialog()
    await loaded()
    await user.clear(nameField())
    await user.click(button('Save'))
    expect(nameField()).toHaveAccessibleDescription('Checklist name is required.')
    expect(created.requests).toEqual([])
  })

  it("drops that message as soon as the name is typed again", async () => {
    boardsListsAndCards()
    const { user } = renderDialog()
    await loaded()
    await user.clear(nameField())
    await user.click(button('Save'))
    await user.type(nameField(), 'L')
    expect(nameField()).toBeValid()
    expect(nameField()).not.toHaveAccessibleDescription()
  })

  it("says so, in the app's words, when the boards can't be loaded", async () => {
    boardsListsAndCards()
    fakeEndpoint('get', BOARDS, () => new HttpResponse(null, { status: 500 }))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR)
  })

  it("says so, in the app's words, when the lists can't be loaded", async () => {
    boardsListsAndCards()
    fakeEndpoint('get', LISTS, () => new HttpResponse(null, { status: 500 }))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR)
  })

  it("says so, in the app's words, when the cards can't be loaded", async () => {
    boardsListsAndCards()
    fakeEndpoint('get', CARDS, () => new HttpResponse(null, { status: 500 }))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR)
  })

  it('says so, and stays open, when the checklist fails to be created', async () => {
    // The card was deleted meanwhile. FastAPI's error has a JSON body, which
    // mustn't be taken for the new checklist.
    boardsListsAndCards()
    fakeEndpoint('post', CHECKLISTS, () => HttpResponse.json({ detail: 'Card not found' }, { status: 404 }))
    fakeEndpoint('post', ITEMS, () => HttpResponse.json({}, { status: 201 }))
    const { user, onCopied, onClose } = renderDialog()
    await loaded()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onCopied).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so, and stops, when an item fails', async () => {
    boardsListsAndCards()
    fakeEndpoint('post', CHECKLISTS, () => HttpResponse.json({ id: 'checklist-9' }, { status: 201 }))
    const items = fakeEndpoint('post', ITEMS, () => new HttpResponse(null, { status: 500 }))
    const { user, onCopied, onClose } = renderDialog()
    await loaded()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(items.requests).toHaveLength(1)
    expect(onCopied).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes nothing while copying', async () => {
    boardsListsAndCards()
    const held = heldAnswer(() => HttpResponse.json({ id: 'checklist-9' }, { status: 201 }))
    fakeEndpoint('post', CHECKLISTS, held.answer)
    fakeEndpoint('post', ITEMS, () => HttpResponse.json({}, { status: 201 }))
    const { user, onClose } = renderDialog()
    await loaded()

    await user.click(button('Save'))
    expect(nameField()).toBeDisabled()
    for (const name of ['Board', 'List', 'Card'] as const) expect(select(name)).toHaveAttribute('aria-disabled', 'true')
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('copies on Enter too', async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user, onClose } = renderDialog()
    await loaded()
    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests).toHaveLength(1)
  })

  it("reopens with the checklist's name of that moment, on its own board, without the last error", async () => {
    boardsListsAndCards()
    const { user, reopen } = renderDialog()
    await loaded()
    await choose(user, 'Board', 'Marketing')
    await user.clear(nameField())
    await user.click(button('Save'))

    reopen({ ...LAUNCH, name: 'Launch day' })

    expect(nameField()).toHaveValue('Launch day')
    expect(nameField()).toBeValid()
    await shows('Board', 'Website redesign')
  })

  it('loads nothing while closed', async () => {
    const loads = boardsListsAndCards()
    renderWithProviders(
      <CopyChecklistDialog open={false} onClose={vi.fn()} boardId="board-1" listId="list-2" cardId="card-7" checklist={LAUNCH} />,
    )
    // Gives a request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect([...loads.boards.requests, ...loads.lists.requests, ...loads.cards.requests]).toEqual([])
  })

  it('closes on Cancel without copying', async () => {
    boardsListsAndCards()
    const { created } = copies()
    const { user, onClose } = renderDialog()
    await loaded()
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(created.requests).toEqual([])
  })
})
