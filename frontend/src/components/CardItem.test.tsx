import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { useEffect, useState, type ReactNode } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import type { CardRead } from '../types/board'
import { fakeEndpoint } from '../test/endpoints'
import { makeBoard, makeCard, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CardItem from './CardItem'

const CARD_URL = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId'
const CARD = makeCard({ id: 'card-7', list_id: 'list-2', name: 'Homepage layout' })
const DEFAULT_PURPLE = '#9C27B0'

// The board's drag-and-drop context: a drag starts only once the pointer
// has moved 4 px, so a click is a click (pages/Board.tsx).
function BoardDnd({ children }: { children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  return <DndContext sensors={sensors}>{children}</DndContext>
}

interface Options {
  card?: CardRead
  color?: string | null
  dragOverlay?: boolean
}

// A card on its list, inside the drag-and-drop contexts the board provides.
// The board keeps the card's colour, as pages/Board.tsx does in its map: the
// card is drawn in it, and a colour saved from the card's menu goes into it.
function renderCard({ card = CARD, color = null, dragOverlay = false }: Options = {}) {
  const onArchived = vi.fn()
  const onUpdated = vi.fn()
  const onCopied = vi.fn()
  const onColorChanged = vi.fn()
  const board: { setColor: (color: string | null) => void } = { setColor: () => {} }
  function Board() {
    const [boardColor, setBoardColor] = useState(color)
    useEffect(() => { board.setColor = setBoardColor }, [])
    return (
      <BoardDnd>
        <SortableContext items={[card.id]}>
          <CardItem card={card} boardId="board-1" listId="list-2" numberLocale="en_GB" dateFormat="numeric"
            color={boardColor}
            onColorChanged={(cardId, saved) => { onColorChanged(cardId, saved); setBoardColor(saved) }}
            onArchived={onArchived} onUpdated={onUpdated} onCopied={onCopied}
            onChecklistCopied={vi.fn()} dragOverlay={dragOverlay} />
        </SortableContext>
      </BoardDnd>
    )
  }
  const result = renderWithProviders(<Board />)
  return {
    ...result,
    onArchived,
    onUpdated,
    onCopied,
    onColorChanged,
    // The board handing the card a colour of its own, as when the colours it
    // fetched arrive.
    boardColor: (color: string | null) => act(() => board.setColor(color)),
  }
}

// The card as drawn on the board (MUI's Card, outlined in the card's colour).
const cardBox = () => screen.getByText('Homepage layout').closest<HTMLElement>('.MuiCard-root')!
const handle = () => screen.getByRole('button', { name: 'Move Homepage layout' })
const menuButton = () => screen.getByRole('button', { name: 'Menu for Homepage layout' })

async function chooseFromMenu(user: ReturnType<typeof renderCard>['user'], item: string) {
  await user.click(menuButton())
  await user.click(screen.getByRole('menuitem', { name: item }))
}

// The menu has gone, even from behind the dialog it opened (which hides it
// from screen readers, so it's looked for hidden too).
const menuClosed = () => waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).not.toBeInTheDocument())

// What the card dialog asks for on opening: the board's people.
const boardPeople = () => fakeEndpoint('get', '/api/v1/boards/:boardId/members', () => HttpResponse.json([]))

describe('CardItem', () => {
  it('names its drag handle and its menu after the card', () => {
    renderCard()
    expect(handle()).toBeInTheDocument()
    expect(menuButton()).toBeInTheDocument()
  })

  describe('opening the card', () => {
    it('opens the card dialog, filled with the card, on a click on the card', async () => {
      boardPeople()
      const { user } = renderCard()

      await user.click(screen.getByText('Homepage layout'))

      const dialog = screen.getByRole('dialog', { name: 'Edit Card' })
      expect(within(dialog).getByRole('textbox', { name: 'Card name' })).toHaveValue('Homepage layout')
    })

    it('does not open it on a click on the drag handle', async () => {
      const { user } = renderCard()
      await user.click(handle())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('opens the menu, not the card, on a click on the menu button', async () => {
      const { user } = renderCard()

      await user.click(menuButton())

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Edit Card', 'Change Color', 'Copy Card', 'Archive card',
      ])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('opens the card dialog from the menu, closing the menu', async () => {
      boardPeople()
      const { user } = renderCard()

      await chooseFromMenu(user, 'Edit Card')

      expect(screen.getByRole('dialog', { name: 'Edit Card' })).toBeInTheDocument()
      await menuClosed()
    })

    it('tells the board about the card once saved in the dialog', async () => {
      boardPeople()
      const saved = fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ ...CARD, name: 'Home page' }))
      fakeEndpoint('get', `${CARD_URL}/checklists`, () => HttpResponse.json([]))
      const { user, onUpdated } = renderCard()
      await user.click(screen.getByText('Homepage layout'))

      const name = screen.getByRole('textbox', { name: 'Card name' })
      await user.clear(name)
      await user.type(name, 'Home page')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'card-7', name: 'Home page' })))
      expect(saved.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-2/cards/card-7'])
    })
  })

  describe('copying', () => {
    it("opens the copy dialog on the card's name, and hands the copy to the board", async () => {
      const lists = [makeList({ id: 'list-2', board_id: 'board-1', name: 'Doing' })]
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [makeBoard({ id: 'board-1' })], shared: [], templates: [] }))
      fakeEndpoint('get', '/api/v1/boards/:boardId/lists', () => HttpResponse.json(lists))
      const theCopy = makeCard({ id: 'card-9', name: 'Copy of Homepage layout' })
      const copied = fakeEndpoint('post', `${CARD_URL}/copy`, () => HttpResponse.json(theCopy, { status: 201 }))
      fakeEndpoint('get', `${CARD_URL}/color`, () => HttpResponse.json({ color: '#4CAF50' }))
      const { user, onCopied } = renderCard()

      await chooseFromMenu(user, 'Copy Card')
      const dialog = screen.getByRole('dialog', { name: 'Copy Card' })
      await menuClosed()
      expect(within(dialog).getByRole('textbox', { name: 'Card name' })).toHaveValue('Homepage layout')
      await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'List' })).toHaveTextContent('Doing'))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onCopied).toHaveBeenCalledWith('list-2', theCopy, '#4CAF50'))
      expect(copied.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-2/cards/card-7/copy'])
    })
  })

  describe('archiving', () => {
    it('archives the card, then tells the board', async () => {
      const archived = fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ ...CARD, is_archived: true }))
      const { user, onArchived } = renderCard()

      await chooseFromMenu(user, 'Archive card')

      await waitFor(() => expect(onArchived).toHaveBeenCalledWith('card-7'))
      await menuClosed()
      expect(archived.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/lists/list-2/cards/card-7', { is_archived: true }],
      ])
    })

    it('tells the board nothing when the archive is refused, and the card stays', async () => {
      const archived = fakeEndpoint('patch', CARD_URL, () => HttpResponse.json({ detail: 'Not allowed' }, { status: 403 }))
      const { user, onArchived } = renderCard()

      await chooseFromMenu(user, 'Archive card')

      await waitFor(() => expect(archived.requests).toHaveLength(1))
      expect(onArchived).not.toHaveBeenCalled()
      expect(cardBox()).toBeInTheDocument()
    })

    it('tells the board nothing when the connection drops', async () => {
      const archived = fakeEndpoint('patch', CARD_URL, () => HttpResponse.error())
      const { user, onArchived } = renderCard()

      await chooseFromMenu(user, 'Archive card')

      await waitFor(() => expect(archived.requests).toHaveLength(1))
      expect(onArchived).not.toHaveBeenCalled()
      expect(cardBox()).toBeInTheDocument()
    })
  })

  describe('the colour', () => {
    it("is the default purple while the board has none for the card", () => {
      renderCard()
      expect(cardBox()).toHaveStyle({ borderColor: DEFAULT_PURPLE })
    })

    it("is the board's colour for the card, also one that arrives later", () => {
      const { boardColor } = renderCard({ color: '#2196F3' })
      expect(cardBox()).toHaveStyle({ borderColor: '#2196F3' })

      boardColor('#4CAF50')

      expect(cardBox()).toHaveStyle({ borderColor: '#4CAF50' })
    })

    it("is the one chosen from the menu, handed to the board as soon as it's saved", async () => {
      const saved = fakeEndpoint('put', `${CARD_URL}/color`)
      const { user, onColorChanged } = renderCard({ color: '#2196F3' })

      await chooseFromMenu(user, 'Change Color')
      const dialog = screen.getByRole('dialog', { name: 'Change Color' })
      await menuClosed()
      // The dialog starts on the card's colour.
      expect(within(dialog).getByRole('textbox', { name: 'Hex color code' })).toHaveValue('#2196F3')
      await user.click(within(dialog).getByRole('button', { name: '#4CAF50' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(cardBox()).toHaveStyle({ borderColor: '#4CAF50' }))
      // The board's colours are what the floating copy shown while dragging,
      // and the card drawn again where it's dropped, are drawn from.
      expect(onColorChanged.mock.calls).toEqual([['card-7', '#4CAF50']])
      expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/lists/list-2/cards/card-7/color', { color: '#4CAF50' }],
      ])
    })

    it('goes back to the default purple once reset from the menu, the board told', async () => {
      const reset = fakeEndpoint('delete', `${CARD_URL}/color`)
      const { user, onColorChanged } = renderCard({ color: '#2196F3' })

      await chooseFromMenu(user, 'Change Color')
      await user.click(screen.getByRole('button', { name: 'Reset to default' }))

      await waitFor(() => expect(cardBox()).toHaveStyle({ borderColor: DEFAULT_PURPLE }))
      expect(onColorChanged.mock.calls).toEqual([['card-7', null]])
      expect(reset.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-2/cards/card-7/color'])
    })

    it("keeps none of its own: after a save, a colour the board has later is the one drawn", async () => {
      fakeEndpoint('put', `${CARD_URL}/color`)
      const { user, boardColor } = renderCard({ color: '#2196F3' })
      await chooseFromMenu(user, 'Change Color')
      await user.click(screen.getByRole('button', { name: '#4CAF50' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(cardBox()).toHaveStyle({ borderColor: '#4CAF50' }))

      // As when the board fetches its colours again, after another tab
      // changed this one.
      boardColor('#F44336')

      expect(cardBox()).toHaveStyle({ borderColor: '#F44336' })
    })

    it('tells the board nothing when the save fails, and keeps its colour', async () => {
      const saved = fakeEndpoint('put', `${CARD_URL}/color`, () => HttpResponse.json({ detail: 'Not allowed' }, { status: 403 }))
      const { user, onColorChanged } = renderCard({ color: '#2196F3' })
      await chooseFromMenu(user, 'Change Color')
      await user.click(screen.getByRole('button', { name: '#4CAF50' }))
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(saved.requests).toHaveLength(1)
      expect(onColorChanged).not.toHaveBeenCalled()
      expect(cardBox()).toHaveStyle({ borderColor: '#2196F3' })
    })
  })

  describe('the floating copy shown while dragging', () => {
    it('opens nothing on a click', async () => {
      const { user } = renderCard({ dragOverlay: true })
      await user.click(screen.getByText('Homepage layout'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it("is drawn in the card's colour, like the card", () => {
      renderCard({ dragOverlay: true, color: '#2196F3' })
      expect(cardBox()).toHaveStyle({ borderColor: '#2196F3' })
    })
  })
})
