import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { CardRead } from '../types/board'
import type { TimeTrackerOption } from '../types/timeTracker'
import { apiFetch } from '../api/client'
import { labelSummary } from '../utils/labelList'
import LabelChips from './LabelChips'

export interface CardSelection {
  boardId: string
  listId: string
  cardId: string
}

interface Props {
  // Remounting the picker (or flipping this) reloads the boards; dialogs
  // pass their own `open` so a reopened dialog starts from fresh data.
  active: boolean
  disabled?: boolean
  // Preselected board/list, when the caller knows where the user was.
  initialBoardId?: string
  initialListId?: string
  onChange: (selection: CardSelection) => void
}

// The board → list → card cascade shared by the time tracker's dialogs: each
// dropdown reloads the one below it, and each keeps its current value when
// that value is still among the new choices. Boards and lists come from the
// time tracker's own endpoints, most used first, so with nothing chosen yet
// the first choice — the default — is the one the user tracks most.
export default function CardPicker({
  active,
  disabled = false,
  initialBoardId = '',
  initialListId = '',
  onChange,
}: Props) {
  const { t } = useTranslation()
  const [boards, setBoards] = useState<TimeTrackerOption[]>([])
  const [fetchedLists, setLists] = useState<TimeTrackerOption[]>([])
  const [fetchedCards, setCards] = useState<CardRead[]>([])
  const [boardId, setBoardId] = useState(initialBoardId)
  const [listId, setListId] = useState(initialListId)
  const [cardId, setCardId] = useState('')
  // The card menu is kept as wide as its field (measured when it opens), so
  // long names and label rows wrap instead of stretching it across the page.
  const cardFieldRef = useRef<HTMLDivElement>(null)
  const [cardMenuWidth, setCardMenuWidth] = useState<number>()

  // Keeps the effect below from re-firing just because the parent re-rendered
  // and handed over a new inline callback — same reason MainAppBar does it.
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => { onChangeRef.current = onChange })

  useEffect(() => {
    onChangeRef.current({ boardId, listId, cardId })
  }, [boardId, listId, cardId])

  useEffect(() => {
    if (!active) return
    apiFetch('/api/v1/time-entries/boards')
      .then(r => r.ok ? r.json() as Promise<TimeTrackerOption[]> : Promise.reject(new Error()))
      .then(data => {
        setBoards(data)
        setBoardId(prev => data.some(b => b.id === prev) ? prev : (data[0]?.id ?? ''))
      })
      .catch(() => setBoards([]))
  }, [active])

  // Without a board (or list) there's nothing to choose from, whatever was
  // fetched for the previous one.
  const lists = active && boardId ? fetchedLists : []
  const cards = active && boardId && listId ? fetchedCards : []

  useEffect(() => {
    if (!active || !boardId) return
    apiFetch(`/api/v1/time-entries/boards/${boardId}/lists`)
      .then(r => r.ok ? r.json() as Promise<TimeTrackerOption[]> : Promise.reject(new Error()))
      .then(data => {
        setLists(data)
        setListId(prev => data.some(l => l.id === prev) ? prev : (data[0]?.id ?? ''))
      })
      .catch(() => setLists([]))
  }, [active, boardId])

  useEffect(() => {
    if (!active || !boardId || !listId) return
    apiFetch(`/api/v1/boards/${boardId}/lists/${listId}/cards`)
      .then(r => r.ok ? r.json() as Promise<CardRead[]> : Promise.reject(new Error()))
      .then(data => {
        setCards(data)
        setCardId(prev => data.some(c => c.id === prev) ? prev : (data[0]?.id ?? ''))
      })
      .catch(() => setCards([]))
  }, [active, boardId, listId])

  return (
    <>
      <FormControl fullWidth size="small" sx={{ mt: 2 }} disabled={disabled || boards.length === 0}>
        <InputLabel>{t('board.targetBoard')}</InputLabel>
        <Select
          label={t('board.targetBoard')}
          value={boardId}
          onChange={(e) => setBoardId(e.target.value)}
        >
          {boards.map(b => (
            <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth size="small" sx={{ mt: 2 }} disabled={disabled || lists.length === 0}>
        <InputLabel>{t('board.targetList')}</InputLabel>
        <Select
          label={t('board.targetList')}
          value={listId}
          onChange={(e) => setListId(e.target.value)}
        >
          {lists.map(l => (
            <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {boardId !== '' && lists.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {t('board.noListsOnBoard')}
        </Typography>
      )}

      {/* Cards with the same name are told apart by their labels: chips in
          the open menu (alphabetical, at most 3 plus "+N"), the same as text
          in the closed field, where a row of chips wouldn't fit. */}
      <FormControl
        ref={cardFieldRef}
        fullWidth
        size="small"
        sx={{ mt: 2 }}
        disabled={disabled || cards.length === 0}
      >
        <InputLabel>{t('board.targetCard')}</InputLabel>
        <Select
          label={t('board.targetCard')}
          value={cardId}
          onChange={(e) => setCardId(e.target.value)}
          onOpen={() => setCardMenuWidth(cardFieldRef.current?.clientWidth)}
          renderValue={(id) => {
            const card = cards.find(c => c.id === id)
            if (!card) return ''
            const summary = labelSummary(card.labels)
            return summary ? `${card.name} ${summary}` : card.name
          }}
          MenuProps={{ slotProps: { paper: { sx: { width: cardMenuWidth } } } }}
        >
          {cards.map(c => (
            <MenuItem key={c.id} value={c.id} sx={{ whiteSpace: 'normal' }}>
              <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {c.name}
                <LabelChips labels={c.labels} max={3} sx={{ mt: 0.5 }} />
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {listId !== '' && cards.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {t('board.noCardsInList')}
        </Typography>
      )}
    </>
  )
}
