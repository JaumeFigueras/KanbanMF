import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  TextField,
  Typography,
} from '@mui/material'
import { Add, Label as LabelIcon, People as PeopleIcon } from '@mui/icons-material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { useTranslation } from 'react-i18next'
import dayjs, { type Dayjs } from 'dayjs'
import type { CardRead, LabelRead, PersonSummary } from '../types/board'
import CardDateField from './CardDateField'
import CardLabelPickerDialog from './CardLabelPickerDialog'
import PersonAvatar from './PersonAvatar'
import SelectUserDialog from './SelectUserDialog'
import { dayjsLocaleFor } from '../utils/locale'
import { contrastColor } from '../utils/labelColor'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  listId: string
  boardId: string
  numberLocale: string
  card?: CardRead | null
  onCreated?: (card: CardRead) => void
  onUpdated?: (card: CardRead) => void
}

export default function CardDialog({
  open,
  onClose,
  listId,
  boardId,
  numberLocale,
  card,
  onCreated,
  onUpdated,
}: Props) {
  const { t } = useTranslation()
  const isEdit = Boolean(card)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState<Dayjs | null>(null)
  const [dueAt, setDueAt] = useState<Dayjs | null>(null)
  const [endAt, setEndAt] = useState<Dayjs | null>(null)
  const [selectedLabels, setSelectedLabels] = useState<LabelRead[]>([])
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)
  const [members, setMembers] = useState<PersonSummary[]>([])
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  const [assignees, setAssignees] = useState<PersonSummary[]>([])
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  const [candidates, setCandidates] = useState<PersonSummary[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const creator = card?.creator ?? null

  useEffect(() => {
    if (open) {
      setName(card?.name ?? '')
      setDescription(card?.description ?? '')
      setStartAt(card?.start_at ? dayjs(card.start_at) : null)
      setDueAt(card?.due_at ? dayjs(card.due_at) : null)
      setEndAt(card?.end_at ? dayjs(card.end_at) : null)
      setSelectedLabels(card?.labels ?? [])
      setMembers(card?.members ?? [])
      setAssignees(card?.assignees ?? [])
      setError(null)
    }
  }, [open, card])

  useEffect(() => {
    if (!open) return
    apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/members`)
      .then((r) => r.ok ? r.json() as Promise<PersonSummary[]> : [])
      .then(setCandidates)
      .catch(() => {})
  }, [open, boardId])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('board.cardNameRequired'))
      return
    }
    if (startAt && endAt && startAt.isAfter(endAt)) {
      setError(t('board.dateOrderError'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const url = isEdit
        ? `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card!.id}`
        : `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards`
      const r = await apiFetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
          start_at: startAt ? startAt.toISOString() : null,
          due_at: dueAt ? dueAt.toISOString() : null,
          end_at: endAt ? endAt.toISOString() : null,
          label_ids: selectedLabels.map((l) => l.id),
          member_ids: members.map((p) => p.id),
          assignee_ids: assignees.map((p) => p.id),
        }),
      })
      if (!r.ok) throw new Error()
      const result: CardRead = await r.json()
      if (isEdit) onUpdated?.(result)
      else onCreated?.(result)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const dayjsLocale = dayjsLocaleFor(numberLocale)

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {isEdit ? t('board.editCard') : t('board.createCard')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          label={t('board.cardName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 255 } }}
          fullWidth
          required
          autoFocus
          sx={{ mt: 1 }}
        />
        <TextField
          label={t('board.cardDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={4}
          sx={{ mt: 2 }}
        />

        <Divider sx={{ mt: 3, mb: 2 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
          <LabelIcon fontSize="small" color="action" />
          <Typography variant="overline" color="text.secondary">
            {t('board.labels')}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {selectedLabels.map((label) => (
            <Chip
              key={label.id}
              label={label.name}
              onClick={() => setLabelPickerOpen(true)}
              sx={{
                bgcolor: label.color,
                color: contrastColor(label.color),
                fontWeight: 700,
                fontSize: '0.9rem',
                height: 32,
                cursor: 'pointer',
              }}
            />
          ))}
          <IconButton
            size="small"
            onClick={() => setLabelPickerOpen(true)}
            aria-label={t('board.manageCardLabels')}
          >
            <Add fontSize="small" />
          </IconButton>
        </Box>

        <Divider sx={{ mt: 3, mb: 2 }} />

        <Typography variant="overline" color="text.secondary">
          {t('board.dates')}
        </Typography>

        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocale}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
            <CardDateField
              label={t('board.startDate')}
              value={startAt}
              onChange={setStartAt}
            />
            <CardDateField
              label={t('board.dueDate')}
              value={dueAt}
              onChange={setDueAt}
            />
            <CardDateField
              label={t('board.endDate')}
              value={endAt}
              onChange={setEndAt}
            />
          </Box>
        </LocalizationProvider>

        <Divider sx={{ mt: 3, mb: 2 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
          <PeopleIcon fontSize="small" color="action" />
          <Typography variant="overline" color="text.secondary">
            {t('board.people')}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('board.creator')}
            </Typography>
            {creator ? (
              <PersonAvatar person={creator} />
            ) : (
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: '2px dashed',
                  borderColor: 'divider',
                }}
              />
            )}
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('board.members')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
              {members.map((person) => (
                <PersonAvatar key={person.id} person={person} onClick={() => setMemberPickerOpen(true)} />
              ))}
              <IconButton
                size="small"
                onClick={() => setMemberPickerOpen(true)}
                aria-label={t('board.manageMembers')}
              >
                <Add fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('board.assignees')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
              {assignees.map((person) => (
                <PersonAvatar key={person.id} person={person} onClick={() => setAssigneePickerOpen(true)} />
              ))}
              <IconButton
                size="small"
                onClick={() => setAssigneePickerOpen(true)}
                aria-label={t('board.manageAssignees')}
              >
                <Add fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving}>
          {t('common.save')}
        </Button>
      </DialogActions>

      <CardLabelPickerDialog
        open={labelPickerOpen}
        onClose={() => setLabelPickerOpen(false)}
        boardId={boardId}
        selectedIds={selectedLabels.map((l) => l.id)}
        onSave={setSelectedLabels}
      />

      <SelectUserDialog
        open={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title={t('board.selectMembers')}
        candidates={candidates}
        selectedIds={members.map((p) => p.id)}
        onSave={setMembers}
      />

      <SelectUserDialog
        open={assigneePickerOpen}
        onClose={() => setAssigneePickerOpen(false)}
        title={t('board.selectAssignees')}
        candidates={candidates}
        selectedIds={assignees.map((p) => p.id)}
        onSave={setAssignees}
      />
    </Dialog>
  )
}
