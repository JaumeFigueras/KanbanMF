import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
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
  Typography,
} from '@mui/material'
import { Add } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { BoardNotificationSettingsRead, BoardRead } from '../types/board'
import { apiFetch } from '../api/client'

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
}

export default function EmailNotificationDialog({ open, onClose, board }: Props) {
  const { t } = useTranslation()
  const [isEnabled, setIsEnabled] = useState(false)
  const [notifyHour, setNotifyHour] = useState(9)
  const [offsetDays, setOffsetDays] = useState<number[]>([])
  const [newOffset, setNewOffset] = useState('')
  const [overdueRepeatEnabled, setOverdueRepeatEnabled] = useState(false)
  const [overdueRepeat, setOverdueRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reset to the board's current settings each time it's opened.
  useEffect(() => {
    if (!open || !board) return
    setError(null)
    apiFetch(`http://localhost:8000/api/v1/boards/${board.id}/notifications`)
      .then((r) => r.ok ? r.json() as Promise<BoardNotificationSettingsRead> : null)
      .then((settings) => {
        setIsEnabled(settings?.is_enabled ?? false)
        setNotifyHour(settings?.notify_hour ?? 9)
        setOffsetDays(settings?.offset_days ?? [])
        setOverdueRepeatEnabled(settings?.overdue_repeat_after_days != null)
        setOverdueRepeat(
          settings?.overdue_repeat_after_days != null ? String(settings.overdue_repeat_after_days) : '',
        )
      })
      .catch(() => {
        setIsEnabled(false)
        setNotifyHour(9)
        setOffsetDays([])
        setOverdueRepeatEnabled(false)
        setOverdueRepeat('')
      })
  }, [open, board])

  async function persist(next: {
    is_enabled: boolean
    notify_hour: number
    offset_days: number[]
    overdue_repeat_after_days: number | null
  }) {
    if (!board) return
    setError(null)
    try {
      const r = await apiFetch(`http://localhost:8000/api/v1/boards/${board.id}/notifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!r.ok) throw new Error()
    } catch {
      setError(t('common.saveError'))
    }
  }

  function currentSettings(overrides: Partial<{
    is_enabled: boolean
    notify_hour: number
    offset_days: number[]
    overdue_repeat_after_days: number | null
  }> = {}) {
    return {
      is_enabled: isEnabled,
      notify_hour: notifyHour,
      offset_days: offsetDays,
      overdue_repeat_after_days: overdueRepeatEnabled && overdueRepeat.trim() ? Number(overdueRepeat) : null,
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

  function handleAddOffset() {
    const value = Number(newOffset)
    if (!newOffset.trim() || Number.isNaN(value) || offsetDays.includes(value)) return
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
    const days = checked ? Number(overdueRepeat.trim() || '1') : null
    if (checked && !overdueRepeat.trim()) setOverdueRepeat('1')
    persist(currentSettings({ overdue_repeat_after_days: days }))
  }

  function handleOverdueBlur() {
    if (!overdueRepeatEnabled) return
    persist(currentSettings())
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.emailNotificationTitle')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <FormControlLabel
          control={
            <Checkbox
              checked={isEnabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
          }
          label={t('boards.enableEmailNotifications')}
        />

        {isEnabled && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('boards.notifyHour')}</InputLabel>
              <Select
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

              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  type="number"
                  placeholder={t('boards.offsetDaysPlaceholder')}
                  value={newOffset}
                  onChange={(e) => setNewOffset(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddOffset() } }}
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
                slotProps={{ htmlInput: { min: 1 } }}
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
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
