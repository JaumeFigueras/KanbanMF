import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material'
import { Delete, DragIndicator, Edit } from '@mui/icons-material'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { LabelRead } from '../types/board'
import { apiFetch } from '../api/client'
import { contrastColor } from '../utils/labelColor'
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

function SortableLabelRow({
  label,
  onEdit,
  onRemove,
  editLabel,
  removeLabel,
  dragLabel,
}: {
  label: LabelRead
  onEdit: () => void
  onRemove: () => void
  editLabel: string
  removeLabel: string
  dragLabel: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label.id })

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: isDragging ? 0.5 : 1 }}
    >
      <IconButton
        size="small"
        aria-label={dragLabel}
        sx={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', flexShrink: 0 }}
        {...attributes}
        {...listeners}
      >
        <DragIndicator fontSize="small" />
      </IconButton>
      <LabelChip label={label} />
      <Tooltip title={editLabel}>
        <IconButton size="small" onClick={onEdit}>
          <Edit fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={removeLabel}>
        <IconButton size="small" color="error" onClick={onRemove}>
          <Delete fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

export default function ManageLabelsDialog({ open, onClose, boardId }: Props) {
  const { t } = useTranslation()
  const [labels, setLabels] = useState<LabelRead[]>([])
  const [formOpen, setFormOpen] = useState(false)
  // Which label the form dialog is editing — null means it's creating a new one.
  const [editingLabel, setEditingLabel] = useState<LabelRead | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const jsonHeaders = { 'Content-Type': 'application/json' }
  const API = `/api/v1/boards/${boardId}/labels`

  useEffect(() => {
    if (!open) return
    setFormOpen(false)
    setEditingLabel(null)
    setError(null)
    apiFetch(API)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setLabels)
      .catch(err => setError(String(err)))
  }, [open, boardId, API])

  function openCreateForm() {
    setEditingLabel(null)
    setFormOpen(true)
    setError(null)
  }

  function openEditForm(label: LabelRead) {
    setEditingLabel(label)
    setFormOpen(true)
    setError(null)
  }

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
        setFormOpen(false)
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
        setFormOpen(false)
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

  const labelSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = labels.findIndex(l => l.id === active.id)
    const newIndex = labels.findIndex(l => l.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(labels, oldIndex, newIndex)
    setLabels(reordered)

    apiFetch(`${API}/order`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ label_ids: reordered.map(l => l.id) }),
    })
      .then(r => { if (!r.ok) throw new Error() })
      .catch(() => {
        // Rejected (e.g. stale state) — resync from the server.
        apiFetch(API)
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(setLabels)
          .catch(() => setError(t('common.saveError')))
      })
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{t('board.manageLabels')}</DialogTitle>

        <DialogContent sx={{ pt: 2.5, pb: 1 }}>
          {error && !formOpen && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {labels.length === 0 && !error && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('board.noLabels')}
            </Typography>
          )}

          <DndContext sensors={labelSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={labels.map(l => l.id)} strategy={verticalListSortingStrategy}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1 }}>
                {labels.map(label => (
                  <SortableLabelRow
                    key={label.id}
                    label={label}
                    onEdit={() => openEditForm(label)}
                    onRemove={() => handleDelete(label.id)}
                    editLabel={t('board.editLabel')}
                    removeLabel={t('board.deleteLabel')}
                    dragLabel={t('board.moveLabel')}
                  />
                ))}
              </Box>
            </SortableContext>
          </DndContext>
        </DialogContent>

        <Divider />

        <DialogActions sx={{ justifyContent: 'space-between', px: 2.5, py: 2 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={formOpen}
            onClick={openCreateForm}
          >
            {t('board.createNewLabel')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <EditLabelDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        label={editingLabel}
        saving={saving}
        error={error}
        onSave={form => editingLabel ? handleEdit(editingLabel, form) : handleCreate(form)}
      />
    </>
  )
}
