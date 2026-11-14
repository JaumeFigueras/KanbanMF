import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import {
  apiFetch,
  getAccessToken,
  getClientId,
  onAccessTokenChange,
  refreshAccessToken,
  setAccessToken,
} from './client'

const REFRESH = '/api/v1/auth/local/refresh'

// The credentials mode of every fetch() call made while `run` runs. MSW
// rebuilds requests from what goes over the wire, where the mode isn't, so
// it is read from the calls themselves.
async function credentialsOf(run: () => Promise<unknown>): Promise<(RequestCredentials | undefined)[]> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  try {
    await run()
    return fetchSpy.mock.calls.map(([, init]) => init?.credentials)
  } finally {
    fetchSpy.mockRestore()
  }
}

// The refresh endpoint, answering with a new token (or the given response)
// and counting how often it was asked.
function fakeRefresh(answer: () => Response | Promise<Response> = () => HttpResponse.json({ access_token: 'new' })) {
  const calls = { count: 0 }
  server.use(
    http.post(REFRESH, () => {
      calls.count += 1
      return answer()
    }),
  )
  return calls
}

// An endpoint that accepts only the given token and answers 401 otherwise,
// recording the Authorization header of every request.
function protectedEndpoint(path: string, validToken = 'new') {
  const seen: (string | null)[] = []
  server.use(
    http.all(path, ({ request }) => {
      const auth = request.headers.get('Authorization')
      seen.push(auth)
      return auth === `Bearer ${validToken}` ? HttpResponse.json({ ok: true }) : new HttpResponse(null, { status: 401 })
    }),
  )
  return seen
}

describe('getClientId', () => {
  it('gives a UUID, the same one on every call', () => {
    const id = getClientId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(getClientId()).toBe(id)
  })

  it('gives each page load its own id, even when the tab storage was copied', async () => {
    // Duplicating a tab copies its sessionStorage; the copy must not make
    // the two tabs share an id.
    sessionStorage.setItem('kanbanmf.client_id', 'copied-from-the-other-tab')
    vi.resetModules()
    const first = (await import('./client')).getClientId()
    vi.resetModules()
    const second = (await import('./client')).getClientId()
    expect(first).not.toBe('copied-from-the-other-tab')
    expect(second).not.toBe(first)
  })
})

describe('the access token', () => {
  it('is told to every listener until they unsubscribe', () => {
    const heard: (string | null)[] = []
    const unsubscribe = onAccessTokenChange((token) => heard.push(token))
    setAccessToken('tok-1')
    expect(getAccessToken()).toBe('tok-1')
    unsubscribe()
    setAccessToken('tok-2')
    expect(heard).toEqual(['tok-1'])
  })
})

describe('apiFetch', () => {
  it('sends the token when there is one, and always the client id and the cookies', async () => {
    const requests: Request[] = []
    server.use(
      http.get('/api/v1/boards', ({ request }) => {
        requests.push(request)
        return HttpResponse.json([])
      }),
    )
    const credentials = await credentialsOf(async () => {
      await apiFetch('/api/v1/boards')
      setAccessToken('tok-1')
      await apiFetch('/api/v1/boards')
    })

    expect(requests.map((r) => r.headers.get('Authorization'))).toEqual([null, 'Bearer tok-1'])
    expect(requests.map((r) => r.headers.get('X-Client-Id'))).toEqual([getClientId(), getClientId()])
    expect(credentials).toEqual(['include', 'include'])
  })

  it("keeps the caller's method, headers and body", async () => {
    let received: { method: string; type: string | null; extra: string | null; body: unknown } | undefined
    server.use(
      http.post('/api/v1/boards', async ({ request }) => {
        received = {
          method: request.method,
          type: request.headers.get('Content-Type'),
          extra: request.headers.get('X-Extra'),
          body: await request.json(),
        }
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    const response = await apiFetch('/api/v1/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extra': 'yes' },
      body: JSON.stringify({ name: 'Website redesign' }),
    })
    expect(response.status).toBe(201)
    expect(received).toEqual({
      method: 'POST',
      type: 'application/json',
      extra: 'yes',
      body: { name: 'Website redesign' },
    })
  })

  it('refreshes the token once on a 401 and retries the request with the new one', async () => {
    const refresh = fakeRefresh()
    const seen = protectedEndpoint('/api/v1/boards')
    const heard: (string | null)[] = []
    const unsubscribe = onAccessTokenChange((token) => heard.push(token))
    setAccessToken('expired')

    const response = await apiFetch('/api/v1/boards')
    unsubscribe()

    expect(response.status).toBe(200)
    expect(refresh.count).toBe(1)
    expect(seen).toEqual(['Bearer expired', 'Bearer new'])
    expect(getAccessToken()).toBe('new')
    expect(heard).toEqual(['expired', 'new'])
  })

  it('returns the 401 and clears the token when the refresh fails', async () => {
    fakeRefresh(() => new HttpResponse(null, { status: 401 }))
    const seen = protectedEndpoint('/api/v1/boards')
    setAccessToken('expired')

    const response = await apiFetch('/api/v1/boards')

    expect(response.status).toBe(401)
    expect(seen).toEqual(['Bearer expired'])
    expect(getAccessToken()).toBeNull()
  })

  it('returns a second 401 as it is, without refreshing again', async () => {
    const refresh = fakeRefresh()
    const seen = protectedEndpoint('/api/v1/boards', 'never-valid')
    setAccessToken('expired')

    const response = await apiFetch('/api/v1/boards')

    expect(response.status).toBe(401)
    expect(refresh.count).toBe(1)
    expect(seen).toEqual(['Bearer expired', 'Bearer new'])
  })

  it('sends the body again on the retry', async () => {
    fakeRefresh()
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/boards', async ({ request }) => {
        bodies.push(await request.json())
        return request.headers.get('Authorization') === 'Bearer new'
          ? HttpResponse.json({}, { status: 201 })
          : new HttpResponse(null, { status: 401 })
      }),
    )
    setAccessToken('expired')

    const response = await apiFetch('/api/v1/boards', { method: 'POST', body: JSON.stringify({ name: 'Plan' }) })

    expect(response.status).toBe(201)
    expect(bodies).toEqual([{ name: 'Plan' }, { name: 'Plan' }])
  })

  it('returns other errors as they are, without refreshing', async () => {
    const refresh = fakeRefresh()
    server.use(
      http.get('/api/v1/forbidden', () => new HttpResponse(null, { status: 403 })),
      http.get('/api/v1/broken', () => new HttpResponse(null, { status: 500 })),
    )
    setAccessToken('tok-1')

    expect((await apiFetch('/api/v1/forbidden')).status).toBe(403)
    expect((await apiFetch('/api/v1/broken')).status).toBe(500)
    expect(refresh.count).toBe(0)
  })

  it('shares one refresh between requests that get a 401 at the same time', async () => {
    // The refresh answers only once both requests have had their 401, so
    // they really are waiting for a new token together.
    let bothRefused: () => void = () => {}
    const refused = new Promise<void>((resolve) => (bothRefused = resolve))
    let refusals = 0
    server.use(
      http.get('/api/v1/:resource', ({ request }) => {
        if (request.headers.get('Authorization') === 'Bearer new') return HttpResponse.json({ ok: true })
        refusals += 1
        if (refusals === 2) bothRefused()
        return new HttpResponse(null, { status: 401 })
      }),
    )
    const refresh = fakeRefresh(async () => {
      await refused
      return HttpResponse.json({ access_token: 'new' })
    })
    setAccessToken('expired')

    const responses = await Promise.all([apiFetch('/api/v1/boards'), apiFetch('/api/v1/time-entries')])

    expect(responses.map((r) => r.status)).toEqual([200, 200])
    expect(refresh.count).toBe(1)
  })
})

describe('refreshAccessToken', () => {
  it('posts to the refresh endpoint with the cookies', async () => {
    let request: Request | undefined
    server.use(
      http.post(REFRESH, ({ request: r }) => {
        request = r
        return HttpResponse.json({ access_token: 'fresh' })
      }),
    )
    const credentials = await credentialsOf(async () => expect(await refreshAccessToken()).toBe('fresh'))
    expect(request?.method).toBe('POST')
    expect(credentials).toEqual(['include'])
  })

  it('gives null and clears the token when the network fails', async () => {
    fakeRefresh(() => HttpResponse.error())
    setAccessToken('old')
    expect(await refreshAccessToken()).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('makes a new request once the previous refresh has finished', async () => {
    const refresh = fakeRefresh()
    await refreshAccessToken()
    await refreshAccessToken()
    expect(refresh.count).toBe(2)
  })

  it('runs inside the kanbanmf.refresh Web Lock when the browser has Web Locks', async () => {
    const refresh = fakeRefresh()
    const refreshesBeforeLock: number[] = []
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => {
      refreshesBeforeLock.push(refresh.count)
      return task()
    })
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    try {
      expect(await refreshAccessToken()).toBe('new')
    } finally {
      delete (navigator as { locks?: unknown }).locks
    }
    expect(request).toHaveBeenCalledWith('kanbanmf.refresh', expect.any(Function))
    // The refresh request was sent from inside the lock, not before it.
    expect(refreshesBeforeLock).toEqual([0])
    expect(refresh.count).toBe(1)
  })
})
