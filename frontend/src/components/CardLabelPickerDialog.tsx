import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { LabelRead } from '../types/board'
import { apiFetch } from '../api/client'
import { contrastColor } from '../utils/labelColor'

interface Props {
  open: boolean
  onClose: () => void
  boardId: string
  selectedIds: string[]
  onSave: (labels: LabelRead[]) => void
}

export default function CardLabelPickerDialog({ open, onClose, boardId, selectedIds, onSave }: Props) {
  const { t } = useTranslation()
  // null until this opening's labels have loaded. Until then the dialog
  // can't tell "no labels" from "not here yet", and saving would take every
  // label off the card, so Save waits.
  const [labels, setLabels] = useState<LabelRead[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // Reset the form each time the dialog opens. Done while rendering rather
  // than in an effect, so the first frame already shows the fresh values.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setChecked(new Set(selectedIds))
      setLabels(null)
      setLoadFailed(false)
    }
  }

  useEffect(() => {
    if (!open) return
    apiFetch(`/api/v1/boards/${boardId}/labels`)
      .then(r => r.ok ? r.json() as Promise<LabelRead[]> : Promise.reject())
      .then(setLabels)
      .catch(() => setLoadFailed(true))
  }, [open, boardId])

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave(loaded: LabelRead[]) {
    onSave(loaded.filter(l => checked.has(l.id)))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('board.selectLabels')}</DialogTitle>
      <DialogContent>
        {loadFailed && <Alert severity="error">{t('board.labelsLoadError')}</Alert>}
        {labels === null && !loadFailed && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {labels?.length === 0 && (
          <Typography variant="body2" color="text.secondary">{t('board.noLabels')}</Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          {labels?.map(label => (
            <Box
              key={label.id}
              onClick={() => toggle(label.id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                borderRadius: 1,
                cursor: 'pointer',
                border: 1,
                borderColor: checked.has(label.id) ? 'primary.main' : 'divider',
                pr: 1,
              }}
            >
              <Checkbox
                checked={checked.has(label.id)}
                size="small"
                slotProps={{ input: { 'aria-label': label.name } }}
              />
              <Box
                sx={{
                  flexGrow: 1,
                  px: 1.5,
                  py: 0.75,
                  borderRadius: 1,
                  bgcolor: label.color,
                  color: contrastColor(label.color),
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label.name}
              </Box>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error">
          {t('common.cancel')}
        </Button>
        <Button
          onClick={labels ? () => handleSave(labels) : undefined}
          disabled={!labels}
          color="success"
          variant="contained"
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
