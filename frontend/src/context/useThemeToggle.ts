import { createContext, useContext } from 'react'

// The context and its hook live apart from ThemeToggleProvider
// (ThemeToggleContext.tsx) so that file exports only a component, which
// Vite's fast refresh needs.

export interface ThemeToggleCtx {
  dark: boolean
  toggleDark: () => void
}

export const ThemeToggleContext = createContext<ThemeToggleCtx>({ dark: false, toggleDark: () => {} })

export const useThemeToggle = () => useContext(ThemeToggleContext)
