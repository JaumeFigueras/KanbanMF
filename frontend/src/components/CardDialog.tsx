import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from '@mui/material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { useTranslation } from 'react-i18next'
import dayjs, { type Dayjs } from 'dayjs'
import type { CardRead } from '../types/board'
import CardDateField from './CardDateField'
import { dayjsLocaleFor } from '../utils/locale'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  listId: string
  boardId: string
  numberLocale: string
  card?: CardRead | null
  onCreated?: (card: CardRead) => void
  onUpdated?: (card: CardRead) => void
}

export default function CardDialog({
  open,
  onClose,
  listId,
  boardId,
  numberLocale,
  card,
  onCreated,
  onUpdated,
}: Props) {
  const { t } = useTranslation()
  const isEdit = Boolean(card)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState<Dayjs | null>(null)
  const [dueAt, setDueAt] = useState<Dayjs | null>(null)
  const [endAt, setEndAt] = useState<Dayjs | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(card?.name ?? '')
      setDescription(card?.description ?? '')
      setStartAt(card?.start_at ? dayjs(card.start_at) : null)
      setDueAt(card?.due_at ? dayjs(card.due_at) : null)
      setEndAt(card?.end_at ? dayjs(card.end_at) : null)
      setError(null)
    }
  }, [open, card])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('board.cardNameRequired'))
      return
    }
    if (startAt && endAt && startAt.isAfter(endAt)) {
      setError(t('board.dateOrderError'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const url = isEdit
        ? `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card!.id}`
        : `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards`
      const r = await apiFetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
          start_at: startAt ? startAt.toISOString() : null,
          due_at: dueAt ? dueAt.toISOString() : null,
          end_at: endAt ? endAt.toISOString() : null,
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

  const dayjsLocale = dayjsLocaleFor(numberLocale)

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

        <Divider sx={{ mt: 3, mb: 2 }} />

        <Typography variant="overline" color="text.secondary">
          {t('board.dates')}
        </Typography>

        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocale}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
            <CardDateField
              label={t('board.startDate')}
              value={startAt}
              onChange={setStartAt}
            />
            <CardDateField
              label={t('board.dueDate')}
              value={dueAt}
              onChange={setDueAt}
            />
            <CardDateField
              label={t('board.endDate')}
              value={endAt}
              onChange={setEndAt}
            />
          </Box>
        </LocalizationProvider>
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
