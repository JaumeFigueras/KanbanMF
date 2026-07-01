import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Delete } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { ChecklistData, ChecklistItemData } from '../types/board'

interface Props {
  open: boolean
  onClose: () => void
  checklist: ChecklistData | null
  onSave: (checklist: ChecklistData) => void
}

export default function ChecklistDialog({ open, onClose, checklist, onSave }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [items, setItems] = useState<ChecklistItemData[]>([])
  const [newItemText, setNewItemText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(checklist?.name ?? '')
      setItems(checklist?.items ?? [])
      setNewItemText('')
      setError(null)
    }
  }, [open, checklist])

  function handleAddItem() {
    const trimmed = newItemText.trim()
    if (!trimmed) return
    setItems((prev) => [...prev, { id: crypto.randomUUID(), text: trimmed, is_done: false }])
    setNewItemText('')
  }

  function handleEditItem(id: string, text: string) {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, text } : i))
  }

  function handleRemoveItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('board.checklistNameRequired'))
      return
    }
    const trimmedItems = items
      .map((i) => ({ ...i, text: i.text.trim() }))
      .filter((i) => i.text)
    onSave({ id: checklist?.id ?? crypto.randomUUID(), name: trimmedName, items: trimmedItems })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {checklist ? t('board.editChecklist') : t('board.createChecklist')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          label={t('board.checklistName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          fullWidth
          required
          autoFocus
          sx={{ mt: 1 }}
        />

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, mb: 0.5 }}>
          {t('board.checklistItems')}
        </Typography>

        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('board.noChecklistItems')}
          </Typography>
        )}

        <Stack spacing={1}>
          {items.map((item) => (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                size="small"
                value={item.text}
                onChange={(e) => handleEditItem(item.id, e.target.value)}
                fullWidth
              />
              <IconButton
                size="small"
                onClick={() => handleRemoveItem(item.id)}
                aria-label={t('board.removeChecklistItem')}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>

        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <TextField
            size="small"
            placeholder={t('board.addChecklistItem')}
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem() } }}
            fullWidth
          />
          <Button onClick={handleAddItem} variant="outlined" size="small" sx={{ flexShrink: 0 }}>
            {t('common.add')}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error">
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} color="success" variant="contained">
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
