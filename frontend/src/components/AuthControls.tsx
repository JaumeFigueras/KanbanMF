import { useState } from 'react'
import { Box, IconButton, Menu, MenuItem } from '@mui/material'
import { LightMode, DarkMode, Translate } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageCode } from '../i18n'
import LanguageSelector from './LanguageSelector'
import { useThemeToggle } from '../context/ThemeToggleContext'

export default function AuthControls() {
  const { dark, toggleDark } = useThemeToggle()
  const { i18n } = useTranslation()
  const [langAnchor, setLangAnchor] = useState<HTMLElement | null>(null)

  return (
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
      {/* Desktop: static icon + autocomplete dropdown */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1 }}>
        <Translate sx={{ color: 'text.secondary' }} />
        <LanguageSelector />
      </Box>

      {/* Mobile/tablet: icon button that opens a menu */}
      <IconButton
        sx={{ display: { xs: 'flex', md: 'none' } }}
        onClick={(e) => setLangAnchor(e.currentTarget)}
        aria-label="select language"
        color="inherit"
      >
        <Translate />
      </IconButton>
      <Menu
        anchorEl={langAnchor}
        open={Boolean(langAnchor)}
        onClose={() => setLangAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {LANGUAGES.map((lang) => (
          <MenuItem
            key={lang.code}
            selected={i18n.language === lang.code}
            onClick={() => {
              i18n.changeLanguage(lang.code as LanguageCode)
              setLangAnchor(null)
            }}
          >
            {lang.label}
          </MenuItem>
        ))}
      </Menu>

      <IconButton onClick={toggleDark} aria-label="toggle light/dark mode" color="inherit">
        {dark ? <LightMode /> : <DarkMode />}
      </IconButton>
    </Box>
  )
}
