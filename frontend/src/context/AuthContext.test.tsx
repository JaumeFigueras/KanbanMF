import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import i18n from '../i18n'
import { getAccessToken, refreshAccessToken } from '../api/client'
import { blockSiteData } from '../test/blockSiteData'
import { FakeWebSocket } from '../test/fakeWebSocket'
import { makeUser } from '../test/fixtures'
import { server } from '../test/server'
import { AuthProvider } from './AuthContext'
import { useAuth } from './useAuth'

const REFRESH = '/api/v1/auth/local/refresh'
const ME = '/api/v1/users/me'
const LOGOUT = '/api/v1/auth/local/logout'

// Shows what useAuth() says ("loading, tok-1", "ready, no token", and
// "ready, no token, logged out" after logout()), with a button for each of
// its actions. Whether the last sign-out went unconfirmed, and whether the
// start-up check got no answer, are shown apart.
function AuthProbe() {
  const { accessToken, loading, loggedOut, signOutUnconfirmed, unreachable, login, logout, retryStartUp } = useAuth()
  return (
    <>
      <output>{`${loading ? 'loading' : 'ready'}, ${accessToken ?? 'no token'}${loggedOut ? ', logged out' : ''}`}</output>
      <p data-testid="unconfirmed">{signOutUnconfirmed ? 'sign-out unconfirmed' : ''}</p>
      <p data-testid="unreachable">{unreachable ? 'unreachable' : ''}</p>
      <button onClick={() => login('tok-login')}>Sign in</button>
      <button onClick={() => void logout()}>Sign out</button>
      <button onClick={retryStartUp}>Try again</button>
    </>
  )
}

function renderAuth() {
  render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  )
  return userEvent.setup()
}

function click(user: ReturnType<typeof userEvent.setup>, name: 'Sign in' | 'Sign out' | 'Try again') {
  return user.click(screen.getByRole('button', { name }))
}

function status() {
  return screen.getByRole('status')
}

const unreachable = () => screen.getByTestId('unreachable')

// The start-up check is over once loading has ended.
async function startUpEnds() {
  await waitFor(() => expect(status()).toHaveTextContent(/^ready, /))
}

// The two start-up requests: by default there is a session (the refresh
// cookie gets 'tok-session') and /users/me answers an English-speaking user.
// Returns how often /users/me was asked.
function fakeStartUp({
  refresh = () => HttpResponse.json({ access_token: 'tok-session' }),
  me = () => HttpResponse.json(makeUser()),
}: {
  refresh?: () => Response
  me?: () => Response | Promise<Response>
} = {}) {
  const asked = { me: 0 }
  server.use(
    http.post(REFRESH, refresh),
    http.get(ME, () => {
      asked.me += 1
      return me()
    }),
  )
  return asked
}

const NO_SESSION = () => new HttpResponse(null, { status: 401 })

// The notification socket's first message, once the server accepts it.
function authMessageOf(socket: FakeWebSocket) {
  socket.open()
  return JSON.parse(socket.sent[0])
}

describe('start-up with a session', () => {
  it('stays loading until the check ends, then is signed in with the new token', async () => {
    // /users/me holds its answer until the test releases it.
    let answerMe: () => void = () => {}
    const meAnswered = new Promise<void>((resolve) => (answerMe = resolve))
    const asked = fakeStartUp({
      me: async () => {
        await meAnswered
        return HttpResponse.json(makeUser())
      },
    })
    renderAuth()

    await waitFor(() => expect(asked.me).toBe(1))
    expect(status()).toHaveTextContent(/^loading, /)

    answerMe()
    await waitFor(() => expect(status()).toHaveTextContent('ready, tok-session'))
  })

  it('opens the notification socket with that token', async () => {
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(authMessageOf(FakeWebSocket.instances[0])).toEqual({ type: 'auth', token: 'tok-session' })
  })

  it("applies the user's language", async () => {
    fakeStartUp({ me: () => HttpResponse.json(makeUser({ language_locale: 'ca_ES' })) })
    renderAuth()
    await startUpEnds()
    expect(i18n.language).toBe('ca')
  })

  it("falls back to English for a language the app doesn't have", async () => {
    await i18n.changeLanguage('ca')
    fakeStartUp({ me: () => HttpResponse.json(makeUser({ language_locale: 'fr_FR' })) })
    renderAuth()
    await startUpEnds()
    expect(i18n.language).toBe('en')
  })
})

describe('start-up without a session', () => {
  it('ends signed out, without asking for the user', async () => {
    const asked = fakeStartUp({ refresh: NO_SESSION })
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent('ready, no token')
    expect(asked.me).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})

describe('start-up, other failures', () => {
  it.each([
    // The token refused even after a new one: the session is no good.
    [401],
    // The backend refuses accounts that aren't verified.
    [403],
  ])('signs out when /users/me is refused with a %i', async (refusal) => {
    fakeStartUp({ me: () => new HttpResponse(null, { status: refusal }) })
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent('ready, no token')
    expect(getAccessToken()).toBeNull()
    expect(unreachable()).toBeEmptyDOMElement()
  })

  it.each([
    ['the connection drops', () => HttpResponse.error()],
    ['the server fails', () => new HttpResponse(null, { status: 500 })],
    ['the answer is garbled', () => new HttpResponse('<html>', { status: 200, headers: { 'Content-Type': 'application/json' } })],
  ])('stays signed in when %s on /users/me, without applying a language (6N)', async (_case, me) => {
    await i18n.changeLanguage('ca')
    fakeStartUp({ me })
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent(/^ready, tok-session$/)
    expect(getAccessToken()).toBe('tok-session')
    expect(i18n.language).toBe('ca')
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(unreachable()).toBeEmptyDOMElement()
  })
})

describe("start-up when the refresh gets no answer (6N)", () => {
  it.each([
    ['the connection drops', () => HttpResponse.error()],
    ['the server fails', () => new HttpResponse(null, { status: 500 })],
    ["the proxy can't reach the backend", () => new HttpResponse(null, { status: 502 })],
  ])('says it was unreachable when %s, deciding nothing about the session', async (_case, refresh) => {
    const asked = fakeStartUp({ refresh })
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent(/^ready, no token$/)
    expect(unreachable()).toHaveTextContent('unreachable')
    expect(asked.me).toBe(0)
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('asks again on Try again, loading meanwhile, and is signed in once it gets an answer', async () => {
    // The second refresh holds its answer until the test releases it.
    let refreshes = 0
    let answer: () => void = () => {}
    server.use(
      http.post(REFRESH, async () => {
        refreshes += 1
        if (refreshes === 1) return HttpResponse.error()
        await new Promise<void>((resolve) => (answer = resolve))
        return HttpResponse.json({ access_token: 'tok-session' })
      }),
      http.get(ME, () => HttpResponse.json(makeUser({ language_locale: 'ca_ES' }))),
    )
    const user = renderAuth()
    await startUpEnds()

    await click(user, 'Try again')

    await waitFor(() => expect(refreshes).toBe(2))
    expect(status()).toHaveTextContent(/^loading, /)
    expect(unreachable()).toBeEmptyDOMElement()
    answer()
    await waitFor(() => expect(status()).toHaveTextContent(/^ready, tok-session$/))
    expect(i18n.language).toBe('ca')
  })

  it('ends signed out, and no longer unreachable, when Try again finds no session', async () => {
    let refresh = () => HttpResponse.error() as Response
    server.use(http.post(REFRESH, () => refresh()))
    const user = renderAuth()
    await startUpEnds()
    refresh = NO_SESSION

    await click(user, 'Try again')

    await waitFor(() => expect(status()).toHaveTextContent(/^ready, no token$/))
    expect(unreachable()).toBeEmptyDOMElement()
  })

  it('says it again when Try again gets no answer either', async () => {
    let refreshes = 0
    server.use(http.post(REFRESH, () => {
      refreshes += 1
      return HttpResponse.error()
    }))
    const user = renderAuth()
    await startUpEnds()

    await click(user, 'Try again')

    await waitFor(() => expect(refreshes).toBe(2))
    await startUpEnds()
    expect(unreachable()).toHaveTextContent('unreachable')
  })

  it('is no longer unreachable once signed in some other way', async () => {
    // The sign-in page works while the start-up check couldn't: the
    // sign-in, and then signing out, settle it.
    fakeStartUp({ refresh: () => HttpResponse.error() })
    server.use(http.post(LOGOUT, () => new HttpResponse(null, { status: 204 })))
    const user = renderAuth()
    await startUpEnds()

    await click(user, 'Sign in')
    expect(unreachable()).toBeEmptyDOMElement()
    await click(user, 'Sign out')

    await waitFor(() => expect(status()).toHaveTextContent(/^ready, no token, logged out$/))
    expect(unreachable()).toBeEmptyDOMElement()
  })
})

describe('start-up, the legacy token', () => {
  it('removes an access token an earlier version left in localStorage', async () => {
    localStorage.setItem('access_token', 'left-by-an-old-version')
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('still signs in when the browser blocks site data', async () => {
    blockSiteData()
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent(/^ready, tok-session$/)
  })
})

describe('login', () => {
  it('signs in with the token, and opens the socket with it', async () => {
    fakeStartUp({ refresh: NO_SESSION })
    const user = renderAuth()
    await startUpEnds()

    await click(user, 'Sign in')

    expect(status()).toHaveTextContent('ready, tok-login')
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(authMessageOf(FakeWebSocket.instances[0])).toEqual({ type: 'auth', token: 'tok-login' })
  })
})

describe('logout', () => {
  it('tells the backend with the token, then signs out and closes the socket', async () => {
    const sentWith: (string | null)[] = []
    fakeStartUp()
    server.use(
      http.post(LOGOUT, ({ request }) => {
        sentWith.push(request.headers.get('Authorization'))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = renderAuth()
    await startUpEnds()
    const socket = FakeWebSocket.instances[0]
    socket.open()

    await click(user, 'Sign out')

    await waitFor(() => expect(status()).toHaveTextContent('ready, no token'))
    expect(sentWith).toEqual(['Bearer tok-session'])
    await waitFor(() => expect(socket.readyState).toBe(FakeWebSocket.CLOSED))
    expect(screen.getByTestId('unconfirmed')).toBeEmptyDOMElement()
  })

  it.each([
    ['the connection drops', () => HttpResponse.error()],
    ['the server fails', () => HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })],
  ])('still signs out on this page when %s, marking the sign-out unconfirmed until the next login (6H)', async (_case, answer) => {
    fakeStartUp()
    server.use(http.post(LOGOUT, answer))
    const user = renderAuth()
    await startUpEnds()
    const socket = FakeWebSocket.instances[0]
    socket.open()

    await click(user, 'Sign out')

    await waitFor(() => expect(status()).toHaveTextContent(/^ready, no token, logged out$/))
    expect(screen.getByTestId('unconfirmed')).toHaveTextContent('sign-out unconfirmed')
    await waitFor(() => expect(socket.readyState).toBe(FakeWebSocket.CLOSED))
    await click(user, 'Sign in')
    expect(screen.getByTestId('unconfirmed')).toBeEmptyDOMElement()
  })

  it('counts a session that was already gone as ended', async () => {
    // The token is refused, and the refresh too: there's no session left.
    fakeStartUp()
    server.use(http.post(LOGOUT, NO_SESSION))
    const user = renderAuth()
    await startUpEnds()
    server.use(http.post(REFRESH, NO_SESSION))

    await click(user, 'Sign out')

    await waitFor(() => expect(status()).toHaveTextContent(/^ready, no token, logged out$/))
    expect(screen.getByTestId('unconfirmed')).toBeEmptyDOMElement()
  })

  it('marks the sign-out as deliberate, until the next login', async () => {
    // So ProtectedRoute doesn't take it for an expired session and remember
    // the page for the next sign-in.
    fakeStartUp()
    server.use(http.post(LOGOUT, () => new HttpResponse(null, { status: 204 })))
    const user = renderAuth()
    await startUpEnds()

    await click(user, 'Sign out')
    await waitFor(() => expect(status()).toHaveTextContent(/^ready, no token, logged out$/))

    await click(user, 'Sign in')
    expect(status()).toHaveTextContent(/^ready, tok-login$/)
  })
})

describe('a refresh made elsewhere (by apiFetch)', () => {
  it('passes the new token to the context', async () => {
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    server.use(http.post(REFRESH, () => HttpResponse.json({ access_token: 'tok-refreshed' })))

    await act(() => refreshAccessToken())

    expect(status()).toHaveTextContent('ready, tok-refreshed')
  })

  it('signs out when it is refused, but not as a logout', async () => {
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    server.use(http.post(REFRESH, NO_SESSION))

    await act(() => refreshAccessToken())

    expect(status()).toHaveTextContent(/^ready, no token$/)
  })

  it('stays signed in, with the socket open, when it gets no answer (6N)', async () => {
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    server.use(http.post(REFRESH, () => HttpResponse.error()))

    await act(() => refreshAccessToken().catch(() => null))

    expect(status()).toHaveTextContent(/^ready, tok-session$/)
    expect(unreachable()).toBeEmptyDOMElement()
    expect(socket.readyState).toBe(FakeWebSocket.OPEN)
  })
})

describe('useAuth outside its provider', () => {
  it('says loading with no token, not logged out, and its actions do nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      render(<AuthProbe />)
      const user = userEvent.setup()
      await click(user, 'Sign in')
      await click(user, 'Sign out')
      await click(user, 'Try again')
      expect(status()).toHaveTextContent(/^loading, no token$/)
      expect(screen.getByTestId('unconfirmed')).toBeEmptyDOMElement()
      expect(unreachable()).toBeEmptyDOMElement()
      expect(getAccessToken()).toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
