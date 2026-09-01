import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import type { TimeEntryRead } from '../types/timeTracker'

interface Props {
  open: boolean
  onClose: () => void
  entry: TimeEntryRead | null
  onDeleted: (entryId: string) => void
}

export default function DeleteTimeEntryDialog({ open, onClose, entry, onDeleted }: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!entry) return
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/time-entries/${entry.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      onDeleted(entry.id)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    if (!saving) {
      setError(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ color: 'error.main' }}>{t('timeTracker.deleteTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          {t('timeTracker.deleteConfirmMessage', { name: entry?.card_name ?? '' })}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleConfirm} color="error" variant="contained" disabled={saving}>
          {t('boards.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
