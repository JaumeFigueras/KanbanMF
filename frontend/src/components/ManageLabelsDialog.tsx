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
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { LabelRead } from '../types/board'
import { apiFetch } from '../api/client'
import { contrastColor } from '../utils/labelColor'
import { cancelDragOnEscape, dragAccessibility } from '../utils/dragAccessibility'
import DeleteLabelDialog from './DeleteLabelDialog'
import EditLabelDialog from './EditLabelDialog'

interface Props {
  open: boolean
  onClose: () => void
  boardId: string
  // A label was renamed, recoloured, reordered or deleted: the cards show
  // their labels, in the labels' order, so the board fetches them again.
  // Not called for a new label, which is on no card yet.
  onChanged?: () => void
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
  editName,
  removeName,
  dragLabel,
  roleDescription,
}: {
  label: LabelRead
  onEdit: () => void
  onRemove: () => void
  // The tooltips; the buttons' own names (outranking the tooltips') name
  // the label, as every row has the same buttons.
  editLabel: string
  removeLabel: string
  editName: string
  removeName: string
  dragLabel: string
  roleDescription: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label.id, attributes: { roleDescription } })

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
        <IconButton size="small" aria-label={editName} onClick={onEdit}>
          <Edit fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={removeLabel}>
        <IconButton size="small" color="error" aria-label={removeName} onClick={onRemove}>
          <Delete fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

export default function ManageLabelsDialog({ open, onClose, boardId, onChanged }: Props) {
  const { t } = useTranslation()
  const [labels, setLabels] = useState<LabelRead[]>([])
  const [formOpen, setFormOpen] = useState(false)
  // Which label the form dialog is editing — null means it's creating a new one.
  const [editingLabel, setEditingLabel] = useState<LabelRead | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The label the delete confirmation asks about. Kept after it closes, so
  // its text doesn't change while it fades out.
  const [labelToDelete, setLabelToDelete] = useState<LabelRead | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const jsonHeaders = { 'Content-Type': 'application/json' }
  const API = `/api/v1/boards/${boardId}/labels`

  // Reset the form each time the dialog opens. Done while rendering rather
  // than in an effect, so the first frame already shows the fresh values.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setFormOpen(false)
      setEditingLabel(null)
      setError(null)
    }
  }

  useEffect(() => {
    if (!open) return
    apiFetch(API)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setLabels)
      .catch(() => setError(t('board.labelsLoadError')))
  }, [open, boardId, API, t])

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
      if (!r.ok) throw new Error()
      const created: LabelRead = await r.json()
      setLabels(prev => [...prev, created])
      setFormOpen(false)
    } catch {
      setError(t('common.saveError'))
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
      if (!r.ok) throw new Error()
      const updated: LabelRead = await r.json()
      setLabels(prev => prev.map(l => l.id === updated.id ? updated : l))
      setFormOpen(false)
      onChanged?.()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  function askToDelete(label: LabelRead) {
    setLabelToDelete(label)
    setDeleteOpen(true)
  }

  const labelSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const labelDragAccessibility = dragAccessibility(
    t,
    id => t('drag.label', { name: labels.find(l => l.id === id)?.name }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = labels.findIndex(l => l.id === active.id)
    const newIndex = labels.findIndex(l => l.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const before = labels
    const reordered = arrayMove(labels, oldIndex, newIndex)
    setLabels(reordered)
    setError(null)

    apiFetch(`${API}/order`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ label_ids: reordered.map(l => l.id) }),
    })
      .then(r => {
        if (!r.ok) throw new Error()
        onChanged?.()
      })
      .catch(() => {
        // Refused (a label added or deleted elsewhere meanwhile) or not sent:
        // the labels go back to their order before the drag, and the dialog
        // says so. Then they're fetched again, so that trying again can
        // work; if that fails too, the order before the drag stays.
        setLabels(before)
        setError(t('common.moveFailed'))
        apiFetch(API)
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(setLabels)
          .catch(() => {})
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

          <DndContext
            sensors={labelSensors}
            collisionDetection={closestCenter}
            accessibility={labelDragAccessibility}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={labels.map(l => l.id)} strategy={verticalListSortingStrategy}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1 }} onKeyDown={cancelDragOnEscape}>
                {labels.map(label => (
                  <SortableLabelRow
                    key={label.id}
                    label={label}
                    onEdit={() => openEditForm(label)}
                    onRemove={() => askToDelete(label)}
                    editLabel={t('board.editLabel')}
                    removeLabel={t('board.deleteLabel')}
                    editName={t('board.editLabelNamed', { name: label.name })}
                    removeName={t('board.deleteLabelNamed', { name: label.name })}
                    dragLabel={t('board.moveLabelNamed', { name: label.name })}
                    roleDescription={t('drag.roleDescription')}
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
        onClose={() => {
          // A cancelled form's error is about nothing any more; the list
          // behind it would show it otherwise, since they share it.
          setFormOpen(false)
          setError(null)
        }}
        label={editingLabel}
        saving={saving}
        error={error}
        onSave={form => editingLabel ? handleEdit(editingLabel, form) : handleCreate(form)}
      />

      <DeleteLabelDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        boardId={boardId}
        label={labelToDelete}
        onDeleted={id => {
          setLabels(prev => prev.filter(l => l.id !== id))
          onChanged?.()
        }}
      />
    </>
  )
}
