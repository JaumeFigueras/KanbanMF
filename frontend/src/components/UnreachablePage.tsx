import { Box } from '@mui/material'
import { useTranslation } from 'react-i18next'
import AuthControls from './AuthControls'
import LoadFailure from './LoadFailure'

interface Props {
  onRetry: () => void
}

// What a signed-in page shows when the start-up check got no answer (see
// ProtectedRoute): KanbanMF couldn't be reached, with Try again. Laid out
// like the signed-out pages, with their language and theme switches, since
// the user's own language couldn't be loaded either.
export default function UnreachablePage({ onRetry }: Props) {
  const { t } = useTranslation()
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
      <LoadFailure message={t('common.unreachable')} onRetry={onRetry} sx={{ width: '100%', maxWidth: 440 }} />
    </Box>
  )
}
