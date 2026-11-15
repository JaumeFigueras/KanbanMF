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
import type { LabelRead } from '../types/board'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  boardId: string
  label: LabelRead | null
  onDeleted: (labelId: string) => void
}

// Asks before deleting a label, because that also takes it off every card
// on the board, then deletes it. Same pattern as DeleteBoardDialog.
export default function DeleteLabelDialog({ open, onClose, boardId, label, onDeleted }: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!label) return
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/boards/${boardId}/labels/${label.id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      onDeleted(label.id)
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
      <DialogTitle>{t('board.deleteLabelConfirmTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          {t('board.deleteLabelConfirmMessage', { name: label?.name ?? '' })}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleConfirm} color="error" variant="contained" disabled={saving}>
          {t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
