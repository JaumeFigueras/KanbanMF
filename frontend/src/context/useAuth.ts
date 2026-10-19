import { createContext, useContext } from 'react'

// The context and its hook live apart from AuthProvider (AuthContext.tsx) so
// that file exports only a component, which Vite's fast refresh needs.

export interface AuthCtx {
  accessToken: string | null
  loading: boolean
  login: (token: string) => void
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthCtx>({
  accessToken: null,
  loading: true,
  login: () => {},
  logout: async () => {},
})

export const useAuth = () => useContext(AuthContext)
