import { useEffect, useId, useRef, useState } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import { Delete } from '@mui/icons-material'
import { MobileDateTimePicker } from '@mui/x-date-pickers/MobileDateTimePicker'
import type { DateTimeValidationError, FieldRef } from '@mui/x-date-pickers/models'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'

interface Props {
  // Shown beside the field, and its name for screen readers.
  label: string
  // The remove button's name, saying which date it removes.
  removeLabel: string
  value: Dayjs | null
  onChange: (value: Dayjs | null) => void
  // Told whether the field holds a date that can't be saved: one typed only
  // in part (the field never reports it, so the value stays empty), or an
  // impossible one.
  onIncompleteChange?: (incomplete: boolean) => void
}

function roundToNearestFiveMinutes(d: Dayjs): Dayjs {
  const rounded = Math.round(d.minute() / 5) * 5
  return d.startOf('minute').minute(0).add(rounded, 'minute')
}

// MobileDateTimePicker always opens its calendar/clock in a centered Dialog
// (rather than a Popper anchored to the field), and its field is natively
// editable — the user can type the date/time directly or click to open the
// picker. onError surfaces MUI's own format/range validation.
export default function CardDateField({ label, removeLabel, value, onChange, onIncompleteChange }: Props) {
  const { t } = useTranslation()
  const labelId = useId()
  const [invalid, setInvalid] = useState(false)
  // MUI's own default `referenceDate` (used to seed the picker when there's
  // no value yet) is today at 00:00, not "now" — recomputed on every open
  // so it reflects the actual current time, rounded to the nearest 5
  // minutes, rather than going stale from whenever the dialog first mounted.
  const [referenceDate, setReferenceDate] = useState(() => roundToNearestFiveMinutes(dayjs()))
  // Something typed while there's no value: a date typed only in part. Read
  // from the field's sections after each key, and on leaving the field (which
  // also catches a paste, and comes before any click on Save), as the field
  // reports a value only once it's complete.
  const fieldRef = useRef<FieldRef<Dayjs | null>>(null)
  const [typed, setTyped] = useState(false)
  // Changed to start the field afresh, which is the only way to clear what
  // was typed into it without a value.
  const [fieldKey, setFieldKey] = useState(0)
  const hasText = Boolean(value) || typed
  const incomplete = value ? !value.isValid() : typed

  const onIncompleteChangeRef = useRef(onIncompleteChange)
  useEffect(() => { onIncompleteChangeRef.current = onIncompleteChange })
  useEffect(() => { onIncompleteChangeRef.current?.(incomplete) }, [incomplete])

  function readTyped() {
    setTyped(!value && Boolean(fieldRef.current?.getSections().some((section) => section.value !== '')))
  }

  function handleError(error: DateTimeValidationError) {
    setInvalid(error !== null)
  }

  function remove() {
    onChange(null)
    setTyped(false)
    setFieldKey((key) => key + 1)
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Typography id={labelId} variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center' }} onKeyUp={readTyped} onBlur={readTyped}>
        <MobileDateTimePicker
          key={fieldKey}
          value={value}
          onChange={onChange}
          onError={handleError}
          referenceDate={referenceDate}
          onOpen={() => setReferenceDate(roundToNearestFiveMinutes(dayjs()))}
          slotProps={{
            field: { fieldRef },
            textField: {
              size: 'small',
              error: invalid,
              helperText: invalid ? t('board.invalidDateTime') : undefined,
              sx: { width: 230 },
              // The field (a group of day, month… sections) takes its name
              // from the label beside it.
              slotProps: { input: { 'aria-labelledby': labelId } },
            },
          }}
        />
        <IconButton
          size="small"
          aria-label={removeLabel}
          disabled={!hasText}
          onClick={remove}
          sx={{ visibility: hasText ? 'visible' : 'hidden' }}
        >
          <Delete fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}
