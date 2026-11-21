import { useState, type ReactNode } from 'react'
import { ThemeToggleContext } from './useThemeToggle'
import { readStored, writeStored } from '../utils/storage'

export function ThemeToggleProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => readStored('local', 'theme') === 'dark')

  function toggleDark() {
    setDark((v) => {
      writeStored('local', 'theme', v ? 'light' : 'dark')
      return !v
    })
  }

  return (
    <ThemeToggleContext.Provider value={{ dark, toggleDark }}>
      {children}
    </ThemeToggleContext.Provider>
  )
}
