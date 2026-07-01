import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { CloudUpload } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'

const MAX_SIZE_BYTES = 100 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

interface Props {
  open: boolean
  onClose: () => void
  hasAvatar: boolean
  currentAvatarUrl: string | null
  onSaved?: () => void
}

export default function UploadAvatarDialog({
  open,
  onClose,
  hasAvatar,
  currentAvatarUrl,
  onSaved,
}: Props) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  // preview is either the currentAvatarUrl (not owned by us) or a blob URL we created
  const [preview, setPreview] = useState<string | null>(null)
  const ownedPreviewRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setFile(null)
      setError(null)
      // Revoke any previously created blob URL before resetting
      if (ownedPreviewRef.current) {
        URL.revokeObjectURL(ownedPreviewRef.current)
        ownedPreviewRef.current = null
      }
      setPreview(currentAvatarUrl)
    }
  }, [open, currentAvatarUrl])

  // Revoke owned blob URL on unmount
  useEffect(() => {
    return () => {
      if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current)
    }
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    setError(null)

    if (!selected) return

    if (!ALLOWED_MIME.includes(selected.type)) {
      setError(t('boards.avatarTypeError'))
      return
    }
    if (selected.size > MAX_SIZE_BYTES) {
      setError(t('boards.avatarSizeError'))
      return
    }

    if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current)
    const url = URL.createObjectURL(selected)
    ownedPreviewRef.current = url
    setFile(selected)
    setPreview(url)
  }

  async function handleSave() {
    if (!file) { setError(t('boards.noFileSelected')); return }

    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await apiFetch('http://localhost:8000/api/v1/users/me/avatar', {
        method: 'PUT',
        body: form,
      })
      if (r.status === 413) { setError(t('boards.avatarSizeError')); return }
      if (r.status === 415) { setError(t('boards.avatarTypeError')); return }
      if (!r.ok) throw new Error()
      onSaved?.()
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch('http://localhost:8000/api/v1/users/me/avatar', {
        method: 'DELETE',
      })
      if (!r.ok) throw new Error()
      onSaved?.()
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {hasAvatar ? t('boards.changeRemoveAvatar') : t('boards.uploadAvatar')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1, alignItems: 'center' }}>
          {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

          {preview ? (
            <Box
              component="img"
              src={preview}
              alt="preview"
              sx={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '2px solid', borderColor: 'divider' }}
            />
          ) : (
            <Box
              sx={{ width: 120, height: 120, borderRadius: '50%', border: '2px dashed', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}
            >
              <CloudUpload sx={{ fontSize: 40 }} />
            </Box>
          )}

          <Button variant="outlined" component="label" disabled={saving}>
            {t('boards.chooseFile')}
            <input
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
            />
          </Button>

          {file && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </Typography>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            {t('boards.avatarSizeLimit')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        {hasAvatar && (
          <Button onClick={handleRemove} color="warning" variant="outlined" disabled={saving}>
            {t('boards.removeAvatar')}
          </Button>
        )}
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving || !file}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
