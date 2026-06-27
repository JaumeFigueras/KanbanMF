import { createContext, useContext, useState, type ReactNode } from 'react'

interface ThemeToggleCtx {
  dark: boolean
  toggleDark: () => void
}

const ThemeToggleContext = createContext<ThemeToggleCtx>({ dark: false, toggleDark: () => {} })

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

export const useThemeToggle = () => useContext(ThemeToggleContext)
