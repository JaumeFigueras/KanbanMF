// Relative on purpose: the app is always served from the same origin as the
// API (directly in dev via Vite's /api proxy in vite.config.ts, and via the
// reverse proxy in front of both in production) — see SETUP.md. That keeps
// this same-origin (no CORS) and means the API never needs its own public
// hostname or port.
const API_BASE = ''
const CLIENT_ID_KEY = 'kanbanmf.client_id'

type TokenListener = (token: string | null) => void

let currentAccessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null
const listeners = new Set<TokenListener>()

// Identifies this browser tab so WebSocket notifications can be told apart
// from a mutation the same tab just made itself. sessionStorage (not
// localStorage) is deliberate: each tab/window gets its own id, so two tabs
// open on the same computer still count as distinct origins.
let cachedClientId: string | null = null

export function getClientId(): string {
  if (cachedClientId) return cachedClientId
  let id = sessionStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_ID_KEY, id)
  }
  cachedClientId = id
  return id
}

export function getAccessToken(): string | null {
  return currentAccessToken
}

export function setAccessToken(token: string | null) {
  currentAccessToken = token
  listeners.forEach((listener) => listener(token))
}

export function onAccessTokenChange(listener: TokenListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The refresh cookie is shared by every tab, and each refresh rotates it:
// two tabs refreshing at once would both send the same cookie, and the one
// that lost the race would be signed out. A Web Lock makes the tabs take
// turns, so the second one sends the cookie the first one just got. (Where
// the browser has no Web Locks, the refresh simply runs unguarded.)
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return task()
  return navigator.locks.request('kanbanmf.refresh', task)
}

// Rotates the refresh-token cookie for a new access token. Concurrent 401s
// share a single in-flight refresh instead of each racing their own.
//
// The access token lives only in this module's memory, never in
// localStorage: a script injected into the page can't read it back later,
// and it isn't left on disk when the browser closes. Each page load gets a
// fresh one through this refresh.
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const r = await withRefreshLock(() =>
          fetch(`${API_BASE}/api/v1/auth/local/refresh`, {
            method: 'POST',
            credentials: 'include',
          }),
        )
        if (!r.ok) {
          setAccessToken(null)
          return null
        }
        const { access_token } = await r.json()
        setAccessToken(access_token)
        return access_token as string
      } catch {
        setAccessToken(null)
        return null
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-Client-Id', getClientId())
  return { ...init, credentials: 'include', headers }
}

// Authenticated fetch: attaches the current access token and, on a 401
// (missing, invalid, or expired token), transparently refreshes it once via
// the cookie-based refresh token and retries the request — callers never
// need to think about token expiry themselves.
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let response = await fetch(url, withAuth(init, currentAccessToken))
  if (response.status === 401) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      response = await fetch(url, withAuth(init, newToken))
    }
  }
  return response
}
