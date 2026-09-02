// A time entry is a snapshot: board_name, card_name and labels are copies
// taken when the entry was recorded, not references. The card they came from
// may since have been renamed, relabelled, archived or deleted — the record
// of the time spent on it doesn't change with it.
export interface TimeEntryLabel {
  name: string
  color: string
}

export interface TimeEntryRead {
  id: string
  started_at: string
  // null while this is the entry currently being tracked.
  ended_at: string | null
  board_name: string
  card_name: string
  labels: TimeEntryLabel[]
  // The user's own note on the work — the one field not copied from the
  // card. null when nothing was written; the API stores a blank note as none.
  comment: string | null
  created_at: string
  updated_at: string
}
