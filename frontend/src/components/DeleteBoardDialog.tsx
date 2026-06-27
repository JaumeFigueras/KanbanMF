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

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
  accessToken: string
  onDeleted: (boardId: string) => void
}

export default function DeleteBoardDialog({ open, onClose, board, accessToken, onDeleted }: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!board) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`http://localhost:8000/api/v1/boards/${board.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
      if (!r.ok) throw new Error()
      onDeleted(board.id)
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
      <DialogTitle sx={{ color: 'error.main' }}>{t('boards.deleteBoard')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <DialogContentText>
          {t('boards.deleteBoardConfirmMessage', { name: board?.name ?? '' })}
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
