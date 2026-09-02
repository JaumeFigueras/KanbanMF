import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import type { TimeEntryRead } from '../types/timeTracker'
import CardPicker, { type CardSelection } from './CardPicker'

interface Props {
  open: boolean
  onClose: () => void
  onStarted: (entry: TimeEntryRead) => void
}

const EMPTY: CardSelection = { boardId: '', listId: '', cardId: '' }

export default function StartTimeEntryDialog({ open, onClose, onStarted }: Props) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<CardSelection>(EMPTY)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The dialog stays mounted between openings, so the note has to be cleared
  // on the way out or the next task would start with the last one's text.
  function handleClose() {
    setComment('')
    setError(null)
    onClose()
  }

  async function handleStart() {
    if (!selection.cardId) {
      setError(t('timeTracker.pickCard'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch('/api/v1/time-entries/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: selection.boardId,
          list_id: selection.listId,
          card_id: selection.cardId,
          comment,
        }),
      })
      // 409: something else is already being tracked — say so rather than
      // showing the generic save error, since it's a state the user can fix.
      if (r.status === 409) {
        setError(t('timeTracker.alreadyRunning'))
        return
      }
      if (!r.ok) throw new Error()
      onStarted(await r.json() as TimeEntryRead)
      handleClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('timeTracker.startTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        <CardPicker active={open} disabled={saving} onChange={setSelection} />
        <TextField
          label={t('timeTracker.commentColumn')}
          placeholder={t('timeTracker.commentHint')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          size="small"
          disabled={saving}
          sx={{ mt: 2 }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleStart} color="success" variant="contained" disabled={saving}>
          {t('timeTracker.start')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
