import { useState } from 'react'
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Typography,
} from '@mui/material'
import { Add, Menu as HamburgerIcon, OpenWith } from '@mui/icons-material'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { BoardListRead } from '../types/board'
import RenameListDialog from './RenameListDialog'

interface Props {
  list: BoardListRead
  accessToken: string
  onRenamed: (listId: string, newName: string) => void
  onArchived: (listId: string) => void
}

export default function BoardListColumn({ list, accessToken, onRenamed, onArchived }: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: list.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  function openMenu(e: React.MouseEvent<HTMLElement>) {
    setMenuAnchor(e.currentTarget)
  }

  function closeMenu() {
    setMenuAnchor(null)
  }

  function handleRename() {
    closeMenu()
    setRenameOpen(true)
  }

  async function handleArchive() {
    closeMenu()
    try {
      const r = await fetch(
        `http://localhost:8000/api/v1/boards/${list.board_id}/lists/${list.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
          body: JSON.stringify({ is_archived: true }),
        },
      )
      if (r.ok) onArchived(list.id)
    } catch {
      // silently ignore — parent still shows the list
    }
  }

  return (
    <>
      <Paper
        ref={setNodeRef}
        style={style}
        elevation={2}
        sx={{
          width: 272,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '100%',
          borderRadius: 2,
          overflow: 'hidden',
          opacity: isDragging ? 0.5 : 1,
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{ flex: 1, fontWeight: 700, px: 0.5 }}
            noWrap
          >
            {list.name}
          </Typography>

          <IconButton
            size="small"
            aria-label={t('board.moveList')}
            sx={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            {...attributes}
            {...listeners}
          >
            <OpenWith fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label={t('board.addCard')}>
            <Add fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={openMenu} aria-label={t('board.listMenu')}>
            <HamburgerIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Card area (scrolls vertically) */}
        <Box sx={{ overflowY: 'auto', flex: 1, p: 1, minHeight: 80 }} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleRename}>{t('board.renameList')}</MenuItem>
        <MenuItem onClick={handleArchive}>{t('board.archiveList')}</MenuItem>
      </Menu>

      <RenameListDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        list={list}
        accessToken={accessToken}
        onSaved={onRenamed}
      />
    </>
  )
}
