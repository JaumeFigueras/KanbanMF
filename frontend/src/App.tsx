import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { lightTheme, darkTheme } from './theme'
import { useThemeToggle } from './context/ThemeToggleContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'
import Boards from './pages/Boards'
import Board from './pages/Board'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'
import VerifyEmail from './pages/VerifyEmail'

function DefaultRedirect() {
  const { accessToken, loading } = useAuth()
  if (loading) return null
  return <Navigate to={accessToken ? '/boards' : '/signin'} replace />
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
