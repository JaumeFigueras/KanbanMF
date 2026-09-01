import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { BoardListRead, BoardRead, BoardsResponse, CardRead } from '../types/board'
import { apiFetch } from '../api/client'

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
// that value is still among the new choices.
export default function CardPicker({
  active,
  disabled = false,
  initialBoardId = '',
  initialListId = '',
  onChange,
}: Props) {
  const { t } = useTranslation()
  const [boards, setBoards] = useState<BoardRead[]>([])
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [cards, setCards] = useState<CardRead[]>([])
  const [boardId, setBoardId] = useState(initialBoardId)
  const [listId, setListId] = useState(initialListId)
  const [cardId, setCardId] = useState('')

  // Keeps the effect below from re-firing just because the parent re-rendered
  // and handed over a new inline callback — same reason MainAppBar does it.
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => { onChangeRef.current = onChange })

  useEffect(() => {
    onChangeRef.current({ boardId, listId, cardId })
  }, [boardId, listId, cardId])

  useEffect(() => {
    if (!active) return
    apiFetch('/api/v1/boards')
      .then(r => r.ok ? r.json() as Promise<BoardsResponse> : Promise.reject(new Error()))
      .then(data => {
        const all = [...data.owned, ...data.shared]
        setBoards(all)
        setBoardId(prev => all.some(b => b.id === prev) ? prev : (all[0]?.id ?? ''))
      })
      .catch(() => setBoards([]))
  }, [active])

  useEffect(() => {
    if (!active || !boardId) {
      setLists([])
      return
    }
    apiFetch(`/api/v1/boards/${boardId}/lists`)
      .then(r => r.ok ? r.json() as Promise<BoardListRead[]> : Promise.reject(new Error()))
      .then(data => {
        setLists(data)
        setListId(prev => data.some(l => l.id === prev) ? prev : (data[0]?.id ?? ''))
      })
      .catch(() => setLists([]))
  }, [active, boardId])

  useEffect(() => {
    if (!active || !boardId || !listId) {
      setCards([])
      return
    }
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

      <FormControl fullWidth size="small" sx={{ mt: 2 }} disabled={disabled || cards.length === 0}>
        <InputLabel>{t('board.targetCard')}</InputLabel>
        <Select
          label={t('board.targetCard')}
          value={cardId}
          onChange={(e) => setCardId(e.target.value)}
        >
          {cards.map(c => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
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
