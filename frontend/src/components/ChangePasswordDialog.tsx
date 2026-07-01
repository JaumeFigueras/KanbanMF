import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
} from '@mui/material'
import { Visibility, VisibilityOff } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ChangePasswordDialog({ open, onClose }: Props) {
  const { t } = useTranslation()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowOld(false)
      setShowNew(false)
      setShowConfirm(false)
      setError(null)
    }
  }, [open])

  function validate(): string | null {
    if (!oldPassword) return t('boards.oldPasswordRequired')
    if (!newPassword) return t('boards.newPasswordRequired')
    if (!confirmPassword) return t('boards.confirmPasswordRequired')
    if (newPassword !== confirmPassword) return t('signUp.passwordMismatch')
    return null
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch('http://localhost:8000/api/v1/users/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      })
      if (r.status === 400) {
        const body = await r.json()
        if (body.detail === 'Current password is incorrect') {
          setError(t('boards.wrongOldPassword'))
        } else {
          setError(t('common.saveError'))
        }
        return
      }
      if (!r.ok) throw new Error()
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  function visibilityAdornment(visible: boolean, toggle: () => void) {
    return (
      <InputAdornment position="end">
        <IconButton onClick={toggle} edge="end" tabIndex={-1}>
          {visible ? <VisibilityOff /> : <Visibility />}
        </IconButton>
      </InputAdornment>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.changePassword')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('boards.oldPassword')}
            type={showOld ? 'text' : 'password'}
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            slotProps={{ input: { endAdornment: visibilityAdornment(showOld, () => setShowOld((v) => !v)) } }}
            fullWidth
            autoFocus
          />
          <TextField
            label={t('boards.newPassword')}
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            slotProps={{ input: { endAdornment: visibilityAdornment(showNew, () => setShowNew((v) => !v)) } }}
            fullWidth
          />
          <TextField
            label={t('signUp.confirmPassword')}
            type={showConfirm ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            slotProps={{ input: { endAdornment: visibilityAdornment(showConfirm, () => setShowConfirm((v) => !v)) } }}
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
