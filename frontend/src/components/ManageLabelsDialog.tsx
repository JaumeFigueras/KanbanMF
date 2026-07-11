import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Delete, Edit } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { LabelRead } from '../types/board'
import { apiFetch } from '../api/client'
import { contrastColor } from '../utils/labelColor'
import ColorPicker from './ColorPicker'
import EditLabelDialog from './EditLabelDialog'

interface Props {
  open: boolean
  onClose: () => void
  boardId: string
}

interface LabelForm {
  name: string
  color: string
}

const DEFAULT_COLOR = '#6366F1'

function LabelChip({ label }: { label: LabelRead }) {
  return (
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
  )
}

function InlineForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: LabelForm
  onSave: (form: LabelForm) => void
  onCancel: () => void
  saving?: boolean
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<LabelForm>(initial)
  const [nameError, setNameError] = useState(false)

  function handleSave() {
    if (!form.name.trim()) { setNameError(true); return }
    onSave({ name: form.name.trim(), color: form.color })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <TextField
        size="small"
        label={t('board.labelName')}
        value={form.name}
        onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setNameError(false) }}
        onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
        error={nameError}
        helperText={nameError ? t('board.labelNameRequired') : undefined}
        fullWidth
        autoFocus
        disabled={saving}
      />
      <ColorPicker value={form.color} onChange={color => setForm(f => ({ ...f, color }))} />
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t('common.save')}
        </Button>
        <Button size="small" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </Box>
    </Box>
  )
}

export default function ManageLabelsDialog({ open, onClose, boardId }: Props) {
  const { t } = useTranslation()
  const [labels, setLabels] = useState<LabelRead[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const jsonHeaders = { 'Content-Type': 'application/json' }
  const API = `/api/v1/boards/${boardId}/labels`

  useEffect(() => {
    if (!open) return
    setEditingId(null)
    setCreating(false)
    setError(null)
    apiFetch(API)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setLabels)
      .catch(err => setError(String(err)))
  }, [open, boardId, API])

  async function handleCreate(form: LabelForm) {
    setError(null)
    setSaving(true)
    try {
      const r = await apiFetch(API, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: form.name, color: form.color }),
      })
      if (r.ok) {
        const created: LabelRead = await r.json()
        setLabels(prev => [...prev, created])
        setCreating(false)
      } else {
        const body = await r.json().catch(() => ({}))
        setError(body.detail ?? `HTTP ${r.status}`)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(label: LabelRead, form: LabelForm) {
    setError(null)
    setSaving(true)
    try {
      const r = await apiFetch(`${API}/${label.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ name: form.name, color: form.color }),
      })
      if (r.ok) {
        const updated: LabelRead = await r.json()
        setLabels(prev => prev.map(l => l.id === updated.id ? updated : l))
        setEditingId(null)
      } else {
        const body = await r.json().catch(() => ({}))
        setError(body.detail ?? `HTTP ${r.status}`)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(labelId: string) {
    setError(null)
    const r = await apiFetch(`${API}/${labelId}`, { method: 'DELETE' })
    if (r.ok) {
      setLabels(prev => prev.filter(l => l.id !== labelId))
    } else {
      const body = await r.json().catch(() => ({}))
      setError(body.detail ?? `HTTP ${r.status}`)
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{t('board.manageLabels')}</DialogTitle>

        <DialogContent sx={{ pt: 2.5, pb: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {labels.length === 0 && !creating && !error && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('board.noLabels')}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1 }}>
            {labels.map(label => (
              <Box key={label.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LabelChip label={label} />
                <Tooltip title={t('board.editLabel')}>
                  <IconButton
                    size="small"
                    onClick={() => { setCreating(false); setEditingId(label.id) }}
                  >
                    <Edit fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('board.deleteLabel')}>
                  <IconButton size="small" color="error" onClick={() => handleDelete(label.id)}>
                    <Delete fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}

            {creating && (
              <InlineForm
                initial={{ name: '', color: DEFAULT_COLOR }}
                onSave={handleCreate}
                onCancel={() => setCreating(false)}
                saving={saving}
              />
            )}
          </Box>
        </DialogContent>

        <Divider />

        <DialogActions sx={{ justifyContent: 'space-between', px: 2.5, py: 2 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={creating || editingId !== null}
            onClick={() => { setEditingId(null); setCreating(true); setError(null) }}
          >
            {t('board.createNewLabel')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <EditLabelDialog
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        label={labels.find(l => l.id === editingId) ?? null}
        saving={saving}
        error={error}
        onSave={form => {
          const label = labels.find(l => l.id === editingId)
          if (label) handleEdit(label, form)
        }}
      />
    </>
  )
}
