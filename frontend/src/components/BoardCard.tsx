import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Avatar,
  Box,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Archive,
  DriveFileRenameOutline,
  Email,
  Menu as MenuIcon,
  OpenWith,
  Palette,
  PersonAdd,
  Star,
  StarBorder,
} from '@mui/icons-material'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { BoardRead } from '../types/board'

interface Props {
  id: string
  board: BoardRead
  numberLocale: string
  dateFormat: 'numeric' | 'textual'
  // False for boards shared with the current user rather than owned by them —
  // those can only have their color changed, not renamed/shared/archived.
  isOwned: boolean
  onStarToggle: (boardId: string, starred: boolean) => void
  onChangeName: (board: BoardRead) => void
  onChangeColor: (board: BoardRead) => void
  onShare: (board: BoardRead) => void
  onArchive: (board: BoardRead) => void
  onEmailNotification: (board: BoardRead) => void
}

export default function BoardCard({
  id,
  board,
  numberLocale,
  dateFormat,
  isOwned,
  onStarToggle,
  onChangeName,
  onChangeColor,
  onShare,
  onArchive,
  onEmailNotification,
}: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const locale = numberLocale.replace('_', '-')
  const formattedDate = new Intl.DateTimeFormat(locale, {
    dateStyle: dateFormat === 'textual' ? 'medium' : 'short',
  }).format(new Date(board.created_at))

  const ownerLabel = board.owner_initials
    ?? board.owner_display_name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase()

  const ownerAvatarSrc = board.owner_has_avatar
    ? `http://localhost:8000/api/v1/users/${board.owner_id}/avatar`
    : undefined

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        opacity: isDragging ? 0.5 : 1,
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'rgba(156, 39, 176, 0.14)' : 'background.paper',
        border: (theme) =>
          `1px solid ${theme.palette.mode === 'dark' ? 'rgba(156, 39, 176, 0.35)' : theme.palette.divider}`,
        boxShadow: 'none',
      }}
    >
      {/* Top row: owner avatar (left) + action icons (right) */}
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
              bgcolor: 'primary.main',
            }}
          >
            {ownerLabel}
          </Avatar>
        </Tooltip>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <Tooltip title={t('boards.reorderHint')}>
            <IconButton
              size="small"
              sx={{ color: 'text.disabled', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
              {...attributes}
              {...listeners}
            >
              <OpenWith sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title={board.is_starred ? t('boards.unstar') : t('boards.star')}>
            <IconButton
              size="small"
              onClick={() => onStarToggle(board.id, !board.is_starred)}
              sx={{ color: board.is_starred ? 'primary.main' : 'text.disabled' }}
            >
              {board.is_starred
                ? <Star sx={{ fontSize: 18 }} />
                : <StarBorder sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>

          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
          >
            <MenuIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Card body — clickable */}
      <CardActionArea sx={{ flexGrow: 1 }} onClick={() => navigate(`/boards/${board.id}`)}>
        <CardContent sx={{ pt: 1, pb: '12px !important', px: 1.5 }}>
          <Typography
            variant="subtitle1"
            noWrap
            title={board.name}
            sx={{ fontWeight: 700, fontSize: '1rem' }}
          >
            {board.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formattedDate}
          </Typography>
        </CardContent>
      </CardActionArea>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {isOwned && (
          <MenuItem onClick={() => { setMenuAnchor(null); onChangeName(board) }}>
            <ListItemIcon><DriveFileRenameOutline fontSize="small" /></ListItemIcon>
            <ListItemText>{t('boards.changeBoardName')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { setMenuAnchor(null); onChangeColor(board) }}>
          <ListItemIcon><Palette fontSize="small" /></ListItemIcon>
          <ListItemText>{t('boards.changeBoardColor')}</ListItemText>
        </MenuItem>
        {isOwned && (
          <MenuItem onClick={() => { setMenuAnchor(null); onShare(board) }}>
            <ListItemIcon><PersonAdd fontSize="small" /></ListItemIcon>
            <ListItemText>{t('boards.shareBoard')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { setMenuAnchor(null); onEmailNotification(board) }}>
          <ListItemIcon><Email fontSize="small" /></ListItemIcon>
          <ListItemText>{t('boards.emailNotification')}</ListItemText>
        </MenuItem>
        {isOwned && (
          <MenuItem onClick={() => { setMenuAnchor(null); onArchive(board) }}>
            <ListItemIcon><Archive fontSize="small" /></ListItemIcon>
            <ListItemText>{t('boards.archiveBoard')}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Card>
  )
}
