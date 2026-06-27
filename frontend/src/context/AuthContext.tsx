import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import i18n from '../i18n'

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
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function verifyOrRefresh() {
      const stored = localStorage.getItem('access_token')

      if (stored) {
        const res = await fetch(`${API}/api/v1/users/me`, {
          headers: { Authorization: `Bearer ${stored}` },
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          applyLanguage(data.language_locale)
          setAccessToken(stored)
          return
        }
      }

      // Token missing or expired — attempt silent refresh via cookie
      const refreshRes = await fetch(`${API}/api/v1/auth/local/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!refreshRes.ok) {
        localStorage.removeItem('access_token')
        setAccessToken(null)
        return
      }

      const { access_token } = await refreshRes.json()
      localStorage.setItem('access_token', access_token)

      // Fetch user data with the new token to apply language preference
      const meRes = await fetch(`${API}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
        credentials: 'include',
      })
      if (meRes.ok) {
        const data = await meRes.json()
        applyLanguage(data.language_locale)
      }
      setAccessToken(access_token)
    }

    verifyOrRefresh()
      .catch(() => {
        localStorage.removeItem('access_token')
        setAccessToken(null)
      })
      .finally(() => setLoading(false))
  }, [])

  function login(token: string) {
    localStorage.setItem('access_token', token)
    setAccessToken(token)
  }

  async function logout() {
    try {
      await fetch(`${API}/api/v1/auth/local/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
    } finally {
      localStorage.removeItem('access_token')
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
