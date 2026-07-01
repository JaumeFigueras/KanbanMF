import { useState } from 'react'
import { Card, IconButton, Menu, MenuItem, Typography } from '@mui/material'
import { Menu as HamburgerIcon, OpenWith } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { CardRead } from '../types/board'

interface Props {
  card: CardRead
  boardId: string
  listId: string
  accessToken: string
  onArchived: (cardId: string) => void
}

export default function CardItem({ card, boardId, listId, accessToken, onArchived }: Props) {
  const { t } = useTranslation()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  function openMenu(e: React.MouseEvent<HTMLElement>) {
    setMenuAnchor(e.currentTarget)
  }

  function closeMenu() {
    setMenuAnchor(null)
  }

  async function handleArchive() {
    closeMenu()
    try {
      const r = await fetch(
        `http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/${card.id}`,
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
      if (r.ok) onArchived(card.id)
    } catch {
      // silently ignore — parent still shows the card
    }
  }

  return (
    <>
      <Card
        variant="outlined"
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1,
          py: 0.5,
          mb: 1,
        }}
      >
        <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word' }}>
          {card.name}
        </Typography>

        <IconButton size="small" aria-label={t('board.moveCard')} sx={{ cursor: 'grab' }}>
          <OpenWith fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={openMenu} aria-label={t('board.cardMenu')}>
          <HamburgerIcon fontSize="small" />
        </IconButton>
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleArchive}>{t('board.archiveCard')}</MenuItem>
      </Menu>
    </>
  )
}
