import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTheme } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import App from './App'
import { onAccessTokenChange, refreshAccessToken } from './api/client'
import { ThemeToggleProvider } from './context/ThemeToggleContext'
import { useAuth } from './context/useAuth'
import { makeUser } from './test/fixtures'
import { server } from './test/server'
import { peekReturnTo, rememberReturnTo } from './utils/returnTo'

// The real App — its route table, guards, AuthProvider and theme — with
// every page swapped for a placeholder, so these tests are about where each
// address leads, not about the pages (and none of their requests).
vi.mock('./pages/Boards', () => ({ default: () => <PagePlaceholder name="Boards" /> }))
vi.mock('./pages/Board', () => ({ default: () => <PagePlaceholder name="Board" /> }))
vi.mock('./pages/TimeTracker', () => ({ default: () => <PagePlaceholder name="TimeTracker" /> }))
vi.mock('./pages/OverdueTasks', () => ({ default: () => <PagePlaceholder name="OverdueTasks" /> }))
vi.mock('./pages/SearchResults', () => ({ default: () => <PagePlaceholder name="SearchResults" /> }))
vi.mock('./pages/OAuthConsent', () => ({ default: () => <PagePlaceholder name="OAuthConsent" /> }))
vi.mock('./pages/SignIn', () => ({ default: () => <PagePlaceholder name="SignIn" /> }))
vi.mock('./pages/SignUp', () => ({ default: () => <PagePlaceholder name="SignUp" /> }))
vi.mock('./pages/VerifyEmail', () => ({ default: () => <PagePlaceholder name="VerifyEmail" /> }))

// A page's name, whether the session check has ended and how, and the
// theme. The sign-in page has a button that signs in, as the real one does
// once the password is accepted (PublicRoute then does the redirect); every
// other page has one that signs out the way MainAppBar does.
function PagePlaceholder({ name }: { name: string }) {
  const { accessToken, loading, login, logout } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()
  return (
    <main>
      <h1>{name}</h1>
      <p>{loading ? 'checking' : accessToken ? 'signed in' : 'signed out'}</p>
      <p>{`${theme.palette.mode} theme`}</p>
      {name === 'SignIn' ? (
        <button onClick={() => login('tok-signed-in')}>Sign in</button>
      ) : (
        <button
          onClick={async () => {
            await logout()
            navigate('/signin')
          }}
        >
          Sign out
        </button>
      )}
    </main>
  )
}

const REFRESH = '/api/v1/auth/local/refresh'
const ME = '/api/v1/users/me'
const LOGOUT = '/api/v1/auth/local/logout'

// The pages that need a session, at an address of each. Two carry a query
// that the page needs, to check it survives the trip through /signin.
const PROTECTED: [address: string, page: string][] = [
  ['/boards', 'Boards'],
  ['/boards/board-7', 'Board'],
  ['/time-tracker', 'TimeTracker'],
  ['/overdue', 'OverdueTasks'],
  ['/search?q=invoice', 'SearchResults'],
  ['/oauth/consent?request=abc', 'OAuthConsent'],
]

const PUBLIC: [address: string, page: string][] = [
  ['/signin', 'SignIn'],
  ['/signup', 'SignUp'],
]

// Opens the app at an address, as typing it in the browser would.
function renderApp(startAddress: string) {
  window.history.replaceState(null, '', startAddress)
  render(
    <ThemeToggleProvider>
      <App />
    </ThemeToggleProvider>,
  )
  return userEvent.setup()
}

function address() {
  return window.location.pathname + window.location.search
}

async function arrivesAt(expected: string) {
  await waitFor(() => expect(address()).toBe(expected))
}

async function showsPage(name: string) {
  expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
}

// A session: the refresh cookie gets a token, and /users/me answers.
function fakeSession() {
  server.use(
    http.post(REFRESH, () => HttpResponse.json({ access_token: 'tok-session' })),
    http.get(ME, () => HttpResponse.json(makeUser())),
  )
}

const NO_SESSION = () => new HttpResponse(null, { status: 401 })

function fakeNoSession() {
  server.use(http.post(REFRESH, NO_SESSION))
}

// A refresh that holds its answer until the test gives it one, to look at
// the app while the start-up check is still running.
function heldRefresh() {
  let release: (response: Response) => void = () => {}
  const answered = new Promise<Response>((resolve) => (release = resolve))
  const asked = { count: 0 }
  let given = false
  function answer(response: Response) {
    given = true
    release(response)
  }
  server.use(
    http.post(REFRESH, () => {
      asked.count += 1
      return answered
    }),
    http.get(ME, () => HttpResponse.json(makeUser())),
  )
  // If the test fails before answering, answer for it, and wait until the
  // refresh is over: client.ts shares one refresh at a time, so a refresh
  // left waiting would hold up the start-up of the tests after it.
  onTestFinished(async () => {
    if (given || asked.count === 0) return
    const over = new Promise<void>((resolve) => {
      const stop = onAccessTokenChange(() => {
        stop()
        resolve()
      })
    })
    answer(NO_SESSION())
    await over
  })
  return { asked, answer }
}

describe('during the start-up check', () => {
  it('a protected page shows a spinner, and stays, until the session is found', async () => {
    const refresh = heldRefresh()
    renderApp('/boards/board-7')
    await waitFor(() => expect(refresh.asked.count).toBe(1))

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(address()).toBe('/boards/board-7')

    refresh.answer(HttpResponse.json({ access_token: 'tok-session' }))
    await showsPage('Board')
    expect(address()).toBe('/boards/board-7')
  })

  it('the sign-in page shows nothing until the check finds no session', async () => {
    const refresh = heldRefresh()
    renderApp('/signin')
    await waitFor(() => expect(refresh.asked.count).toBe(1))

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(address()).toBe('/signin')

    refresh.answer(NO_SESSION())
    await showsPage('SignIn')
  })

  it('/ waits for the check before sending anyone anywhere', async () => {
    const refresh = heldRefresh()
    renderApp('/')
    await waitFor(() => expect(refresh.asked.count).toBe(1))

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(address()).toBe('/')

    refresh.answer(HttpResponse.json({ access_token: 'tok-session' }))
    await arrivesAt('/boards')
  })
})

describe('the protected pages', () => {
  it.each(PROTECTED)('%s shows %s when signed in', async (start, page) => {
    fakeSession()
    renderApp(start)
    await showsPage(page)
    expect(address()).toBe(start)
  })

  it.each(PROTECTED)('%s sends you to /signin when signed out, remembering the address', async (start) => {
    fakeNoSession()
    renderApp(start)
    await arrivesAt('/signin')
    await showsPage('SignIn')
    expect(peekReturnTo()).toBe(start)
  })

  it('send you back after signing in, and then forget the address', async () => {
    // This is how Claude's connection request survives the sign-in: the
    // consent page needs its ?request=.
    fakeNoSession()
    const user = renderApp('/oauth/consent?request=abc')
    await showsPage('SignIn')

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await arrivesAt('/oauth/consent?request=abc')
    await showsPage('OAuthConsent')
    expect(peekReturnTo()).toBeNull()
  })
})

describe('the public pages', () => {
  it.each(PUBLIC)('%s shows %s when signed out', async (start, page) => {
    fakeNoSession()
    renderApp(start)
    await showsPage(page)
    expect(address()).toBe(start)
  })

  it.each(PUBLIC)('%s sends you to /boards when signed in', async (start) => {
    fakeSession()
    renderApp(start)
    await arrivesAt('/boards')
    await showsPage('Boards')
  })

  it('send you to the remembered page instead, when there is one', async () => {
    rememberReturnTo('/boards/board-7')
    fakeSession()
    renderApp('/signin')
    await arrivesAt('/boards/board-7')
    await showsPage('Board')
  })
})

describe('/ and unknown addresses', () => {
  it.each(['/', '/no-such-page'])('%s sends you to /boards when signed in', async (start) => {
    fakeSession()
    renderApp(start)
    await arrivesAt('/boards')
    await showsPage('Boards')
  })

  it.each(['/', '/no-such-page'])('%s sends you to /signin when signed out', async (start) => {
    fakeNoSession()
    renderApp(start)
    await arrivesAt('/signin')
    await showsPage('SignIn')
  })

  it('/ sends you to the remembered page, when there is one and a session', async () => {
    // The way back from Google sign-in, which returns to /.
    rememberReturnTo('/oauth/consent?request=abc')
    fakeSession()
    renderApp('/')
    await arrivesAt('/oauth/consent?request=abc')
    await showsPage('OAuthConsent')
  })
})

describe('/verify-email', () => {
  it.each([
    ['signed in', fakeSession],
    ['signed out', fakeNoSession],
  ])('opens when %s', async (state, fake) => {
    fake()
    renderApp('/verify-email?token=abc')
    expect(await screen.findByText(state)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'VerifyEmail' })).toBeInTheDocument()
    expect(address()).toBe('/verify-email?token=abc')
  })
})

describe('when the session ends', () => {
  it('on its own (the refresh fails), sends you to /signin and back after signing in', async () => {
    fakeSession()
    const user = renderApp('/boards/board-7')
    await showsPage('Board')
    server.use(http.post(REFRESH, NO_SESSION))

    await act(() => refreshAccessToken())

    await arrivesAt('/signin')
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    await arrivesAt('/boards/board-7')
  })

  it('by signing out, sends the next sign-in to /boards, not back to that page', async () => {
    // The next person to sign in on this tab mustn't land on your board.
    fakeSession()
    server.use(http.post(LOGOUT, () => new HttpResponse(null, { status: 204 })))
    const user = renderApp('/boards/board-7')
    await showsPage('Board')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await arrivesAt('/signin')
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    await arrivesAt('/boards')
  })

  it('on its own after signing out and back in, remembers the page again', async () => {
    fakeSession()
    server.use(http.post(LOGOUT, () => new HttpResponse(null, { status: 204 })))
    const user = renderApp('/boards')
    await showsPage('Boards')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))
    await showsPage('Boards')
    server.use(http.post(REFRESH, NO_SESSION))

    await act(() => refreshAccessToken())

    await arrivesAt('/signin')
    expect(peekReturnTo()).toBe('/boards')
  })
})

describe('the theme', () => {
  it.each(['light', 'dark'])('is %s when that is the saved choice', async (mode) => {
    localStorage.setItem('theme', mode)
    fakeSession()
    renderApp('/boards')
    expect(await screen.findByText(`${mode} theme`)).toBeInTheDocument()
  })
})
