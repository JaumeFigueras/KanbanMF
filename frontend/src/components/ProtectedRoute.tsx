import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from '../context/useAuth'
import { clearReturnTo, rememberReturnTo } from '../utils/returnTo'
import UnreachablePage from './UnreachablePage'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { accessToken, loading, loggedOut, unreachable, retryStartUp } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (accessToken) clearReturnTo()
  }, [accessToken])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  // No answer from the start-up check: there may well be a session, so
  // this isn't a reason to send anyone to sign in.
  if (!accessToken && unreachable) return <UnreachablePage onRetry={retryStartUp} />

  if (!accessToken) {
    // Come back here after signing in (see utils/returnTo.ts), unless the
    // user signed out: the next sign-in on this tab, maybe someone else's,
    // starts at the boards page. Signing out sends the user to /signin as a
    // navigation, which React applies after this render, so without this
    // check the page would be remembered on the way out.
    if (!loggedOut) rememberReturnTo(location.pathname + location.search)
    return <Navigate to="/signin" replace />
  }
  return <>{children}</>
}
