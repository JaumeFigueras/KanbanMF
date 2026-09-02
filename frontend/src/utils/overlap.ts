interface Interval {
  id: string
  started_at: string
  ended_at: string | null
}

const MINUTE_MS = 60_000

// Instants are compared at the granularity the table shows them in: the
// columns, the pickers in the edit dialog and the CSV export all stop at
// the minute, so an overlap of a few seconds would be a warning about
// something the user can neither see nor edit away. Flooring both ends can
// only ever hide such an overlap, never invent one — two entries that
// really are disjoint stay disjoint once floored.
function toMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

// Ids of every entry that shares time with at least one other entry. Two
// entries overlap when each starts before the other ends; touching ends
// (one starting exactly when the previous stopped) is not an overlap.
//
// The entry still running is measured up to `now`, so a recorded entry that
// covers the present moment is flagged while the clock runs through it.
//
// Only the entries handed in are compared — with a month filter applied,
// that means an overlap with a neighbouring month's entry isn't visible
// here, because that entry hasn't been loaded.
export function findOverlappingEntryIds(entries: Interval[], now: number): Set<string> {
  const spans = entries
    .map((e) => ({
      id: e.id,
      start: toMinute(Date.parse(e.started_at)),
      end: toMinute(e.ended_at ? Date.parse(e.ended_at) : now),
    }))
    .sort((a, b) => a.start - b.start)

  const overlapping = new Set<string>()
  // Spans that reach past the current one's start, so they're the only ones
  // that can still overlap anything further down the sorted list.
  let active: typeof spans = []
  for (const span of spans) {
    active = active.filter((other) => other.end > span.start)
    if (active.length > 0) {
      overlapping.add(span.id)
      for (const other of active) overlapping.add(other.id)
    }
    active.push(span)
  }
  return overlapping
}
