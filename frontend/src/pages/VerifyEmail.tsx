import { useEffect, useState } from 'react'
import { useSearchParams, Link as RouterLink } from 'react-router-dom'
import { Box, Card, CardContent, Typography, Alert, CircularProgress, Button } from '@mui/material'
import { CheckCircleOutlined, ErrorOutlined } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import AuthControls from '../components/AuthControls'

type State = 'pending' | 'success' | 'invalid' | 'expired' | 'error'

export default function VerifyEmail() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [state, setState] = useState<State>('pending')

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      setState('invalid')
      return
    }

    fetch('/api/v1/auth/local/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (res.ok) {
          setState('success')
        } else {
          const body = await res.json().catch(() => ({}))
          if (body.detail === 'Verification token has expired') {
            setState('expired')
          } else {
            setState('invalid')
          }
        }
      })
      .catch(() => setState('error'))
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

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
      <Card sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          {state === 'pending' && (
            <>
              <CircularProgress />
              <Typography>{t('verifyEmail.verifying')}</Typography>
            </>
          )}

          {state === 'success' && (
            <>
              <CheckCircleOutlined sx={{ fontSize: 56, color: 'success.main' }} />
              <Typography variant="h6">{t('verifyEmail.successTitle')}</Typography>
              <Alert severity="success" sx={{ width: '100%' }}>{t('verifyEmail.successBody')}</Alert>
              <Button component={RouterLink} to="/signin" variant="contained" fullWidth>
                {t('verifyEmail.signInNow')}
              </Button>
            </>
          )}

          {(state === 'invalid' || state === 'expired' || state === 'error') && (
            <>
              <ErrorOutlined sx={{ fontSize: 56, color: 'error.main' }} />
              <Typography variant="h6">{t('verifyEmail.errorTitle')}</Typography>
              <Alert severity="error" sx={{ width: '100%' }}>
                {state === 'expired' ? t('verifyEmail.errorExpired') : t('verifyEmail.errorInvalid')}
              </Alert>
              <Button component={RouterLink} to="/signup" variant="outlined" fullWidth>
                {t('verifyEmail.tryAgain')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
