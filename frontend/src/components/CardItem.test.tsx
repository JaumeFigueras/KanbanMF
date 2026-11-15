import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { makeCard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CardItem from './CardItem'

// A card on its list, inside the drag-and-drop contexts the board provides.
function renderCard(name: string) {
  const card = makeCard({ id: `card-${name}`, name })
  return renderWithProviders(
    <DndContext>
      <SortableContext items={[card.id]}>
        <CardItem card={card} boardId="board-1" listId="list-1" numberLocale="en_GB" dateFormat="numeric"
          initialColor={null} onArchived={vi.fn()} onUpdated={vi.fn()} onCopied={vi.fn()} onChecklistCopied={vi.fn()} />
      </SortableContext>
    </DndContext>,
  )
}

describe('CardItem', () => {
  it('names its drag handle and its menu after the card', () => {
    renderCard('Homepage layout')
    expect(screen.getByRole('button', { name: 'Move Homepage layout' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Menu for Homepage layout' })).toBeInTheDocument()
  })
})
