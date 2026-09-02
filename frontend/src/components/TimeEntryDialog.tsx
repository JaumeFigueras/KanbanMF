import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material'
import { MobileDateTimePicker } from '@mui/x-date-pickers/MobileDateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import { dayjsLocaleFor } from '../utils/locale'
import type { TimeEntryRead } from '../types/timeTracker'
import CardPicker, { type CardSelection } from './CardPicker'

interface Props {
  open: boolean
  onClose: () => void
  // null → record a stretch of work that wasn't tracked live; otherwise edit
  // that entry. The two share every field except which card details come from.
  entry: TimeEntryRead | null
  numberLocale: string
  onSaved: (entry: TimeEntryRead) => void
}

const EMPTY: CardSelection = { boardId: '', listId: '', cardId: '' }

export default function TimeEntryDialog({ open, onClose, entry, numberLocale, onSaved }: Props) {
  const { t } = useTranslation()
  const isEdit = entry !== null
  const [startAt, setStartAt] = useState<Dayjs | null>(null)
  const [endAt, setEndAt] = useState<Dayjs | null>(null)
  const [boardName, setBoardName] = useState('')
  const [cardName, setCardName] = useState('')
  const [comment, setComment] = useState('')
  // Editing an entry keeps its stored snapshot by default; ticking this
  // re-copies board name, card name and labels from a card that exists now.
  const [recopy, setRecopy] = useState(false)
  const [selection, setSelection] = useState<CardSelection>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setRecopy(false)
    setSelection(EMPTY)
    if (entry) {
      setStartAt(dayjs(entry.started_at))
      setEndAt(entry.ended_at ? dayjs(entry.ended_at) : null)
      setBoardName(entry.board_name)
      setCardName(entry.card_name)
      setComment(entry.comment ?? '')
    } else {
      // An hour ending now: the shape of a stretch of work being written up
      // just after it happened, and both ends are editable anyway.
      const now = dayjs().startOf('minute')
      setStartAt(now.subtract(1, 'hour'))
      setEndAt(now)
      setBoardName('')
      setCardName('')
      setComment('')
    }
  }, [open, entry])

  // The pickers only go down to the minute, so that's the precision the user
  // is actually choosing: seconds inherited from a live-tracked entry would
  // survive an edit invisibly, leaving times that read as touching but really
  // overlap (or leave a gap) by a few seconds. Truncating before the range
  // check too, so a span the server would reject is caught here instead.
  const start = startAt?.second(0).millisecond(0) ?? null
  const end = endAt?.second(0).millisecond(0) ?? null

  const invalidRange = Boolean(start && end && !end.isAfter(start))

  async function handleSave() {
    if (!start || !end) {
      setError(t('timeTracker.timesRequired'))
      return
    }
    if (invalidRange) {
      setError(t('timeTracker.endBeforeStart'))
      return
    }
    if (!isEdit && !selection.cardId) {
      setError(t('timeTracker.pickCard'))
      return
    }
    if (isEdit && recopy && !selection.cardId) {
      setError(t('timeTracker.pickCard'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const cardRef = {
        board_id: selection.boardId,
        list_id: selection.listId,
        card_id: selection.cardId,
      }
      const r = isEdit
        ? await apiFetch(`/api/v1/time-entries/${entry.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            started_at: start.toISOString(),
            ended_at: end.toISOString(),
            // Always sent, even blank: that's how a note gets removed.
            comment,
            // Re-copying wins over the text fields: the server overwrites
            // both names (and the labels) from the card it's given.
            ...(recopy ? cardRef : { board_name: boardName, card_name: cardName }),
          }),
        })
        : await apiFetch('/api/v1/time-entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...cardRef,
            started_at: start.toISOString(),
            ended_at: end.toISOString(),
            comment,
          }),
        })
      if (!r.ok) throw new Error()
      onSaved(await r.json() as TimeEntryRead)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEdit ? t('timeTracker.editTitle') : t('timeTracker.addTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocaleFor(numberLocale)}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <MobileDateTimePicker
              label={t('timeTracker.startTime')}
              value={startAt}
              onChange={setStartAt}
              disabled={saving}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <MobileDateTimePicker
              label={t('timeTracker.endTime')}
              value={endAt}
              onChange={setEndAt}
              disabled={saving}
              slotProps={{
                textField: {
                  size: 'small',
                  fullWidth: true,
                  error: invalidRange,
                  helperText: invalidRange ? t('timeTracker.endBeforeStart') : undefined,
                },
              }}
            />
          </Box>
        </LocalizationProvider>

        {isEdit && (
          <>
            <TextField
              label={t('timeTracker.boardColumn')}
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              fullWidth
              size="small"
              disabled={saving || recopy}
              sx={{ mt: 2 }}
            />
            <TextField
              label={t('timeTracker.cardColumn')}
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              fullWidth
              size="small"
              disabled={saving || recopy}
              sx={{ mt: 2 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {t('timeTracker.snapshotHint')}
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={recopy}
                  onChange={(e) => setRecopy(e.target.checked)}
                  disabled={saving}
                />
              }
              label={<Typography variant="body2">{t('timeTracker.recopyFromCard')}</Typography>}
            />
          </>
        )}

        {(!isEdit || recopy) && (
          <CardPicker active={open && (!isEdit || recopy)} disabled={saving} onChange={setSelection} />
        )}

        {/* Last, and outside the snapshot block: unlike the names above it,
            the note is the user's own text and never comes from a card. */}
        <TextField
          label={t('timeTracker.commentColumn')}
          placeholder={t('timeTracker.commentHint')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          size="small"
          disabled={saving}
          sx={{ mt: 2 }}
        />
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
