import { HttpResponse } from 'msw'
import type { CardRead } from '../types/board'
import type { TimeTrackerOption } from '../types/timeTracker'
import { fakeEndpoint, type Answer } from './endpoints'
import { makeCard, makeLabel } from './fixtures'

// What the time tracker's card picker chooses from: boards and lists from the
// time tracker's own endpoints, most used first, then a list's cards.
export const CHOICE_BOARDS: TimeTrackerOption[] = [
  { id: 'board-1', name: 'Website redesign', usage_count: 9 },
  { id: 'board-2', name: 'Marketing', usage_count: 2 },
  { id: 'board-3', name: 'Empty board', usage_count: 0 },
]

export const CHOICE_LISTS: Record<string, TimeTrackerOption[]> = {
  'board-1': [
    { id: 'list-2', name: 'Doing', usage_count: 7 },
    { id: 'list-1', name: 'To do', usage_count: 2 },
  ],
  'board-2': [
    { id: 'list-5', name: 'Ideas', usage_count: 2 },
    { id: 'list-6', name: 'Done', usage_count: 0 },
  ],
  'board-3': [],
}

export const CHOICE_CARDS: Record<string, CardRead[]> = {
  'list-2': [
    makeCard({
      id: 'card-7',
      list_id: 'list-2',
      name: 'Homepage layout',
      labels: [makeLabel({ name: 'Urgent', color: '#D32F2F' }), makeLabel({ name: 'Bug', color: '#1976D2' })],
    }),
    makeCard({ id: 'card-8', list_id: 'list-2', name: 'Footer' }),
  ],
  'list-1': [makeCard({ id: 'card-3', list_id: 'list-1', name: 'Contact form' })],
  'list-5': [makeCard({ id: 'card-20', list_id: 'list-5', name: 'Spring campaign' })],
  'list-6': [],
}

const segment = (request: Request, index: number) => new URL(request.url).pathname.split('/')[index]

// A board's lists.
export const answerLists: Answer = (request) => HttpResponse.json(CHOICE_LISTS[segment(request, 5)])

// A list's cards, refused like the backend does when the list isn't on the
// board asked about.
export const answerCards: Answer = (request) => {
  const [boardId, listId] = [segment(request, 4), segment(request, 6)]
  return CHOICE_LISTS[boardId]?.some((l) => l.id === listId)
    ? HttpResponse.json(CHOICE_CARDS[listId])
    : HttpResponse.json({ detail: 'List not found' }, { status: 404 })
}

// Makes the fake backend answer the picker's three loads with the data above;
// any of them can be swapped for another answer (a failure, a held one).
export function fakeCardChoices(answers: { boards?: Answer; lists?: Answer; cards?: Answer } = {}) {
  return {
    boards: fakeEndpoint('get', '/api/v1/time-entries/boards', answers.boards ?? (() => HttpResponse.json(CHOICE_BOARDS))),
    lists: fakeEndpoint('get', '/api/v1/time-entries/boards/:boardId/lists',
      answers.lists ?? answerLists),
    cards: fakeEndpoint('get', '/api/v1/boards/:boardId/lists/:listId/cards', answers.cards ?? answerCards),
  }
}
