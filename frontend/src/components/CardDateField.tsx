import { useState } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import { Delete } from '@mui/icons-material'
import { MobileDateTimePicker } from '@mui/x-date-pickers/MobileDateTimePicker'
import type { DateTimeValidationError } from '@mui/x-date-pickers/models'
import type { Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'

interface Props {
  label: string
  value: Dayjs | null
  onChange: (value: Dayjs | null) => void
}

// MobileDateTimePicker always opens its calendar/clock in a centered Dialog
// (rather than a Popper anchored to the field), and its field is natively
// editable — the user can type the date/time directly or click to open the
// picker. onError surfaces MUI's own format/range validation.
export default function CardDateField({ label, value, onChange }: Props) {
  const { t } = useTranslation()
  const [invalid, setInvalid] = useState(false)

  function handleError(error: DateTimeValidationError) {
    setInvalid(error !== null)
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <MobileDateTimePicker
          value={value}
          onChange={onChange}
          onError={handleError}
          slotProps={{
            textField: {
              size: 'small',
              error: invalid,
              helperText: invalid ? t('board.invalidDateTime') : undefined,
              sx: { width: 230 },
            },
          }}
        />
        <IconButton
          size="small"
          aria-label={t('board.clearDate')}
          disabled={!value}
          onClick={() => onChange(null)}
          sx={{ visibility: value ? 'visible' : 'hidden' }}
        >
          <Delete fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}
