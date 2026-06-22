import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider, CssBaseline, IconButton, Box } from '@mui/material'
import { LightMode, DarkMode, Translate } from '@mui/icons-material'
import { lightTheme, darkTheme } from './theme'
import LanguageSelector from './components/LanguageSelector'
import SignIn from './pages/SignIn'
import SignUp from './pages/SignUp'

export default function App() {
  const [dark, setDark] = useState(false)

  return (
    <ThemeProvider theme={dark ? darkTheme : lightTheme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          top: 12,
          right: 16,
          zIndex: 1300,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Translate sx={{ color: 'text.secondary' }} />
        <LanguageSelector />
        <IconButton
          onClick={() => setDark((v) => !v)}
          aria-label="toggle light/dark mode"
          color="inherit"
        >
          {dark ? <LightMode /> : <DarkMode />}
        </IconButton>
      </Box>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="*" element={<Navigate to="/signin" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
