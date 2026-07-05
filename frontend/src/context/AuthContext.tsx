import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import i18n from '../i18n'
import { apiFetch, onAccessTokenChange, setAccessToken } from '../api/client'
import { setWebSocketToken } from '../api/ws'

const API = 'http://localhost:8000'

// Maps backend language_locale values to i18n language codes
const LOCALE_TO_I18N: Record<string, string> = {
  en: 'en',
  ca_ES: 'ca',
}

function applyLanguage(locale: string) {
  i18n.changeLanguage(LOCALE_TO_I18N[locale] ?? 'en')
}

interface AuthCtx {
  accessToken: string | null
  loading: boolean
  login: (token: string) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  accessToken: null,
  loading: true,
  login: () => {},
  logout: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Single place that keeps React state and localStorage in sync with the
  // module-level token — covers explicit login/logout as well as silent
  // refreshes triggered by apiFetch() elsewhere in the app.
  useEffect(() => {
    return onAccessTokenChange((token) => {
      setAccessTokenState(token)
      if (token) localStorage.setItem('access_token', token)
      else localStorage.removeItem('access_token')
      setWebSocketToken(token)
    })
  }, [])

  useEffect(() => {
    async function verifyOrRefresh() {
      const stored = localStorage.getItem('access_token')
      setAccessToken(stored)

      // apiFetch already retries once via a silent refresh on a 401, so a
      // single call here covers both "token still valid" and "token expired
      // but refresh cookie still good".
      const res = await apiFetch(`${API}/api/v1/users/me`)
      if (res.ok) {
        const data = await res.json()
        applyLanguage(data.language_locale)
        return
      }

      setAccessToken(null)
    }

    verifyOrRefresh()
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

export const useAuth = () => useContext(AuthContext)
