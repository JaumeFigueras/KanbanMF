import { useCallback, useEffect, useRef, useState } from 'react'
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
  CalendarToday,
  DriveFileRenameOutline,
  Lock,
  Logout,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useAuth } from '../context/AuthContext'
import ChangeDisplayNameDialog from '../components/ChangeDisplayNameDialog'
import ChangePasswordDialog from '../components/ChangePasswordDialog'
import UploadAvatarDialog from '../components/UploadAvatarDialog'

const LOCALE_TO_I18N: Record<string, string> = { en: 'en', ca_ES: 'ca' }

export default function Boards() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { accessToken, logout } = useAuth()
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [initials, setInitials] = useState<string | null>(null)
  const [authProviders, setAuthProviders] = useState<string[]>([])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const avatarUrlRef = useRef<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [changeNameOpen, setChangeNameOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [uploadAvatarOpen, setUploadAvatarOpen] = useState(false)

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
        i18n.changeLanguage(LOCALE_TO_I18N[data.language_locale] ?? 'en')
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
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: 0.5 }}>
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
                <Typography variant="body2">
                  {displayName}
                </Typography>
              )}
            </Box>
          </Tooltip>

          <Tooltip title={t('boards.signOut')}>
            <IconButton
              color="inherit"
              onClick={handleSignOut}
              aria-label={t('boards.signOut')}
              sx={{ ml: 1 }}
            >
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
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <ListItemIcon><CalendarToday fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.setFirstDayOfWeek')}</ListItemText>
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

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'calc(100vh - 64px)',
          bgcolor: 'background.default',
        }}
      >
        <Typography variant="h5">{t('boards.signedIn')}</Typography>
      </Box>
    </>
  )
}
