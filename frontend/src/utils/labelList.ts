// Ordering and trimming a card's labels for compact displays, such as the
// time tracker's card picker, where cards with the same name are told apart
// by their labels. Works on anything with a name: a board's LabelRead or a
// time entry's copied TimeEntryLabel.

interface NamedLabel {
  name: string
}

// Case- and accent-insensitive, so "àrea", "Area" and "AREA" sit together.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// A sorted copy; the input is left as it is.
export function sortLabels<T extends NamedLabel>(labels: readonly T[]): T[] {
  return [...labels].sort((a, b) => collator.compare(a.name, b.name))
}

// The first `max` labels, in the order given, and how many are left over.
export function capLabels<T extends NamedLabel>(
  labels: readonly T[],
  max = 3,
): { shown: T[]; hidden: number } {
  const limit = Math.max(0, max)
  return { shown: labels.slice(0, limit), hidden: Math.max(0, labels.length - limit) }
}

// The text form, e.g. "(Bug, Client, Urgent +2)": sorted, capped, and empty
// when there are no labels.
export function labelSummary(labels: readonly NamedLabel[], max = 3): string {
  if (labels.length === 0) return ''
  const { shown, hidden } = capLabels(sortLabels(labels), max)
  const names = shown.map(l => l.name).join(', ')
  if (shown.length === 0) return `(+${hidden})`
  return hidden > 0 ? `(${names} +${hidden})` : `(${names})`
}
