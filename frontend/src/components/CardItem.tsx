import { useState } from 'react'
import {
  AvatarGroup,
  Box,
  Card,
  CardActions,
  CardContent,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { CalendarToday, CheckCircle, Menu as HamburgerIcon, OpenWith } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { CardRead } from '../types/board'
import { formatDateTime, intlCodeFor, type DateFormat } from '../utils/locale'
import { dueDateStyle } from '../utils/dueDateColor'
import { contrastColor } from '../utils/labelColor'
import dayjs from 'dayjs'
import { apiFetch } from '../api/client'
import CardDialog from './CardDialog'
import PersonAvatar from './PersonAvatar'

interface Props {
  card: CardRead
  boardId: string
  listId: string
  numberLocale: string
  dateFormat: DateFormat
  onArchived: (cardId: string) => void
  onUpdated: (card: CardRead) => void
}

export default function CardItem({
  card,
  boardId,
  listId,
  numberLocale,
  dateFormat,
  onArchived,
  onUpdated,
}: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  function openMenu(e: React.MouseEvent<HTMLElement>) {
    setMenuAnchor(e.currentTarget)
  }

  function closeMenu() {
    setMenuAnchor(null)
  }

  function handleEdit() {
    closeMenu()
    setEditOpen(true)
  }

  async function handleArchive() {
    closeMenu()
    try {
      const r = await apiFetch(
        `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_archived: true }),
        },
      )
      if (r.ok) onArchived(card.id)
    } catch {
      // silently ignore — parent still shows the card
    }
  }

  const isCompleted = Boolean(card.end_at)
  const hasDates = Boolean(card.due_at || card.end_at)
  const hasLabels = card.labels.length > 0
  const intlCode = intlCodeFor(numberLocale)
  // A defined end date means the task is done — the due date no longer needs an urgency color.
  const dueStyle = card.due_at && !isCompleted ? dueDateStyle(dayjs(card.due_at)) : null

  return (
    <>
      <Card
        variant="outlined"
        onClick={() => setEditOpen(true)}
        sx={{ mb: 1, cursor: 'pointer' }}
      >
        <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              ...((hasLabels || hasDates) && { borderBottom: 1, borderColor: 'divider', pb: 1 }),
            }}
          >
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
              {card.name}
            </Typography>

            {isCompleted && (
              // Sized to match IconButton's own box (20px icon + 5px padding on
              // each side) so it lines up with the buttons next to it.
              <Box sx={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle fontSize="small" sx={{ color: 'success.main' }} />
              </Box>
            )}

            <IconButton
              size="small"
              aria-label={t('board.moveCard')}
              sx={{ cursor: 'grab' }}
              onClick={(e) => e.stopPropagation()}
            >
              <OpenWith fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); openMenu(e) }}
              aria-label={t('board.cardMenu')}
            >
              <HamburgerIcon fontSize="small" />
            </IconButton>
          </Box>

          {(hasLabels || hasDates) && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              {hasLabels && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {card.labels.map((label) => (
                    <Chip
                      key={label.id}
                      label={label.name}
                      size="small"
                      sx={{ bgcolor: label.color, color: contrastColor(label.color), fontWeight: 700 }}
                    />
                  ))}
                </Box>
              )}
              {card.due_at && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 1,
                    width: 'fit-content',
                    ...(dueStyle && { bgcolor: dueStyle.background, color: dueStyle.color }),
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {t('board.dueLabel')}
                  </Typography>
                  <CalendarToday sx={{ fontSize: 14 }} />
                  <Typography variant="caption">
                    {formatDateTime(card.due_at, intlCode, dateFormat)}
                  </Typography>
                </Box>
              )}
              {card.end_at && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: 1,
                    width: 'fit-content',
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {t('board.endLabel')}
                  </Typography>
                  <CalendarToday sx={{ fontSize: 14 }} />
                  <Typography variant="caption">
                    {formatDateTime(card.end_at, intlCode, dateFormat)}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </CardContent>

        {card.assignees.length > 0 && (
          <CardActions sx={{ px: 1, py: 0.5, justifyContent: 'flex-end' }}>
            <AvatarGroup max={5}>
              {card.assignees.map((person) => (
                <PersonAvatar key={person.id} person={person} size={32} />
              ))}
            </AvatarGroup>
          </CardActions>
        )}
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleEdit}>{t('board.editCard')}</MenuItem>
        <MenuItem onClick={handleArchive}>{t('board.archiveCard')}</MenuItem>
      </Menu>

      <CardDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        listId={listId}
        boardId={boardId}
        numberLocale={numberLocale}
        card={card}
        onUpdated={onUpdated}
      />
    </>
  )
}
