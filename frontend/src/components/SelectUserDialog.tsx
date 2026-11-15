import { useState } from 'react'
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
import type { PersonSummary } from '../types/board'
import PersonAvatar from './PersonAvatar'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  // null until the board's people have loaded. Until then the dialog can't
  // tell "nobody" from "not here yet", and saving would take everyone off
  // the card, so Save waits.
  candidates: PersonSummary[] | null
  // Loading them failed: Save stays disabled for good.
  loadFailed?: boolean
  selectedIds: string[]
  onSave: (people: PersonSummary[]) => void
}

export default function SelectUserDialog({
  open, onClose, title, candidates, loadFailed = false, selectedIds, onSave,
}: Props) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // Reset the form each time the dialog opens. Done while rendering rather
  // than in an effect, so the first frame already shows the fresh values.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setChecked(new Set(selectedIds))
  }

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave(loaded: PersonSummary[]) {
    onSave(loaded.filter((c) => checked.has(c.id)))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {loadFailed && <Alert severity="error">{t('board.peopleLoadError')}</Alert>}
        {candidates === null && !loadFailed && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {candidates?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('board.noUsersAvailable')}
          </Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          {candidates?.map((person) => (
            <Box
              key={person.id}
              onClick={() => toggle(person.id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1,
                borderRadius: 1,
                cursor: 'pointer',
                border: 1,
                borderColor: checked.has(person.id) ? 'primary.main' : 'divider',
              }}
            >
              <Checkbox
                checked={checked.has(person.id)}
                size="small"
                sx={{ p: 0 }}
                slotProps={{ input: { 'aria-label': person.display_name } }}
              />
              <PersonAvatar person={person} />
              <Typography variant="body2">{person.display_name}</Typography>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error">
          {t('common.cancel')}
        </Button>
        <Button
          onClick={() => candidates && handleSave(candidates)}
          color="success"
          variant="contained"
          disabled={candidates === null}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
