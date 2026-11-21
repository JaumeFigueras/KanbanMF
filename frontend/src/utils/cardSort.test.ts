import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { makeCard } from '../test/fixtures'
import type { CardRead } from '../types/board'
import {
  applyUndatedOrder,
  clampDueDateDropIndex,
  isSortMode,
  SORT_OPTIONS,
  sortCards,
  type SortMode,
} from './cardSort'

// Cards named after their id, so a failing assertion reads as a list of ids.
function card(id: string, due_at: string | null = null, name = id): CardRead {
  return makeCard({ id, name, due_at })
}

function ids(cards: CardRead[]): string[] {
  return cards.map((c) => c.id)
}

describe('sortCards', () => {
  describe('custom', () => {
    it('follows the stored order', () => {
      const cards = [card('a'), card('b'), card('c')]
      expect(ids(sortCards(cards, 'custom', ['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
    })

    it('puts cards missing from the stored order first, in the order they came', () => {
      const cards = [card('a'), card('new1'), card('b'), card('new2')]
      expect(ids(sortCards(cards, 'custom', ['b', 'a']))).toEqual(['new1', 'new2', 'b', 'a'])
    })

    it('ignores ids of cards that are no longer in the list', () => {
      const cards = [card('a'), card('b')]
      expect(ids(sortCards(cards, 'custom', ['gone1', 'b', 'gone2', 'a']))).toEqual(['b', 'a'])
    })
  })

  describe('due_date', () => {
    it('puts undated cards first, then dated ones from the earliest due date', () => {
      const cards = [
        card('late', '2026-12-01T10:00:00Z'),
        card('undated'),
        card('early', '2026-11-20T10:00:00Z'),
      ]
      expect(ids(sortCards(cards, 'due_date'))).toEqual(['undated', 'early', 'late'])
    })

    it('orders cards with the same due date by name', () => {
      const due = '2026-11-20T10:00:00Z'
      const cards = [card('w', due, 'Write report'), card('c', due, 'Call client')]
      expect(ids(sortCards(cards, 'due_date'))).toEqual(['c', 'w'])
    })

    it('keeps undated cards in the stored order, and puts those missing from it last', () => {
      const cards = [card('new1'), card('u1'), card('new2'), card('d1', '2026-11-20T10:00:00Z'), card('u2')]
      expect(ids(sortCards(cards, 'due_date', ['u2', 'd1', 'u1']))).toEqual(['u2', 'u1', 'new1', 'new2', 'd1'])
    })
  })

  it('sorts alpha_asc from A to Z by the language rules, not by character codes', () => {
    const cards = [card('banana'), card('Cherry'), card('apple')]
    expect(ids(sortCards(cards, 'alpha_asc'))).toEqual(['apple', 'banana', 'Cherry'])
  })

  it('sorts alpha_desc from Z to A', () => {
    const cards = [card('banana'), card('Cherry'), card('apple')]
    expect(ids(sortCards(cards, 'alpha_desc'))).toEqual(['Cherry', 'banana', 'apple'])
  })

  // Board.tsx reads the mode from localStorage as it is, so an old or
  // hand-edited value can get here.
  it('keeps the incoming order for an unknown mode', () => {
    const cards = [card('b'), card('c'), card('a')]
    expect(ids(sortCards(cards, 'by_colour' as SortMode))).toEqual(['b', 'c', 'a'])
  })

  it('never changes the array it was given', () => {
    const cards = [card('b', '2026-11-20T10:00:00Z'), card('c'), card('a')]
    const before = [...cards]
    for (const mode of SORT_OPTIONS.map((o) => o.value)) {
      sortCards(cards, mode, ['a', 'c'])
      expect(cards, mode).toEqual(before)
    }
  })
})

describe('clampDueDateDropIndex', () => {
  // A list as due-date mode shows it: the undated cards, then the dated ones.
  const displayed = [
    card('u1'),
    card('u2'),
    card('u3'),
    card('d1', '2026-11-20T10:00:00Z'),
    card('d2', '2026-11-21T10:00:00Z'),
  ]

  it('gives null for a dated card, whose place follows from its due date', () => {
    expect(clampDueDateDropIndex(displayed, 'd1', 0)).toBeNull()
  })

  it('gives null for a card that is not shown', () => {
    expect(clampDueDateDropIndex(displayed, 'elsewhere', 0)).toBeNull()
  })

  it('keeps a position inside the undated block', () => {
    expect(clampDueDateDropIndex(displayed, 'u1', 2)).toBe(2)
  })

  it('turns a position past the undated block into its last slot', () => {
    expect(clampDueDateDropIndex(displayed, 'u1', 4)).toBe(2)
  })

  it('turns a negative position into 0', () => {
    expect(clampDueDateDropIndex(displayed, 'u3', -1)).toBe(0)
  })
})

describe('applyUndatedOrder', () => {
  const u1 = card('u1')
  const u2 = card('u2')
  const u3 = card('u3')
  const d1 = card('d1', '2026-11-20T10:00:00Z')
  const d2 = card('d2', '2026-11-21T10:00:00Z')

  it('refills the undated cards’ slots in the new sequence, leaving dated cards in theirs', () => {
    expect(applyUndatedOrder(['u1', 'd1', 'u2', 'd2'], [u1, u2, d1, d2], ['u2', 'u1'])).toEqual(['u2', 'd1', 'u1', 'd2'])
  })

  it('drops ids of cards that are no longer in the list', () => {
    expect(applyUndatedOrder(['u1', 'gone', 'd1', 'u2'], [u1, u2, d1], ['u2', 'u1'])).toEqual(['u2', 'd1', 'u1'])
  })

  it('adds an undated card that had no slot at the end, keeping the requested sequence', () => {
    expect(applyUndatedOrder(['u1', 'd1'], [u1, u3, d1], ['u3', 'u1'])).toEqual(['u3', 'd1', 'u1'])
  })

  it('leaves a slot out rather than writing an empty one when there are fewer ids than slots', () => {
    expect(applyUndatedOrder(['u1', 'd1', 'u2'], [u1, u2, d1], ['u2'])).toEqual(['u2', 'd1'])
  })
})

describe('isSortMode', () => {
  it('accepts the four modes', () => {
    expect(['due_date', 'alpha_asc', 'alpha_desc', 'custom'].filter(isSortMode)).toHaveLength(4)
  })

  it('refuses anything else a stored value could be (6I)', () => {
    expect([null, '', 'bogus', 'Custom', 'due-date', 'toString', undefined, 3].filter(isSortMode)).toEqual([])
  })
})

describe('SORT_OPTIONS', () => {
  it('has an existing translation key for every option', () => {
    const missing = SORT_OPTIONS.filter((o) => !i18n.exists(o.labelKey)).map((o) => o.labelKey)
    expect(missing).toEqual([])
  })
})
