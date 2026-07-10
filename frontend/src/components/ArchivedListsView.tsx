import { useEffect, useMemo, useState } from 'react'
import {
  AppBar,
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Toolbar,
  Typography,
} from '@mui/material'
import { Archive, DeleteForever, Menu as HamburgerIcon, Undo, Unarchive } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import type { BoardListRead, CardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import CardFace from './CardFace'

interface Props {
  boardId: string
  boardName: string
  activeLists: BoardListRead[]
  numberLocale: string
  dateFormat: DateFormat
  isOwner: boolean
  onReturn: () => void
}

interface ListColumn {
  listId: string
  listName: string
  archived: boolean
  cards: CardRead[]
}

type ItemTarget =
  | { type: 'list'; id: string; listId: string; name: string }
  | { type: 'card'; id: string; listId: string; name: string }

export default function ArchivedListsView({
  boardId,
  boardName,
  activeLists,
  numberLocale,
  dateFormat,
  isOwner,
  onReturn,
}: Props) {
  const { t } = useTranslation()
  const [archivedLists, setArchivedLists] = useState<BoardListRead[]>([])
  const [archivedCards, setArchivedCards] = useState<CardRead[]>([])
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuTarget, setMenuTarget] = useState<ItemTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ItemTarget | null>(null)
  const [deleteError, setDeleteError] = useState(false)

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/v1/boards/${boardId}/lists/archived`)
        .then(r => r.ok ? r.json() as Promise<BoardListRead[]> : []),
      apiFetch(`/api/v1/boards/${boardId}/cards/archived`)
        .then(r => r.ok ? r.json() as Promise<CardRead[]> : []),
    ])
      .then(([lists, cards]) => {
        setArchivedLists(lists)
        setArchivedCards(cards)
      })
      .catch(() => {})
  }, [boardId])

  // One 330px column per list — archived lists first (red header), then any
  // list whose own cards were archived individually while it stayed active
  // (plain header) — same column shape and card face as the live board.
  const columns = useMemo<ListColumn[]>(() => {
    const cardsByList = new Map<string, CardRead[]>()
    for (const card of archivedCards) {
      const list = cardsByList.get(card.list_id) ?? []
      list.push(card)
      cardsByList.set(card.list_id, list)
    }

    const archivedListColumns: ListColumn[] = archivedLists.map(list => ({
      listId: list.id,
      listName: list.name,
      archived: true,
      cards: cardsByList.get(list.id) ?? [],
    }))

    const archivedListIds = new Set(archivedLists.map(l => l.id))
    const activeListsById = new Map(activeLists.map(l => [l.id, l]))
    const looseCardColumns: ListColumn[] = []
    for (const [listId, cards] of cardsByList) {
      if (archivedListIds.has(listId)) continue
      looseCardColumns.push({
        listId,
        listName: activeListsById.get(listId)?.name ?? '',
        archived: false,
        cards,
      })
    }

    return [...archivedListColumns, ...looseCardColumns]
  }, [archivedLists, archivedCards, activeLists])

  function openMenu(e: React.MouseEvent<HTMLElement>, target: ItemTarget) {
    e.stopPropagation()
    setMenuAnchor(e.currentTarget)
    setMenuTarget(target)
  }

  function closeMenu() {
    setMenuAnchor(null)
    setMenuTarget(null)
  }

  async function handleRestore() {
    const target = menuTarget
    closeMenu()
    if (!target) return

    const url = target.type === 'list'
      ? `/api/v1/boards/${boardId}/lists/${target.id}`
      : `/api/v1/boards/${boardId}/lists/${target.listId}/cards/${target.id}`
    const r = await apiFetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: false }),
    })
    if (!r.ok) return

    if (target.type === 'list') {
      // Restoring a list also restores its cards (backend cascade), so both
      // disappear from this view together.
      setArchivedLists(prev => prev.filter(l => l.id !== target.id))
      setArchivedCards(prev => prev.filter(c => c.list_id !== target.id))
    } else {
      setArchivedCards(prev => prev.filter(c => c.id !== target.id))
    }
  }

  function handleDeleteClick() {
    if (menuTarget) setDeleteTarget(menuTarget)
    closeMenu()
  }

  async function handleDeleteConfirmed() {
    const target = deleteTarget
    if (!target) return
    setDeleteError(false)

    const url = target.type === 'list'
      ? `/api/v1/boards/${boardId}/lists/${target.id}`
      : `/api/v1/boards/${boardId}/lists/${target.listId}/cards/${target.id}`
    const r = await apiFetch(url, { method: 'DELETE' })
    if (!r.ok) {
      setDeleteError(true)
      return
    }

    if (target.type === 'list') {
      setArchivedLists(prev => prev.filter(l => l.id !== target.id))
      setArchivedCards(prev => prev.filter(c => c.list_id !== target.id))
    } else {
      setArchivedCards(prev => prev.filter(c => c.id !== target.id))
    }
    setDeleteTarget(null)
  }

  return (
    <>
      <AppBar
        position="fixed"
        elevation={1}
        sx={{ top: { xs: '56px', sm: '64px' }, bgcolor: 'error.main', color: 'white' }}
      >
        <Toolbar>
          <Archive sx={{ mr: 1.5 }} />
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 1 }} noWrap>
            {boardName}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.85, mr: 2 }} noWrap>
            — {t('board.archivedListsAndCards')}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Undo />}
            onClick={onReturn}
            sx={{ color: 'white', borderColor: 'white', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' } }}
          >
            {t('board.returnToBoard')}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
        </Toolbar>
      </AppBar>

      {/* Two spacers: one per fixed bar */}
      <Toolbar />
      <Toolbar />

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleRestore}>
          <ListItemIcon><Unarchive fontSize="small" /></ListItemIcon>
          <ListItemText>{t('board.restore')}</ListItemText>
        </MenuItem>
        {isOwner && (
          <MenuItem onClick={handleDeleteClick} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteForever fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t('common.delete')}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: 'error.main' }}>{t('board.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{t('common.saveError')}</Alert>}
          <DialogContentText>
            {t('board.deleteConfirmMessage', { name: deleteTarget?.name ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button onClick={handleDeleteConfirmed} color="error" variant="contained">
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {columns.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">{t('board.noArchivedLists')}</Typography>
        </Box>
      ) : (
        // Multi-column (masonry-like) flow: columns fill top-to-bottom and
        // wrap downward once the row is full, instead of growing endlessly
        // to the right — columns naturally vary in height with their cards.
        <Box sx={{ p: 2, columnWidth: 330, columnGap: '16px' }}>
          {columns.map(column => (
            <Paper
              key={column.listId}
              elevation={2}
              sx={{
                width: 330,
                display: 'inline-block',
                breakInside: 'avoid',
                mb: 2,
                borderRadius: 2,
                overflow: 'hidden',
                border: column.archived
                  ? (theme) => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(211, 47, 47, 0.35)' : '#ffcdd2'}`
                  : undefined,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  px: 1.5,
                  py: 0.75,
                  ...(column.archived
                    ? { bgcolor: 'error.main', color: 'white' }
                    : { borderBottom: 1, borderColor: 'divider' }),
                }}
              >
                <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 700, fontSize: '0.9625rem' }} noWrap>
                  {column.listName}
                </Typography>
                {column.archived && (
                  <IconButton
                    size="small"
                    aria-label={t('board.listMenu')}
                    sx={{ color: 'white' }}
                    onClick={(e) => openMenu(e, { type: 'list', id: column.listId, listId: column.listId, name: column.listName })}
                  >
                    <HamburgerIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ p: 1 }}>
                {column.cards.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">{t('board.noCardsInList')}</Typography>
                ) : (
                  column.cards.map(card => (
                    <Card key={card.id} variant="outlined" sx={{ mb: 1 }}>
                      <CardFace
                        card={card}
                        numberLocale={numberLocale}
                        dateFormat={dateFormat}
                        // Cards inside an archived list have no menu of their
                        // own — restoring/deleting the list covers all of
                        // them together. Only a card archived individually
                        // (its list still active) gets its own menu.
                        headerActions={column.archived ? undefined : (
                          <IconButton
                            size="small"
                            aria-label={t('board.cardMenu')}
                            onClick={(e) => openMenu(e, { type: 'card', id: card.id, listId: column.listId, name: card.name })}
                          >
                            <HamburgerIcon sx={{ fontSize: 22 }} />
                          </IconButton>
                        )}
                      />
                    </Card>
                  ))
                )}
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </>
  )
}
