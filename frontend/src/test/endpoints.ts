import { onTestFinished } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './server'

// What a fake endpoint received: the address, with its query, and the body
// as the backend would read it (JSON as an object, a form as FormData,
// nothing as null).
export interface ReceivedRequest {
  url: URL
  body: unknown
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
export type Answer = (request: Request) => Response | Promise<Response>

// What the backend answers a delete, and a fine default for anything whose
// answer the caller doesn't read.
const NO_CONTENT: Answer = () => new HttpResponse(null, { status: 204 })

// Makes the fake backend answer `method path` (an MSW path, so ':boardId'
// matches any id) and records every request it gets:
//
//   const deleted = fakeEndpoint('delete', '/api/v1/boards/:boardId')
//   ... click Delete ...
//   expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7'])
export function fakeEndpoint(method: Method, path: string, answer: Answer = NO_CONTENT) {
  const requests: ReceivedRequest[] = []
  server.use(
    http[method](path, async ({ request }) => {
      requests.push({ url: new URL(request.url), body: await readBody(request.clone()) })
      return answer(request)
    }),
  )
  return { requests }
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? ''
  if (type.includes('application/json')) return request.json()
  if (type.includes('multipart/form-data')) return request.formData()
  const text = await request.text()
  return text === '' ? null : text
}

// An answer held back until the test releases it, to look at the app while
// its request is still running:
//
//   const held = heldAnswer()
//   fakeEndpoint('delete', '/api/v1/boards/:boardId', held.answer)
//   ... click Delete, check the buttons are disabled ...
//   held.release()
//
// If the test ends first, it's released then, so no request is left waiting.
export function heldAnswer(answer: Answer = NO_CONTENT) {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  onTestFinished(() => release())
  return {
    answer: async (request: Request) => {
      await released
      return answer(request)
    },
    release: () => release(),
  }
}

// The two ways a load fails: the server answers with an error, or the
// connection drops before any answer.
export const SERVER_ERROR: Answer = () => HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
export const DROPPED: Answer = () => HttpResponse.error()
