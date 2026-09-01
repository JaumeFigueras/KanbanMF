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

export function isUndated(card: CardRead): boolean {
  return !card.due_at
}

// Due-date mode renders a list as two blocks: the undated cards first, in the
// list's custom order, then the dated ones by due date. Only the first block
// can be rearranged by hand, so this clamps the index a drop asked for into
// it. null means the card has no say in where it sits — a dated card's slot
// follows from its due date, so dropping it anywhere is a no-op.
export function clampDueDateDropIndex(
  displayed: CardRead[],
  cardId: string,
  requestedIndex: number,
): number | null {
  const card = displayed.find((c) => c.id === cardId)
  if (!card || !isUndated(card)) return null
  const lastUndatedIndex = displayed.filter(isUndated).length - 1
  return Math.max(0, Math.min(requestedIndex, lastUndatedIndex))
}

// Rewrites a list's stored custom order after the undated cards were
// rearranged in due-date mode. Every slot an undated card held is refilled
// from `undatedIds` in its new sequence, so the dated cards keep both their
// slots and their relative order — a drag here leaves the custom view as
// close to what the user arranged there as possible. An undated card with no
// slot to reuse (just created, or just dragged in from another list) is
// appended; due-date sorting reads only the undated cards' order relative to
// each other, so the requested sequence still comes out right.
export function applyUndatedOrder(
  orderIds: string[],
  cards: CardRead[],
  undatedIds: string[],
): string[] {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const queue = [...undatedIds]
  const result: string[] = []
  for (const id of orderIds) {
    const card = byId.get(id)
    // Stale entry: that card was archived, deleted, or moved to another list.
    if (!card) continue
    if (isUndated(card)) {
      const next = queue.shift()
      if (next) result.push(next)
      continue
    }
    result.push(id)
  }
  return [...result, ...queue]
}
