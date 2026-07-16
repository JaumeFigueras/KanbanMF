import { useState } from 'react'
import {
  Box,
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
import ChangeCardColorDialog from './ChangeCardColorDialog'
import CopyCardDialog from './CopyCardDialog'
import { DEFAULT_COLOR } from './ChangeBoardColorDialog'
import { STRONG_TINT_WEIGHT, tintColor } from '../utils/colorTint'

interface Props {
  card: CardRead
  boardId: string
  listId: string
  numberLocale: string
  dateFormat: DateFormat
  // The viewer's color for this card, fetched once up front by the board
  // page — avoids the default-color flash that fetching it on mount used
  // to cause. See Board.tsx's `colors`.
  initialColor: string | null
  onArchived: (cardId: string) => void
  onUpdated: (card: CardRead) => void
  // Same shape as CardDialog's onCreated — lets the copy show up immediately
  // when it lands on a list already on screen.
  onCopied: (targetListId: string, card: CardRead, color: string | null) => void
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
  initialColor,
  onArchived,
  onUpdated,
  onCopied,
  dragOverlay = false,
}: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [colorDialogOpen, setColorDialogOpen] = useState(false)
  const [copyDialogOpen, setCopyDialogOpen] = useState(false)
  // undefined = no explicit local choice yet, so `initialColor` (which the
  // board page can still update after mount — e.g. a freshly created or
  // copied card's color arrives via a follow-up fetch, see Board.tsx's
  // handleCardCreated) keeps driving the display. Once the user explicitly
  // saves or clears a color via ChangeCardColorDialog, that choice wins for
  // the rest of this component's lifetime.
  const [colorOverride, setColorOverride] = useState<string | null | undefined>(undefined)
  const cardColor = colorOverride !== undefined ? colorOverride : initialColor

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

  function handleChangeColor() {
    closeMenu()
    setColorDialogOpen(true)
  }

  function handleCopy() {
    closeMenu()
    setCopyDialogOpen(true)
  }

  async function handleArchive() {
    closeMenu()
    try {
      const r = await apiFetch(
        `/api/v1/boards/${boardId}/lists/${listId}/cards/${card.id}`,
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
        sx={{
          mb: 1,
          position: 'relative',
          cursor: dragOverlay ? 'grabbing' : 'pointer',
          // Opaque (not alpha) so this doesn't blend with the list's own
          // tinted background sitting behind it — see utils/colorTint.
          bgcolor: (theme) => tintColor(cardColor ?? DEFAULT_COLOR, theme.palette.background.paper, STRONG_TINT_WEIGHT),
          borderColor: cardColor ?? DEFAULT_COLOR,
        }}
      >
        {/* Content stays laid out (visibility, not display) so the card keeps
            its own footprint — that footprint is exactly the drop slot the
            dashed overlay below highlights. */}
        <Box sx={{ visibility: isDragging ? 'hidden' : 'visible' }}>
          <CardFace
            card={card}
            numberLocale={numberLocale}
            dateFormat={dateFormat}
            color={cardColor ?? DEFAULT_COLOR}
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
        </Box>
        {isDragging && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              border: '2px dashed',
              borderColor: 'primary.main',
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          />
        )}
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleEdit}>{t('board.editCard')}</MenuItem>
        <MenuItem onClick={handleChangeColor}>{t('board.changeCardColor')}</MenuItem>
        <MenuItem onClick={handleCopy}>{t('board.copyCard')}</MenuItem>
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

      <ChangeCardColorDialog
        open={colorDialogOpen}
        onClose={() => setColorDialogOpen(false)}
        boardId={boardId}
        listId={listId}
        cardId={card.id}
        currentColor={cardColor}
        onSaved={setColorOverride}
      />

      <CopyCardDialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        boardId={boardId}
        listId={listId}
        cardId={card.id}
        cardName={card.name}
        onCopied={onCopied}
      />
    </>
  )
}
