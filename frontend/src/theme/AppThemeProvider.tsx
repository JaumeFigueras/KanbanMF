import { useMemo, type ReactNode } from 'react'
import { ThemeProvider } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { appTheme } from '.'

// The MUI theme, light or dark, built again when the language changes so
// that MUI's own texts (drop-downs, alerts, date pickers) follow it.
export default function AppThemeProvider({ dark, children }: { dark: boolean, children: ReactNode }) {
  const { i18n } = useTranslation()
  const language = i18n.language
  const theme = useMemo(() => appTheme(dark, language), [dark, language])
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
