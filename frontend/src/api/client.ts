const API_BASE = 'http://localhost:8000'

type TokenListener = (token: string | null) => void

let currentAccessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null
const listeners = new Set<TokenListener>()

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

// Rotates the refresh-token cookie for a new access token. Concurrent 401s
// share a single in-flight refresh instead of each racing their own.
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/v1/auth/local/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
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
