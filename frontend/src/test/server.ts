import { setupServer } from 'msw/node'

// The fake backend every test talks to. It starts with no handlers: each test
// says what the endpoints it needs answer, e.g.
//
//   server.use(http.get('/api/v1/boards', () => HttpResponse.json(boards)))
//
// Handlers added with server.use() are dropped after each test (setup.ts),
// and a request no handler matches fails the test.
export const server = setupServer()
