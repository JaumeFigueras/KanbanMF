interface Interval {
  id: string
  started_at: string
  ended_at: string | null
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
      start: Date.parse(e.started_at),
      end: e.ended_at ? Date.parse(e.ended_at) : now,
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
