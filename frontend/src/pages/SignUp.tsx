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
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GoogleButton from '../components/GoogleButton'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export default function SignUp() {
  const { t, i18n } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [apiError, setApiError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

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
        }),
      })

      if (res.status === 201) {
        setSuccess(true)
      } else if (res.status === 409) {
        setApiError(t('signUp.emailTaken'))
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
        <Card sx={{ width: '100%', maxWidth: 420 }} elevation={3}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center', mb: 3 }}>
              {t('signUp.checkEmailTitle')}
            </Typography>
            <Alert severity="success">{t('signUp.checkEmailBody')}</Alert>
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
      <Card sx={{ width: '100%', maxWidth: 420 }} elevation={3}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 600, textAlign: 'center', mb: 3 }}>
            {t('signUp.title')}
          </Typography>

          {apiError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {apiError}
            </Alert>
          )}

          <Box component="form" action={handleSubmit} noValidate>
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
              disabled={loading}
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
