import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { Add, Archive, Block, Check, Email, Label, Menu as MenuIcon, Sort as SortIcon } from '@mui/icons-material'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useTranslation } from 'react-i18next'
import MainAppBar from '../components/MainAppBar'
import CreateListDialog from '../components/CreateListDialog'
import ManageLabelsDialog from '../components/ManageLabelsDialog'
import EmailNotificationDialog from '../components/EmailNotificationDialog'
import BoardListColumn from '../components/BoardListColumn'
import CardItem from '../components/CardItem'
import ArchivedListsView from '../components/ArchivedListsView'
import { DEFAULT_COLOR } from '../components/ChangeBoardColorDialog'
import { LIGHT_TINT_WEIGHT, tintColor } from '../utils/colorTint'
import type { BoardListRead, BoardListOrderRead, BoardRead, CardOrderRead, CardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import type { SortMode } from '../utils/cardSort'
import { SORT_OPTIONS, sortCards } from '../utils/cardSort'
import { apiFetch } from '../api/client'
import { isOwnNotification, subscribeToNotifications } from '../api/ws'

const LIST_EVENT_TYPES = new Set(['list_created', 'list_reordered', 'list_renamed', 'list_archived'])
const CARD_EVENT_TYPES = new Set([
  'card_created',
  'card_updated',
  'card_moved',
  'card_order_changed',
  'card_archived',
])

// Lists and cards share one DndContext (a card needs to move between list
// columns), so plain closestCenter compares a dragged list against every
// card's rect too — near a column edge a card can read as "closer" than the
// list column itself, so the reorder misfires or silently no-ops. When
// dragging a list, only ever compare it against other lists.
const listAwareCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type !== 'list') return closestCenter(args)
  const listContainers = args.droppableContainers.filter(
    (container) => container.data.current?.type === 'list',
  )
  return closestCenter({ ...args, droppableContainers: listContainers })
}

export default function Board() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { boardId } = useParams<{ boardId: string }>()
  const [board, setBoard] = useState<BoardRead | null>(null)
  const [boardColor, setBoardColor] = useState<string | null>(null)
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [createListOpen, setCreateListOpen] = useState(false)
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<HTMLElement | null>(null)
  const [boardMenuAnchor, setBoardMenuAnchor] = useState<HTMLElement | null>(null)
  const [emailNotificationOpen, setEmailNotificationOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem(`kanbanmf:sort:${boardId}`) as SortMode | null) ?? 'custom',
  )
  const [cardsByList, setCardsByList] = useState<Record<string, CardRead[]>>({})
  const [orderByList, setOrderByList] = useState<Record<string, string[]>>({})
  const [activeCard, setActiveCard] = useState<CardRead | null>(null)
  const [activeList, setActiveList] = useState<BoardListRead | null>(null)
  // The list a card drag started from — cardsByList gets live-reparented as
  // the card is dragged over other lists (see handleDragOver), so by drop
  // time cardsByList alone can no longer tell us where it came from.
  const dragSourceListIdRef = useRef<string | null>(null)
  // 403 (not owner/shared) and 404 (doesn't exist) are shown identically —
  // this also avoids leaking whether a given board id exists at all.
  const [accessDenied, setAccessDenied] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

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
      .then(r => {
        if (r.status === 403 || r.status === 404) {
          setAccessDenied(true)
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => { if (data) setBoard(data) })
      .catch(() => {})
  }, [boardId])

  useEffect(() => {
    if (!boardId) return
    apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/color`)
      .then(r => r.ok ? r.json() as Promise<{ color: string | null }> : null)
      .then(data => setBoardColor(data?.color ?? null))
      .catch(() => {})
  }, [boardId])

  // Needed to tell whether *this* viewer is the board owner — permanently
  // deleting a list or card in the archive view is an owner-only action.
  useEffect(() => {
    apiFetch('http://localhost:8000/api/v1/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCurrentUserId(data.id) })
      .catch(() => {})
  }, [])

  const isOwner = board?.owner_id === currentUserId

  const fetchLists = useCallback(() => {
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

  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  // List changes made elsewhere (owner's other session, or a shared member)
  // arrive as bare notifications scoped to this board; a notification we
  // triggered ourselves is skipped since our own local state already reflects it.
  useEffect(() => {
    if (!boardId) return
    return subscribeToNotifications((notification) => {
      if (notification.board_id !== boardId) return
      if (!LIST_EVENT_TYPES.has(notification.type)) return
      if (isOwnNotification(notification)) return
      fetchLists()
    })
  }, [boardId, fetchLists])

  // Cards live here (not in BoardListColumn) so a card can be dragged from
  // one list's array into another's.
  const fetchCardsForList = useCallback((listId: string) => {
    if (!boardId) return
    Promise.all([
      apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards`)
        .then(r => r.ok ? r.json() as Promise<CardRead[]> : []),
      apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${listId}/cards/order`)
        .then(r => r.ok ? r.json() as Promise<CardOrderRead> : { list_id: listId, card_ids: [] }),
    ])
      .then(([cards, order]) => {
        setCardsByList(prev => ({ ...prev, [listId]: cards }))
        setOrderByList(prev => ({ ...prev, [listId]: order.card_ids }))
      })
      .catch(() => {})
  }, [boardId])

  // Fetch only for lists we haven't loaded yet.
  useEffect(() => {
    if (!boardId) return
    lists.filter(l => !(l.id in cardsByList)).forEach(l => fetchCardsForList(l.id))
  }, [boardId, lists, cardsByList, fetchCardsForList])

  // Card changes made elsewhere (owner's other session, or a shared member)
  // arrive as bare notifications naming which list's cards to refetch; a
  // notification we triggered ourselves is skipped since our own local state
  // already reflects it. card_moved is sent once per affected list (source
  // and destination), so a single fetchCardsForList call per message suffices.
  useEffect(() => {
    if (!boardId) return
    return subscribeToNotifications((notification) => {
      if (notification.board_id !== boardId) return
      if (!CARD_EVENT_TYPES.has(notification.type)) return
      if (isOwnNotification(notification)) return
      if (notification.list_id) fetchCardsForList(notification.list_id)
    })
  }, [boardId, fetchCardsForList])

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

  function openBoardMenu(e: React.MouseEvent<HTMLElement>) {
    setBoardMenuAnchor(e.currentTarget)
  }

  function closeBoardMenu() {
    setBoardMenuAnchor(null)
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

  // Returns the in-flight request so callers can sequence a following order
  // update after it — the backend rejects a list's card_ids PUT if it names
  // a card that (as far as it's concerned) still belongs to another list.
  function persistCardMove(sourceListId: string, cardId: string, destListId: string) {
    return apiFetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/${sourceListId}/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: destListId }),
    }).catch(() => {})
  }

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    if (active.data.current?.type === 'card') {
      const sourceListId = active.data.current.listId as string
      dragSourceListIdRef.current = sourceListId
      const card = (cardsByList[sourceListId] ?? []).find(c => c.id === active.id)
      if (card) setActiveCard(card)
      return
    }
    if (active.data.current?.type === 'list') {
      const list = sortedLists.find(l => l.id === active.id)
      if (list) setActiveList(list)
    }
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

  function findCardListId(cardId: string): string | undefined {
    return Object.keys(cardsByList).find(id => (cardsByList[id] ?? []).some(c => c.id === cardId))
  }

  // Cards live in per-list SortableContexts, so a card being dragged only
  // gets a drop-slot placeholder rendered inside whichever list's array it's
  // currently a member of. Hovering it over a *different* list therefore has
  // to actually move it into that list's cardsByList entry right away —
  // otherwise there's nothing there for dnd-kit to render a placeholder for,
  // and the destination list shows no indication of the drop at all. Only
  // cross-list moves are handled here; reordering within a single list is
  // already animated by that list's own SortableContext.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over || active.data.current?.type !== 'card') return

    const cardId = active.id as string
    const currentListId = findCardListId(cardId)
    if (!currentListId) return

    const destListId = resolveDestinationListId(over)
    if (!destListId || destListId === currentListId) return

    setCardsByList(prev => {
      const sourceCards = prev[currentListId] ?? []
      const movingCard = sourceCards.find(c => c.id === cardId)
      if (!movingCard) return prev

      const destCards = prev[destListId] ?? []
      const overIsCard = over.data.current?.type === 'card'
      let insertIndex = overIsCard ? destCards.findIndex(c => c.id === over.id) : destCards.length
      if (insertIndex === -1) insertIndex = destCards.length

      const movedCard: CardRead = { ...movingCard, list_id: destListId }
      const newDestCards = [...destCards.slice(0, insertIndex), movedCard, ...destCards.slice(insertIndex)]
      const newSourceCards = sourceCards.filter(c => c.id !== cardId)

      return { ...prev, [currentListId]: newSourceCards, [destListId]: newDestCards }
    })
  }

  function handleCardDragEnd(
    active: DragEndEvent['active'],
    over: NonNullable<DragEndEvent['over']>,
    originalListId: string,
  ) {
    const cardId = active.id as string

    // handleDragOver may already have re-parented the card into a different
    // list's array while it was being dragged — find wherever it currently
    // lives to compute its final position.
    const currentListId = findCardListId(cardId)
    if (!currentListId) return

    const overIsCard = over.data.current?.type === 'card'
    const currentCards = cardsByList[currentListId] ?? []
    const displayed = sortCards(currentCards, sortMode, orderByList[currentListId] ?? [])
    const oldIndex = displayed.findIndex(c => c.id === cardId)
    if (oldIndex === -1) return
    let newIndex = overIsCard ? displayed.findIndex(c => c.id === over.id) : displayed.length - 1
    if (newIndex === -1) newIndex = displayed.length - 1

    const reordered = oldIndex === newIndex ? displayed : arrayMove(displayed, oldIndex, newIndex)
    if (oldIndex !== newIndex) {
      setCardsByList(prev => ({ ...prev, [currentListId]: reordered }))
    }

    const movedAcrossLists = currentListId !== originalListId
    const moveDone = movedAcrossLists
      ? persistCardMove(originalListId, cardId, currentListId)
      : Promise.resolve()

    // Reordering only matters — and is only persisted — when the board is
    // displaying the custom order.
    if (sortMode === 'custom') {
      const newOrderIds = reordered.map(c => c.id)
      setOrderByList(prev => ({ ...prev, [currentListId]: newOrderIds }))
      const sourceOrderIds = movedAcrossLists ? (cardsByList[originalListId] ?? []).map(c => c.id) : null
      if (sourceOrderIds) {
        setOrderByList(prev => ({ ...prev, [originalListId]: sourceOrderIds }))
      }

      // The order PUT for the destination list names this card, which the
      // backend rejects until the move PATCH above has actually committed
      // — wait for it instead of firing both requests in parallel.
      moveDone.then(() => {
        persistCardOrder(currentListId, newOrderIds)
        if (sourceOrderIds) persistCardOrder(originalListId, sourceOrderIds)
      })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    setActiveList(null)

    const activeType = active.data.current?.type
    if (activeType === 'card') {
      const cardId = active.id as string
      const originalListId = dragSourceListIdRef.current
      dragSourceListIdRef.current = null
      if (!originalListId) return
      if (!over) {
        // Dropped outside any droppable — undo whatever optimistic
        // re-parenting handleDragOver did by resyncing from the server.
        fetchCardsForList(originalListId)
        const currentListId = findCardListId(cardId)
        if (currentListId && currentListId !== originalListId) fetchCardsForList(currentListId)
        return
      }
      handleCardDragEnd(active, over, originalListId)
      return
    }

    if (!over || active.id === over.id) return
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
    })
      .then(r => { if (!r.ok) fetchLists() }) // rejected (e.g. stale ownership) — resync from the server
      .catch(() => fetchLists())
  }

  if (accessDenied) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={(num, fmt) => {
            setNumberLocale(num)
            setDateFormat(fmt)
          }}
        />
        <Toolbar />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' },
            textAlign: 'center',
            px: 2,
          }}
        >
          <Block sx={{ fontSize: 64, color: 'text.disabled' }} />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t('board.forbiddenTitle')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('board.forbiddenMessage')}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/boards')}>
            {t('board.backToBoards')}
          </Button>
        </Box>
      </>
    )
  }

  if (board?.is_archived) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={(num, fmt) => {
            setNumberLocale(num)
            setDateFormat(fmt)
          }}
        />
        <Toolbar />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' },
            textAlign: 'center',
            px: 2,
          }}
        >
          <Archive sx={{ fontSize: 64, color: 'text.disabled' }} />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t('board.archivedTitle')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {t('board.archivedMessage')}
          </Typography>
          <Button variant="contained" onClick={() => navigate('/boards')}>
            {t('board.backToBoards')}
          </Button>
        </Box>
      </>
    )
  }

  if (showArchive) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={(num, fmt) => {
            setNumberLocale(num)
            setDateFormat(fmt)
          }}
        />
        <ArchivedListsView
          boardId={boardId ?? ''}
          boardName={board?.name ?? ''}
          activeLists={lists}
          numberLocale={numberLocale}
          dateFormat={dateFormat}
          isOwner={isOwner}
          onReturn={() => {
            // Restoring/deleting in the archive view can change what the
            // board looks like (a restored list needs to reappear, a
            // deleted card's stale cache needs to go) — force a full
            // refetch instead of showing whatever was cached before.
            setShowArchive(false)
            fetchLists()
            setCardsByList({})
            setOrderByList({})
          }}
        />
      </>
    )
  }

  return (
    <>
      <MainAppBar
        onLocaleChanged={(num, fmt) => {
          setNumberLocale(num)
          setDateFormat(fmt)
        }}
      />

      {/* Secondary board toolbar — sits below the main AppBar. Tinted with
          the viewer's chosen board color, falling back to the app default
          when they haven't picked one. */}
      <AppBar
        position="fixed"
        color="default"
        elevation={1}
        sx={{
          top: { xs: '56px', sm: '64px' },
          bgcolor: `${boardColor ?? DEFAULT_COLOR}26`,
          borderBottom: `1px solid ${boardColor ?? DEFAULT_COLOR}`,
        }}
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
          <Button
            variant="outlined"
            color="error"
            startIcon={<Archive />}
            size="small"
            sx={{ ml: 1 }}
            onClick={() => setShowArchive(true)}
          >
            {t('board.archive')}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton color="inherit" aria-label={t('board.boardMenu')} onClick={openBoardMenu}>
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

      <Menu anchorEl={boardMenuAnchor} open={Boolean(boardMenuAnchor)} onClose={closeBoardMenu}>
        <MenuItem onClick={() => { closeBoardMenu(); setEmailNotificationOpen(true) }}>
          <ListItemIcon><Email fontSize="small" /></ListItemIcon>
          <ListItemText>{t('boards.emailNotification')}</ListItemText>
        </MenuItem>
      </Menu>

      <EmailNotificationDialog
        open={emailNotificationOpen}
        onClose={() => setEmailNotificationOpen(false)}
        board={board}
      />

      {/* Two spacers: one per fixed bar */}
      <Toolbar />
      <Toolbar />

      {/* Scrollable lists container */}
      <DndContext
        sensors={sensors}
        collisionDetection={listAwareCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
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
              // Opaque so lists sitting on top of it (each with their own
              // opaque tint) never blend with the page's own color — see
              // utils/colorTint.
              bgcolor: (theme) => tintColor(boardColor ?? DEFAULT_COLOR, theme.palette.background.default, LIGHT_TINT_WEIGHT),
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
          ) : activeList ? (
            <BoardListColumn
              list={activeList}
              cards={cardsByList[activeList.id] ?? []}
              customOrderIds={orderByList[activeList.id] ?? []}
              numberLocale={numberLocale}
              dateFormat={dateFormat}
              sortMode={sortMode}
              onRenamed={() => {}}
              onArchived={() => {}}
              onCardCreated={() => {}}
              onCardArchived={() => {}}
              onCardUpdated={() => {}}
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
