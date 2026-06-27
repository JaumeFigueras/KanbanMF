import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { BoardRead } from '../types/board'

interface Props {
  open: boolean
  onClose: () => void
  accessToken: string
  onCreated: (board: BoardRead) => void
}

export default function CreateBoardDialog({ open, onClose, accessToken, onCreated }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [starred, setStarred] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setStarred(false)
      setError(null)
    }
  }, [open])

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('boards.boardNameRequired'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const r = await fetch('http://localhost:8000/api/v1/boards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({ name: trimmed, is_starred: starred }),
      })
      if (!r.ok) throw new Error()
      const board: BoardRead = await r.json()
      onCreated(board)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.createNewBoard')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('boards.boardName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            fullWidth
            required
            autoFocus
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={starred}
                onChange={(e) => setStarred(e.target.checked)}
              />
            }
            label={t('boards.starred')}
          />
        </Stack>
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
