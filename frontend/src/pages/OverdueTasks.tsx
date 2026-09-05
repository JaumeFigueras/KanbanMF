import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Toolbar,
  Typography,
} from '@mui/material'
import { ArrowBack, ExpandMore } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import { subscribeToNotifications } from '../api/ws'
import MainAppBar from '../components/MainAppBar'
import OverdueListColumn from '../components/OverdueListColumn'
import { DEFAULT_COLOR } from '../components/ChangeBoardColorDialog'
import { LIGHT_TINT_WEIGHT, tintColor } from '../utils/colorTint'
import type { DateFormat } from '../utils/locale'
import type { OverdueBoardRead } from '../types/board'

export default function OverdueTasks() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')
  const [boards, setBoards] = useState<OverdueBoardRead[]>([])
  // Which board accordions are open, keyed by board id. Not persisted: the
  // set of boards with overdue cards changes on its own as due dates pass.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const fetchOverdue = useCallback(() => {
    apiFetch('/api/v1/boards/overdue')
      .then((r) => (r.ok ? (r.json() as Promise<OverdueBoardRead[]>) : []))
      .then(setBoards)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchOverdue()
  }, [fetchOverdue])

  // Any card change anywhere can add or remove an overdue card, so this page
  // just refetches on every notification rather than inspecting the payload.
  useEffect(() => subscribeToNotifications(() => fetchOverdue()), [fetchOverdue])

  // Opens the card on its own board, with its edit dialog already up — see
  // the `card` search param Board.tsx reads.
  function openCard(boardId: string, cardId: string) {
    navigate(`/boards/${boardId}?card=${cardId}`)
  }

  return (
    <>
      <MainAppBar
        onLocaleChanged={(num, fmt) => {
          setNumberLocale(num)
          setDateFormat(fmt)
        }}
      />

      <Toolbar />{/* spacer for the fixed AppBar */}
      <Box sx={{ mt: 4, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Button size="small" startIcon={<ArrowBack />} onClick={() => navigate('/boards')}>
            {t('overdue.backToBoards')}
          </Button>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {t('overdue.title')}
          </Typography>
        </Box>

        {boards.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('overdue.noOverdueTasks')}
          </Typography>
        ) : (
          boards.map((board) => (
            <Accordion
              key={board.board_id}
              expanded={expanded[board.board_id] ?? false}
              onChange={(_, isExpanded) =>
                setExpanded((prev) => ({ ...prev, [board.board_id]: isExpanded }))
              }
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {board.board_name} ({board.overdue_count})
                </Typography>
              </AccordionSummary>
              <AccordionDetails
                sx={{
                  // Same light board tint the board page paints behind its
                  // columns, so an expanded board reads as that board.
                  bgcolor: (theme) =>
                    tintColor(board.color ?? DEFAULT_COLOR, theme.palette.background.default, LIGHT_TINT_WEIGHT),
                  // Columns side by side, as on the board itself, scrolling
                  // sideways when they don't fit. (A CSS multi-column flow
                  // can't work here: an accordion body has no fixed height,
                  // so every column collapses into one.)
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 2,
                  overflowX: 'auto',
                }}
              >
                {board.lists.map((list) => (
                  <OverdueListColumn
                    key={list.list_id}
                    list={list}
                    numberLocale={numberLocale}
                    dateFormat={dateFormat}
                    cardColors={board.card_colors}
                    onCardClick={(card) => openCard(board.board_id, card.id)}
                  />
                ))}
              </AccordionDetails>
            </Accordion>
          ))
        )}
      </Box>
    </>
  )
}
