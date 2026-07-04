import { useMemo, useState } from 'react'
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Typography,
} from '@mui/material'
import { Add, Menu as HamburgerIcon, OpenWith } from '@mui/icons-material'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { BoardListRead, CardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import type { SortMode } from '../utils/cardSort'
import { sortCards } from '../utils/cardSort'
import { apiFetch } from '../api/client'
import CardDialog from './CardDialog'
import CardItem from './CardItem'
import RenameListDialog from './RenameListDialog'

interface Props {
  list: BoardListRead
  cards: CardRead[]
  customOrderIds: string[]
  numberLocale: string
  dateFormat: DateFormat
  sortMode: SortMode
  onRenamed: (listId: string, newName: string) => void
  onArchived: (listId: string) => void
  onCardCreated: (listId: string, card: CardRead) => void
  onCardArchived: (listId: string, cardId: string) => void
  onCardUpdated: (listId: string, card: CardRead) => void
}

export default function BoardListColumn({
  list,
  cards,
  customOrderIds,
  numberLocale,
  dateFormat,
  sortMode,
  onRenamed,
  onArchived,
  onCardCreated,
  onCardArchived,
  onCardUpdated,
}: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [cardDialogOpen, setCardDialogOpen] = useState(false)

  const sortedCards = useMemo(
    () => sortCards(cards, sortMode, customOrderIds),
    [cards, sortMode, customOrderIds],
  )

  function handleCardCreated(card: CardRead) {
    onCardCreated(list.id, card)
  }

  function handleCardArchived(cardId: string) {
    onCardArchived(list.id, cardId)
  }

  function handleCardUpdated(card: CardRead) {
    onCardUpdated(list.id, card)
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: list.id, data: { type: 'list' } })

  // Lets an empty list (or the space below its last card) still accept a
  // card dropped in from another list.
  const { setNodeRef: setDropZoneRef } = useDroppable({ id: `list-dropzone:${list.id}` })

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
      const r = await apiFetch(
        `http://localhost:8000/api/v1/boards/${list.board_id}/lists/${list.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
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
          width: 330,
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
            sx={{ flex: 1, fontWeight: 700, px: 0.5, fontSize: '0.9625rem' }}
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
            <OpenWith sx={{ fontSize: 22 }} />
          </IconButton>
          <IconButton size="small" aria-label={t('board.addCard')} onClick={() => setCardDialogOpen(true)}>
            <Add sx={{ fontSize: 22 }} />
          </IconButton>
          <IconButton size="small" onClick={openMenu} aria-label={t('board.listMenu')}>
            <HamburgerIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </Box>

        {/* Card area (scrolls vertically) */}
        <Box ref={setDropZoneRef} sx={{ overflowY: 'auto', flex: 1, p: 1, minHeight: 80 }}>
          <SortableContext items={sortedCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {sortedCards.map(card => (
              <CardItem
                key={card.id}
                card={card}
                boardId={list.board_id}
                listId={list.id}
                numberLocale={numberLocale}
                dateFormat={dateFormat}
                onArchived={handleCardArchived}
                onUpdated={handleCardUpdated}
              />
            ))}
          </SortableContext>
        </Box>
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleRename}>{t('board.renameList')}</MenuItem>
        <MenuItem onClick={handleArchive}>{t('board.archiveList')}</MenuItem>
      </Menu>

      <RenameListDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        list={list}
        onSaved={onRenamed}
      />

      <CardDialog
        open={cardDialogOpen}
        onClose={() => setCardDialogOpen(false)}
        listId={list.id}
        boardId={list.board_id}
        numberLocale={numberLocale}
        onCreated={handleCardCreated}
      />
    </>
  )
}
