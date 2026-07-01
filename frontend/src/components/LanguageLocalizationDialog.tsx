import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n'
import { DATE_LOCALES, type DateFormat, type DateLocaleCode, formatDateTime, intlCodeFor } from '../utils/locale'

// Maps backend language_locale → i18n code  and back
const BACKEND_TO_I18N: Record<string, string> = { en: 'en', ca_ES: 'ca' }
const I18N_TO_BACKEND: Record<string, string> = { en: 'en', ca: 'ca_ES' }

interface Props {
  open: boolean
  onClose: () => void
  currentLanguageLocale: string  // backend code: "en" | "ca_ES"
  currentNumberLocale: string    // backend code: "en" | "en_GB" | "ca_ES"
  currentDateFormat: DateFormat
  accessToken: string
  onSaved: (languageLocale: string, numberLocale: string, dateFormat: DateFormat) => void
}

export default function LanguageLocalizationDialog({
  open,
  onClose,
  currentLanguageLocale,
  currentNumberLocale,
  currentDateFormat,
  accessToken,
  onSaved,
}: Props) {
  const { t } = useTranslation()

  // i18n code ("en" | "ca") for the language selector
  const [langCode, setLangCode] = useState(BACKEND_TO_I18N[currentLanguageLocale] ?? 'en')
  const [numberLocale, setNumberLocale] = useState<DateLocaleCode>(
    (DATE_LOCALES.find((l) => l.code === currentNumberLocale)?.code ?? 'en') as DateLocaleCode
  )
  const [dateFormat, setDateFormat] = useState<DateFormat>(currentDateFormat)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLangCode(BACKEND_TO_I18N[currentLanguageLocale] ?? 'en')
      setNumberLocale(
        (DATE_LOCALES.find((l) => l.code === currentNumberLocale)?.code ?? 'en') as DateLocaleCode
      )
      setDateFormat(currentDateFormat)
      setError(null)
    }
  }, [open, currentLanguageLocale, currentNumberLocale, currentDateFormat])

  async function handleSave() {
    setSaving(true)
    setError(null)
    const backendLanguageLocale = I18N_TO_BACKEND[langCode] ?? 'en'
    try {
      const r = await fetch('http://localhost:8000/api/v1/users/me/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          language_locale: backendLanguageLocale,
          number_locale: numberLocale,
          date_format: dateFormat,
        }),
      })
      if (!r.ok) throw new Error()
      onSaved(backendLanguageLocale, numberLocale, dateFormat)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const intlCode = intlCodeFor(numberLocale)
  const exampleLong = formatDateTime(new Date(), intlCode, 'textual')
  const exampleNumeric = formatDateTime(new Date(), intlCode, 'numeric')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('boards.languageLocalization')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl fullWidth size="small">
            <InputLabel>{t('boards.displayLanguage')}</InputLabel>
            <Select
              label={t('boards.displayLanguage')}
              value={langCode}
              onChange={(e) => setLangCode(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>{t('boards.dateTimeLocale')}</InputLabel>
            <Select
              label={t('boards.dateTimeLocale')}
              value={numberLocale}
              onChange={(e) => setNumberLocale(e.target.value as DateLocaleCode)}
            >
              {DATE_LOCALES.map((l) => (
                <MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>{t('boards.dateDisplayFormat')}</InputLabel>
            <Select
              label={t('boards.dateDisplayFormat')}
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as DateFormat)}
            >
              <MenuItem value="numeric">{t('boards.dateFormatNumeric')}</MenuItem>
              <MenuItem value="textual">{t('boards.dateFormatTextual')}</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              {t('boards.dateTimeExample')}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: dateFormat === 'textual' ? 700 : 400 }}
            >
              {exampleLong}
            </Typography>
            <Typography
              variant="body2"
              sx={{ mt: 0.5, fontWeight: dateFormat === 'numeric' ? 700 : 400 }}
            >
              {exampleNumeric}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
