import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AppBar,
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
  AccountCircle,
  AddPhotoAlternate,
  CalendarToday,
  DriveFileRenameOutline,
  Lock,
  Logout,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useAuth } from '../context/AuthContext'

const LOCALE_TO_I18N: Record<string, string> = { en: 'en', ca_ES: 'ca' }

export default function Boards() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { accessToken, logout } = useAuth()
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)

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
        i18n.changeLanguage(LOCALE_TO_I18N[data.language_locale] ?? 'en')
      })
      .catch(() => navigate('/signin'))
  }, [accessToken, navigate])

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
              {displayName && (
                <Typography variant="body2" sx={{ mr: 0.5 }}>
                  {displayName}
                </Typography>
              )}
              <IconButton color="inherit" size="small" disableRipple tabIndex={-1}>
                <AccountCircle />
              </IconButton>
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
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <ListItemIcon><DriveFileRenameOutline fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.changeDisplayName')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <ListItemIcon><Lock fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.changePassword')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => setMenuAnchor(null)}>
              <ListItemIcon><AddPhotoAlternate fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.uploadAvatar')}</ListItemText>
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
