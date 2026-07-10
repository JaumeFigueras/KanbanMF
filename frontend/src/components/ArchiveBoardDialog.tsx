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
import type { BoardRead } from '../types/board'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
  onArchived: (boardId: string) => void
}

export default function ArchiveBoardDialog({ open, onClose, board, onArchived }: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!board) return
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/boards/${board.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: true }),
      })
      if (!r.ok) throw new Error()
      onArchived(board.id)
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
      <DialogTitle>{t('boards.archiveBoard')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          {t('boards.archiveBoardConfirmMessage', { name: board?.name ?? '' })}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleConfirm} color="success" variant="contained" disabled={saving}>
          {t('boards.archive')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
