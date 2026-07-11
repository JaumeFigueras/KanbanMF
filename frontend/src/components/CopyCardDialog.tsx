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
import type { BoardListRead, BoardRead, BoardsResponse, CardRead } from '../types/board'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  boardId: string
  listId: string
  cardId: string
  // Reports the target list and the newly created card so the caller can
  // update local state when the copy lands on a list already on screen
  // (same shape as CardDialog's onCreated — harmless no-op otherwise).
  onCopied: (targetListId: string, card: CardRead) => void
}

export default function CopyCardDialog({ open, onClose, boardId, listId, cardId, onCopied }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)
  const [boards, setBoards] = useState<BoardRead[]>([])
  const [targetBoardId, setTargetBoardId] = useState(boardId)
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [targetListId, setTargetListId] = useState(listId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setNameError(false)
    setTargetBoardId(boardId)
    setError(null)
    apiFetch('/api/v1/boards')
      .then(r => r.ok ? r.json() as Promise<BoardsResponse> : Promise.reject(`HTTP ${r.status}`))
      .then(data => setBoards([...data.owned, ...data.shared]))
      .catch(err => setError(String(err)))
  }, [open, boardId])

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

  function handleBoardChange(nextBoardId: string) {
    setTargetBoardId(nextBoardId)
    // Reset to the source list only when switching back to the source
    // board; otherwise the list effect above picks a default once its
    // lists load.
    setTargetListId(nextBoardId === boardId ? listId : '')
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(true)
      return
    }
    if (!targetListId) {
      setError(t('board.noListsOnBoard'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(
        `/api/v1/boards/${boardId}/lists/${listId}/cards/${cardId}/copy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            target_board_id: targetBoardId,
            target_list_id: targetListId,
          }),
        },
      )
      if (!r.ok) throw new Error()
      const copied: CardRead = await r.json()
      onCopied(targetListId, copied)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('board.copyCard')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label={t('board.cardName')}
          placeholder={t('board.copyCardNamePlaceholder')}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          error={nameError}
          helperText={nameError ? t('board.cardNameRequired') : undefined}
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
            onChange={(e) => setTargetListId(e.target.value)}
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
