// Where a search looks, and the /search address that carries it. Every
// search lives in the address (q, board, archived), so the results page can
// be reloaded, bookmarked and left with Back.

// No boardId and no archived: every live board you can see. boardId: that
// board's live cards. Both: that board's archive. archived alone: your
// archived boards. Mirrors the backend's /search parameters.
export interface SearchScope {
  boardId?: string
  archived?: boolean
}

// The backend refuses anything shorter.
export const MIN_SEARCH_LENGTH = 2

export function searchUrl(q: string, scope: SearchScope): string {
  const params = new URLSearchParams({ q })
  if (scope.boardId) params.set('board', scope.boardId)
  if (scope.archived) params.set('archived', '1')
  return `/search?${params}`
}

export function scopeFromParams(params: URLSearchParams): SearchScope {
  return {
    boardId: params.get('board') ?? undefined,
    archived: params.get('archived') === '1',
  }
}

// The translation key of the search box's placeholder for a scope.
export function searchPlaceholderKey(scope: SearchScope): string {
  if (scope.boardId) return scope.archived ? 'search.boardArchive' : 'search.thisBoard'
  return scope.archived ? 'search.archivedBoards' : 'search.allBoards'
}

// The backend's query string for a scope.
export function searchApiParams(q: string, scope: SearchScope): string {
  const params = new URLSearchParams({ q })
  if (scope.boardId) params.set('board_id', scope.boardId)
  if (scope.archived) params.set('archived', 'true')
  return params.toString()
}
