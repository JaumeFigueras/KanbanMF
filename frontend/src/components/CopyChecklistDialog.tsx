import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type {
  BoardListRead,
  BoardRead,
  BoardsResponse,
  CardRead,
  ChecklistData,
} from '../types/board'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  // The source card's board/list/card, used as the initial selection so the
  // common case (copying onto a nearby card) needs one dropdown, not three.
  // cardId is undefined while the source card itself hasn't been created yet.
  boardId: string
  listId: string
  cardId?: string
  // Copied from the dialog's *local* state, not from the server, so unsaved
  // edits (renames, added items, toggles) are copied as shown on screen.
  checklist: ChecklistData | null
  // Fires after a successful copy so the caller can refresh the target card
  // — the copy is written straight to the target, which may be a card the
  // caller is currently rendering with stale checklists.
  onCopied?: (targetBoardId: string, targetListId: string) => void
}

export default function CopyChecklistDialog({
  open,
  onClose,
  boardId,
  listId,
  cardId,
  checklist,
  onCopied,
}: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)
  const [boards, setBoards] = useState<BoardRead[]>([])
  const [targetBoardId, setTargetBoardId] = useState(boardId)
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [targetListId, setTargetListId] = useState(listId)
  const [cards, setCards] = useState<CardRead[]>([])
  const [targetCardId, setTargetCardId] = useState(cardId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(checklist?.name ?? '')
    setNameError(false)
    setTargetBoardId(boardId)
    setError(null)
    apiFetch('/api/v1/boards')
      .then(r => r.ok ? r.json() as Promise<BoardsResponse> : Promise.reject(`HTTP ${r.status}`))
      .then(data => setBoards([...data.owned, ...data.shared]))
      .catch(err => setError(String(err)))
  }, [open, boardId, checklist])

  useEffect(() => {
    if (!open || !targetBoardId) return
    apiFetch(`/api/v1/boards/${targetBoardId}/lists`)
      .then(r => r.ok ? r.json() as Promise<BoardListRead[]> : Promise.reject(`HTTP ${r.status}`))
      .then(data => {
        setLists(data)
        // Keep the current list selected when it's still on this board (the
        // common case — the target board defaults to the source board);
        // otherwise fall back to that board's first list.
        setTargetListId(prev =>
          data.some(l => l.id === prev) ? prev : (data[0]?.id ?? ''))
      })
      .catch(err => setError(String(err)))
  }, [open, targetBoardId])

  useEffect(() => {
    if (!open || !targetBoardId || !targetListId) {
      setCards([])
      return
    }
    apiFetch(`/api/v1/boards/${targetBoardId}/lists/${targetListId}/cards`)
      .then(r => r.ok ? r.json() as Promise<CardRead[]> : Promise.reject(`HTTP ${r.status}`))
      .then(data => {
        setCards(data)
        // Same idea as the list effect: the source card stays selected while
        // it's among the choices, so a plain "copy onto this same card"
        // duplicate needs no picking at all.
        setTargetCardId(prev =>
          data.some(c => c.id === prev) ? prev : (data[0]?.id ?? ''))
      })
      .catch(err => setError(String(err)))
  }, [open, targetBoardId, targetListId])

  function handleBoardChange(nextBoardId: string) {
    setTargetBoardId(nextBoardId)
    // Reset to the source list only when switching back to the source
    // board; otherwise the list effect above picks a default once its
    // lists load.
    setTargetListId(nextBoardId === boardId ? listId : '')
  }

  function handleListChange(nextListId: string) {
    setTargetListId(nextListId)
    setTargetCardId(nextListId === listId ? (cardId ?? '') : '')
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(true)
      return
    }
    if (!targetCardId) {
      setError(t('board.noCardsInList'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const checklistsUrl =
        `/api/v1/boards/${targetBoardId}/lists/${targetListId}/cards/${targetCardId}/checklists`
      const r = await apiFetch(checklistsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!r.ok) throw new Error()
      const created: { id: string } = await r.json()

      // One request per item, in order: the server appends each item after
      // the ones already there, so firing them in parallel would scramble
      // the checklist. is_done rides along, keeping the copy's tick marks.
      for (const item of checklist?.items ?? []) {
        const itemRes = await apiFetch(`${checklistsUrl}/${created.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: item.text, is_done: item.is_done }),
        })
        if (!itemRes.ok) throw new Error()
      }

      onCopied?.(targetBoardId, targetListId)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('board.copyChecklistTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label={t('board.checklistName')}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          error={nameError}
          helperText={nameError ? t('board.checklistNameRequired') : undefined}
          fullWidth
          required
          autoFocus
          disabled={saving}
          sx={{ mt: 1 }}
        />

        <FormControl fullWidth size="small" sx={{ mt: 2 }}>
          <InputLabel>{t('board.targetBoard')}</InputLabel>
          <Select
            label={t('board.targetBoard')}
            value={targetBoardId}
            onChange={(e) => handleBoardChange(e.target.value)}
            disabled={saving}
          >
            {boards.map(b => (
              <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth size="small" sx={{ mt: 2 }} disabled={saving || lists.length === 0}>
          <InputLabel>{t('board.targetList')}</InputLabel>
          <Select
            label={t('board.targetList')}
            value={targetListId}
            onChange={(e) => handleListChange(e.target.value)}
          >
            {lists.map(l => (
              <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {lists.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('board.noListsOnBoard')}
          </Typography>
        )}

        <FormControl fullWidth size="small" sx={{ mt: 2 }} disabled={saving || cards.length === 0}>
          <InputLabel>{t('board.targetCard')}</InputLabel>
          <Select
            label={t('board.targetCard')}
            value={targetCardId}
            onChange={(e) => setTargetCardId(e.target.value)}
          >
            {cards.map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {targetListId && cards.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('board.noCardsInList')}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
