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
import ChangeBoardColorDialog from './ChangeBoardColorDialog'

interface Props {
  id: string
  board: BoardRead
  numberLocale: string
  dateFormat: 'numeric' | 'textual'
  // False for boards shared with the current user rather than owned by them —
  // those can only have their color changed, not renamed/shared/archived.
  isOwned: boolean
  // This user's personal color choice for this board, lifted up to the page
  // level: a starred board renders a second BoardCard instance (once in
  // "Starred", once in "My Boards"/"Shared with me"), and both instances
  // must reflect the same color and update together when either one changes it.
  color: string | null
  onStarToggle: (boardId: string, starred: boolean) => void
  onChangeName: (board: BoardRead) => void
  onShare: (board: BoardRead) => void
  onArchive: (board: BoardRead) => void
  onEmailNotification: (board: BoardRead) => void
  onColorChanged: (boardId: string, color: string | null) => void
  // True only for the floating clone rendered inside <DragOverlay> — it must
  // not register its own drag (that would collide with the real card's) or
  // respond to clicks. Mirrors CardItem/BoardListColumn's own dragOverlay prop.
  dragOverlay?: boolean
}

export default function BoardCard({
  id,
  board,
  numberLocale,
  dateFormat,
  isOwned,
  color,
  onStarToggle,
  onChangeName,
  onShare,
  onArchive,
  onEmailNotification,
  onColorChanged,
  dragOverlay = false,
}: Props) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [colorDialogOpen, setColorDialogOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragOverlay ? `overlay-${id}` : id,
    disabled: dragOverlay,
  })

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
      ref={dragOverlay ? undefined : setNodeRef}
      style={dragOverlay ? undefined : { transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        cursor: dragOverlay ? 'grabbing' : undefined,
        bgcolor: color
          ? `${color}26` // ~15% alpha wash of the user's chosen color
          : (theme) => theme.palette.mode === 'dark' ? 'rgba(156, 39, 176, 0.14)' : 'background.paper',
        border: color
          ? `1px solid ${color}`
          : (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(156, 39, 176, 0.35)' : theme.palette.divider}`,
        boxShadow: 'none',
      }}
    >
      {/* Content stays laid out (visibility, not display) while dragging, so
          the card keeps its own footprint — that footprint is exactly the
          drop slot the dashed overlay below highlights. */}
      <Box sx={{ visibility: isDragging ? 'hidden' : 'visible', display: 'contents' }}>
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
                sx={{ color: 'text.disabled', cursor: dragOverlay || isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                {...attributes}
                {...listeners}
              >
                <OpenWith sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>

            <Tooltip title={board.is_starred ? t('boards.unstar') : t('boards.star')}>
              <IconButton
                size="small"
                onClick={dragOverlay ? undefined : () => onStarToggle(board.id, !board.is_starred)}
                sx={{ color: board.is_starred ? 'primary.main' : 'text.disabled' }}
              >
                {board.is_starred
                  ? <Star sx={{ fontSize: 18 }} />
                  : <StarBorder sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>

            <IconButton
              size="small"
              onClick={dragOverlay ? undefined : (e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
            >
              <MenuIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>

        {/* Card body — clickable */}
        <CardActionArea sx={{ flexGrow: 1 }} onClick={dragOverlay ? undefined : () => navigate(`/boards/${board.id}`)}>
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
      </Box>

      {isDragging && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        />
      )}

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
        <MenuItem onClick={() => { setMenuAnchor(null); setColorDialogOpen(true) }}>
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

      <ChangeBoardColorDialog
        open={colorDialogOpen}
        onClose={() => setColorDialogOpen(false)}
        board={board}
        currentColor={color}
        onSaved={(newColor) => onColorChanged(board.id, newColor)}
      />
    </Card>
  )
}
