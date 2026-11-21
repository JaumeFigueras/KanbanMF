import { Alert, Box, Button } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { useTranslation } from 'react-i18next'

// Where a page's load stands: under way, failed (say so, with Try again),
// or in (show it, or its "nothing here").
export type LoadState = 'loading' | 'failed' | 'loaded'

interface Props {
  // What couldn't be loaded, as a sentence.
  message: string
  onRetry: () => void
  sx?: SxProps<Theme>
}

// Said in place of data that couldn't be loaded (a server error, a dropped
// connection), so the page can't be taken for having nothing to show, with
// a button to load it again. The button sits under the text rather than
// beside it, so it also fits in a list's narrow column.
export default function LoadFailure({ message, onRetry, sx }: Props) {
  const { t } = useTranslation()
  return (
    <Alert severity="error" sx={sx}>
      {message}
      <Box sx={{ mt: 1 }}>
        <Button variant="outlined" color="inherit" size="small" onClick={onRetry}>
          {t('common.tryAgain')}
        </Button>
      </Box>
    </Alert>
  )
}
