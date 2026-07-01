export interface BoardRead {
  id: string
  owner_id: string
  owner_display_name: string
  owner_initials: string | null
  owner_has_avatar: boolean
  name: string
  is_archived: boolean
  is_deleted: boolean
  is_starred: boolean
  created_at: string
  updated_at: string
}

export interface BoardsResponse {
  owned: BoardRead[]
  shared: BoardRead[]
}

export interface BoardListRead {
  id: string
  board_id: string
  name: string
  is_archived: boolean
  is_deleted: boolean
  created_at: string
  updated_at: string
}

export interface BoardListOrderRead {
  board_id: string
  list_ids: string[]
}

export interface BoardOrderRead {
  starred_ids: string[]
  owned_ids: string[]
  shared_ids: string[]
}

export interface LabelRead {
  id: string
  board_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
}

export interface PersonSummary {
  id: string
  display_name: string
  initials: string | null
  has_avatar: boolean
}

// Frontend-only for now — no checklist API exists yet, so ids are generated
// client-side and nothing here is persisted.
export interface ChecklistItemData {
  id: string
  text: string
  is_done: boolean
}

export interface ChecklistData {
  id: string
  name: string
  items: ChecklistItemData[]
}

export interface CardRead {
  id: string
  list_id: string
  name: string
  description: string | null
  is_archived: boolean
  is_deleted: boolean
  start_at: string | null
  due_at: string | null
  end_at: string | null
  labels: LabelRead[]
  creator: PersonSummary | null
  members: PersonSummary[]
  assignees: PersonSummary[]
  created_at: string
  updated_at: string
}
