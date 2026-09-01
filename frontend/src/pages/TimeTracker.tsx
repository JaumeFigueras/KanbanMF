import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AppBar,
  Box,
  Button,
  Chip,
  IconButton,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Add,
  Delete,
  Download,
  Edit,
  ErrorOutlined,
  PlayArrow,
  Stop,
} from '@mui/icons-material'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import MainAppBar from '../components/MainAppBar'
import StartTimeEntryDialog from '../components/StartTimeEntryDialog'
import TimeEntryDialog from '../components/TimeEntryDialog'
import DeleteTimeEntryDialog from '../components/DeleteTimeEntryDialog'
import type { TimeEntryRead } from '../types/timeTracker'
import { contrastColor } from '../utils/labelColor'
import { decimalHours, durationSeconds, formatDuration, formatRunning } from '../utils/duration'
import { findOverlappingEntryIds } from '../utils/overlap'
import { intlCodeFor, type DateFormat } from '../utils/locale'

const ALL_MONTHS = 'all'

// The filters name a calendar year/month; the API takes instants. The
// conversion happens here, in the browser's own timezone, so the server
// never has to guess which timezone "March 2026" was meant in.
function filterRange(year: number, month: string): { from: string; to: string } {
  // Built from a concrete Y/M/1 date rather than by shifting today's date:
  // setting the month on, say, the 31st would overflow into the next one.
  const start = dayjs(new Date(year, month === ALL_MONTHS ? 0 : Number(month), 1))
  const end = month === ALL_MONTHS ? start.add(1, 'year') : start.add(1, 'month')
  return { from: start.toISOString(), to: end.toISOString() }
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export default function TimeTracker() {
  const { t } = useTranslation()
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')

  const [entries, setEntries] = useState<TimeEntryRead[]>([])
  const [years, setYears] = useState<number[]>([])
  const [year, setYear] = useState(() => dayjs().year())
  const [month, setMonth] = useState<string>(() => String(dayjs().month()))
  // Re-rendered every second so the running entry's elapsed time ticks.
  const [now, setNow] = useState(() => Date.now())

  const [startOpen, setStartOpen] = useState(false)
  const [entryDialogOpen, setEntryDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<TimeEntryRead | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<TimeEntryRead | null>(null)

  const running = useMemo(() => entries.find((e) => e.ended_at === null) ?? null, [entries])
  // The running entry lives in the strip above the table, not in it — the
  // API returns it whatever the filter says, so it's filtered out here.
  const recorded = useMemo(() => entries.filter((e) => e.ended_at !== null), [entries])

  const fetchEntries = useCallback(() => {
    const { from, to } = filterRange(year, month)
    apiFetch(`/api/v1/time-entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => (r.ok ? r.json() as Promise<TimeEntryRead[]> : []))
      .then(setEntries)
      .catch(() => {})
  }, [year, month])

  const fetchYears = useCallback(() => {
    apiFetch('/api/v1/time-entries/years')
      .then((r) => (r.ok ? r.json() as Promise<number[]> : []))
      .then(setYears)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  useEffect(() => {
    fetchYears()
  }, [fetchYears])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  // The current year is always offered even before it holds an entry —
  // otherwise the filter would have no valid value on a first visit.
  const yearOptions = useMemo(() => {
    const all = new Set([...years, dayjs().year(), year])
    return [...all].sort((a, b) => b - a)
  }, [years, year])

  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(intlCodeFor(numberLocale), { month: 'long' })
    return Array.from({ length: 12 }, (_, m) => formatter.format(new Date(2020, m, 1)))
  }, [numberLocale])

  const formatStamp = useCallback((iso: string) => {
    const options: Intl.DateTimeFormatOptions = dateFormat === 'textual'
      ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    return new Intl.DateTimeFormat(intlCodeFor(numberLocale), options).format(new Date(iso))
  }, [numberLocale, dateFormat])

  // Recomputed as the clock ticks: the running entry grows into recorded
  // ones, so what overlaps what can change while you watch.
  const overlapping = useMemo(() => findOverlappingEntryIds(entries, now), [entries, now])

  const totalSeconds = useMemo(
    () => recorded.reduce((sum, e) => sum + durationSeconds(e.started_at, e.ended_at, now), 0),
    [recorded, now],
  )

  function replaceEntry(entry: TimeEntryRead) {
    setEntries((prev) => {
      const exists = prev.some((e) => e.id === entry.id)
      const next = exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...prev]
      return [...next].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    })
    fetchYears()
  }

  async function handleStop() {
    if (!running) return
    try {
      const r = await apiFetch(`/api/v1/time-entries/${running.id}/stop`, { method: 'POST' })
      if (!r.ok) return
      const stopped = await r.json() as TimeEntryRead
      // A task started in a month the filter doesn't cover would vanish from
      // the table the moment it ends, so refetch rather than patch state.
      replaceEntry(stopped)
      fetchEntries()
    } catch {
      // silently ignore — the entry is still running as far as the UI knows
    }
  }

  function handleExport() {
    const header = [
      t('timeTracker.startColumn'),
      t('timeTracker.endColumn'),
      t('timeTracker.durationColumn'),
      t('timeTracker.hoursColumn'),
      t('timeTracker.boardColumn'),
      t('timeTracker.cardColumn'),
      t('timeTracker.labelsColumn'),
    ]
    const rows = recorded.map((e) => {
      const seconds = durationSeconds(e.started_at, e.ended_at, now)
      return [
        // ISO-ish local time (not UTC): what the user saw in the table, in a
        // form every spreadsheet parses as a date.
        dayjs(e.started_at).format('YYYY-MM-DD HH:mm'),
        dayjs(e.ended_at ?? e.started_at).format('YYYY-MM-DD HH:mm'),
        formatDuration(seconds),
        decimalHours(seconds),
        e.board_name,
        e.card_name,
        e.labels.map((l) => l.name).join(', '),
      ]
    })
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')

    const suffix = month === ALL_MONTHS ? `${year}` : `${year}-${String(Number(month) + 1).padStart(2, '0')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `time-entries-${suffix}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <MainAppBar
        onLocaleChanged={(num, fmt) => {
          setNumberLocale(num)
          setDateFormat(fmt)
        }}
      />

      {/* Secondary toolbar — same placement as the board page's own. */}
      <AppBar position="fixed" color="default" elevation={1} sx={{ top: { xs: '56px', sm: '64px' } }}>
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<PlayArrow />}
            onClick={() => setStartOpen(true)}
            disabled={running !== null}
          >
            {t('timeTracker.start')}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            startIcon={<Stop />}
            onClick={handleStop}
            disabled={running === null}
          >
            {t('timeTracker.end')}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            startIcon={<Add />}
            onClick={() => { setEditingEntry(null); setEntryDialogOpen(true) }}
          >
            {t('timeTracker.addEntry')}
          </Button>

          <Box sx={{ flexGrow: 1 }} />

          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel>{t('timeTracker.year')}</InputLabel>
            <Select
              label={t('timeTracker.year')}
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <MenuItem key={y} value={String(y)}>{y}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t('timeTracker.month')}</InputLabel>
            <Select
              label={t('timeTracker.month')}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <MenuItem value={ALL_MONTHS}>{t('timeTracker.allMonths')}</MenuItem>
              {monthNames.map((name, index) => (
                <MenuItem key={name} value={String(index)}>{name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="outlined"
            color="inherit"
            size="small"
            startIcon={<Download />}
            onClick={handleExport}
            disabled={recorded.length === 0}
          >
            {t('timeTracker.export')}
          </Button>
        </Toolbar>
      </AppBar>

      <Toolbar />
      <Toolbar />

      <Box sx={{ p: 2 }}>
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          {running ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  {t('timeTracker.currentTask')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {overlapping.has(running.id) && (
                    <Tooltip title={t('timeTracker.overlapWarning')}>
                      <ErrorOutlined color="error" fontSize="small" />
                    </Tooltip>
                  )}
                  <Typography variant="h6" sx={{ wordBreak: 'break-word' }}>
                    {running.card_name}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {running.board_name} · {formatStamp(running.started_at)}
                </Typography>
                {running.labels.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                    {running.labels.map((label) => (
                      <Chip
                        key={`${label.name}-${label.color}`}
                        label={label.name}
                        size="small"
                        sx={{ bgcolor: label.color, color: contrastColor(label.color) }}
                      />
                    ))}
                  </Box>
                )}
              </Box>
              <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatRunning(durationSeconds(running.started_at, null, now))}
              </Typography>
              <Button variant="contained" color="error" startIcon={<Stop />} onClick={handleStop}>
                {t('timeTracker.end')}
              </Button>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('timeTracker.nothingRunning')}
            </Typography>
          )}
        </Paper>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                {/* Unlabelled: it only ever holds the overlap warning. */}
                <TableCell sx={{ width: 40 }} />
                <TableCell>{t('timeTracker.startColumn')}</TableCell>
                <TableCell>{t('timeTracker.endColumn')}</TableCell>
                <TableCell align="right">{t('timeTracker.durationColumn')}</TableCell>
                <TableCell>{t('timeTracker.boardColumn')}</TableCell>
                <TableCell>{t('timeTracker.cardColumn')}</TableCell>
                <TableCell>{t('timeTracker.labelsColumn')}</TableCell>
                <TableCell align="right">{t('timeTracker.actionsColumn')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recorded.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant="body2" color="text.secondary">
                      {t('timeTracker.noEntries')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {recorded.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell sx={{ width: 40 }}>
                    {overlapping.has(entry.id) && (
                      <Tooltip title={t('timeTracker.overlapWarning')}>
                        <ErrorOutlined color="error" fontSize="small" sx={{ display: 'block' }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>{formatStamp(entry.started_at)}</TableCell>
                  <TableCell>{entry.ended_at ? formatStamp(entry.ended_at) : ''}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatDuration(durationSeconds(entry.started_at, entry.ended_at, now))}
                  </TableCell>
                  <TableCell>{entry.board_name}</TableCell>
                  <TableCell>{entry.card_name}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {entry.labels.map((label) => (
                        <Chip
                          key={`${label.name}-${label.color}`}
                          label={label.name}
                          size="small"
                          sx={{ bgcolor: label.color, color: contrastColor(label.color) }}
                        />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={t('timeTracker.editEntry')}>
                      <IconButton
                        size="small"
                        onClick={() => { setEditingEntry(entry); setEntryDialogOpen(true) }}
                      >
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('timeTracker.deleteEntry')}>
                      <IconButton size="small" onClick={() => setDeletingEntry(entry)}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {recorded.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'right' }}>
            {t('timeTracker.total', { entries: recorded.length, duration: formatDuration(totalSeconds) })}
          </Typography>
        )}
      </Box>

      <StartTimeEntryDialog
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onStarted={replaceEntry}
      />

      <TimeEntryDialog
        open={entryDialogOpen}
        onClose={() => setEntryDialogOpen(false)}
        entry={editingEntry}
        numberLocale={numberLocale}
        onSaved={(entry) => {
          replaceEntry(entry)
          // An entry can be moved (or added) outside the filtered range, so
          // let the filter decide what stays on screen.
          fetchEntries()
        }}
      />

      <DeleteTimeEntryDialog
        open={deletingEntry !== null}
        onClose={() => setDeletingEntry(null)}
        entry={deletingEntry}
        onDeleted={(entryId) => {
          setEntries((prev) => prev.filter((e) => e.id !== entryId))
          fetchYears()
        }}
      />
    </>
  )
}
