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
import type { CardRead } from '../types/board'

interface Props {
  open: boolean
  onClose: () => void
  listId: string
  boardId: string
  accessToken: string
  card?: CardRead | null
  onCreated?: (card: CardRead) => void
  onUpdated?: (card: CardRead) => void
}

export default function CardDialog({
  open,
  onClose,
  listId,
  boardId,
  accessToken,
  card,
  onCreated,
  onUpdated,
}: Props) {
  const { t } = useTranslation()
  const isEdit = Boolean(card)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(card?.name ?? '')
      setDescription(card?.description ?? '')
      setError(null)
    }
  }, [open, card])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('board.cardNameRequired'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const url = isEdit
        ? `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card!.id}`
        : `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards`
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      })
      if (!r.ok) throw new Error()
      const result: CardRead = await r.json()
      if (isEdit) onUpdated?.(result)
      else onCreated?.(result)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {isEdit ? t('board.editCard') : t('board.createCard')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label={t('board.cardName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 255 } }}
          fullWidth
          required
          autoFocus
          sx={{ mt: 1 }}
        />
        <TextField
          label={t('board.cardDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={4}
          sx={{ mt: 2 }}
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
