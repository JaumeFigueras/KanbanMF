import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { BoardRead } from '../types/board'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  template: BoardRead | null
  onDuplicated: (copy: BoardRead) => void
}

// Board names are capped at 255 characters server-side; "Copy of …" on a
// name already near the cap would otherwise be rejected on save.
const MAX_NAME_LENGTH = 255

export default function DuplicateTemplateDialog({ open, onClose, template, onDuplicated }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      {/* Dialog unmounts its content while closed, so the form starts fresh —
          with the default name for this template — every time it opens. */}
      {template && <DuplicateTemplateForm template={template} onClose={onClose} onDuplicated={onDuplicated} />}
    </Dialog>
  )
}

function DuplicateTemplateForm({
  template,
  onClose,
  onDuplicated,
}: {
  template: BoardRead
  onClose: () => void
  onDuplicated: (copy: BoardRead) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(
    () => t('boards.duplicateTemplateDefaultName', { name: template.name }).slice(0, MAX_NAME_LENGTH),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('boards.templateNameRequired'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/boards/${template.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!r.ok) throw new Error()
      const copy: BoardRead = await r.json()
      onDuplicated(copy)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogTitle>{t('boards.duplicateTemplateTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>{t('boards.duplicateTemplateHint')}</DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          label={t('boards.templateName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          slotProps={{ htmlInput: { maxLength: MAX_NAME_LENGTH } }}
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
    </>
  )
}
