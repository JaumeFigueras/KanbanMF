import { useState } from 'react'
import { Box, Card, IconButton, Menu, MenuItem, Typography } from '@mui/material'
import { CalendarToday, CheckCircle, Menu as HamburgerIcon, OpenWith } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { CardRead } from '../types/board'
import { formatDateTime, intlCodeFor, type DateFormat } from '../utils/locale'
import { dueDateStyle } from '../utils/dueDateColor'
import dayjs from 'dayjs'
import CardDialog from './CardDialog'

interface Props {
  card: CardRead
  boardId: string
  listId: string
  accessToken: string
  numberLocale: string
  dateFormat: DateFormat
  onArchived: (cardId: string) => void
  onUpdated: (card: CardRead) => void
}

export default function CardItem({
  card,
  boardId,
  listId,
  accessToken,
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
      const r = await fetch(
        `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
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
  const intlCode = intlCodeFor(numberLocale)
  // A defined end date means the task is done — the due date no longer needs an urgency color.
  const dueStyle = card.due_at && !isCompleted ? dueDateStyle(dayjs(card.due_at)) : null

  return (
    <>
      <Card
        variant="outlined"
        onClick={() => setEditOpen(true)}
        sx={{ px: 1, py: 0.5, mb: 1, cursor: 'pointer' }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            ...(hasDates && { borderBottom: 1, borderColor: 'divider', pb: 0.5 }),
          }}
        >
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
            {card.name}
          </Typography>

          {isCompleted && (
            <CheckCircle sx={{ fontSize: 18, color: 'success.main', mt: 0.25, mr: 0.5 }} />
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

        {hasDates && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
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
        accessToken={accessToken}
        numberLocale={numberLocale}
        card={card}
        onUpdated={onUpdated}
      />
    </>
  )
}
