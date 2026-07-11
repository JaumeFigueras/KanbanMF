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

interface Props {
  open: boolean
  onClose: () => void
  label: LabelRead | null
  saving?: boolean
  error?: string | null
  onSave: (form: { name: string; color: string }) => void
}

// A separate popup for editing an existing label's name/color — kept out of
// ManageLabelsDialog's own list so editing one label doesn't turn the whole
// "all labels" dialog into a big inline form (same pattern as
// ChangeBoardColorDialog/ChangeListColorDialog/ChangeCardColorDialog being
// their own dialogs rather than inline in the parent view).
export default function EditLabelDialog({ open, onClose, label, saving, error, onSave }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [color, setColor] = useState('')
  const [nameError, setNameError] = useState(false)

  useEffect(() => {
    if (open && label) {
      setName(label.name)
      setColor(label.color)
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
      <DialogTitle>{t('board.editLabel')}</DialogTitle>
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
