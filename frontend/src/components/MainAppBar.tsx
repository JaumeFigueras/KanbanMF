import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  AddPhotoAlternate,
  DarkMode,
  DriveFileRenameOutline,
  Language,
  LightMode,
  Lock,
  Logout,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useThemeToggle } from '../context/ThemeToggleContext'
import ChangeDisplayNameDialog from './ChangeDisplayNameDialog'
import ChangePasswordDialog from './ChangePasswordDialog'
import UploadAvatarDialog from './UploadAvatarDialog'
import LanguageLocalizationDialog from './LanguageLocalizationDialog'

const LOCALE_TO_I18N: Record<string, string> = { en: 'en', ca_ES: 'ca' }

interface Props {
  onLocaleChanged?: (numberLocale: string, dateFormat: 'numeric' | 'textual') => void
}

export default function MainAppBar({ onLocaleChanged }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { accessToken, logout } = useAuth()
  const { dark, toggleDark } = useThemeToggle()

  const [displayName, setDisplayName] = useState<string | null>(null)
  const [initials, setInitials] = useState<string | null>(null)
  const [authProviders, setAuthProviders] = useState<string[]>([])
  const [languageLocale, setLanguageLocale] = useState('en')
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<'numeric' | 'textual'>('numeric')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const avatarUrlRef = useRef<string | null>(null)

  // Keep a stable ref to the callback so the fetch effect never re-fires just
  // because the parent re-rendered and passed a new inline function reference.
  const onLocaleChangedRef = useRef(onLocaleChanged)
  useLayoutEffect(() => { onLocaleChangedRef.current = onLocaleChanged })

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [changeNameOpen, setChangeNameOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [uploadAvatarOpen, setUploadAvatarOpen] = useState(false)
  const [langLocOpen, setLangLocOpen] = useState(false)

  const fetchAvatar = useCallback(async () => {
    try {
      const r = await fetch('http://localhost:8000/api/v1/users/me/avatar', {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
      if (r.ok) {
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
        avatarUrlRef.current = url
        setAvatarUrl(url)
      } else {
        setAvatarUrl(null)
      }
    } catch {
      setAvatarUrl(null)
    }
  }, [accessToken])

  useEffect(() => {
    fetch('http://localhost:8000/api/v1/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        setDisplayName(data.display_name)
        setInitials(data.initials ?? null)
        setAuthProviders(data.auth_providers ?? [])
        const lang = data.language_locale ?? 'en'
        const num = data.number_locale ?? 'en'
        const fmt = data.date_format ?? 'numeric'
        setLanguageLocale(lang)
        setNumberLocale(num)
        setDateFormat(fmt)
        i18n.changeLanguage(LOCALE_TO_I18N[lang] ?? 'en')
        onLocaleChangedRef.current?.(num, fmt)
      })
      .catch(() => navigate('/signin'))

    fetchAvatar()

    return () => {
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
    }
  }, [accessToken, navigate, fetchAvatar])

  async function handleSignOut() {
    setMenuAnchor(null)
    await logout()
    navigate('/signin')
  }

  return (
    <>
      <AppBar position="fixed">
        <Toolbar>
          <Typography
            variant="h6"
            onClick={() => navigate('/boards')}
            sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }}
          >
            KanbanMF
          </Typography>

          <Tooltip title={t('boards.userProfile')}>
            <Box
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                borderRadius: 1,
                px: 0.5,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
              }}
            >
              <Avatar
                src={avatarUrl ?? undefined}
                sx={{
                  width: 32,
                  height: 32,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  bgcolor: 'primary.dark',
                  mr: displayName ? 1 : 0,
                }}
              >
                {initials}
              </Avatar>
              {displayName && (
                <Typography variant="body2">{displayName}</Typography>
              )}
            </Box>
          </Tooltip>

          <Tooltip title={t('boards.signOut')}>
            <IconButton color="inherit" onClick={handleSignOut} sx={{ ml: 1 }}>
              <Logout />
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <MenuItem onClick={() => { setMenuAnchor(null); setChangeNameOpen(true) }}>
              <ListItemIcon><DriveFileRenameOutline fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.changeDisplayName')}</ListItemText>
            </MenuItem>
            {authProviders.includes('local') && (
              <MenuItem onClick={() => { setMenuAnchor(null); setChangePasswordOpen(true) }}>
                <ListItemIcon><Lock fontSize="small" /></ListItemIcon>
                <ListItemText>{t('boards.changePassword')}</ListItemText>
              </MenuItem>
            )}
            <MenuItem onClick={() => { setMenuAnchor(null); setUploadAvatarOpen(true) }}>
              <ListItemIcon><AddPhotoAlternate fontSize="small" /></ListItemIcon>
              <ListItemText>
                {avatarUrl ? t('boards.changeRemoveAvatar') : t('boards.uploadAvatar')}
              </ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); setLangLocOpen(true) }}>
              <ListItemIcon><Language fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.languageLocalization')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); toggleDark() }}>
              <ListItemIcon>
                {dark ? <LightMode fontSize="small" /> : <DarkMode fontSize="small" />}
              </ListItemIcon>
              <ListItemText>
                {dark ? t('boards.changeToLight') : t('boards.changeToDark')}
              </ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleSignOut}>
              <ListItemIcon><Logout fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.signOut')}</ListItemText>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <UploadAvatarDialog
        open={uploadAvatarOpen}
        onClose={() => setUploadAvatarOpen(false)}
        accessToken={accessToken ?? ''}
        hasAvatar={avatarUrl !== null}
        currentAvatarUrl={avatarUrl}
        onSaved={fetchAvatar}
      />

      <LanguageLocalizationDialog
        open={langLocOpen}
        onClose={() => setLangLocOpen(false)}
        currentLanguageLocale={languageLocale}
        currentNumberLocale={numberLocale}
        currentDateFormat={dateFormat}
        accessToken={accessToken ?? ''}
        onSaved={(newLang, newNum, newFmt) => {
          setLanguageLocale(newLang)
          setNumberLocale(newNum)
          setDateFormat(newFmt)
          i18n.changeLanguage(LOCALE_TO_I18N[newLang] ?? 'en')
          onLocaleChanged?.(newNum, newFmt)
        }}
      />

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        accessToken={accessToken ?? ''}
      />

      {displayName !== null && (
        <ChangeDisplayNameDialog
          open={changeNameOpen}
          onClose={() => setChangeNameOpen(false)}
          currentDisplayName={displayName}
          currentInitials={initials}
          accessToken={accessToken ?? ''}
          onSaved={(newName, newInitials) => {
            setDisplayName(newName)
            setInitials(newInitials)
          }}
        />
      )}
    </>
  )
}
