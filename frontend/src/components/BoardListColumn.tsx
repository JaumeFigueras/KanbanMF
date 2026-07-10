import { useEffect, useMemo, useState } from 'react'
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
import ChangeListColorDialog from './ChangeListColorDialog'
import { DEFAULT_COLOR } from './ChangeBoardColorDialog'
import { STRONG_TINT_WEIGHT, tintColor } from '../utils/colorTint'

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
  // True only for the floating clone rendered inside <DragOverlay> — it must
  // not register its own drag (that would collide with the real column's) or
  // respond to clicks. Mirrors CardItem's own dragOverlay prop.
  dragOverlay?: boolean
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
  dragOverlay = false,
}: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [cardDialogOpen, setCardDialogOpen] = useState(false)
  const [colorDialogOpen, setColorDialogOpen] = useState(false)
  const [listColor, setListColor] = useState<string | null>(null)

  useEffect(() => {
    apiFetch(`/api/v1/boards/${list.board_id}/lists/${list.id}/color`)
      .then(r => r.ok ? r.json() as Promise<{ color: string | null }> : null)
      .then(data => setListColor(data?.color ?? null))
      .catch(() => {})
  }, [list.board_id, list.id])

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

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragOverlay ? `overlay-${list.id}` : list.id,
    data: { type: 'list' },
    disabled: dragOverlay,
  })

  // Lets an empty list (or the space below its last card) still accept a
  // card dropped in from another list. Given a distinct id in overlay mode
  // so it doesn't collide with the real column's own dropzone registration.
  const { setNodeRef: setDropZoneRef } = useDroppable({
    id: dragOverlay ? `overlay-list-dropzone:${list.id}` : `list-dropzone:${list.id}`,
  })

  const style = dragOverlay
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition }

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

  function handleChangeColor() {
    closeMenu()
    setColorDialogOpen(true)
  }

  async function handleArchive() {
    closeMenu()
    try {
      const r = await apiFetch(
        `/api/v1/boards/${list.board_id}/lists/${list.id}`,
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
        ref={dragOverlay ? undefined : setNodeRef}
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
          position: 'relative',
          cursor: dragOverlay ? 'grabbing' : undefined,
        }}
      >
        {/* Header + card area stay mounted and laid out while dragging, so
            the column keeps its own footprint — that footprint is exactly
            the drop slot the opaque dashed overlay below covers. (Can't hide
            this via a `visibility: hidden` wrapper: each CardItem inside
            explicitly sets its own `visibility: visible`, which — unlike
            `display` — overrides an inherited `hidden` from an ancestor.) */}
        <>
          {/* Header — tinted with the viewer's chosen list color, falling
              back to the app default when they haven't picked one. Opaque
              (not alpha) so it doesn't blend with the board page's own
              tinted background sitting behind the Paper — see utils/colorTint. */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              px: 1,
              py: 0.5,
              bgcolor: (theme) => tintColor(listColor ?? DEFAULT_COLOR, theme.palette.background.paper, STRONG_TINT_WEIGHT),
              borderBottom: `1px solid ${listColor ?? DEFAULT_COLOR}`,
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
              sx={{ cursor: dragOverlay || isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
              {...attributes}
              {...listeners}
            >
              <OpenWith sx={{ fontSize: 22 }} />
            </IconButton>
            <IconButton
              size="small"
              aria-label={t('board.addCard')}
              onClick={dragOverlay ? undefined : () => setCardDialogOpen(true)}
            >
              <Add sx={{ fontSize: 22 }} />
            </IconButton>
            <IconButton size="small" onClick={dragOverlay ? undefined : openMenu} aria-label={t('board.listMenu')}>
              <HamburgerIcon sx={{ fontSize: 22 }} />
            </IconButton>
          </Box>

          {/* Card area (scrolls vertically) — same flat tint as the header,
              applied directly here rather than on the Paper, so the two
              don't stack into a darker double coat. */}
          <Box
            ref={setDropZoneRef}
            sx={{
              overflowY: 'auto',
              flex: 1,
              p: 1,
              minHeight: 80,
              bgcolor: (theme) => tintColor(listColor ?? DEFAULT_COLOR, theme.palette.background.paper, STRONG_TINT_WEIGHT),
            }}
          >
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
                  dragOverlay={dragOverlay}
                />
              ))}
            </SortableContext>
          </Box>
        </>
        {isDragging && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              border: '2px dashed',
              borderColor: 'primary.main',
              borderRadius: 2,
              // Opaque — this has to fully hide the real header/cards
              // underneath (they're still mounted, just covered), not just
              // tint them.
              bgcolor: 'background.paper',
            }}
          />
        )}
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleRename}>{t('board.renameList')}</MenuItem>
        <MenuItem onClick={handleChangeColor}>{t('board.changeListColor')}</MenuItem>
        <MenuItem onClick={handleArchive}>{t('board.archiveList')}</MenuItem>
      </Menu>

      <RenameListDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        list={list}
        onSaved={onRenamed}
      />

      <ChangeListColorDialog
        open={colorDialogOpen}
        onClose={() => setColorDialogOpen(false)}
        list={list}
        currentColor={listColor}
        onSaved={setListColor}
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
