import type { CardRead } from '../types/board'

export type SortMode = 'due_date' | 'alpha_asc' | 'alpha_desc' | 'custom'

export const SORT_OPTIONS: { value: SortMode; labelKey: string }[] = [
  { value: 'due_date', labelKey: 'board.sortDueDate' },
  { value: 'alpha_asc', labelKey: 'board.sortAlphaAsc' },
  { value: 'alpha_desc', labelKey: 'board.sortAlphaDesc' },
  { value: 'custom', labelKey: 'board.sortCustom' },
]

// Cards with a stored position (`customOrderIds`) are sorted by it; anything
// not yet in that list — e.g. a card just created or just dropped in from
// another list before its position was persisted — floats to the front.
export function sortCards(cards: CardRead[], mode: SortMode, customOrderIds: string[] = []): CardRead[] {
  if (mode === 'custom') {
    const position = new Map(customOrderIds.map((id, index) => [id, index]))
    const ordered = cards.filter((c) => position.has(c.id))
      .sort((a, b) => position.get(a.id)! - position.get(b.id)!)
    const unordered = cards.filter((c) => !position.has(c.id))
    return [...unordered, ...ordered]
  }
  const sorted = [...cards]
  if (mode === 'due_date') {
    const position = new Map(customOrderIds.map((id, index) => [id, index]))
    sorted.sort((a, b) => {
      if (a.due_at && b.due_at) {
        const diff = Date.parse(a.due_at) - Date.parse(b.due_at)
        return diff !== 0 ? diff : a.name.localeCompare(b.name)
      }
      if (a.due_at) return 1
      if (b.due_at) return -1
      // Neither has a due date: fall back to this list's custom order so the
      // user can still arrange undated cards manually.
      const posA = position.has(a.id) ? position.get(a.id)! : Infinity
      const posB = position.has(b.id) ? position.get(b.id)! : Infinity
      return posA - posB
    })
  } else if (mode === 'alpha_asc') {
    sorted.sort((a, b) => a.name.localeCompare(b.name))
  } else if (mode === 'alpha_desc') {
    sorted.sort((a, b) => b.name.localeCompare(a.name))
  }
  return sorted
}
