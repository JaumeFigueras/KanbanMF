import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardListRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard, makeCard, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CopyCardDialog from './CopyCardDialog'

const BOARDS = '/api/v1/boards'
const LISTS = '/api/v1/boards/:boardId/lists'
const COPY = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId/copy'
const COLOR = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId/color'

const WEBSITE = makeBoard({ id: 'board-1', name: 'Website redesign' })
const EMPTY = makeBoard({ id: 'board-3', name: 'Empty board' })
const MARKETING = makeBoard({ id: 'board-2', name: 'Marketing', owner_id: 'user-2' })
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
const THE_COPY = makeCard({ id: 'card-9', name: 'Homepage layout v2' })

// The boards the user can copy to, and each board's lists.
function boardsAndLists() {
  fakeEndpoint('get', BOARDS, () => HttpResponse.json({ owned: [WEBSITE, EMPTY], shared: [MARKETING], templates: [] }))
  return fakeEndpoint('get', LISTS, (request) => {
    const boardId = new URL(request.url).pathname.split('/')[4]
    return HttpResponse.json(LISTS_OF[boardId])
  })
}

// The copy is made, and its colour read back.
function copies(color: string | null = '#4CAF50') {
  return {
    copied: fakeEndpoint('post', COPY, () => HttpResponse.json(THE_COPY, { status: 201 })),
    colorRead: fakeEndpoint('get', COLOR, () => HttpResponse.json({ color })),
  }
}

interface Options {
  title?: string
  includeDescription?: boolean
  includeChecklists?: boolean
}

function renderDialog(options: Options = {}) {
  const onClose = vi.fn()
  const onCopied = vi.fn()
  const dialog = (open: boolean, cardName: string) => (
    <CopyCardDialog
      open={open}
      onClose={onClose}
      boardId="board-1"
      listId="list-2"
      cardId="card-7"
      cardName={cardName}
      onCopied={onCopied}
      {...options}
    />
  )
  const result = renderWithProviders(dialog(true, 'Homepage layout'))
  // Closes the dialog and opens it again, as the card's menu does, with the
  // card's name as it is by then.
  let shown = 'Homepage layout'
  function reopen(cardName: string) {
    result.rerender(dialog(false, shown))
    shown = cardName
    result.rerender(dialog(true, cardName))
  }
  return { ...result, onClose, onCopied, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Card name' })
}

function select(name: 'Board' | 'List') {
  return screen.getByRole('combobox', { name })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

async function choose(user: ReturnType<typeof renderDialog>['user'], from: 'Board' | 'List', option: string) {
  await user.click(select(from))
  await user.click(screen.getByRole('option', { name: option }))
}

// The selects show their choice once the boards and lists have loaded.
async function loaded() {
  await waitFor(() => expect(select('List')).toHaveTextContent('Doing'))
  await waitFor(() => expect(select('Board')).toHaveTextContent('Website redesign'))
}

describe('CopyCardDialog', () => {
  it("opens with the card's name, on its own board and list", async () => {
    boardsAndLists()
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Copy Card' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Homepage layout')
    await loaded()
  })

  it('offers every board, owned or shared, and the lists of the chosen one', async () => {
    boardsAndLists()
    const { user } = renderDialog()
    await loaded()
    await user.click(select('Board'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Website redesign', 'Empty board', 'Marketing'])
    await user.click(screen.getByRole('option', { name: 'Website redesign' }))
    await user.click(select('List'))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['To do', 'Doing'])
  })

  it('copies the card, with the name trimmed, then hands over the copy with its colour and closes', async () => {
    boardsAndLists()
    const { copied, colorRead } = copies('#4CAF50')
    const { user, onCopied, onClose } = renderDialog()
    await loaded()

    await user.type(nameField(), ' v2  ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(copied.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-1/lists/list-2/cards/card-7/copy', {
        name: 'Homepage layout v2',
        target_board_id: 'board-1',
        target_list_id: 'list-2',
        include_description: true,
        include_checklists: true,
      }],
    ])
    expect(colorRead.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-2/cards/card-9/color'])
    expect(onCopied).toHaveBeenCalledWith('list-2', THE_COPY, '#4CAF50')
  })

  it("copies to another board, into that board's first list", async () => {
    boardsAndLists()
    const { copied, colorRead } = copies()
    const { user, onCopied, onClose } = renderDialog()
    await loaded()

    await choose(user, 'Board', 'Marketing')
    await waitFor(() => expect(select('List')).toHaveTextContent('Ideas'))
    await choose(user, 'List', 'Done')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(copied.requests.map((r) => r.body)).toEqual([expect.objectContaining({ target_board_id: 'board-2', target_list_id: 'list-6' })])
    expect(colorRead.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-2/lists/list-6/cards/card-9/color'])
    expect(onCopied).toHaveBeenCalledWith('list-6', THE_COPY, '#4CAF50')
  })

  it("picks the card's own list again on going back to its board", async () => {
    boardsAndLists()
    const { user } = renderDialog()
    await loaded()
    await choose(user, 'Board', 'Marketing')
    await waitFor(() => expect(select('List')).toHaveTextContent('Ideas'))
    await choose(user, 'Board', 'Website redesign')
    await waitFor(() => expect(select('List')).toHaveTextContent('Doing'))
  })

  it('copies under the title, and with the parts, it is given', async () => {
    // How the card dialog turns a checklist item into a card of its own.
    boardsAndLists()
    const { copied } = copies()
    const { user, onClose } = renderDialog({ title: 'Make it a card', includeDescription: false, includeChecklists: false })
    expect(screen.getByRole('dialog', { name: 'Make it a card' })).toBeInTheDocument()
    await loaded()
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(copied.requests.map((r) => r.body)).toEqual([
      expect.objectContaining({ include_description: false, include_checklists: false }),
    ])
  })

  it("hands over no colour when the copy's colour can't be read", async () => {
    boardsAndLists()
    fakeEndpoint('post', COPY, () => HttpResponse.json(THE_COPY, { status: 201 }))
    fakeEndpoint('get', COLOR, () => new HttpResponse(null, { status: 500 }))
    const { user, onCopied, onClose } = renderDialog()
    await loaded()
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onCopied).toHaveBeenCalledWith('list-2', THE_COPY, null)
  })

  it('refuses a blank name, saying so under the field', async () => {
    boardsAndLists()
    const { copied } = copies()
    const { user } = renderDialog()
    await loaded()
    await user.clear(nameField())
    await user.click(button('Save'))
    expect(nameField()).toHaveAccessibleDescription('Card name is required.')
    expect(copied.requests).toEqual([])
  })

  it("drops that message as soon as the name is typed again", async () => {
    boardsAndLists()
    const { user } = renderDialog()
    await loaded()
    await user.clear(nameField())
    await user.click(button('Save'))
    await user.type(nameField(), 'C')
    expect(nameField()).toBeValid()
    expect(nameField()).not.toHaveAccessibleDescription()
  })

  it("says a board without lists can't take the copy", async () => {
    boardsAndLists()
    const { copied } = copies()
    const { user } = renderDialog()
    await loaded()

    await choose(user, 'Board', 'Empty board')

    expect(await screen.findByText('This board has no lists yet.')).toBeInTheDocument()
    expect(select('List')).toHaveAttribute('aria-disabled', 'true')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('This board has no lists yet.')
    expect(copied.requests).toEqual([])
  })

  it("says so, in the app's words, when the boards can't be loaded", async () => {
    fakeEndpoint('get', BOARDS, () => new HttpResponse(null, { status: 500 }))
    fakeEndpoint('get', LISTS, () => HttpResponse.json(LISTS_OF['board-1']))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The boards or lists to copy to couldn't be loaded. Please close this and try again.",
    )
  })

  it("says so, in the app's words, when the lists can't be loaded", async () => {
    fakeEndpoint('get', BOARDS, () => HttpResponse.json({ owned: [WEBSITE], shared: [], templates: [] }))
    fakeEndpoint('get', LISTS, () => new HttpResponse(null, { status: 500 }))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The boards or lists to copy to couldn't be loaded. Please close this and try again.",
    )
  })

  it('says so, and stays open, when copying fails', async () => {
    // The card was deleted meanwhile. FastAPI's error has a JSON body, which
    // mustn't be taken for the copy.
    boardsAndLists()
    fakeEndpoint('post', COPY, () => HttpResponse.json({ detail: 'Card not found' }, { status: 404 }))
    fakeEndpoint('get', COLOR, () => HttpResponse.json({ color: null }))
    const { user, onCopied, onClose } = renderDialog()
    await loaded()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onCopied).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes nothing while copying', async () => {
    boardsAndLists()
    const held = heldAnswer(() => HttpResponse.json(THE_COPY, { status: 201 }))
    fakeEndpoint('post', COPY, held.answer)
    fakeEndpoint('get', COLOR, () => HttpResponse.json({ color: null }))
    const { user, onClose } = renderDialog()
    await loaded()

    await user.click(button('Save'))
    expect(nameField()).toBeDisabled()
    expect(select('Board')).toHaveAttribute('aria-disabled', 'true')
    expect(select('List')).toHaveAttribute('aria-disabled', 'true')
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('copies on Enter too', async () => {
    boardsAndLists()
    const { copied } = copies()
    const { user, onClose } = renderDialog()
    await loaded()
    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(copied.requests).toHaveLength(1)
  })

  it("reopens with the card's name of that moment, on its own board, without the last error", async () => {
    boardsAndLists()
    const { user, reopen } = renderDialog()
    await loaded()
    await choose(user, 'Board', 'Marketing')
    await user.clear(nameField())
    await user.click(button('Save'))

    reopen('Homepage layout (final)')

    expect(nameField()).toHaveValue('Homepage layout (final)')
    expect(nameField()).toBeValid()
    await waitFor(() => expect(select('Board')).toHaveTextContent('Website redesign'))
  })

  it('loads nothing while closed', async () => {
    const loaded = boardsAndLists()
    const boards = fakeEndpoint('get', BOARDS, () => HttpResponse.json({ owned: [], shared: [], templates: [] }))
    renderWithProviders(
      <CopyCardDialog open={false} onClose={vi.fn()} boardId="board-1" listId="list-2" cardId="card-7" cardName="Homepage layout" onCopied={vi.fn()} />,
    )
    // Gives a request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect([...boards.requests, ...loaded.requests]).toEqual([])
  })

  it('closes on Cancel without copying', async () => {
    boardsAndLists()
    const { copied } = copies()
    const { user, onClose } = renderDialog()
    await loaded()
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(copied.requests).toEqual([])
  })
})
