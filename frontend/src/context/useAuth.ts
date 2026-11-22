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
  // True when the start-up check got no answer (a dropped connection, a
  // server error), so whether there's a session is unknown: ProtectedRoute
  // says KanbanMF couldn't be reached instead of sending the user to sign
  // in. Cleared by any news of the token, and by retryStartUp().
  unreachable: boolean
  login: (token: string) => void
  // Signs this page out whether or not the server answers; never rejects.
  logout: () => Promise<void>
  // Runs the start-up check again (loading meanwhile).
  retryStartUp: () => void
}

export const AuthContext = createContext<AuthCtx>({
  accessToken: null,
  loading: true,
  loggedOut: false,
  signOutUnconfirmed: false,
  unreachable: false,
  login: () => {},
  logout: async () => {},
  retryStartUp: () => {},
})

export const useAuth = () => useContext(AuthContext)
