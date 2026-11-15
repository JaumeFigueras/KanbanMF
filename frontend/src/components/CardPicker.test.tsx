import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { fakeCardChoices } from '../test/cardChoices'
import { renderWithProviders } from '../test/render'
import CardPicker from './CardPicker'

interface Options {
  active?: boolean
  disabled?: boolean
  initialBoardId?: string
  initialListId?: string
}

function renderPicker(options: Options = {}) {
  const onChange = vi.fn()
  const picker = (shown: Options) => (
    <CardPicker active={shown.active ?? true} disabled={shown.disabled} initialBoardId={shown.initialBoardId}
      initialListId={shown.initialListId} onChange={onChange} />
  )
  const result = renderWithProviders(picker(options))
  // What the picker last reported.
  const chosen = () => onChange.mock.calls[onChange.mock.calls.length - 1][0]
  return { ...result, onChange, chosen, update: (next: Options) => result.rerender(picker({ ...options, ...next })) }
}

function select(name: 'Board' | 'List' | 'Card') {
  return screen.getByRole('combobox', { name })
}

async function shows(name: 'Board' | 'List' | 'Card', text: string) {
  await waitFor(() => expect(select(name)).toHaveTextContent(text))
}

async function choose(user: ReturnType<typeof renderPicker>['user'], from: 'Board' | 'List' | 'Card', option: string | RegExp) {
  await user.click(select(from))
  await user.click(screen.getByRole('option', { name: option }))
}

function options() {
  return screen.getAllByRole('option').map((o) => o.textContent)
}

describe('CardPicker', () => {
  it('starts on the most used board, its most used list, and that list\'s first card', async () => {
    fakeCardChoices()
    const { chosen } = renderPicker()
    await shows('Card', 'Homepage layout')
    await shows('Board', 'Website redesign')
    await shows('List', 'Doing')
    expect(chosen()).toEqual({ boardId: 'board-1', listId: 'list-2', cardId: 'card-7' })
  })

  it('offers the boards and lists in the order the server gives, most used first', async () => {
    fakeCardChoices()
    const { user } = renderPicker()
    await shows('Card', 'Homepage layout')
    await user.click(select('Board'))
    expect(options()).toEqual(['Website redesign', 'Marketing', 'Empty board'])
    await user.click(screen.getByRole('option', { name: 'Website redesign' }))
    await user.click(select('List'))
    expect(options()).toEqual(['Doing', 'To do'])
  })

  it('starts on the board and list it is given, when they are offered', async () => {
    fakeCardChoices()
    const { chosen } = renderPicker({ initialBoardId: 'board-2', initialListId: 'list-6' })
    await shows('List', 'Done')
    await shows('Board', 'Marketing')
    expect(chosen()).toEqual({ boardId: 'board-2', listId: 'list-6', cardId: '' })
  })

  it('falls back to the most used ones when those given are not offered', async () => {
    fakeCardChoices()
    const { chosen } = renderPicker({ initialBoardId: 'board-gone', initialListId: 'list-gone' })
    await shows('Card', 'Homepage layout')
    expect(chosen()).toEqual({ boardId: 'board-1', listId: 'list-2', cardId: 'card-7' })
  })

  it("loads another board's lists when it is chosen, starting on its first list and card", async () => {
    fakeCardChoices()
    const { user, chosen } = renderPicker()
    await shows('Card', 'Homepage layout')
    await choose(user, 'Board', 'Marketing')
    await shows('Card', 'Spring campaign')
    await shows('List', 'Ideas')
    expect(chosen()).toEqual({ boardId: 'board-2', listId: 'list-5', cardId: 'card-20' })
  })

  it("loads another list's cards when it is chosen", async () => {
    fakeCardChoices()
    const { user, chosen } = renderPicker()
    await shows('Card', 'Homepage layout')
    await choose(user, 'List', 'To do')
    await shows('Card', 'Contact form')
    expect(chosen()).toEqual({ boardId: 'board-1', listId: 'list-1', cardId: 'card-3' })
  })

  it('reports the card chosen', async () => {
    fakeCardChoices()
    const { user, chosen } = renderPicker()
    await shows('Card', 'Homepage layout')
    await choose(user, 'Card', /^Footer/)
    expect(chosen()).toEqual({ boardId: 'board-1', listId: 'list-2', cardId: 'card-8' })
  })

  it('tells cards apart by their labels: as text in the field, as chips in the menu', async () => {
    fakeCardChoices()
    const { user } = renderPicker()
    await shows('Card', 'Homepage layout (Bug, Urgent)')
    await user.click(select('Card'))
    const option = screen.getByRole('option', { name: /^Homepage layout/ })
    expect(within(option).getByText('Bug')).toBeInTheDocument()
    expect(within(option).getByText('Urgent')).toBeInTheDocument()
  })

  it("says a board has no lists, and offers no list or card", async () => {
    fakeCardChoices()
    const { user } = renderPicker()
    await shows('Card', 'Homepage layout')
    await choose(user, 'Board', 'Empty board')
    expect(await screen.findByText('This board has no lists yet.')).toBeInTheDocument()
    expect(select('List')).toHaveAttribute('aria-disabled', 'true')
    expect(select('Card')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('No cards in this list.')).not.toBeInTheDocument()
  })

  it('says a list has no cards, and offers none', async () => {
    fakeCardChoices()
    const { user, chosen } = renderPicker()
    await shows('Card', 'Homepage layout')
    await choose(user, 'Board', 'Marketing')
    await shows('List', 'Ideas')
    await choose(user, 'List', 'Done')
    expect(await screen.findByText('No cards in this list.')).toBeInTheDocument()
    expect(select('Card')).toHaveAttribute('aria-disabled', 'true')
    expect(chosen()).toEqual({ boardId: 'board-2', listId: 'list-6', cardId: '' })
  })

  it('offers nothing to someone with no boards', async () => {
    const loads = fakeCardChoices({ boards: () => Response.json([]) })
    const { chosen } = renderPicker()
    await waitFor(() => expect(loads.boards.requests).toHaveLength(1))
    for (const name of ['Board', 'List', 'Card'] as const) expect(select(name)).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('This board has no lists yet.')).not.toBeInTheDocument()
    expect([...loads.lists.requests, ...loads.cards.requests]).toEqual([])
    expect(chosen()).toEqual({ boardId: '', listId: '', cardId: '' })
  })

  it('can be switched off as a whole', async () => {
    fakeCardChoices()
    renderPicker({ disabled: true })
    await waitFor(() => expect(select('Card')).toHaveTextContent('Homepage layout'))
    for (const name of ['Board', 'List', 'Card'] as const) expect(select(name)).toHaveAttribute('aria-disabled', 'true')
  })

  it('loads nothing while inactive, and everything again once active', async () => {
    const loads = fakeCardChoices()
    const { update } = renderPicker({ active: false })
    // Gives a request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect([...loads.boards.requests, ...loads.lists.requests, ...loads.cards.requests]).toEqual([])

    update({ active: true })

    await shows('Card', 'Homepage layout')
    expect(loads.boards.requests).toHaveLength(1)
  })

  it('keeps the choice when reactivated, if it is still offered', async () => {
    fakeCardChoices()
    const { user, update, chosen } = renderPicker()
    await shows('Card', 'Homepage layout')
    await choose(user, 'Card', /^Footer/)

    update({ active: false })
    update({ active: true })

    await shows('Card', 'Footer')
    // Gives the reloads time to land, and to change the choice if they would.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(chosen()).toEqual({ boardId: 'board-1', listId: 'list-2', cardId: 'card-8' })
  })
})
