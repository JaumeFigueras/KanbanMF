import { useState, type ReactNode } from 'react'
import { ThemeToggleContext } from './useThemeToggle'

export function ThemeToggleProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')

  function toggleDark() {
    setDark((v) => {
      localStorage.setItem('theme', v ? 'light' : 'dark')
      return !v
    })
  }

  return (
    <ThemeToggleContext.Provider value={{ dark, toggleDark }}>
      {children}
    </ThemeToggleContext.Provider>
  )
}
