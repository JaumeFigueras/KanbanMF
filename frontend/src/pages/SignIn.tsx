import { useState } from 'react'
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
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GoogleButton from '../components/GoogleButton'
import AuthControls from '../components/AuthControls'
import { useAuth } from '../context/useAuth'
import { peekReturnTo } from '../utils/returnTo'

export default function SignIn() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { login, signOutUnconfirmed } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  // Controlled, as on the sign-up page, rather than read with
  // new FormData(form), which the tests' FormData can't do.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrorKey(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        if (res.status === 429) {
          setErrorKey('common.tooManyAttempts')
        } else if (res.status === 403) {
          const body = await res.json().catch(() => ({}))
          setErrorKey(body.detail === 'Email not verified' ? 'signIn.errorNotVerified' : 'signIn.errorCredentials')
        } else if (res.status === 401 || res.status === 422) {
          // A wrong password or an unknown address (401), or something that
          // isn't an e-mail address at all (422).
          setErrorKey('signIn.errorCredentials')
        } else {
          setErrorKey('common.saveError')
        }
        return
      }
      const { access_token } = await res.json()
      login(access_token)
      navigate(peekReturnTo() ?? '/boards')
    } catch {
      // No answer, or none that can be read: the connection dropped, before
      // the answer or in the middle of it.
      setErrorKey('common.unreachable')
    } finally {
      setLoading(false)
    }
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
            {t('signIn.title')}
          </Typography>

          {signOutUnconfirmed && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('signIn.signOutUnconfirmed')}
            </Alert>
          )}

          {errorKey && (
            <Alert severity={errorKey === 'signIn.errorNotVerified' ? 'warning' : 'error'} sx={{ mb: 2 }}>
              {t(errorKey)}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <TextField
              label={t('signIn.email')}
              name="email"
              type="email"
              fullWidth
              required
              margin="normal"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label={t('signIn.password')}
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              margin="normal"
              autoComplete="current-password"
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
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading}
              sx={{ mt: 2 }}
            >
              {t('signIn.submit')}
            </Button>
          </Box>

          <Divider sx={{ my: 3 }}>{t('common.or')}</Divider>

          <GoogleButton />

          <Typography variant="body2" sx={{ textAlign: 'center', mt: 3 }}>
            {t('signIn.noAccount')}{' '}
            <Link component={RouterLink} to="/signup">
              {t('signIn.signUpLink')}
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
