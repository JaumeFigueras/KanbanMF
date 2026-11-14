import { describe, expect, it } from 'vitest'
import { findOverlappingEntryIds } from './overlap'

// Every entry is on the same day, written as 'HH:MM' or 'HH:MM:SS' (UTC).
const DAY = '2026-11-14'

function entry(id: string, start: string, end: string | null) {
  return { id, started_at: `${DAY}T${start}Z`, ended_at: end ? `${DAY}T${end}Z` : null }
}

function at(time: string): number {
  return Date.parse(`${DAY}T${time}Z`)
}

// The flagged ids, sorted, so the order the Set was filled in doesn't matter.
function flagged(entries: ReturnType<typeof entry>[], now = at('18:00')): string[] {
  return [...findOverlappingEntryIds(entries, now)].sort()
}

describe('findOverlappingEntryIds', () => {
  it('flags nothing when there are no entries, or just one', () => {
    expect(flagged([])).toEqual([])
    expect(flagged([entry('a', '09:00', '10:00')])).toEqual([])
  })

  it('flags nothing when the entries are apart', () => {
    expect(flagged([entry('a', '09:00', '10:00'), entry('b', '11:00', '12:00')])).toEqual([])
  })

  it('does not count touching ends as an overlap', () => {
    expect(flagged([entry('a', '09:00', '10:00'), entry('b', '10:00', '11:00')])).toEqual([])
  })

  it('flags both entries of an overlap, and not a third one apart', () => {
    const entries = [entry('a', '09:00', '10:30'), entry('b', '10:00', '11:00'), entry('c', '12:00', '13:00')]
    expect(flagged(entries)).toEqual(['a', 'b'])
  })

  it('flags a long entry and every separate entry inside it', () => {
    const entries = [entry('long', '09:00', '13:00'), entry('b', '10:00', '10:30'), entry('c', '11:00', '11:30')]
    expect(flagged(entries)).toEqual(['b', 'c', 'long'])
  })

  it('finds overlaps whatever the order of the entries', () => {
    const entries = [entry('c', '12:00', '13:00'), entry('b', '10:00', '11:00'), entry('a', '09:00', '10:30')]
    expect(flagged(entries)).toEqual(['a', 'b'])
  })

  it('measures the running entry up to now', () => {
    const entries = [entry('running', '09:00', null), entry('x', '10:00', '11:00')]
    expect(flagged(entries, at('10:30'))).toEqual(['running', 'x'])
  })

  it('measures the running entry only up to now, not beyond', () => {
    const entries = [entry('running', '09:00', null), entry('later', '10:00', '11:00')]
    expect(flagged(entries, at('09:59'))).toEqual([])
  })

  it('ignores less than a minute of overlap', () => {
    const entries = [entry('a', '09:00', '10:00:40'), entry('b', '10:00:10', '11:00')]
    expect(flagged(entries)).toEqual([])
  })

  it('flags an overlap of a full minute', () => {
    const entries = [entry('a', '09:00', '10:01:10'), entry('b', '10:00:10', '11:00')]
    expect(flagged(entries)).toEqual(['a', 'b'])
  })
})
