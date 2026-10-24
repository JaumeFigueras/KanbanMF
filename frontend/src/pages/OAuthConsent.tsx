import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  FormGroup,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import AuthControls from '../components/AuthControls'
import { apiFetch } from '../api/client'

// GET /api/v1/oauth/requests/{id} — see backend/src/schemas/oauth.py.
interface AuthorizationRequest {
  client_name: string
  redirect_host: string
  redirect_is_local: boolean
  boards: { id: string; name: string }[]
  expires_at: string
}

interface Me {
  display_name: string
  email: string
}

// The errors /oauth/authorize reports here instead of redirecting, because
// the client or its redirect address couldn't be trusted.
const ERROR_KEYS: Record<string, string> = {
  invalid_client: 'oauthConsent.errorClient',
  invalid_redirect_uri: 'oauthConsent.errorRedirect',
}

// Where an MCP client such as Claude asks to reach the user's boards: the
// backend's /oauth/authorize sends the browser here with ?request=<id>. The
// user picks which of their own boards to share, and whether read-only;
// the answer is a redirect back to the client.
export default function OAuthConsent() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const requestId = params.get('request')
  const errorCode = params.get('error')

  const [request, setRequest] = useState<AuthorizationRequest | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [readOnly, setReadOnly] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    ;(async () => {
      try {
        const [r, meRes] = await Promise.all([
          apiFetch(`/api/v1/oauth/requests/${encodeURIComponent(requestId)}`),
          apiFetch('/api/v1/users/me'),
        ])
        if (cancelled) return
        if (r.status === 404 || r.status === 422) {
          setLoadError(t('oauthConsent.errorExpired'))
          return
        }
        if (!r.ok || !meRes.ok) throw new Error()
        setRequest(await r.json())
        setMe(await meRes.json())
      } catch {
        if (!cancelled) setLoadError(t('common.saveError'))
      }
    })()
    return () => { cancelled = true }
  }, [requestId, t])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function answer(approve: boolean) {
    if (!requestId) return
    setSending(true)
    setSendError(null)
    try {
      const r = await apiFetch(
        `/api/v1/oauth/requests/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'deny'}`,
        approve
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ board_ids: [...selected], read_only: readOnly }),
            }
          : { method: 'POST' },
      )
      if (r.status === 404) {
        setSendError(t('oauthConsent.errorExpired'))
        setSending(false)
        return
      }
      if (!r.ok) throw new Error()
      const { redirect_to } = await r.json()
      // Back to the client (Claude, or a program on this computer), which
      // takes it from there. Stay "sending" so nothing can be clicked twice.
      window.location.assign(redirect_to)
    } catch {
      setSendError(t('common.saveError'))
      setSending(false)
    }
  }

  let body: React.ReactNode
  if (errorCode || !requestId) {
    body = (
      <Alert severity="error">
        {t(ERROR_KEYS[errorCode ?? ''] ?? 'oauthConsent.errorInvalid')}
      </Alert>
    )
  } else if (loadError) {
    body = <Alert severity="error">{loadError}</Alert>
  } else if (!request || !me) {
    body = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  } else {
    const allSelected = request.boards.length > 0 && selected.size === request.boards.length
    body = (
      <Stack spacing={2}>
        <Typography>
          {t('oauthConsent.intro', { client: request.client_name })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('oauthConsent.signedInAs', { name: me.display_name, email: me.email })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('oauthConsent.redirectTo', { host: request.redirect_host })}
        </Typography>
        {request.redirect_is_local && (
          <Alert severity="warning">{t('oauthConsent.localWarning', { host: request.redirect_host })}</Alert>
        )}

        <Divider />

        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('oauthConsent.chooseBoards')}
        </Typography>
        {request.boards.length === 0 ? (
          <Alert severity="info">{t('oauthConsent.noBoards')}</Alert>
        ) : (
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={allSelected}
                  indeterminate={selected.size > 0 && !allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(request.boards.map((b) => b.id)))
                  }
                />
              }
              label={t('oauthConsent.selectAll')}
            />
            <Box sx={{ pl: 3, maxHeight: 280, overflowY: 'auto' }}>
              {request.boards.map((board) => (
                <FormControlLabel
                  key={board.id}
                  sx={{ display: 'flex' }}
                  control={<Checkbox checked={selected.has(board.id)} onChange={() => toggle(board.id)} />}
                  label={board.name}
                />
              ))}
            </Box>
          </FormGroup>
        )}
        <Typography variant="body2" color="text.secondary">
          {t('oauthConsent.onlyOwnBoards')}
        </Typography>

        <FormControlLabel
          control={<Switch checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />}
          label={t('oauthConsent.readOnly')}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: '0 !important' }}>
          {readOnly ? t('oauthConsent.readOnlyHelp') : t('oauthConsent.readWriteHelp')}
        </Typography>

        {sendError && <Alert severity="error">{sendError}</Alert>}

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', pt: 1 }}>
          <Button color="error" onClick={() => answer(false)} disabled={sending}>
            {t('oauthConsent.deny')}
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => answer(true)}
            disabled={sending || selected.size === 0}
          >
            {t('oauthConsent.allow')}
          </Button>
        </Stack>
      </Stack>
    )
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
        py: 8,
      }}
    >
      <AuthControls />
      <Card sx={{ width: '100%', maxWidth: 520 }} elevation={3}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center', mb: 3 }}>
            {request ? t('oauthConsent.title', { client: request.client_name }) : t('oauthConsent.titleGeneric')}
          </Typography>
          {body}
        </CardContent>
      </Card>
    </Box>
  )
}
