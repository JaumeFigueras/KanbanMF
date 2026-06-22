import { Autocomplete, TextField } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageCode } from '../i18n'

type Language = (typeof LANGUAGES)[number]

export default function LanguageSelector() {
  const { i18n } = useTranslation()

  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]

  const handleChange = (_: unknown, value: Language | null) => {
    if (value) i18n.changeLanguage(value.code as LanguageCode)
  }

  return (
    <Autocomplete
      options={[...LANGUAGES]}
      value={current}
      onChange={handleChange}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      disableClearable
      size="small"
      sx={{ width: 160 }}
      renderInput={(params) => <TextField {...params} label="Language" />}
    />
  )
}
