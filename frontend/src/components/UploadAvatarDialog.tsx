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

const MAX_SIZE_BYTES = 100 * 1024
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

interface Props {
  open: boolean
  onClose: () => void
  accessToken: string
}

export default function UploadAvatarDialog({ open, onClose, accessToken }: Props) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setFile(null)
      setPreview(null)
      setError(null)
    }
  }, [open])

  // Revoke the object URL when it changes to avoid memory leaks
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview) }
  }, [preview])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    setError(null)

    if (!selected) { setFile(null); setPreview(null); return }

    if (!ALLOWED_MIME.includes(selected.type)) {
      setError(t('boards.avatarTypeError'))
      setFile(null); setPreview(null)
      return
    }
    if (selected.size > MAX_SIZE_BYTES) {
      setError(t('boards.avatarSizeError'))
      setFile(null); setPreview(null)
      return
    }

    setFile(selected)
    setPreview(URL.createObjectURL(selected))
  }

  async function handleSave() {
    if (!file) { setError(t('boards.noFileSelected')); return }

    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch('http://localhost:8000/api/v1/users/me/avatar', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
        body: form,
      })
      if (r.status === 413) { setError(t('boards.avatarSizeError')); return }
      if (r.status === 415) { setError(t('boards.avatarTypeError')); return }
      if (!r.ok) throw new Error()
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.uploadAvatar')}</DialogTitle>
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
              ref={inputRef}
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
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving || !file}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
