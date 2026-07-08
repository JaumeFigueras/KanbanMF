import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { BoardListRead } from '../types/board'
import { apiFetch } from '../api/client'
import { DEFAULT_COLOR } from './ChangeBoardColorDialog'

interface Props {
  open: boolean
  onClose: () => void
  list: BoardListRead | null
  currentColor: string | null
  onSaved: (color: string | null) => void
}

export default function ChangeListColorDialog({ open, onClose, list, currentColor, onSaved }: Props) {
  const { t } = useTranslation()
  const [color, setColor] = useState(currentColor ?? DEFAULT_COLOR)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setColor(currentColor ?? DEFAULT_COLOR)
      setError(null)
    }
  }, [open, currentColor])

  async function handleSave() {
    if (!list) return
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(
        `http://localhost:8000/api/v1/boards/${list.board_id}/lists/${list.id}/color`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ color }),
        },
      )
      if (!r.ok) throw new Error()
      onSaved(color)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!list) return
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(
        `http://localhost:8000/api/v1/boards/${list.board_id}/lists/${list.id}/color`,
        { method: 'DELETE' },
      )
      if (!r.ok) throw new Error()
      onSaved(null)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('board.changeListColor')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
          <Box
            component="input"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            sx={{
              width: 48,
              height: 48,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              cursor: 'pointer',
              p: '2px',
              bgcolor: 'transparent',
            }}
          />
          <Typography variant="body2" color="text.secondary">{color.toUpperCase()}</Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button onClick={handleReset} color="inherit" disabled={saving}>
          {t('boards.resetColorToDefault')}
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} color="error" disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} color="success" variant="contained" disabled={saving}>
            {t('common.save')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
