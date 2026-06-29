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
