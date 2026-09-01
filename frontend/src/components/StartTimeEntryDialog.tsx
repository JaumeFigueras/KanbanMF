import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('timeTracker.startTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        <CardPicker active={open} disabled={saving} onChange={setSelection} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleStart} color="success" variant="contained" disabled={saving}>
          {t('timeTracker.start')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
