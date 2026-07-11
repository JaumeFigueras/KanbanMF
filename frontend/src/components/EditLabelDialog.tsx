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
import type { LabelRead } from '../types/board'
import ColorPicker from './ColorPicker'

// Fallback swatch value for a brand-new label — matches the app's default
// indigo accent used elsewhere as a neutral starting color.
export const DEFAULT_LABEL_COLOR = '#6366F1'

interface Props {
  open: boolean
  onClose: () => void
  // null means "create a new label" — the form starts blank/default instead
  // of prefilled from an existing one.
  label: LabelRead | null
  saving?: boolean
  error?: string | null
  onSave: (form: { name: string; color: string }) => void
}

// A single dialog for both creating and editing a label — kept out of
// ManageLabelsDialog's own list so it doesn't turn the "all labels" dialog
// into a big inline form (same pattern as ChangeBoardColorDialog/
// ChangeListColorDialog/ChangeCardColorDialog being their own dialogs
// rather than inline in the parent view).
export default function EditLabelDialog({ open, onClose, label, saving, error, onSave }: Props) {
  const { t } = useTranslation()
  const isEdit = Boolean(label)
  const [name, setName] = useState('')
  const [color, setColor] = useState('')
  const [nameError, setNameError] = useState(false)

  useEffect(() => {
    if (open) {
      setName(label?.name ?? '')
      setColor(label?.color ?? DEFAULT_LABEL_COLOR)
      setNameError(false)
    }
  }, [open, label])

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(true)
      return
    }
    onSave({ name: trimmed, color })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEdit ? t('board.editLabel') : t('board.createNewLabel')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label={t('board.labelName')}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          error={nameError}
          helperText={nameError ? t('board.labelNameRequired') : undefined}
          fullWidth
          required
          autoFocus
          disabled={saving}
          sx={{ mt: 1 }}
        />
        <ColorPicker value={color} onChange={setColor} />
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
