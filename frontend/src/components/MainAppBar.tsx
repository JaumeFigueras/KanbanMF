import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import {
  AddPhotoAlternate,
  Cable,
  DarkMode,
  DriveFileRenameOutline,
  Language,
  LightMode,
  Lock,
  Logout,
  Search,
  Timer,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useAuth } from '../context/useAuth'
import { useThemeToggle } from '../context/useThemeToggle'
import { apiFetch } from '../api/client'
import { getBrowserTimezone } from '../utils/locale'
import type { SearchScope } from '../utils/search'
import { MIN_SEARCH_LENGTH, searchPlaceholderKey, searchUrl } from '../utils/search'
import ChangeDisplayNameDialog from './ChangeDisplayNameDialog'
import ChangePasswordDialog from './ChangePasswordDialog'
import UploadAvatarDialog from './UploadAvatarDialog'
import LanguageLocalizationDialog from './LanguageLocalizationDialog'
import ConnectedAppsDialog from './ConnectedAppsDialog'

const LOCALE_TO_I18N: Record<string, string> = { en: 'en', ca_ES: 'ca' }

interface Props {
  onLocaleChanged?: (numberLocale: string, dateFormat: 'numeric' | 'textual') => void
  // Fired after the user's own avatar is uploaded, replaced or removed.
  // Pages carry other people's avatar state in their own payloads (a board's
  // owner_has_avatar, a card's members), so they have to refetch to notice.
  onAvatarChanged?: () => void
  // Shows the search box, searching this scope; Enter opens the results
  // page. Left out on pages that have nothing to search, or their own box.
  search?: SearchScope
}

export default function MainAppBar({ onLocaleChanged, onAvatarChanged, search }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { dark, toggleDark } = useThemeToggle()
  const theme = useTheme()
  // On a phone the box folds into a magnifier icon, and takes the title's
  // place while open.
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'))
  const [searchText, setSearchText] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const [displayName, setDisplayName] = useState<string | null>(null)
  const [initials, setInitials] = useState<string | null>(null)
  const [authProviders, setAuthProviders] = useState<string[]>([])
  const [languageLocale, setLanguageLocale] = useState('en')
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<'numeric' | 'textual'>('numeric')
  const [timezone, setTimezone] = useState(getBrowserTimezone())
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const avatarUrlRef = useRef<string | null>(null)

  // Keep a stable ref to the callback so the fetch effect never re-fires just
  // because the parent re-rendered and passed a new inline function reference.
  const onLocaleChangedRef = useRef(onLocaleChanged)
  useLayoutEffect(() => { onLocaleChangedRef.current = onLocaleChanged })
  const onAvatarChangedRef = useRef(onAvatarChanged)
  useLayoutEffect(() => { onAvatarChangedRef.current = onAvatarChanged })

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [changeNameOpen, setChangeNameOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [uploadAvatarOpen, setUploadAvatarOpen] = useState(false)
  const [langLocOpen, setLangLocOpen] = useState(false)
  const [connectedAppsOpen, setConnectedAppsOpen] = useState(false)

  // A promise chain rather than an async function: every setState then sits
  // in a callback, which lets the lint rule against setting state directly
  // inside an effect see that the effect below doesn't.
  const fetchAvatar = useCallback(() => {
    apiFetch('/api/v1/users/me/avatar')
      .then((r) => r.ok ? r.blob() : null)
      .then((blob) => {
        if (!blob) {
          setAvatarUrl(null)
          return
        }
        const url = URL.createObjectURL(blob)
        if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
        avatarUrlRef.current = url
        setAvatarUrl(url)
      })
      .catch(() => setAvatarUrl(null))
  }, [])

  useEffect(() => {
    apiFetch('/api/v1/users/me')
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
        setTimezone(data.timezone ?? getBrowserTimezone())
        i18n.changeLanguage(LOCALE_TO_I18N[lang] ?? 'en')
        onLocaleChangedRef.current?.(num, fmt)
      })
      .catch(() => navigate('/signin'))

    fetchAvatar()

    return () => {
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
    }
  }, [navigate, fetchAvatar])

  async function handleSignOut() {
    setMenuAnchor(null)
    await logout()
    navigate('/signin')
  }

  function submitSearch() {
    const q = searchText.trim()
    if (search && q.length >= MIN_SEARCH_LENGTH) navigate(searchUrl(q, search))
  }

  const searchPlaceholder = search ? t(searchPlaceholderKey(search)) : ''
  const searchBox = search && (
    <Box
      component="form"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submitSearch()
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexGrow: isPhone ? 1 : 0,
        width: isPhone ? 'auto' : 280,
        mr: 1,
        borderRadius: 1,
        bgcolor: alpha(theme.palette.common.white, 0.15),
        '&:hover': { bgcolor: alpha(theme.palette.common.white, 0.25) },
      }}
    >
      <Search sx={{ mx: 1, opacity: 0.8 }} />
      <InputBase
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        onBlur={() => { if (isPhone && !searchText) setSearchOpen(false) }}
        autoFocus={isPhone}
        placeholder={searchPlaceholder}
        inputProps={{ 'aria-label': searchPlaceholder, enterKeyHint: 'search' }}
        sx={{ color: 'inherit', flex: 1, py: 0.5, pr: 1 }}
      />
    </Box>
  )

  return (
    <>
      <AppBar position="fixed">
        <Toolbar>
          {isPhone && searchOpen ? searchBox : (
            <Typography
              variant="h6"
              onClick={() => navigate('/boards')}
              sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }}
            >
              KanbanMF
            </Typography>
          )}

          {search && !isPhone && searchBox}
          {search && isPhone && !searchOpen && (
            <IconButton color="inherit" onClick={() => setSearchOpen(true)} aria-label={searchPlaceholder}>
              <Search />
            </IconButton>
          )}

          <Tooltip title={t('timeTracker.title')}>
            <IconButton
              color="inherit"
              onClick={() => navigate('/time-tracker')}
              sx={{ mr: 1 }}
              aria-label={t('timeTracker.title')}
            >
              <Timer />
            </IconButton>
          </Tooltip>

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
            <MenuItem onClick={() => { setMenuAnchor(null); setConnectedAppsOpen(true) }}>
              <ListItemIcon><Cable fontSize="small" /></ListItemIcon>
              <ListItemText>{t('connectedApps.title')}</ListItemText>
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
        hasAvatar={avatarUrl !== null}
        currentAvatarUrl={avatarUrl}
        onSaved={() => {
          fetchAvatar()
          onAvatarChangedRef.current?.()
        }}
      />

      <LanguageLocalizationDialog
        open={langLocOpen}
        onClose={() => setLangLocOpen(false)}
        currentLanguageLocale={languageLocale}
        currentNumberLocale={numberLocale}
        currentDateFormat={dateFormat}
        currentTimezone={timezone}
        onSaved={(newLang, newNum, newFmt, newTz) => {
          setLanguageLocale(newLang)
          setNumberLocale(newNum)
          setDateFormat(newFmt)
          setTimezone(newTz)
          i18n.changeLanguage(LOCALE_TO_I18N[newLang] ?? 'en')
          onLocaleChanged?.(newNum, newFmt)
        }}
      />

      <ConnectedAppsDialog
        open={connectedAppsOpen}
        onClose={() => setConnectedAppsOpen(false)}
        numberLocale={numberLocale}
        dateFormat={dateFormat}
      />

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      {displayName !== null && (
        <ChangeDisplayNameDialog
          open={changeNameOpen}
          onClose={() => setChangeNameOpen(false)}
          currentDisplayName={displayName}
          currentInitials={initials}
          onSaved={(newName, newInitials) => {
            setDisplayName(newName)
            setInitials(newInitials)
          }}
        />
      )}
    </>
  )
}
