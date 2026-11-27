import { setupServer } from 'msw/node'

// The fake backend every test talks to. It starts with no handlers: each test
// says what the endpoints it needs answer, e.g.
//
//   server.use(http.get('/api/v1/boards', () => HttpResponse.json(boards)))
//
// Handlers added with server.use() are dropped after each test (setup.ts),
// and a request no handler matches fails the test.
export const server = setupServer()

// Every request no handler matched, as "GET /api/v1/boards", until taken.
const unanswered: string[] = []
server.events.on('request:unhandled', ({ request }) => {
  unanswered.push(`${request.method} ${new URL(request.url).pathname}`)
})

// The requests no handler matched since the last call (setup.ts calls it
// after each test, and fails the test if there were any).
export function takeUnansweredRequests(): string[] {
  return unanswered.splice(0)
}
