import { useState } from 'react'
import {
  Card,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material'
import { Menu as HamburgerIcon, OpenWith } from '@mui/icons-material'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import type { CardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import { apiFetch } from '../api/client'
import CardDialog from './CardDialog'
import CardFace from './CardFace'

interface Props {
  card: CardRead
  boardId: string
  listId: string
  numberLocale: string
  dateFormat: DateFormat
  onArchived: (cardId: string) => void
  onUpdated: (card: CardRead) => void
  // True only for the floating clone rendered inside <DragOverlay> — it must
  // not register its own drag (that would collide with the real card's) or
  // respond to clicks.
  dragOverlay?: boolean
}

export default function CardItem({
  card,
  boardId,
  listId,
  numberLocale,
  dateFormat,
  onArchived,
  onUpdated,
  dragOverlay = false,
}: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragOverlay ? `overlay-${card.id}` : card.id,
    data: { type: 'card', listId },
    disabled: dragOverlay,
  })
  const dragStyle = dragOverlay
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition }

  function openMenu(e: React.MouseEvent<HTMLElement>) {
    setMenuAnchor(e.currentTarget)
  }

  function closeMenu() {
    setMenuAnchor(null)
  }

  function handleEdit() {
    closeMenu()
    setEditOpen(true)
  }

  async function handleArchive() {
    closeMenu()
    try {
      const r = await apiFetch(
        `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_archived: true }),
        },
      )
      if (r.ok) onArchived(card.id)
    } catch {
      // silently ignore — parent still shows the card
    }
  }

  return (
    <>
      <Card
        ref={dragOverlay ? undefined : setNodeRef}
        style={dragStyle}
        variant="outlined"
        onClick={dragOverlay ? undefined : () => setEditOpen(true)}
        sx={{ mb: 1, cursor: dragOverlay ? 'grabbing' : 'pointer', opacity: isDragging ? 0.5 : 1 }}
      >
        <CardFace
          card={card}
          numberLocale={numberLocale}
          dateFormat={dateFormat}
          headerActions={
            <>
              <IconButton
                size="small"
                aria-label={t('board.moveCard')}
                sx={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                onClick={(e) => e.stopPropagation()}
                {...attributes}
                {...listeners}
              >
                <OpenWith sx={{ fontSize: 22 }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); openMenu(e) }}
                aria-label={t('board.cardMenu')}
              >
                <HamburgerIcon sx={{ fontSize: 22 }} />
              </IconButton>
            </>
          }
        />
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleEdit}>{t('board.editCard')}</MenuItem>
        <MenuItem onClick={handleArchive}>{t('board.archiveCard')}</MenuItem>
      </Menu>

      <CardDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        listId={listId}
        boardId={boardId}
        numberLocale={numberLocale}
        card={card}
        onUpdated={onUpdated}
      />
    </>
  )
}
