import { useState } from 'react'
import {
  Avatar,
  Box,
  Card,
  CardContent,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import { DeleteForever, Menu as MenuIcon, Unarchive } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { BoardRead } from '../types/board'

interface Props {
  board: BoardRead
  numberLocale: string
  dateFormat: 'numeric' | 'textual'
  onRestore: (board: BoardRead) => void
  onDelete: (board: BoardRead) => void
}

export default function ArchivedBoardCard({ board, numberLocale, dateFormat, onRestore, onDelete }: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)

  const locale = numberLocale.replace('_', '-')
  const formattedDate = new Intl.DateTimeFormat(locale, {
    dateStyle: dateFormat === 'textual' ? 'medium' : 'short',
  }).format(new Date(board.created_at))

  const ownerLabel = board.owner_initials
    ?? board.owner_display_name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()

  const ownerAvatarSrc = board.owner_has_avatar
    ? `/api/v1/users/${board.owner_id}/avatar`
    : undefined

  return (
    <Card
      sx={{
        display: 'flex',
        flexDirection: 'column',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'rgba(211, 47, 47, 0.14)' : '#ffebee',
        border: (theme) =>
          `1px solid ${theme.palette.mode === 'dark' ? 'rgba(211, 47, 47, 0.35)' : '#ffcdd2'}`,
        boxShadow: 'none',
      }}
    >
      {/* Top row: owner avatar (left) + menu (right) */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 1,
          pt: 1,
        }}
        onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
      >
        <Tooltip title={board.owner_display_name}>
          <Avatar
            src={ownerAvatarSrc}
            sx={{
              width: 28,
              height: 28,
              fontSize: '0.65rem',
              fontWeight: 700,
              bgcolor: 'error.main',
            }}
          >
            {ownerLabel}
          </Avatar>
        </Tooltip>

        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
        >
          <MenuIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      <CardContent sx={{ pt: 1, pb: '12px !important', px: 1.5 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 700, fontSize: '1rem' }}
          noWrap
          title={board.name}
        >
          {board.name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formattedDate}
        </Typography>
      </CardContent>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem onClick={() => { setMenuAnchor(null); onRestore(board) }}>
          <ListItemIcon><Unarchive fontSize="small" /></ListItemIcon>
          <ListItemText>{t('boards.restoreBoard')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); onDelete(board) }} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteForever fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>{t('boards.deleteBoard')}</ListItemText>
        </MenuItem>
      </Menu>
    </Card>
  )
}
