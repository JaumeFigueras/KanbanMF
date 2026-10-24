import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { lightTheme, darkTheme } from './theme'
import { useThemeToggle } from './context/useThemeToggle'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/useAuth'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import Boards from './pages/Boards'
import Board from './pages/Board'
import TimeTracker from './pages/TimeTracker'
import OverdueTasks from './pages/OverdueTasks'
import SearchResults from './pages/SearchResults'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import VerifyEmail from './pages/VerifyEmail'
import OAuthConsent from './pages/OAuthConsent'
import { peekReturnTo } from './utils/returnTo'

function DefaultRedirect() {
  const { accessToken, loading } = useAuth()
  if (loading) return null
  // Google sign-in comes back to "/", so this is also where it resumes a
  // page that sent the user to sign in.
  return <Navigate to={accessToken ? peekReturnTo() ?? '/boards' : '/signin'} replace />
}

export default function App() {
  const { dark } = useThemeToggle()

  return (
    <ThemeProvider theme={dark ? darkTheme : lightTheme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/boards" element={<ProtectedRoute><Boards /></ProtectedRoute>} />
            <Route path="/boards/:boardId" element={<ProtectedRoute><Board /></ProtectedRoute>} />
            <Route path="/time-tracker" element={<ProtectedRoute><TimeTracker /></ProtectedRoute>} />
            <Route path="/overdue" element={<ProtectedRoute><OverdueTasks /></ProtectedRoute>} />
            <Route path="/search" element={<ProtectedRoute><SearchResults /></ProtectedRoute>} />
            <Route path="/oauth/consent" element={<ProtectedRoute><OAuthConsent /></ProtectedRoute>} />
            <Route path="/signin" element={<PublicRoute><SignIn /></PublicRoute>} />
            <Route path="/signup" element={<PublicRoute><SignUp /></PublicRoute>} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
