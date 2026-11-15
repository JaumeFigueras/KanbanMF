import { useEffect, useId, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { Add } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { BoardNotificationSettingsRead, BoardRead } from '../types/board'
import { apiFetch } from '../api/client'

// ISO weekdays (1 = Monday ... 7 = Sunday), the backend's notify_weekdays format.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const WORKDAYS = [1, 2, 3, 4, 5]

interface Settings {
  is_enabled: boolean
  notify_hour: number
  notify_weekdays: number[]
  offset_days: number[]
  overdue_repeat_after_days: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
}

export default function EmailNotificationDialog({ open, onClose, board }: Props) {
  const { t } = useTranslation()
  const hourLabelId = useId()
  const [isEnabled, setIsEnabled] = useState(false)
  const [notifyHour, setNotifyHour] = useState(9)
  const [notifyWeekdays, setNotifyWeekdays] = useState<number[]>(WORKDAYS)
  const [offsetDays, setOffsetDays] = useState<number[]>([])
  const [newOffset, setNewOffset] = useState('')
  const [offsetError, setOffsetError] = useState<string | null>(null)
  const [overdueRepeatEnabled, setOverdueRepeatEnabled] = useState(false)
  // The repeat field's text, and the number of days in effect: what was
  // loaded or last saved, which the field goes back to when it's left with
  // anything but a whole number of at least one.
  const [overdueRepeat, setOverdueRepeat] = useState('')
  const [savedRepeat, setSavedRepeat] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Every change saves the whole set, so nothing can be changed until this
  // opening's settings have loaded: a click on the defaults shown meanwhile
  // (or after a failed load) would save them over the real ones.
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  // Each opening waits for the board's current settings. Done while
  // rendering rather than in an effect, so the first frame already does. A
  // leftover save error is cleared on close (handleClose).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLoaded(false)
      setLoadFailed(false)
      setNewOffset('')
      setOffsetError(null)
    }
  }

  useEffect(() => {
    if (!open || !board) return
    // An answer for an earlier opening, perhaps of another board, is dropped.
    let cancelled = false
    apiFetch(`/api/v1/boards/${board.id}/notifications`)
      .then((r) => r.ok ? r.json() as Promise<BoardNotificationSettingsRead> : Promise.reject(new Error()))
      .then((settings) => {
        if (cancelled) return
        setIsEnabled(settings.is_enabled)
        setNotifyHour(settings.notify_hour)
        setNotifyWeekdays(settings.notify_weekdays)
        setOffsetDays(settings.offset_days)
        setOverdueRepeatEnabled(settings.overdue_repeat_after_days != null)
        setOverdueRepeat(
          settings.overdue_repeat_after_days != null ? String(settings.overdue_repeat_after_days) : '',
        )
        setSavedRepeat(settings.overdue_repeat_after_days)
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [open, board])

  function handleClose() {
    setError(null)
    onClose()
  }

  async function persist(next: Settings) {
    if (!board) return
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/boards/${board.id}/notifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!r.ok) throw new Error()
    } catch {
      setError(t('common.saveError'))
    }
  }

  function currentSettings(overrides: Partial<Settings> = {}): Settings {
    return {
      is_enabled: isEnabled,
      notify_hour: notifyHour,
      notify_weekdays: notifyWeekdays,
      offset_days: offsetDays,
      overdue_repeat_after_days: overdueRepeatEnabled ? savedRepeat : null,
      ...overrides,
    }
  }

  function handleToggleEnabled(checked: boolean) {
    setIsEnabled(checked)
    persist(currentSettings({ is_enabled: checked }))
  }

  function handleHourChange(hour: number) {
    setNotifyHour(hour)
    persist(currentSettings({ notify_hour: hour }))
  }

  function handleWeekdaysChange(next: number[]) {
    // At least one day must stay selected — turning notifications off is
    // what the checkbox above is for (the backend rejects an empty list).
    if (next.length === 0) return
    const sorted = [...next].sort((a, b) => a - b)
    setNotifyWeekdays(sorted)
    persist(currentSettings({ notify_weekdays: sorted }))
  }

  // The number fields take whole days only: a number field can still hold
  // 1.5, which the backend refuses.
  function handleAddOffset() {
    if (!newOffset.trim()) return
    const value = Number(newOffset)
    if (!Number.isInteger(value)) {
      setOffsetError(t('boards.offsetDaysWhole'))
      return
    }
    if (offsetDays.includes(value)) return
    const next = [...offsetDays, value].sort((a, b) => a - b)
    setOffsetDays(next)
    setNewOffset('')
    persist(currentSettings({ offset_days: next }))
  }

  function handleRemoveOffset(value: number) {
    const next = offsetDays.filter((d) => d !== value)
    setOffsetDays(next)
    persist(currentSettings({ offset_days: next }))
  }

  function handleToggleOverdueRepeat(checked: boolean) {
    setOverdueRepeatEnabled(checked)
    // Turned on for the first time, it starts at one day.
    const days = savedRepeat ?? 1
    if (checked && savedRepeat === null) {
      setSavedRepeat(days)
      setOverdueRepeat(String(days))
    }
    persist(currentSettings({ overdue_repeat_after_days: checked ? days : null }))
  }

  function handleOverdueBlur() {
    if (!overdueRepeatEnabled) return
    // Left empty, it reads as 0.
    const days = Number(overdueRepeat)
    if (!Number.isInteger(days) || days < 1) {
      setOverdueRepeat(String(savedRepeat))
      return
    }
    setSavedRepeat(days)
    persist(currentSettings({ overdue_repeat_after_days: days }))
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.emailNotificationTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('boards.emailNotificationHint')}
        </Typography>

        {loadFailed && <Alert severity="error">{t('boards.notificationsLoadError')}</Alert>}
        {!loaded && !loadFailed && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        {loaded && (
          <FormControlLabel
            control={
              <Checkbox
                checked={isEnabled}
                onChange={(e) => handleToggleEnabled(e.target.checked)}
              />
            }
            label={t('boards.enableEmailNotifications')}
          />
        )}

        {loaded && isEnabled && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel id={hourLabelId}>{t('boards.notifyHour')}</InputLabel>
              <Select
                labelId={hourLabelId}
                label={t('boards.notifyHour')}
                value={notifyHour}
                onChange={(e) => handleHourChange(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <MenuItem key={h} value={h}>{String(h).padStart(2, '0')}:00</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('boards.notifyWeekdays')}
              </Typography>
              <ToggleButtonGroup
                value={notifyWeekdays}
                onChange={(_, next: number[]) => handleWeekdaysChange(next)}
                size="small"
                color="primary"
                fullWidth
              >
                {WEEKDAYS.map((d) => (
                  <ToggleButton
                    key={d}
                    value={d}
                    aria-label={t(`boards.weekdayLong.${d}`)}
                    disabled={notifyWeekdays.length === 1 && notifyWeekdays[0] === d}
                    sx={{ px: 0 }}
                  >
                    {t(`boards.weekdayShort.${d}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t('boards.notifyWeekdaysHint')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('boards.notifyOffsetDays')}
              </Typography>

              {offsetDays.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('boards.noOffsetDays')}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                  {offsetDays.map((d) => (
                    <Chip key={d} label={d > 0 ? `+${d}` : `${d}`} onDelete={() => handleRemoveOffset(d)} />
                  ))}
                </Box>
              )}

              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  size="small"
                  type="number"
                  placeholder={t('boards.offsetDaysPlaceholder')}
                  value={newOffset}
                  onChange={(e) => {
                    setNewOffset(e.target.value)
                    setOffsetError(null)
                  }}
                  error={offsetError !== null}
                  helperText={offsetError}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddOffset() } }}
                  slotProps={{ htmlInput: { 'aria-label': t('boards.notifyOffsetDays') } }}
                  fullWidth
                />
                <IconButton onClick={handleAddOffset} color="primary" aria-label={t('common.add')}>
                  <Add />
                </IconButton>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Checkbox
                checked={overdueRepeatEnabled}
                onChange={(e) => handleToggleOverdueRepeat(e.target.checked)}
                slotProps={{
                  input: { 'aria-label': `${t('boards.overdueRepeatPrefix')} … ${t('boards.overdueRepeatSuffix')}` },
                }}
                sx={{ p: 0 }}
              />
              <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                {t('boards.overdueRepeatPrefix')}
              </Typography>
              <TextField
                size="small"
                type="number"
                value={overdueRepeat}
                onChange={(e) => setOverdueRepeat(e.target.value)}
                onBlur={handleOverdueBlur}
                disabled={!overdueRepeatEnabled}
                slotProps={{ htmlInput: { min: 1, 'aria-label': t('boards.overdueRepeatDays') } }}
                sx={{ width: 90 }}
              />
              <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
                {t('boards.overdueRepeatSuffix')}
              </Typography>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
