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
// its actions. Whether the last sign-out went unconfirmed is shown apart.
function AuthProbe() {
  const { accessToken, loading, loggedOut, signOutUnconfirmed, login, logout } = useAuth()
  return (
    <>
      <output>{`${loading ? 'loading' : 'ready'}, ${accessToken ?? 'no token'}${loggedOut ? ', logged out' : ''}`}</output>
      <p data-testid="unconfirmed">{signOutUnconfirmed ? 'sign-out unconfirmed' : ''}</p>
      <button onClick={() => login('tok-login')}>Sign in</button>
      <button onClick={() => void logout()}>Sign out</button>
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

function click(user: ReturnType<typeof userEvent.setup>, name: 'Sign in' | 'Sign out') {
  return user.click(screen.getByRole('button', { name }))
}

function status() {
  return screen.getByRole('status')
}

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
  it('signs out when /users/me is refused', async () => {
    // A 403, say: the backend refuses accounts that aren't verified.
    fakeStartUp({ me: () => new HttpResponse(null, { status: 403 }) })
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent('ready, no token')
    expect(getAccessToken()).toBeNull()
  })

  it('signs out, and stops loading, when the network fails', async () => {
    fakeStartUp({ me: () => HttpResponse.error() })
    renderAuth()
    await startUpEnds()
    expect(status()).toHaveTextContent('ready, no token')
    expect(getAccessToken()).toBeNull()
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

  it('signs out when it fails, but not as a logout', async () => {
    fakeStartUp()
    renderAuth()
    await startUpEnds()
    server.use(http.post(REFRESH, NO_SESSION))

    await act(() => refreshAccessToken())

    expect(status()).toHaveTextContent(/^ready, no token$/)
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
      expect(status()).toHaveTextContent(/^loading, no token$/)
      expect(screen.getByTestId('unconfirmed')).toBeEmptyDOMElement()
      expect(getAccessToken()).toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
