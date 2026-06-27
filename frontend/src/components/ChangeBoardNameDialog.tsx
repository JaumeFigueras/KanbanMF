import { useEffect, useState } from 'react'
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
import type { BoardRead } from '../types/board'

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
  accessToken: string
  onSaved: (boardId: string, newName: string) => void
}

export default function ChangeBoardNameDialog({ open, onClose, board, accessToken, onSaved }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && board) {
      setName(board.name)
      setError(null)
    }
  }, [open, board])

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('boards.boardNameRequired'))
      return
    }
    if (!board) return

    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`http://localhost:8000/api/v1/boards/${board.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({ name: trimmed }),
      })
      if (!r.ok) throw new Error()
      onSaved(board.id, trimmed)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.changeBoardName')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label={t('boards.boardName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          slotProps={{ htmlInput: { maxLength: 255 } }}
          fullWidth
          required
          autoFocus
          sx={{ mt: 1 }}
        />
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
