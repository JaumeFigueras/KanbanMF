import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
} from '@mui/material'
import { Add, Check, Label, Menu as MenuIcon, Sort as SortIcon } from '@mui/icons-material'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useTranslation } from 'react-i18next'
import MainAppBar from '../components/MainAppBar'
import CreateListDialog from '../components/CreateListDialog'
import ManageLabelsDialog from '../components/ManageLabelsDialog'
import BoardListColumn from '../components/BoardListColumn'
import CardItem from '../components/CardItem'
import type { BoardListRead, BoardListOrderRead, BoardRead, CardOrderRead, CardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import type { SortMode } from '../utils/cardSort'
import { SORT_OPTIONS, sortCards } from '../utils/cardSort'
import { apiFetch } from '../api/client'

export default function Board() {
  const { t } = useTranslation()
  const { boardId } = useParams<{ boardId: string }>()
  const [board, setBoard] = useState<BoardRead | null>(null)
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [createListOpen, setCreateListOpen] = useState(false)
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false)
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<HTMLElement | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem(`kanbanmf:sort:${boardId}`) as SortMode | null) ?? 'custom',
  )
  const [cardsByList, setCardsByList] = useState<Record<string, CardRead[]>>({})
  const [orderByList, setOrderByList] = useState<Record<string, string[]>>({})
  const [activeCard, setActiveCard] = useState<CardRead | null>(null)

  useEffect(() => {
    if (!boardId) return
    localStorage.setItem(`kanbanmf:sort:${boardId}`, sortMode)
  }, [boardId, sortMode])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  useEffect(() => {
    if (!boardId) return
    apiFetch(`http://localhost:8000/api/v1/boards/${boardId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBoard(data) })
      .catch(() => {})
  }, [boardId])

  useEffect(() => {
    if (!boardId) return
    Promise.all([
      apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists`)
        .then(r => r.ok ? r.json() as Promise<BoardListRead[]> : []),
      apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/order`)
        .then(r => r.ok ? r.json() as Promise<BoardListOrderRead> : { board_id: boardId, list_ids: [] }),
    ])
      .then(([fetchedLists, fetchedOrder]) => {
        setLists(fetchedLists)
        setOrder(fetchedOrder.list_ids)
      })
      .catch(() => {})
  }, [boardId])

  // Cards live here (not in BoardListColumn) so a card can be dragged from
  // one list's array into another's. Fetch only for lists we haven't loaded yet.
  useEffect(() => {
    if (!boardId) return
    const toFetch = lists.filter(l => !(l.id in cardsByList))
    if (toFetch.length === 0) return

    Promise.all(
      toFetch.map(list =>
        Promise.all([
          apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${list.id}/cards`)
            .then(r => r.ok ? r.json() as Promise<CardRead[]> : []),
          apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${list.id}/cards/order`)
            .then(r => r.ok ? r.json() as Promise<CardOrderRead> : { list_id: list.id, card_ids: [] }),
        ]).then(([cards, order]) => ({ listId: list.id, cards, cardIds: order.card_ids })),
      ),
    )
      .then(results => {
        setCardsByList(prev => {
          const next = { ...prev }
          for (const r of results) next[r.listId] = r.cards
          return next
        })
        setOrderByList(prev => {
          const next = { ...prev }
          for (const r of results) next[r.listId] = r.cardIds
          return next
        })
      })
      .catch(() => {})
  }, [boardId, lists, cardsByList])

  // Merge lists with the stored order: ordered first, then any unordered remainders
  const sortedLists = useMemo(() => {
    const byId = new Map(lists.map(l => [l.id, l]))
    const ordered = order.filter(id => byId.has(id)).map(id => byId.get(id)!)
    const unordered = lists.filter(l => !order.includes(l.id))
    return [...ordered, ...unordered]
  }, [lists, order])

  function handleListCreated(list: BoardListRead) {
    setLists(prev => [...prev, list])
    setOrder(prev => [...prev, list.id])
  }

  function openSortMenu(e: React.MouseEvent<HTMLElement>) {
    setSortMenuAnchor(e.currentTarget)
  }

  function closeSortMenu() {
    setSortMenuAnchor(null)
  }

  function handleSortSelect(mode: SortMode) {
    setSortMode(mode)
    closeSortMenu()
  }

  function handleListRenamed(listId: string, newName: string) {
    setLists(prev => prev.map(l => l.id === listId ? { ...l, name: newName } : l))
  }

  function handleListArchived(listId: string) {
    setLists(prev => prev.filter(l => l.id !== listId))
    setOrder(prev => prev.filter(id => id !== listId))
  }

  function handleCardCreated(listId: string, card: CardRead) {
    setCardsByList(prev => ({ ...prev, [listId]: [...(prev[listId] ?? []), card] }))
  }

  function handleCardArchived(listId: string, cardId: string) {
    setCardsByList(prev => ({
      ...prev,
      [listId]: (prev[listId] ?? []).filter(c => c.id !== cardId),
    }))
  }

  function handleCardUpdated(listId: string, card: CardRead) {
    setCardsByList(prev => ({
      ...prev,
      [listId]: (prev[listId] ?? []).map(c => c.id === card.id ? card : c),
    }))
  }

  function persistCardOrder(listId: string, cardIds: string[]) {
    apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_ids: cardIds }),
    }).catch(() => {})
  }

  function persistCardMove(sourceListId: string, cardId: string, destListId: string) {
    apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${sourceListId}/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: destListId }),
    }).catch(() => {})
  }

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    if (active.data.current?.type !== 'card') return
    const sourceListId = active.data.current.listId as string
    const card = (cardsByList[sourceListId] ?? []).find(c => c.id === active.id)
    if (card) setActiveCard(card)
  }

  // Resolves whatever the card was dropped on (another card, a list's empty
  // area, or the list itself) to a destination list id.
  function resolveDestinationListId(over: NonNullable<DragEndEvent['over']>): string | undefined {
    const overType = over.data.current?.type
    if (overType === 'card') return over.data.current?.listId as string
    if (overType === 'list') return over.id as string
    if (typeof over.id === 'string' && over.id.startsWith('list-dropzone:')) {
      return over.id.slice('list-dropzone:'.length)
    }
    return undefined
  }

  function handleCardDragEnd(active: DragEndEvent['active'], over: NonNullable<DragEndEvent['over']>) {
    const cardId = active.id as string
    const sourceListId = active.data.current?.listId as string | undefined
    if (!sourceListId) return

    const destListId = resolveDestinationListId(over)
    if (!destListId) return

    const sourceCards = cardsByList[sourceListId] ?? []
    const movingCard = sourceCards.find(c => c.id === cardId)
    if (!movingCard) return

    const overIsCard = over.data.current?.type === 'card'

    if (sourceListId === destListId) {
      // Reordering within the same list only matters — and is only
      // persisted — when the board is displaying the custom order.
      if (sortMode !== 'custom') return
      const displayed = sortCards(sourceCards, sortMode, orderByList[sourceListId] ?? [])
      const oldIndex = displayed.findIndex(c => c.id === cardId)
      const newIndex = overIsCard ? displayed.findIndex(c => c.id === over.id) : displayed.length - 1
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

      const reordered = arrayMove(displayed, oldIndex, newIndex)
      const newOrderIds = reordered.map(c => c.id)
      setCardsByList(prev => ({ ...prev, [sourceListId]: reordered }))
      setOrderByList(prev => ({ ...prev, [sourceListId]: newOrderIds }))
      persistCardOrder(sourceListId, newOrderIds)
      return
    }

    // Moving to a different list — the card always moves; only its
    // position within the destination is custom-order-specific.
    const destCards = sortCards(cardsByList[destListId] ?? [], sortMode, orderByList[destListId] ?? [])
    const withoutMoved = sourceCards.filter(c => c.id !== cardId)
    let insertIndex = overIsCard ? destCards.findIndex(c => c.id === over.id) : destCards.length
    if (insertIndex === -1) insertIndex = destCards.length

    const movedCard: CardRead = { ...movingCard, list_id: destListId }
    const newDestCards = [...destCards.slice(0, insertIndex), movedCard, ...destCards.slice(insertIndex)]

    setCardsByList(prev => ({
      ...prev,
      [sourceListId]: withoutMoved,
      [destListId]: newDestCards,
    }))
    persistCardMove(sourceListId, cardId, destListId)

    if (sortMode === 'custom') {
      const destOrderIds = newDestCards.map(c => c.id)
      const sourceOrderIds = withoutMoved.map(c => c.id)
      setOrderByList(prev => ({ ...prev, [destListId]: destOrderIds, [sourceListId]: sourceOrderIds }))
      persistCardOrder(destListId, destOrderIds)
      persistCardOrder(sourceListId, sourceOrderIds)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    if (!over) return

    const activeType = active.data.current?.type
    if (activeType === 'card') {
      handleCardDragEnd(active, over)
      return
    }

    if (active.id === over.id) return
    const oldIndex = sortedLists.findIndex(l => l.id === active.id)
    const newIndex = sortedLists.findIndex(l => l.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(sortedLists, oldIndex, newIndex)
    const newOrder = reordered.map(l => l.id)

    setLists(reordered)
    setOrder(newOrder)

    apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_ids: newOrder }),
    }).catch(() => {})
  }

  return (
    <>
      <MainAppBar
        onLocaleChanged={(num, fmt) => {
          setNumberLocale(num)
          setDateFormat(fmt)
        }}
      />

      {/* Secondary board toolbar — sits below the main AppBar */}
      <AppBar
        position="fixed"
        color="default"
        elevation={1}
        sx={{ top: { xs: '56px', sm: '64px' } }}
      >
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 2 }} noWrap>
            {board?.name ?? '…'}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<Add />}
            size="small"
            onClick={() => setCreateListOpen(true)}
          >
            {t('board.addList')}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<Label />}
            size="small"
            sx={{ ml: 1 }}
            onClick={() => setManageLabelsOpen(true)}
          >
            {t('board.manageLabels')}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<SortIcon />}
            size="small"
            sx={{ ml: 1 }}
            onClick={openSortMenu}
            aria-label={t('board.sortCards')}
          >
            {t('board.sortCards')}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton color="inherit" aria-label={t('board.boardMenu')}>
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Menu anchorEl={sortMenuAnchor} open={Boolean(sortMenuAnchor)} onClose={closeSortMenu}>
        {SORT_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={sortMode === option.value}
            onClick={() => handleSortSelect(option.value)}
          >
            <ListItemIcon>
              {sortMode === option.value && <Check fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{t(option.labelKey)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Two spacers: one per fixed bar */}
      <Toolbar />
      <Toolbar />

      {/* Scrollable lists container */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sortedLists.map(l => l.id)} strategy={horizontalListSortingStrategy}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              gap: 2,
              overflowX: 'auto',
              overflowY: 'hidden',
              height: { xs: 'calc(100vh - 112px)', sm: 'calc(100vh - 128px)' },
              px: 2,
              py: 2,
              alignItems: 'flex-start',
            }}
          >
            {sortedLists.map(list => (
              <BoardListColumn
                key={list.id}
                list={list}
                cards={cardsByList[list.id] ?? []}
                customOrderIds={orderByList[list.id] ?? []}
                numberLocale={numberLocale}
                dateFormat={dateFormat}
                sortMode={sortMode}
                onRenamed={handleListRenamed}
                onArchived={handleListArchived}
                onCardCreated={handleCardCreated}
                onCardArchived={handleCardArchived}
                onCardUpdated={handleCardUpdated}
              />
            ))}
          </Box>
        </SortableContext>

        <DragOverlay>
          {activeCard ? (
            <CardItem
              card={activeCard}
              boardId={boardId ?? ''}
              listId={activeCard.list_id}
              numberLocale={numberLocale}
              dateFormat={dateFormat}
              onArchived={() => {}}
              onUpdated={() => {}}
              dragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CreateListDialog
        open={createListOpen}
        onClose={() => setCreateListOpen(false)}
        boardId={boardId ?? ''}
        onCreated={handleListCreated}
      />

      <ManageLabelsDialog
        open={manageLabelsOpen}
        onClose={() => setManageLabelsOpen(false)}
        boardId={boardId ?? ''}
      />
    </>
  )
}
