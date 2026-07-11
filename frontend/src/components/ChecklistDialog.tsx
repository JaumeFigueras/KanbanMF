import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Delete, DragIndicator } from '@mui/icons-material'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { ChecklistData, ChecklistItemData } from '../types/board'

interface Props {
  open: boolean
  onClose: () => void
  checklist: ChecklistData | null
  onSave: (checklist: ChecklistData) => void
}

function SortableItemRow({
  item,
  onEditText,
  onRemove,
  removeLabel,
  dragLabel,
}: {
  item: ChecklistItemData
  onEditText: (text: string) => void
  onRemove: () => void
  removeLabel: string
  dragLabel: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

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
      <TextField
        size="small"
        value={item.text}
        onChange={(e) => onEditText(e.target.value)}
        fullWidth
      />
      <IconButton size="small" onClick={onRemove} aria-label={removeLabel}>
        <Delete fontSize="small" />
      </IconButton>
    </Box>
  )
}

export default function ChecklistDialog({ open, onClose, checklist, onSave }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [items, setItems] = useState<ChecklistItemData[]>([])
  const [newItemText, setNewItemText] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(checklist?.name ?? '')
      setItems(checklist?.items ?? [])
      setNewItemText('')
      setError(null)
    }
  }, [open, checklist])

  function handleAddItem() {
    const trimmed = newItemText.trim()
    if (!trimmed) return
    setItems((prev) => [...prev, { id: crypto.randomUUID(), text: trimmed, is_done: false }])
    setNewItemText('')
  }

  function handleEditItem(id: string, text: string) {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, text } : i))
  }

  function handleRemoveItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const itemSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id)
      const newIndex = prev.findIndex((i) => i.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('board.checklistNameRequired'))
      return
    }
    const trimmedItems = items
      .map((i) => ({ ...i, text: i.text.trim() }))
      .filter((i) => i.text)
    onSave({ id: checklist?.id ?? crypto.randomUUID(), name: trimmedName, items: trimmedItems })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {checklist ? t('board.editChecklist') : t('board.createChecklist')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          label={t('board.checklistName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
          fullWidth
          required
          autoFocus
          sx={{ mt: 1 }}
        />

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, mb: 0.5 }}>
          {t('board.checklistItems')}
        </Typography>

        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('board.noChecklistItems')}
          </Typography>
        )}

        <DndContext sensors={itemSensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <Stack spacing={1}>
              {items.map((item) => (
                <SortableItemRow
                  key={item.id}
                  item={item}
                  onEditText={(text) => handleEditItem(item.id, text)}
                  onRemove={() => handleRemoveItem(item.id)}
                  removeLabel={t('board.removeChecklistItem')}
                  dragLabel={t('board.moveChecklistItem')}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>

        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <TextField
            size="small"
            placeholder={t('board.addChecklistItem')}
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem() } }}
            fullWidth
          />
          <Button onClick={handleAddItem} variant="outlined" size="small" sx={{ flexShrink: 0 }}>
            {t('common.add')}
          </Button>
        </Box>
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
