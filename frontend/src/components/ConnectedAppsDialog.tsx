import { useEffect, useState } from 'react'
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
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { ContentCopy } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import { formatDateTime, intlCodeFor, type DateFormat } from '../utils/locale'

// GET /api/v1/oauth/grants — see backend/src/schemas/oauth.py.
interface Grant {
  id: string
  client_name: string
  redirect_host: string
  read_only: boolean
  created_at: string
  last_used_at: string | null
  boards: { id: string; name: string; is_archived: boolean }[]
}

interface OwnBoard {
  id: string
  name: string
}

interface Props {
  open: boolean
  onClose: () => void
  numberLocale: string
  dateFormat: DateFormat
}

// The apps (MCP clients such as Claude) the user has allowed to reach their
// boards: which boards each may reach, read-only or not, and revoking it.
export default function ConnectedAppsDialog({ open, onClose, numberLocale, dateFormat }: Props) {
  const { t } = useTranslation()
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [ownBoards, setOwnBoards] = useState<OwnBoard[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBoards, setEditBoards] = useState<Set<string>>(new Set())
  const [editReadOnly, setEditReadOnly] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const mcpUrl = `${window.location.origin}/mcp`
  const intlCode = intlCodeFor(numberLocale)

  // Fresh state each time the dialog opens. Done while rendering rather
  // than in an effect, so the first frame already shows the fresh values.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setGrants(null)
      setError(null)
      setEditingId(null)
      setRevokingId(null)
      setCopied(false)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([apiFetch('/api/v1/oauth/grants'), apiFetch('/api/v1/boards')])
      .then(async ([g, b]) => {
        if (!g.ok || !b.ok) throw new Error()
        const loadedGrants: Grant[] = await g.json()
        const owned: OwnBoard[] = (await b.json()).owned
        if (cancelled) return
        setGrants(loadedGrants)
        setOwnBoards(owned.slice().sort((x, y) => x.name.localeCompare(y.name)))
      })
      .catch(() => {
        if (!cancelled) setError(t('common.saveError'))
      })
    return () => { cancelled = true }
  }, [open, t])

  function startEditing(grant: Grant) {
    setRevokingId(null)
    setEditingId(grant.id)
    setEditBoards(new Set(grant.boards.filter((b) => !b.is_archived).map((b) => b.id)))
    setEditReadOnly(grant.read_only)
  }

  function toggleBoard(id: string) {
    setEditBoards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save(grantId: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/oauth/grants/${grantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_ids: [...editBoards], read_only: editReadOnly }),
      })
      if (!r.ok) throw new Error()
      const updated: Grant = await r.json()
      setGrants((prev) => prev?.map((g) => (g.id === grantId ? updated : g)) ?? null)
      setEditingId(null)
    } catch {
      setError(t('common.saveError'))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(grantId: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/v1/oauth/grants/${grantId}`, { method: 'DELETE' })
      if (!r.ok && r.status !== 404) throw new Error()
      setGrants((prev) => prev?.filter((g) => g.id !== grantId) ?? null)
      setRevokingId(null)
    } catch {
      setError(t('common.saveError'))
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl)
      setCopied(true)
    } catch {
      // Clipboard unavailable (e.g. plain http): the address is on screen.
    }
  }

  function renderGrant(grant: Grant) {
    const editing = editingId === grant.id
    return (
      <Paper key={grant.id} variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>{grant.client_name}</Typography>
          <Chip
            size="small"
            color={grant.read_only ? 'default' : 'warning'}
            label={grant.read_only ? t('connectedApps.readOnly') : t('connectedApps.canChange')}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('connectedApps.details', {
            host: grant.redirect_host,
            created: formatDateTime(grant.created_at, intlCode, dateFormat),
            lastUsed: grant.last_used_at
              ? formatDateTime(grant.last_used_at, intlCode, dateFormat)
              : t('connectedApps.neverUsed'),
          })}
        </Typography>

        {editing ? (
          <Box sx={{ mt: 1 }}>
            {ownBoards.length === 0 && (
              <Alert severity="info">{t('oauthConsent.noBoards')}</Alert>
            )}
            {ownBoards.map((board) => (
              <FormControlLabel
                key={board.id}
                sx={{ display: 'flex' }}
                control={<Checkbox checked={editBoards.has(board.id)} onChange={() => toggleBoard(board.id)} />}
                label={board.name}
              />
            ))}
            <FormControlLabel
              control={<Switch checked={editReadOnly} onChange={(e) => setEditReadOnly(e.target.checked)} />}
              label={t('oauthConsent.readOnly')}
            />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1 }}>
              <Button onClick={() => setEditingId(null)} disabled={busy}>{t('common.cancel')}</Button>
              <Button
                variant="contained"
                color="success"
                onClick={() => save(grant.id)}
                disabled={busy || editBoards.size === 0}
              >
                {t('common.save')}
              </Button>
            </Stack>
          </Box>
        ) : (
          <>
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
              {grant.boards.length === 0 && (
                <Typography variant="body2" color="text.secondary">{t('connectedApps.noBoards')}</Typography>
              )}
              {grant.boards.map((board) => (
                <Chip
                  key={board.id}
                  size="small"
                  variant="outlined"
                  label={board.is_archived ? t('connectedApps.archivedBoard', { name: board.name }) : board.name}
                />
              ))}
            </Stack>
            {revokingId === grant.id ? (
              <Alert
                severity="warning"
                sx={{ mt: 1 }}
                action={
                  <Stack direction="row" spacing={1}>
                    <Button size="small" onClick={() => setRevokingId(null)} disabled={busy}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="small" color="error" variant="contained" onClick={() => revoke(grant.id)} disabled={busy}>
                      {t('connectedApps.revoke')}
                    </Button>
                  </Stack>
                }
              >
                {t('connectedApps.revokeConfirm', { client: grant.client_name })}
              </Alert>
            ) : (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1 }}>
                <Button size="small" onClick={() => startEditing(grant)}>{t('connectedApps.edit')}</Button>
                <Button size="small" color="error" onClick={() => { setEditingId(null); setRevokingId(grant.id) }}>
                  {t('connectedApps.revoke')}
                </Button>
              </Stack>
            )}
          </>
        )}
      </Paper>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('connectedApps.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{t('connectedApps.intro')}</Typography>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="body2">{t('connectedApps.howToConnect')}</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {mcpUrl}
              </Typography>
              <Tooltip title={copied ? t('connectedApps.copied') : t('connectedApps.copy')}>
                <IconButton size="small" onClick={copyUrl} aria-label={t('connectedApps.copy')}>
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Paper>

          {error && <Alert severity="error">{error}</Alert>}
          {grants === null && !error && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {grants?.length === 0 && (
            <Typography variant="body2" color="text.secondary">{t('connectedApps.none')}</Typography>
          )}
          {grants?.map(renderGrant)}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
