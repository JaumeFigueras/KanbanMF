import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ThemeToggleProvider } from './context/ThemeToggleContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeToggleProvider>
      <App />
    </ThemeToggleProvider>
  </StrictMode>,
)
