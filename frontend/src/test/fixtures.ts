// Builders for the API shapes tests use most. Each returns a complete,
// valid object with plain defaults; pass only what the test is about:
//
//   makeCard({ name: 'Homepage layout', labels: [makeLabel({ name: 'Bug' })] })
import type { BoardListRead, BoardRead, CardRead, LabelRead, PersonSummary } from '../types/board'
import type { TimeEntryRead } from '../types/timeTracker'

const CREATED = '2026-01-15T10:00:00Z'

let counter = 0
// Distinct, readable ids ("card-3"), so a failing assertion says which object.
function nextId(kind: string): string {
  counter += 1
  return `${kind}-${counter}`
}

// GET /api/v1/users/me (backend UserRead). The frontend has no shared type
// for it, so the fixture defines the shape.
export interface TestUser {
  id: string
  email: string
  display_name: string
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
  language_locale: string
  number_locale: string
  date_format: string
  timezone: string
  initials: string | null
  auth_providers: string[]
}

export function makeUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: 'user-1',
    email: 'emma.wilson@example.com',
    display_name: 'Emma Wilson',
    is_active: true,
    is_verified: true,
    created_at: CREATED,
    updated_at: CREATED,
    language_locale: 'en',
    number_locale: 'en',
    date_format: 'numeric',
    timezone: 'Europe/Madrid',
    initials: null,
    auth_providers: ['local'],
    ...overrides,
  }
}

export function makeBoard(overrides: Partial<BoardRead> = {}): BoardRead {
  return {
    id: nextId('board'),
    owner_id: 'user-1',
    owner_display_name: 'Emma Wilson',
    owner_initials: null,
    owner_has_avatar: false,
    name: 'Website redesign',
    is_archived: false,
    is_deleted: false,
    is_template: false,
    is_starred: false,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

export function makeList(overrides: Partial<BoardListRead> = {}): BoardListRead {
  return {
    id: nextId('list'),
    board_id: 'board-1',
    name: 'In progress',
    is_archived: false,
    is_deleted: false,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

export function makeLabel(overrides: Partial<LabelRead> = {}): LabelRead {
  return {
    id: nextId('label'),
    board_id: 'board-1',
    name: 'Bug',
    color: '#d32f2f',
    position: 0,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

export function makeCard(overrides: Partial<CardRead> = {}): CardRead {
  return {
    id: nextId('card'),
    list_id: 'list-1',
    name: 'Homepage layout',
    description: null,
    is_archived: false,
    is_deleted: false,
    start_at: null,
    due_at: null,
    end_at: null,
    labels: [],
    creator: null,
    members: [],
    assignees: [],
    checklists: [],
    replaced_by_id: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}

// Someone on a board, as the API summarises them (owner, members, shares).
export function makePerson(overrides: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id: nextId('user'),
    display_name: 'Liam Chen',
    initials: null,
    has_avatar: false,
    ...overrides,
  }
}

// A finished time entry: an hour on a card, with no note.
export function makeTimeEntry(overrides: Partial<TimeEntryRead> = {}): TimeEntryRead {
  return {
    id: nextId('entry'),
    started_at: '2026-01-15T09:00:00Z',
    ended_at: '2026-01-15T10:00:00Z',
    board_name: 'Website redesign',
    card_name: 'Homepage layout',
    labels: [],
    comment: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  }
}
