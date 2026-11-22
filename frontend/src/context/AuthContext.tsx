import { useCallback, useState, useEffect, type ReactNode } from 'react'
import i18n from '../i18n'
import { apiFetch, onAccessTokenChange, refreshAccessToken, setAccessToken } from '../api/client'
import { setWebSocketToken } from '../api/ws'
import { AuthContext } from './useAuth'
import { removeStored } from '../utils/storage'

// Relative on purpose — see the comment on API_BASE in api/client.ts.
const API = ''

// Maps backend language_locale values to i18n language codes
const LOCALE_TO_I18N: Record<string, string> = {
  en: 'en',
  ca_ES: 'ca',
}

function applyLanguage(locale: string) {
  i18n.changeLanguage(LOCALE_TO_I18N[locale] ?? 'en')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggedOut, setLoggedOut] = useState(false)
  const [signOutUnconfirmed, setSignOutUnconfirmed] = useState(false)
  const [unreachable, setUnreachable] = useState(false)

  // Single place that keeps React state and the WebSocket in sync with the
  // module-level token — covers explicit login/logout as well as silent
  // refreshes triggered by apiFetch() elsewhere in the app. Any news of the
  // token also settles whether there's a session, so an earlier "couldn't
  // be reached" no longer stands.
  useEffect(() => {
    return onAccessTokenChange((token) => {
      setAccessTokenState(token)
      setWebSocketToken(token)
      setUnreachable(false)
    })
  }, [])

  // The access token is only ever in memory (see api/client.ts), so a page
  // load starts without one: the refresh cookie, if there's a session, gets
  // a new one. Only a refusal means there's no session. With no answer
  // (a dropped connection, a server error) there may well be one, so
  // nothing is decided: `unreachable` says so, and retryStartUp() asks
  // again. Never rejects.
  const signInFromCookie = useCallback(async () => {
    // Earlier versions kept the access token in localStorage; don't leave
    // one behind.
    removeStored('local', 'access_token')
    try {
      let token: string | null
      try {
        token = await refreshAccessToken()
      } catch {
        setUnreachable(true)
        return
      }
      if (!token) return

      // The user's language. Refused (401 once apiFetch's own refresh is
      // refused too, or 403 for an address that isn't verified): sign out.
      // No answer or a server error: stay signed in; the top bar says it
      // couldn't load the profile, and loads it again on every page.
      try {
        const res = await apiFetch(`${API}/api/v1/users/me`)
        if (res.ok) {
          applyLanguage((await res.json()).language_locale)
        } else if (res.status === 401 || res.status === 403) {
          setAccessToken(null)
        }
      } catch {
        // Stay signed in, as above.
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void signInFromCookie()
  }, [signInFromCookie])

  function retryStartUp() {
    setUnreachable(false)
    setLoading(true)
    void signInFromCookie()
  }

  function login(token: string) {
    setLoggedOut(false)
    setSignOutUnconfirmed(false)
    setAccessToken(token)
  }

  async function logout() {
    // Whether the server ended the session. A 401, after apiFetch's
    // refresh, means there was none left to end.
    const ended = await apiFetch(`${API}/api/v1/auth/local/logout`, { method: 'POST' })
      .then((res) => res.ok || res.status === 401, () => false)
    setSignOutUnconfirmed(!ended)
    setLoggedOut(true)
    setAccessToken(null)
  }

  return (
    <AuthContext.Provider
      value={{ accessToken, loading, loggedOut, signOutUnconfirmed, unreachable, login, logout, retryStartUp }}
    >
      {children}
    </AuthContext.Provider>
  )
}
