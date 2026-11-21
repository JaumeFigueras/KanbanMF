import { useState } from 'react'
import { Alert, Snackbar } from '@mui/material'
import { useTranslation } from 'react-i18next'

// How long a message stays up, unless it's closed sooner.
export const FAILURE_MESSAGE_MS = 10000

interface Props {
  // What couldn't be done, or null for no message.
  message: string | null
  onClose: () => void
}

// A short message at the foot of the page, for a change made on the page
// itself (a menu entry, a star, a drag) that couldn't be saved: there's no
// dialog open to say it in. It goes after a while, with its close button or
// with Escape; a click elsewhere on the page leaves it up, so it can be read
// while carrying on.
export default function FailureMessage({ message, onClose }: Props) {
  const { t } = useTranslation()
  // The last message, kept while the box slides away once closed, so it
  // doesn't empty itself on the way out.
  const [shown, setShown] = useState(message)
  if (message !== null && message !== shown) setShown(message)

  return (
    <Snackbar
      open={message !== null}
      autoHideDuration={FAILURE_MESSAGE_MS}
      onClose={(_, reason) => { if (reason !== 'clickaway') onClose() }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity="error" variant="filled" onClose={onClose} closeText={t('common.close')} sx={{ width: '100%' }}>
        {shown}
      </Alert>
    </Snackbar>
  )
}
