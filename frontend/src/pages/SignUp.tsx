import { useCallback, useEffect, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Divider,
  Link,
  IconButton,
  InputAdornment,
  Alert,
} from '@mui/material'
import { Visibility, VisibilityOff } from '@mui/icons-material'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GoogleButton from '../components/GoogleButton'
import AuthControls from '../components/AuthControls'
import LoadFailure, { type LoadState } from '../components/LoadFailure'
import type { InvitationPreview } from '../types/invitation'
import { passwordProblem } from '../utils/password'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

// FastAPI's answer to a field it refuses is a list of problems, each saying
// where it is: { loc: ['body', 'email'], msg: '…' }.
function refusesEmail(body: { detail?: unknown }): boolean {
  return Array.isArray(body.detail)
    && body.detail.some((problem: { loc?: unknown[] }) => problem?.loc?.[1] === 'email')
}

export default function SignUp() {
  const { t, i18n } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  // The fields are controlled, and the form has an ordinary submit handler,
  // not a form action: React empties a form's fields when its action ends,
  // so an error (a short password, too many tries) used to wipe all four.
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [apiError, setApiError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  // Opened from an invitation e-mail (/signup?invite=<token>): the address is
  // fixed to the invited one, and the board is shared once it's verified.
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [invitationInvalid, setInvitationInvalid] = useState(false)
  // Create account waits for the invitation: until the page knows whether
  // it's valid, it can't tell which address to lock.
  const [invitationLoad, setInvitationLoad] = useState<LoadState>(inviteToken ? 'loading' : 'loaded')

  const fetchInvitation = useCallback(() => {
    if (!inviteToken) return
    fetch(`${API_BASE}/api/v1/invitations/${encodeURIComponent(inviteToken)}`)
      .then(async (r) => {
        if (r.ok) {
          const preview = (await r.json()) as InvitationPreview
          setInvitation(preview)
          setEmail(preview.email)
        } else if (r.status === 404) {
          // The backend's answer for an invitation that expired, was
          // cancelled or never existed.
          setInvitationInvalid(true)
        } else {
          setInvitationLoad('failed')
          return
        }
        setInvitationLoad('loaded')
      })
      // A dropped connection says so, rather than that the link expired.
      .catch(() => setInvitationLoad('failed'))
  }, [inviteToken])

  function retryInvitation() {
    setInvitationLoad('loading')
    fetchInvitation()
  }

  useEffect(() => {
    fetchInvitation()
  }, [fetchInvitation])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPasswordError('')
    setEmailError('')
    setApiError('')

    const problem = passwordProblem(password)
    if (problem) {
      setPasswordError(t(problem))
      return
    }
    if (password !== confirmPassword) {
      setPasswordError(t('signUp.passwordMismatch'))
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/local/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          email,
          password,
          language: i18n.language,
          ...(invitation && inviteToken ? { invitation_token: inviteToken } : {}),
        }),
      })

      // 201 whether or not the address already has an account, so the page
      // can't tell anyone who uses the server; the e-mail says which it was.
      if (res.status === 201) {
        setSuccess(true)
      } else if (res.status === 429) {
        setApiError(t('common.tooManyAttempts'))
      } else if (res.status === 400 || res.status === 422) {
        const body = await res.json().catch(() => ({}))
        if (body.detail === 'Invalid or expired invitation') {
          // The invitation expired or was cancelled while this page was
          // open. What was typed stays, and the address, still the invited
          // one, can now be changed.
          setInvitation(null)
          setInvitationInvalid(true)
        } else if (refusesEmail(body)) {
          setEmailError(t('signUp.emailInvalid'))
        } else {
          setApiError(t('signUp.errorGeneric'))
        }
      } else {
        setApiError(t('signUp.errorGeneric'))
      }
    } catch {
      setApiError(t('common.unreachable'))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          px: 2,
        }}
      >
        <AuthControls />
        <Card sx={{ width: '100%', maxWidth: 420 }} elevation={3}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center', mb: 3 }}>
              {t('signUp.checkEmailTitle')}
            </Typography>
            <Alert severity="success">{t('signUp.checkEmailBody')}</Alert>
            {invitation && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t('signUp.checkEmailInvited')}
              </Typography>
            )}
            <Typography variant="body2" sx={{ textAlign: 'center', mt: 3 }}>
              <Link component={RouterLink} to="/signin">
                {t('signUp.signInLink')}
              </Link>
            </Typography>
          </CardContent>
        </Card>
      </Box>
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
      }}
    >
      <AuthControls />
      <Card sx={{ width: '100%', maxWidth: 420 }} elevation={3}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center', mb: 3 }}>
            {t('signUp.title')}
          </Typography>

          {invitation && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('signUp.invitedBy', { inviter: invitation.inviter_name, board: invitation.board_name })}
            </Alert>
          )}
          {invitationLoad === 'failed' && (
            <LoadFailure message={t('signUp.invitationLoadFailed')} onRetry={retryInvitation} sx={{ mb: 2 }} />
          )}
          {invitationInvalid && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('signUp.invitationInvalid')}
            </Alert>
          )}

          {apiError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {apiError}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <TextField
              slotProps={{ htmlInput: { maxLength: 100 } }}
              label={t('signUp.displayName')}
              name="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              fullWidth
              required
              margin="normal"
              autoComplete="name"
            />
            <TextField
              label={t('signUp.email')}
              name="email"
              type="email"
              fullWidth
              required
              margin="normal"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={!!emailError}
              helperText={emailError}
              slotProps={{ input: { readOnly: Boolean(invitation) } }}
            />
            <TextField
              label={t('signUp.password')}
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              margin="normal"
              autoComplete="new-password"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword((v) => !v)}
                        edge="end"
                        aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <TextField
              label={t('signUp.confirmPassword')}
              name="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              required
              margin="normal"
              autoComplete="new-password"
              error={!!passwordError}
              helperText={passwordError}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirm((v) => !v)}
                        edge="end"
                        aria-label={showConfirm ? t('common.hideRepeatedPassword') : t('common.showRepeatedPassword')}
                      >
                        {showConfirm ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading || invitationLoad !== 'loaded'}
              sx={{ mt: 2 }}
            >
              {t('signUp.submit')}
            </Button>
          </Box>

          <Divider sx={{ my: 3 }}>{t('common.or')}</Divider>

          <GoogleButton />

          <Typography variant="body2" sx={{ textAlign: 'center', mt: 3 }}>
            {t('signUp.hasAccount')}{' '}
            <Link component={RouterLink} to="/signin">
              {t('signUp.signInLink')}
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
