import { createContext, useContext } from 'react'

// The context and its hook live apart from AuthProvider (AuthContext.tsx) so
// that file exports only a component, which Vite's fast refresh needs.

export interface AuthCtx {
  accessToken: string | null
  loading: boolean
  // True once logout() has ended the session on this page, until the next
  // login(): the session ended on purpose, not by expiring.
  loggedOut: boolean
  // True once a logout() the server couldn't confirm (no answer, a server
  // error) has signed this page out, until the next login(): the refresh
  // cookie may still be good, and opening KanbanMF again on this device
  // would sign back in. The sign-in page says so.
  signOutUnconfirmed: boolean
  login: (token: string) => void
  // Signs this page out whether or not the server answers; never rejects.
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthCtx>({
  accessToken: null,
  loading: true,
  loggedOut: false,
  signOutUnconfirmed: false,
  login: () => {},
  logout: async () => {},
})

export const useAuth = () => useContext(AuthContext)
