import { useEffect, useState } from 'react'
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
import type { InvitationPreview } from '../types/invitation'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export default function SignUp() {
  const { t, i18n } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [apiError, setApiError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  // Opened from an invitation e-mail (/signup?invite=<token>): the address is
  // fixed to the invited one, and the board is shared once it's verified.
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [invitationInvalid, setInvitationInvalid] = useState(false)
  const [invitationLoading, setInvitationLoading] = useState(Boolean(inviteToken))

  useEffect(() => {
    if (!inviteToken) return
    fetch(`${API_BASE}/api/v1/invitations/${encodeURIComponent(inviteToken)}`)
      .then((r) => (r.ok ? (r.json() as Promise<InvitationPreview>) : Promise.reject()))
      .then(setInvitation)
      .catch(() => setInvitationInvalid(true))
      .finally(() => setInvitationLoading(false))
  }, [inviteToken])

  async function handleSubmit(data: FormData) {
    const password = data.get('password') as string
    const confirm = data.get('confirmPassword') as string

    if (password !== confirm) {
      setPasswordError(t('signUp.passwordMismatch'))
      return
    }

    setPasswordError('')
    setApiError('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/local/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: data.get('displayName') as string,
          email: data.get('email') as string,
          password,
          language: i18n.language,
          ...(invitation && inviteToken ? { invitation_token: inviteToken } : {}),
        }),
      })

      if (res.status === 201) {
        setSuccess(true)
      } else if (res.status === 409) {
        setApiError(t('signUp.emailTaken'))
      } else if (invitation && (res.status === 400 || res.status === 422)) {
        // The invitation expired or was cancelled while this page was open.
        setInvitation(null)
        setInvitationInvalid(true)
      } else {
        setApiError(t('signUp.errorGeneric'))
      }
    } catch {
      setApiError(t('signUp.errorGeneric'))
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

          {/* Keyed on the invitation so the locked e-mail field remounts with
              its defaultValue once the preview has loaded (or been dropped). */}
          <Box component="form" action={handleSubmit} noValidate key={invitation?.email ?? 'no-invitation'}>
            <TextField
              label={t('signUp.displayName')}
              name="displayName"
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
              defaultValue={invitation?.email ?? ''}
              slotProps={{ input: { readOnly: Boolean(invitation) } }}
            />
            <TextField
              label={t('signUp.password')}
              name="password"
              type={showPassword ? 'text' : 'password'}
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
                        aria-label="toggle password visibility"
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
                        aria-label="toggle confirm password visibility"
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
              disabled={loading || invitationLoading}
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
