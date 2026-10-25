import { useState, useEffect, type ReactNode } from 'react'
import i18n from '../i18n'
import { apiFetch, onAccessTokenChange, refreshAccessToken, setAccessToken } from '../api/client'
import { setWebSocketToken } from '../api/ws'
import { AuthContext } from './useAuth'

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

  // Single place that keeps React state and the WebSocket in sync with the
  // module-level token — covers explicit login/logout as well as silent
  // refreshes triggered by apiFetch() elsewhere in the app.
  useEffect(() => {
    return onAccessTokenChange((token) => {
      setAccessTokenState(token)
      setWebSocketToken(token)
    })
  }, [])

  useEffect(() => {
    async function signInFromCookie() {
      // Earlier versions kept the access token in localStorage; don't leave
      // one behind.
      try {
        localStorage.removeItem('access_token')
      } catch {
        // storage blocked: nothing to remove
      }

      // The access token is only ever in memory (see api/client.ts), so a
      // page load starts without one: the refresh cookie, if there's a
      // session, gets a new one.
      if (!(await refreshAccessToken())) return

      const res = await apiFetch(`${API}/api/v1/users/me`)
      if (res.ok) {
        const data = await res.json()
        applyLanguage(data.language_locale)
        return
      }

      setAccessToken(null)
    }

    signInFromCookie()
      .catch(() => setAccessToken(null))
      .finally(() => setLoading(false))
  }, [])

  function login(token: string) {
    setAccessToken(token)
  }

  async function logout() {
    try {
      await apiFetch(`${API}/api/v1/auth/local/logout`, { method: 'POST' })
    } finally {
      setAccessToken(null)
    }
  }

  return (
    <AuthContext.Provider value={{ accessToken, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
