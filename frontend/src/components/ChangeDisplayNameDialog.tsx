import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
  currentDisplayName: string
  currentInitials: string | null
  accessToken: string
  onSaved: (displayName: string, initials: string | null) => void
}

export default function ChangeDisplayNameDialog({
  open,
  onClose,
  currentDisplayName,
  currentInitials,
  accessToken,
  onSaved,
}: Props) {
  const { t } = useTranslation()
  const [displayName, setDisplayName] = useState(currentDisplayName)
  const [initials, setInitials] = useState(currentInitials ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDisplayName(currentDisplayName)
      setInitials(currentInitials ?? '')
      setError(null)
    }
  }, [open, currentDisplayName, currentInitials])

  function validate(): string | null {
    if (!displayName.trim()) return t('boards.displayNameRequired')
    if (initials && !/^[a-zA-Z0-9]{1,3}$/.test(initials.trim())) return t('boards.initialsInvalid')
    return null
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    setError(null)
    try {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      }
      const [r1, r2] = await Promise.all([
        fetch('http://localhost:8000/api/v1/users/me', {
          method: 'PUT',
          headers,
          credentials: 'include',
          body: JSON.stringify({ display_name: displayName.trim() }),
        }),
        fetch('http://localhost:8000/api/v1/users/me/preferences', {
          method: 'PUT',
          headers,
          credentials: 'include',
          body: JSON.stringify({ initials: initials.trim() || null }),
        }),
      ])
      if (!r1.ok || !r2.ok) throw new Error()
      onSaved(displayName.trim(), initials.trim().toUpperCase() || null)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.changeDisplayName')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('signUp.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label={t('boards.initials')}
            value={initials}
            onChange={(e) => setInitials(e.target.value.slice(0, 3))}
            slotProps={{ htmlInput: { maxLength: 3 } }}
            helperText={t('boards.initialsHint')}
            fullWidth
          />
        </Stack>
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
