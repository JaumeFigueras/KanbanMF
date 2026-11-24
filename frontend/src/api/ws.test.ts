import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { server } from '../test/server'
import { getClientId, onAccessTokenChange, setAccessToken } from './client'
import {
  isOwnNotification,
  setWebSocketToken,
  subscribeToNotifications,
  subscribeToReconnects,
  type BoardNotification,
} from './ws'

// Vitest's jsdom environment exposes the JSDOM instance as a global.
declare const jsdom: { reconfigure(options: { url: string }): void }

const WS_URL = 'ws://localhost:5173/api/v1/ws'
const RECONNECT_MS = 3000

function sockets(): FakeWebSocket[] {
  return FakeWebSocket.instances
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

// The messages a socket sent, parsed.
function sentBy(socket: FakeWebSocket): unknown[] {
  return socket.sent.map((data) => JSON.parse(data))
}

function notification(overrides: Partial<BoardNotification> = {}): BoardNotification {
  return { type: 'card_updated', board_id: 'board-1', list_id: 'list-1', origin_client_id: null, ...overrides }
}

// The refresh endpoint, counting how often it was asked.
function fakeRefresh(answer: () => Response | Promise<Response> = () => HttpResponse.json({ access_token: 'new' })) {
  const calls = { count: 0 }
  server.use(
    http.post('/api/v1/auth/local/refresh', () => {
      calls.count += 1
      return answer()
    }),
  )
  return calls
}

// setup.ts signs the socket out and puts real timers back after each test.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

describe('connecting', () => {
  it('opens one socket at /api/v1/ws, without the token in the address', () => {
    setWebSocketToken('tok-1')
    expect(sockets().map((s) => s.url)).toEqual([WS_URL])
  })

  it('authenticates with the token as its first message', () => {
    setWebSocketToken('tok-1')
    lastSocket().open()
    expect(sentBy(lastSocket())).toEqual([{ type: 'auth', token: 'tok-1' }])
  })

  it('uses wss:// on an https page', () => {
    jsdom.reconfigure({ url: 'https://kanban.example/boards' })
    try {
      setWebSocketToken('tok-1')
    } finally {
      jsdom.reconfigure({ url: 'http://localhost:5173/' })
    }
    expect(lastSocket().url).toBe('wss://kanban.example/api/v1/ws')
  })

  it('keeps the open socket when the token is refreshed', () => {
    setWebSocketToken('tok-1')
    lastSocket().open()
    setWebSocketToken('tok-2')
    expect(sockets()).toHaveLength(1)
  })
})

describe('notifications', () => {
  it('reach every subscriber, until they unsubscribe', () => {
    const first: BoardNotification[] = []
    const second: BoardNotification[] = []
    const unsubscribeFirst = subscribeToNotifications((n) => first.push(n))
    const unsubscribeSecond = subscribeToNotifications((n) => second.push(n))
    setWebSocketToken('tok-1')
    lastSocket().open()

    lastSocket().receive(notification({ type: 'card_created' }))
    unsubscribeFirst()
    lastSocket().receive(notification({ type: 'card_moved' }))
    unsubscribeSecond()

    expect(first.map((n) => n.type)).toEqual(['card_created'])
    expect(second.map((n) => n.type)).toEqual(['card_created', 'card_moved'])
  })

  it('skip a malformed message and keep coming', () => {
    const heard: BoardNotification[] = []
    const unsubscribe = subscribeToNotifications((n) => heard.push(n))
    setWebSocketToken('tok-1')
    lastSocket().open()

    lastSocket().onmessage?.(new MessageEvent('message', { data: 'not json' }))
    lastSocket().receive(notification())
    unsubscribe()

    expect(heard).toEqual([notification()])
  })
})

describe('signing out', () => {
  it('closes the socket, which then stays closed', async () => {
    setWebSocketToken('tok-1')
    lastSocket().open()
    setWebSocketToken(null)
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2)
    expect(sockets()).toHaveLength(1)
    expect(lastSocket().readyState).toBe(FakeWebSocket.CLOSED)
  })
})

describe('when the connection drops', () => {
  it('reconnects after 3 s, not before, with the current token', async () => {
    setWebSocketToken('tok-1')
    lastSocket().open()
    setWebSocketToken('tok-2')
    lastSocket().serverClose()

    await vi.advanceTimersByTimeAsync(RECONNECT_MS - 1)
    expect(sockets()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(2)

    lastSocket().open()
    expect(sentBy(lastSocket())).toEqual([{ type: 'auth', token: 'tok-2' }])
  })

  it('does not reconnect after a sign-out during the wait', async () => {
    setWebSocketToken('tok-1')
    lastSocket().open()
    lastSocket().serverClose()
    await vi.advanceTimersByTimeAsync(1000)
    setWebSocketToken(null)
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2)
    expect(sockets()).toHaveLength(1)
  })
})

describe('when the backend refuses the token (1008)', () => {
  it('asks for a new token after 3 s instead of reconnecting', async () => {
    const refresh = fakeRefresh()
    setWebSocketToken('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)

    await vi.advanceTimersByTimeAsync(RECONNECT_MS - 1)
    expect(refresh.count).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(refresh.count).toBe(1))
    expect(sockets()).toHaveLength(1)
  })

  it('asks for nothing after a sign-out during the wait', async () => {
    // A refresh after signing out could sign the user back in, if the
    // logout request failed and left the refresh cookie valid.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      setWebSocketToken('tok-1')
      lastSocket().open()
      lastSocket().serverClose(1008)
      await vi.advanceTimersByTimeAsync(1000)
      setWebSocketToken(null)
      await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('stays closed, and the session ends, when the refresh fails', async () => {
    fakeRefresh(() => new HttpResponse(null, { status: 401 }))
    const heard: (string | null)[] = []
    const unsubscribe = onAccessTokenChange((token) => heard.push(token))
    setWebSocketToken('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)

    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(heard).toEqual([null]))
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2)
    unsubscribe()
    expect(sockets()).toHaveLength(1)
  })

  // Signed in as AuthContext does it: the client holds the token, and every
  // new token goes to the socket. Returns the unsubscribe.
  function signedIn(token: string) {
    const unsubscribe = onAccessTokenChange(setWebSocketToken)
    setAccessToken(token)
    return unsubscribe
  }

  it('asks again every 3 s while the refresh gets no answer, then reconnects with the new token (6N)', async () => {
    let unanswered = 2
    const refresh = fakeRefresh(() => {
      if (unanswered === 0) return HttpResponse.json({ access_token: 'new' })
      unanswered -= 1
      return HttpResponse.error()
    })
    const unsubscribe = signedIn('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)

    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(refresh.count).toBe(1))
    // Not at once: half the delay later (vi.waitFor moves the clock a
    // little too), it hasn't asked again.
    await vi.advanceTimersByTimeAsync(RECONNECT_MS / 2)
    expect(refresh.count).toBe(1)
    await vi.advanceTimersByTimeAsync(RECONNECT_MS / 2)
    await vi.waitFor(() => expect(refresh.count).toBe(2))
    expect(sockets()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(sockets()).toHaveLength(2))
    unsubscribe()

    expect(refresh.count).toBe(3)
    lastSocket().open()
    expect(sentBy(lastSocket())).toEqual([{ type: 'auth', token: 'new' }])
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 3)
    expect(refresh.count).toBe(3)
  })

  // A refresh that gets no answer, but only once `answer()` is called: what
  // happens while it's under way can then be tested.
  function heldUnansweredRefresh() {
    let answer: () => void = () => {}
    const refresh = fakeRefresh(async () => {
      await new Promise<void>((resolve) => (answer = resolve))
      return HttpResponse.error()
    })
    return { refresh, answer: () => answer() }
  }

  it.each([
    ['after it', false],
    ['while it is under way', true],
  ])('stops asking once signed out %s, when the refresh gets no answer (6N)', async (_case, underWay) => {
    const { refresh, answer } = heldUnansweredRefresh()
    const unsubscribe = signedIn('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)
    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(refresh.count).toBe(1))

    if (!underWay) answer()
    await vi.advanceTimersByTimeAsync(0)
    setAccessToken(null)
    if (underWay) answer()
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 3)
    unsubscribe()

    expect(refresh.count).toBe(1)
    expect(sockets()).toHaveLength(1)
  })

  it.each([
    ['after it', false],
    ['while it is under way', true],
  ])('stops asking once a new token got elsewhere %s has reconnected the socket (6N)', async (_case, underWay) => {
    const { refresh, answer } = heldUnansweredRefresh()
    const unsubscribe = signedIn('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)
    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(refresh.count).toBe(1))

    if (!underWay) answer()
    await vi.advanceTimersByTimeAsync(0)
    // A page's request refreshed the token meanwhile, as apiFetch does.
    setAccessToken('tok-2')
    if (underWay) answer()
    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 3)
    unsubscribe()

    expect(refresh.count).toBe(1)
    expect(sockets()).toHaveLength(2)
    lastSocket().open()
    expect(sentBy(lastSocket())).toEqual([{ type: 'auth', token: 'tok-2' }])
  })

  it('reconnects with the new token when the refresh succeeds', async () => {
    fakeRefresh()
    // What AuthContext does: every new token goes to the socket.
    const unsubscribe = onAccessTokenChange(setWebSocketToken)
    setWebSocketToken('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)

    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(sockets()).toHaveLength(2))
    unsubscribe()
    lastSocket().open()
    expect(sentBy(lastSocket())).toEqual([{ type: 'auth', token: 'new' }])
  })
})

describe('a close event that arrives late', () => {
  it('leaves a single socket after a sign-out and a quick sign-in', async () => {
    setWebSocketToken('tok-1')
    const old = lastSocket()
    old.open()
    // Signing out starts closing the old socket; signing in again opens a
    // new one before the old one's close event has arrived.
    setWebSocketToken(null)
    setWebSocketToken('tok-2')
    const current = lastSocket()
    current.open()

    await vi.advanceTimersByTimeAsync(RECONNECT_MS * 2)
    expect(old.readyState).toBe(FakeWebSocket.CLOSED)
    expect(sockets()).toEqual([old, current])

    // And signing out closes the socket that is actually open.
    setWebSocketToken(null)
    expect(current.readyState).toBe(FakeWebSocket.CLOSING)
  })
})

describe('reconnecting (7C)', () => {
  // The notifications sent while there was no socket are lost: the pages are
  // told, to fetch again what they show.
  it('tells every subscriber once the new socket opens, until they unsubscribe', async () => {
    const reconnected = vi.fn()
    const unsubscribe = subscribeToReconnects(reconnected)
    setWebSocketToken('tok-1')
    // The first connection: the pages fetched what they show as they opened.
    lastSocket().open()
    expect(reconnected).not.toHaveBeenCalled()

    lastSocket().serverClose()
    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    expect(sockets()).toHaveLength(2)
    expect(reconnected).not.toHaveBeenCalled()
    lastSocket().open()
    expect(reconnected).toHaveBeenCalledTimes(1)

    unsubscribe()
    lastSocket().serverClose()
    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    lastSocket().open()
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  it('tells them when a refused token has been replaced', async () => {
    fakeRefresh()
    const reconnected = vi.fn()
    const unsubscribe = subscribeToReconnects(reconnected)
    const stopFollowing = onAccessTokenChange(setWebSocketToken)
    setAccessToken('tok-1')
    lastSocket().open()
    lastSocket().serverClose(1008)

    await vi.advanceTimersByTimeAsync(RECONNECT_MS)
    await vi.waitFor(() => expect(sockets()).toHaveLength(2))
    lastSocket().open()
    stopFollowing()
    unsubscribe()
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  it('tells them nothing on the first connection after signing in again', () => {
    const reconnected = vi.fn()
    const unsubscribe = subscribeToReconnects(reconnected)
    setWebSocketToken('tok-1')
    lastSocket().open()
    setWebSocketToken(null)
    setWebSocketToken('tok-2')
    lastSocket().open()
    unsubscribe()
    expect(reconnected).not.toHaveBeenCalled()
  })
})

describe('isOwnNotification', () => {
  it('is true for a change this page made', () => {
    expect(isOwnNotification(notification({ origin_client_id: getClientId() }))).toBe(true)
  })

  it("is false for another tab's change, or one with no origin", () => {
    expect(isOwnNotification(notification({ origin_client_id: 'another-tab' }))).toBe(false)
    expect(isOwnNotification(notification({ origin_client_id: null }))).toBe(false)
  })
})
