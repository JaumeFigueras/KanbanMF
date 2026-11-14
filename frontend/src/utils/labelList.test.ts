import { describe, expect, it } from 'vitest'
import { capLabels, labelSummary, sortLabels } from './labelList'

// The helpers take anything with a name; the ids show which object is which.
function labels(...names: string[]) {
  return names.map((name, i) => ({ id: `l${i + 1}`, name }))
}

function names(list: { name: string }[]): string[] {
  return list.map((l) => l.name)
}

const FIVE = labels('Urgent', 'Writing', 'Bug', 'Website', 'Client')

describe('sortLabels', () => {
  it('sorts by name, ignoring case and accents', () => {
    expect(names(sortLabels(labels('Urgent', 'àrea', 'Bug', 'client')))).toEqual(['àrea', 'Bug', 'client', 'Urgent'])
  })

  it('puts numbers in natural order', () => {
    expect(names(sortLabels(labels('Phase 10', 'Phase 2', 'Phase 1')))).toEqual(['Phase 1', 'Phase 2', 'Phase 10'])
  })

  it('returns a sorted copy and leaves the input as it was', () => {
    const input = labels('Client', 'Bug')
    const sorted = sortLabels(input)
    expect(names(input)).toEqual(['Client', 'Bug'])
    expect(sorted).not.toBe(input)
  })

  it('keeps labels with equal names in the order given', () => {
    expect(sortLabels(labels('Area', 'àrea', 'AREA')).map((l) => l.id)).toEqual(['l1', 'l2', 'l3'])
  })
})

describe('capLabels', () => {
  it('shows the first 3 by default and counts the rest', () => {
    const { shown, hidden } = capLabels(FIVE)
    expect(names(shown)).toEqual(['Urgent', 'Writing', 'Bug'])
    expect(hidden).toBe(2)
  })

  it('shows every label when there are no more than the maximum', () => {
    expect(capLabels(labels('Bug', 'Client'))).toEqual({ shown: labels('Bug', 'Client'), hidden: 0 })
    expect(capLabels(labels('Bug', 'Client', 'Urgent')).hidden).toBe(0)
  })

  it('shows none when the maximum is 0 or less', () => {
    expect(capLabels(FIVE, 0)).toEqual({ shown: [], hidden: 5 })
    expect(capLabels(FIVE, -2)).toEqual({ shown: [], hidden: 5 })
  })
})

describe('labelSummary', () => {
  it('is empty when there are no labels', () => {
    expect(labelSummary([])).toBe('')
  })

  it('lists the labels sorted, in brackets', () => {
    expect(labelSummary(labels('Client', 'Bug'))).toBe('(Bug, Client)')
  })

  it('adds how many labels were left out', () => {
    expect(labelSummary(FIVE)).toBe('(Bug, Client, Urgent +2)')
  })

  it('shows only the count when the maximum is 0', () => {
    expect(labelSummary(FIVE, 0)).toBe('(+5)')
  })
})
