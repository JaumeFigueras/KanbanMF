import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
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
  candidates: PersonSummary[]
  selectedIds: string[]
  onSave: (people: PersonSummary[]) => void
}

export default function SelectUserDialog({ open, onClose, title, candidates, selectedIds, onSave }: Props) {
  const { t } = useTranslation()
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setChecked(new Set(selectedIds))
  }, [open, selectedIds])

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave() {
    onSave(candidates.filter((c) => checked.has(c.id)))
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {candidates.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('board.noUsersAvailable')}
          </Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          {candidates.map((person) => (
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
              <Checkbox checked={checked.has(person.id)} size="small" sx={{ p: 0 }} />
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
        <Button onClick={handleSave} color="success" variant="contained">
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
