import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  // The list, and how many cards it holds now.
  listName: string
  count: number
  onClose: () => void
  onConfirm: () => void
}

// Asks before archiving every card in a list. One click used to do it, and
// getting the cards back means restoring them one by one from the archive.
// It only asks: BoardListColumn archives the cards and reports any it
// couldn't, as before. Laid out like ArchiveBoardDialog.
export default function ArchiveAllCardsDialog({ open, listName, count, onClose, onConfirm }: Props) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('board.archiveAllCardsConfirmTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t('board.archiveAllCardsConfirmMessage', { count, name: listName })}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error">
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} color="success" variant="contained">
          {t('boards.archive')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
