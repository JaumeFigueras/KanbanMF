import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import { Add, Archive, Block, Check, Email, Label, Menu as MenuIcon, Sort as SortIcon } from '@mui/icons-material'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DroppableContainer,
  DroppableContainers,
  KeyboardCoordinateGetter,
  UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { useTranslation } from 'react-i18next'
import MainAppBar from '../components/MainAppBar'
import CreateListDialog from '../components/CreateListDialog'
import ManageLabelsDialog from '../components/ManageLabelsDialog'
import EmailNotificationDialog from '../components/EmailNotificationDialog'
import BoardListColumn from '../components/BoardListColumn'
import CardItem from '../components/CardItem'
import CardDialog from '../components/CardDialog'
import ArchivedListsView from '../components/ArchivedListsView'
import FailureMessage from '../components/FailureMessage'
import LoadFailure from '../components/LoadFailure'
import { DEFAULT_COLOR } from '../components/ChangeBoardColorDialog'
import { LIGHT_TINT_WEIGHT, tintColor } from '../utils/colorTint'
import type { BoardColorsRead, BoardListRead, BoardListOrderRead, BoardRead, CardOrderRead, CardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import type { SortMode } from '../utils/cardSort'
import { SORT_OPTIONS, applyUndatedOrder, clampDueDateDropIndex, isSortMode, isUndated, sortCards } from '../utils/cardSort'
import { readStored, writeStored } from '../utils/storage'
import { latestOnly } from '../utils/latest'
import { dragAccessibility } from '../utils/dragAccessibility'
import { HttpError, apiFetch, loadJson } from '../api/client'
import { isOwnNotification, subscribeToNotifications, subscribeToReconnects } from '../api/ws'

const BOARD_ACCESS_EVENT_TYPES = new Set(['board_archived', 'board_unshared', 'board_deleted'])
const LIST_EVENT_TYPES = new Set([
  'list_created',
  'list_reordered',
  'list_renamed',
  'list_archived',
  'list_unarchived',
  'list_deleted',
])
const CARD_EVENT_TYPES = new Set([
  'card_created',
  'card_updated',
  'card_moved',
  'card_order_changed',
  'card_archived',
  'card_unarchived',
  'card_deleted',
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

// For the same reason, dnd-kit's own arrow-key moves would take a list onto
// its own cards, a card past the next one into its list's drop area, or down
// onto a lower card of the list next door. Here a list only moves left or
// right, among the lists; a card up or down within its list, or left or
// right to a card of another list, or into a list with no cards.
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, droppableContainers } = args.context
  const type = active?.data.current?.type
  const listId = active?.data.current?.listId
  const sideways = event.code === 'ArrowLeft' || event.code === 'ArrowRight'
  const enabled = droppableContainers.getEnabled()
  const listsWithCards = new Set(enabled
    .filter(c => c.data.current?.type === 'card' && c.id !== active?.id)
    .map(c => c.data.current?.listId))
  const targets = enabled.filter(c => {
    // dnd-kit measures the move from the item's own place.
    if (c.id === active?.id) return true
    if (type === 'list') return sideways && c.data.current?.type === 'list'
    if (c.data.current?.type === 'card') return sideways === (c.data.current.listId !== listId)
    const emptyListId = String(c.id).startsWith('list-dropzone:') ? String(c.id).slice('list-dropzone:'.length) : null
    return sideways && emptyListId !== null && emptyListId !== listId && !listsWithCards.has(emptyListId)
  })
  // dnd-kit's own map type, which it doesn't export.
  const Targets = droppableContainers.constructor as new (entries: [UniqueIdentifier, DroppableContainer][]) => DroppableContainers
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers: new Targets(targets.map(c => [c.id, c])) },
  })
}

// A set without one id, or the same set when it hasn't got it (so nothing
// renders again for nothing).
function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export default function Board() {
  const { t } = useTranslation()
  const { boardId } = useParams<{ boardId: string }>()
  // ?card=<id> deep link (the overdue-tasks page links here) — opens that
  // card's edit dialog once its list has loaded, exactly as clicking the
  // card on the board does. Dropped from the URL when the dialog closes, so
  // closing and reopening the board doesn't reopen the card.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkedCardId = searchParams.get('card')
  const [board, setBoard] = useState<BoardRead | null>(null)
  // Every color the current user has personally set anywhere on this board
  // (board/lists/cards), fetched once alongside the lists themselves so
  // everything renders with its final color from the first paint — see
  // fetchLists below.
  const [colors, setColors] = useState<BoardColorsRead>({ board: null, lists: {}, cards: {} })
  const boardColor = colors.board
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [createListOpen, setCreateListOpen] = useState(false)
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false)
  // Whether a label was changed in the Labels dialog since it opened: the
  // cards show their labels, so they're fetched again when it closes.
  const labelsChangedRef = useRef(false)
  // ?archive=1 — where a search of the board's archive leads back to — opens
  // the archive view straight away; &highlight=<card id> marks the card the
  // search result was. Both are read once and dropped from the address (see
  // the effect below), so they don't stick to reloads.
  const [showArchive, setShowArchive] = useState(() => searchParams.get('archive') === '1')
  const [highlightCardId] = useState(() => searchParams.get('highlight'))
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')
  const [sortMenuAnchor, setSortMenuAnchor] = useState<HTMLElement | null>(null)
  const [boardMenuAnchor, setBoardMenuAnchor] = useState<HTMLElement | null>(null)
  const [emailNotificationOpen, setEmailNotificationOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = readStored('local', `kanbanmf:sort:${boardId}`)
    return isSortMode(stored) ? stored : 'custom'
  })
  const [cardsByList, setCardsByList] = useState<Record<string, CardRead[]>>({})
  const [orderByList, setOrderByList] = useState<Record<string, string[]>>({})
  const [activeCard, setActiveCard] = useState<CardRead | null>(null)
  const [activeList, setActiveList] = useState<BoardListRead | null>(null)
  // The list a card drag started from — cardsByList gets live-reparented as
  // the card is dragged over other lists (see handleDragOver), so by drop
  // time cardsByList alone can no longer tell us where it came from.
  const dragSourceListIdRef = useRef<string | null>(null)
  // Every list's cards and their order as they were when that drag started,
  // to put back if the move can't be saved.
  const dragStartRef = useRef<{ cards: Record<string, CardRead[]>; order: Record<string, string[]> } | null>(null)
  // While a card is moved, and until its drop is saved or undone, no list's
  // cards are fetched: an answer would put a list back as the server has it,
  // without the card the move put in it (which then showed nowhere, and was
  // never saved) or with the card it took out (which then showed twice).
  // `count` is the moves under way (one can start while the last one's drop
  // is still being saved), `lists` the lists asked for meanwhile, fetched
  // once the last move is over.
  const cardFetchHoldRef = useRef({ count: 0, lists: new Set<string>() })
  // A change made on the page itself (a menu entry, a drag) that couldn't
  // be saved, said at the foot of the page.
  const [failure, setFailure] = useState<string | null>(null)
  // 403 (not owner/shared) and 404 (doesn't exist) are shown identically —
  // this also avoids leaking whether a given board id exists at all.
  const [accessDenied, setAccessDenied] = useState(false)
  // The board, or its lists, couldn't be loaded (a server error, a dropped
  // connection): the page says so instead of showing an empty board.
  const [boardFailed, setBoardFailed] = useState(false)
  const [listsFailed, setListsFailed] = useState(false)
  // The lists whose cards couldn't be loaded. Each says so in its column,
  // rather than look empty, until it's tried again.
  const [cardsFailed, setCardsFailed] = useState<ReadonlySet<string>>(() => new Set())
  // Who this viewer is, to tell whether they own the board. Its failure
  // fails the page too, as the archive view would otherwise hide the owner's
  // Delete without a word.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [meFailed, setMeFailed] = useState(false)
  // The lists, each list's cards and the colours are fetched again on every
  // notification, and only the latest answer of each counts: an older one
  // arriving last would put back what the newer one replaced.
  const [track] = useState(latestOnly)

  useEffect(() => {
    if (!boardId) return
    writeStored('local', `kanbanmf:sort:${boardId}`, sortMode)
  }, [boardId, sortMode])

  useEffect(() => {
    if (!searchParams.has('archive') && !searchParams.has('highlight')) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('archive')
      next.delete('highlight')
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  )

  // Resolves to whether the board opened: not when it's refused (the
  // Forbidden page) or couldn't be loaded.
  const fetchBoard = useCallback((): Promise<boolean> => {
    if (!boardId) return Promise.resolve(false)
    return apiFetch(`/api/v1/boards/${boardId}`)
      .then(r => {
        if (r.status === 403 || r.status === 404) {
          setAccessDenied(true)
          return null
        }
        if (!r.ok) throw new Error(`board answered ${r.status}`)
        return r.json() as Promise<BoardRead>
      })
      .then(data => {
        if (!data) return false
        setBoard(data)
        setBoardFailed(false)
        return true
      })
      .catch(() => {
        setBoardFailed(true)
        return false
      })
  }, [boardId])

  useEffect(() => { fetchBoard() }, [fetchBoard])

  // Archiving a board takes it away from the people it's shared with (only
  // the owner can open an archived board), as does unsharing or deleting
  // it: fetch it again, which shows the "no access" page to anyone who has
  // lost it, and refreshes the owner's copy.
  useEffect(() => {
    if (!boardId) return
    return subscribeToNotifications((notification) => {
      if (notification.board_id !== boardId) return
      if (!BOARD_ACCESS_EVENT_TYPES.has(notification.type)) return
      fetchBoard()
    })
  }, [boardId, fetchBoard])

  // Needed to tell whether *this* viewer is the board owner — permanently
  // deleting a list or card in the archive view is an owner-only action.
  const fetchMe = useCallback(() => {
    loadJson<{ id: string }>('/api/v1/users/me')
      .then(data => {
        setCurrentUserId(data.id)
        setMeFailed(false)
      })
      .catch(() => setMeFailed(true))
  }, [])

  useEffect(() => { fetchMe() }, [fetchMe])

  const isOwner = board?.owner_id === currentUserId

  // A template holds lists only — the API refuses cards, labels and
  // notification settings on it — so their controls are hidden here.
  const isTemplate = board?.is_template ?? false

  const fetchLists = useCallback(() => {
    if (!boardId) return
    track('lists', Promise.all([
      loadJson<BoardListRead[]>(`/api/v1/boards/${boardId}/lists`),
      loadJson<BoardListOrderRead>(`/api/v1/boards/${boardId}/lists/order`),
      // Fetched alongside the lists themselves (not on-demand per list/card)
      // so every list/card column can render with its final color on first
      // paint — no default-color flash while N per-entity requests resolve.
      loadJson<BoardColorsRead>(`/api/v1/boards/${boardId}/colors`),
    ]))
      .then(([fetchedLists, fetchedOrder, fetchedColors]) => {
        setLists(fetchedLists)
        setOrder(fetchedOrder.list_ids)
        setColors(fetchedColors)
        setListsFailed(false)
      })
      .catch((error) => {
        // A refusal most likely means the board was taken away (unshared,
        // archived, deleted). The board's own answer decides: the Forbidden
        // page, or, if it still opens, the lists' failure. Saying so before
        // that would flash "couldn't be loaded" on the way to Forbidden.
        if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
          fetchBoard().then(opened => { if (opened) setListsFailed(true) })
        } else {
          setListsFailed(true)
        }
      })
  }, [boardId, fetchBoard, track])

  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  // Just the colors, for a card created elsewhere (another tab, or Claude
  // through the MCP server): the backend gave it the list's color, which
  // the `colors` map fetched at load doesn't know about yet.
  const fetchColors = useCallback(() => {
    track('colors', apiFetch(`/api/v1/boards/${boardId}/colors`))
      .then(r => r.ok ? r.json() as Promise<BoardColorsRead> : null)
      .then(fetchedColors => { if (fetchedColors) setColors(fetchedColors) })
      .catch(() => {})
  }, [boardId, track])

  // The lists whose cards are on their way, so the effect below that loads
  // the lists not shown yet doesn't ask for them again: it runs each time
  // another list's cards arrive.
  const cardsPendingRef = useRef(new Set<string>())

  // Cards live here (not in BoardListColumn) so a card can be dragged from
  // one list's array into another's.
  const fetchCardsForList = useCallback((listId: string) => {
    const hold = cardFetchHoldRef.current
    // Asked for, or answered, while a card is moved: fetched once it's over.
    const heldBack = () => {
      if (hold.count === 0) return false
      hold.lists.add(listId)
      return true
    }
    if (heldBack()) return
    cardsPendingRef.current.add(listId)
    track(`cards:${listId}`, Promise.all([
      loadJson<CardRead[]>(`/api/v1/boards/${boardId}/lists/${listId}/cards`),
      loadJson<CardOrderRead>(`/api/v1/boards/${boardId}/lists/${listId}/cards/order`),
    ]))
      .then(([cards, order]) => {
        cardsPendingRef.current.delete(listId)
        if (heldBack()) return
        setCardsByList(prev => ({ ...prev, [listId]: cards }))
        setOrderByList(prev => ({ ...prev, [listId]: order.card_ids }))
        setCardsFailed(prev => withoutId(prev, listId))
      })
      .catch(() => {
        cardsPendingRef.current.delete(listId)
        if (heldBack()) return
        // Whatever the list showed may be out of date now, so it goes: the
        // column says its cards couldn't be loaded instead, and takes no
        // dropped card, whose order would leave out the cards not shown.
        setCardsByList(prev => omitKey(prev, listId))
        setOrderByList(prev => omitKey(prev, listId))
        setCardsFailed(prev => new Set(prev).add(listId))
      })
  }, [boardId, track])

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
      // A restored list may still have the cards it had when it was
      // archived cached here; list_unarchived names it so they're refetched.
      if (notification.list_id) fetchCardsForList(notification.list_id)
    })
  }, [boardId, fetchLists, fetchCardsForList])

  // Fetch only for lists we haven't loaded yet, leaving out those whose
  // cards are on their way, and those whose cards couldn't be loaded: they
  // wait for Try again, which takes them off cardsFailed, and so brings them
  // back here.
  useEffect(() => {
    if (!boardId) return
    lists
      .filter(l => !(l.id in cardsByList) && !cardsFailed.has(l.id) && !cardsPendingRef.current.has(l.id))
      .forEach(l => fetchCardsForList(l.id))
  }, [boardId, lists, cardsByList, cardsFailed, fetchCardsForList])

  // Dropping the list's cards too (a card added meanwhile) makes the effect
  // above load them.
  function retryCards(listId: string) {
    setCardsByList(prev => omitKey(prev, listId))
    setOrderByList(prev => omitKey(prev, listId))
    setCardsFailed(prev => withoutId(prev, listId))
  }

  // The whole board again, and every list's cards that couldn't be loaded:
  // when the board failed, they most likely did too.
  function retryLoad() {
    setBoardFailed(false)
    setListsFailed(false)
    cardsFailed.forEach(retryCards)
    fetchBoard()
    fetchLists()
    if (meFailed) {
      setMeFailed(false)
      fetchMe()
    }
  }

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
      if (notification.type === 'card_created') fetchColors()
    })
  }, [boardId, fetchCardsForList, fetchColors])

  // Every card shows its labels, so a label changed elsewhere (by the board's
  // owner, in another tab or session) means fetching all the cards again.
  useEffect(() => {
    if (!boardId) return
    return subscribeToNotifications((notification) => {
      if (notification.board_id !== boardId || notification.type !== 'labels_changed') return
      if (isOwnNotification(notification)) return
      lists.forEach(l => fetchCardsForList(l.id))
    })
  }, [boardId, lists, fetchCardsForList])

  // Back after the connection dropped: whatever changed meanwhile sent
  // notifications that never arrived, so the whole board is fetched again.
  useEffect(() => subscribeToReconnects(() => {
    fetchBoard()
    fetchLists()
    lists.forEach(l => fetchCardsForList(l.id))
  }), [fetchBoard, fetchLists, lists, fetchCardsForList])

  function closeManageLabels() {
    setManageLabelsOpen(false)
    if (labelsChangedRef.current) {
      labelsChangedRef.current = false
      lists.forEach(l => fetchCardsForList(l.id))
    }
  }

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
    // The backend's create_list gives a new list the board's own color
    // (the viewer's per-user choice) when it has one — mirror that here so the bulk
    // `colors` map (fetched once at board load) knows about it too, or the
    // new list would render with the default color until the next reload.
    if (boardColor) {
      setColors(prev => ({ ...prev, lists: { ...prev.lists, [list.id]: boardColor } }))
    }
  }

  // The top bar hands over the viewer's number locale and date format once
  // their profile loads, on whichever page it's on.
  function handleLocaleChanged(num: string, fmt: DateFormat) {
    setNumberLocale(num)
    setDateFormat(fmt)
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

  function handleCardCreated(listId: string, card: CardRead, color: string | null) {
    // The color (inherited list color for a plain create, or the source
    // card's own color for a copy — see CardDialog/CopyCardDialog) is
    // already resolved by the caller before this fires, so it lands in the
    // same render as the card itself: no default-color flash while a
    // follow-up fetch resolves.
    setCardsByList(prev => ({ ...prev, [listId]: [...(prev[listId] ?? []), card] }))
    if (color) {
      setColors(prev => ({ ...prev, cards: { ...prev.cards, [card.id]: color } }))
    }
  }

  // A list's or card's color saved (or reset) from its menu. The map is what
  // every drawing of it reads — the list or card on the board, the floating
  // copy while it's dragged, and a card drawn afresh in the list it's
  // dropped in — so updating it here repaints them all.
  function handleColorChanged(kind: 'lists' | 'cards', id: string, color: string | null) {
    setColors(prev => {
      const next = { ...prev[kind] }
      if (color) next[id] = color
      else delete next[id]
      return { ...prev, [kind]: next }
    })
  }

  function handleCardArchived(listId: string, cardId: string) {
    setCardsByList(prev => ({
      ...prev,
      [listId]: (prev[listId] ?? []).filter(c => c.id !== cardId),
    }))
  }

  // An archive that was refused may mean the card or list was changed
  // elsewhere meanwhile (moved, archived, deleted), so what it touched is
  // fetched again: with the connection back, the board shows what's saved.
  function handleCardArchiveFailed(listId: string, card: CardRead) {
    setFailure(t('board.archiveCardFailed', { name: card.name }))
    fetchCardsForList(listId)
  }

  function handleArchiveAllCardsFailed(list: BoardListRead, count: number) {
    setFailure(t('board.archiveAllCardsFailed', { count, name: list.name }))
    fetchCardsForList(list.id)
  }

  function handleListArchiveFailed(list: BoardListRead) {
    setFailure(t('board.archiveListFailed', { name: list.name }))
    fetchLists()
  }

  // A checklist copied onto another card changes that card's face (it
  // lists its checklists), and checklist writes send no WebSocket
  // notification — so refetch the target list here when it's on this board.
  function handleChecklistCopied(targetBoardId: string, targetListId: string) {
    if (targetBoardId === boardId) fetchCardsForList(targetListId)
  }

  function handleCardUpdated(listId: string, card: CardRead) {
    setCardsByList(prev => ({
      ...prev,
      [listId]: (prev[listId] ?? []).map(c => c.id === card.id ? card : c),
    }))
  }

  // The ?card=<id> deep link resolves against the cards already fetched, so
  // the dialog opens as soon as that card's list arrives — no extra request,
  // and nothing happens if the card is archived, deleted or on another board.
  const deepLinkedCard = useMemo(() => {
    if (!deepLinkedCardId) return null
    for (const cards of Object.values(cardsByList)) {
      const found = cards.find(c => c.id === deepLinkedCardId)
      if (found) return found
    }
    return null
  }, [deepLinkedCardId, cardsByList])

  function closeDeepLinkedCard() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('card')
      return next
    }, { replace: true })
  }

  // Both resolve to whether the change was saved: false when it was refused
  // or the connection dropped.
  function persistCardOrder(listId: string, cardIds: string[]): Promise<boolean> {
    return apiFetch(`/api/v1/boards/${boardId}/lists/${listId}/cards/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_ids: cardIds }),
    }).then(r => r.ok, () => false)
  }

  // Callers sequence a following order update after it — the backend rejects
  // a list's card_ids PUT if it names a card that (as far as it's concerned)
  // still belongs to another list.
  function persistCardMove(sourceListId: string, cardId: string, destListId: string): Promise<boolean> {
    return apiFetch(`/api/v1/boards/${boardId}/lists/${sourceListId}/cards/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: destListId }),
    }).then(r => r.ok, () => false)
  }

  // Ends a card move's hold on fetching cards (see cardFetchHoldRef), and
  // fetches the lists asked for meanwhile, and those given: held again if
  // another move is still under way.
  function releaseCardFetches(listIds: string[] = []) {
    const hold = cardFetchHoldRef.current
    hold.count -= 1
    const lists = new Set([...hold.lists, ...listIds])
    hold.lists.clear()
    lists.forEach(id => fetchCardsForList(id))
  }

  // Puts the given lists' cards and order back as they were when the drag
  // started (a list that wasn't loaded then is dropped, so it's loaded
  // afresh), ends the move's hold and fetches them again: without a
  // connection, the board shows what it showed before the drag, and with
  // one, what's saved.
  function undoCardDrag(before: NonNullable<typeof dragStartRef.current>, listIds: string[]) {
    const restore = <T,>(prev: Record<string, T>, saved: Record<string, T>) => {
      const next = { ...prev }
      for (const id of listIds) {
        if (id in saved) next[id] = saved[id]
        else delete next[id]
      }
      return next
    }
    setCardsByList(prev => restore(prev, before.cards))
    setOrderByList(prev => restore(prev, before.order))
    releaseCardFetches(listIds)
  }

  // What a card is over names the list it would land in, and the card
  // there if there is one; what a list is over, the list there.
  const listName = (id: UniqueIdentifier | undefined) => lists.find(l => l.id === id)?.name ?? ''
  const cardName = (id: UniqueIdentifier) => Object.values(cardsByList).flat().find(c => c.id === id)?.name ?? ''
  const boardDragAccessibility = dragAccessibility(
    t,
    id => lists.some(l => l.id === id) ? t('drag.list', { name: listName(id) }) : cardName(id),
    (over, active) => {
      if (active.data.current?.type === 'list') {
        return over.id === active.id ? t('drag.itsOwnPlace') : t('drag.list', { name: listName(over.id) })
      }
      const list = listName(resolveDestinationListId(over))
      return over.data.current?.type === 'card' && over.id !== active.id
        ? t('drag.cardInList', { name: cardName(over.id), list })
        : t('drag.list', { name: list })
    },
  )

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    if (active.data.current?.type === 'card') {
      const sourceListId = active.data.current.listId as string
      dragSourceListIdRef.current = sourceListId
      dragStartRef.current = { cards: cardsByList, order: orderByList }
      cardFetchHoldRef.current.count += 1
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
    if (!destListId || destListId === currentListId || cardsFailed.has(destListId)) return

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
    before: NonNullable<typeof dragStartRef.current>,
  ) {
    const cardId = active.id as string

    // handleDragOver may already have re-parented the card into a different
    // list's array while it was being dragged — find wherever it currently
    // lives to compute its final position.
    const currentListId = findCardListId(cardId)
    if (!currentListId) {
      releaseCardFetches()
      return
    }

    const overIsCard = over.data.current?.type === 'card'
    const currentCards = cardsByList[currentListId] ?? []
    const displayed = sortCards(currentCards, sortMode, orderByList[currentListId] ?? [])
    const oldIndex = displayed.findIndex(c => c.id === cardId)
    if (oldIndex === -1) {
      releaseCardFetches()
      return
    }
    let newIndex = overIsCard ? displayed.findIndex(c => c.id === over.id) : displayed.length - 1
    if (newIndex === -1) newIndex = displayed.length - 1

    // Due-date mode only lets the undated block at the top be arranged by
    // hand: a drop past it lands at the block's end rather than among the
    // dated cards, and dragging a dated card around inside its own list
    // does nothing (null) — its place follows from its due date.
    const targetIndex = sortMode === 'due_date'
      ? clampDueDateDropIndex(displayed, cardId, newIndex)
      : newIndex

    const reordered = targetIndex === null || oldIndex === targetIndex
      ? displayed
      : arrayMove(displayed, oldIndex, targetIndex)
    if (targetIndex !== null && oldIndex !== targetIndex) {
      setCardsByList(prev => ({ ...prev, [currentListId]: reordered }))
    }

    const movedAcrossLists = currentListId !== originalListId
    const moveDone = movedAcrossLists
      ? persistCardMove(originalListId, cardId, currentListId)
      : Promise.resolve(true)
    // The lists' orders to save once the move is, if any.
    const orders: [string, string[]][] = []

    // Reordering is only persisted in the two modes that let the user do it:
    // custom, where the whole list is theirs to arrange, and due date, where
    // only the undated block at the top is (handled below).
    if (sortMode === 'custom') {
      const newOrderIds = reordered.map(c => c.id)
      setOrderByList(prev => ({ ...prev, [currentListId]: newOrderIds }))
      const sourceOrderIds = movedAcrossLists ? (cardsByList[originalListId] ?? []).map(c => c.id) : null
      if (sourceOrderIds) {
        setOrderByList(prev => ({ ...prev, [originalListId]: sourceOrderIds }))
      }
      orders.push([currentListId, newOrderIds])
      if (sourceOrderIds) orders.push([originalListId, sourceOrderIds])
    } else if (sortMode === 'due_date' && targetIndex !== null) {
      // The undated cards were rearranged, so their new sequence goes into
      // the same stored order custom mode uses — only the slots they already
      // held are rewritten, leaving the dated cards where the user put them.
      const newOrderIds = applyUndatedOrder(
        orderByList[currentListId] ?? [],
        reordered,
        reordered.filter(isUndated).map(c => c.id),
      )
      setOrderByList(prev => ({ ...prev, [currentListId]: newOrderIds }))

      // handleDragOver already took the card out of the source list's array,
      // so filtering the stored order against it drops the card that left —
      // naming it in that list's PUT would be rejected.
      const sourceCardIds = movedAcrossLists
        ? new Set((cardsByList[originalListId] ?? []).map(c => c.id))
        : null
      const sourceOrderIds = sourceCardIds
        ? (orderByList[originalListId] ?? []).filter(id => sourceCardIds.has(id))
        : null
      if (sourceOrderIds) {
        setOrderByList(prev => ({ ...prev, [originalListId]: sourceOrderIds }))
      }
      orders.push([currentListId, newOrderIds])
      if (sourceOrderIds) orders.push([originalListId, sourceOrderIds])
    }

    // The order PUT for the destination list names this card, which the
    // backend rejects until the move PATCH above has actually committed —
    // so the orders wait for it instead of going in parallel. If any of it
    // isn't saved, the drag is undone and the page says so.
    moveDone.then(async moved => {
      const saved = moved
        && (await Promise.all(orders.map(([listId, ids]) => persistCardOrder(listId, ids)))).every(Boolean)
      if (saved) {
        releaseCardFetches()
        return
      }
      undoCardDrag(before, movedAcrossLists ? [originalListId, currentListId] : [currentListId])
      setFailure(t('common.moveFailed'))
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    setActiveList(null)

    const activeType = active.data.current?.type
    if (activeType === 'card') {
      const cardId = active.id as string
      const originalListId = dragSourceListIdRef.current
      const before = dragStartRef.current
      dragSourceListIdRef.current = null
      dragStartRef.current = null
      if (!originalListId || !before) return
      const destListId = over ? resolveDestinationListId(over) : undefined
      if (!over || (destListId && cardsFailed.has(destListId))) {
        // Dropped outside any droppable, or on a list whose cards couldn't
        // be loaded — undo whatever optimistic re-parenting handleDragOver
        // did.
        const currentListId = findCardListId(cardId)
        undoCardDrag(before, currentListId && currentListId !== originalListId
          ? [originalListId, currentListId]
          : [originalListId])
        return
      }
      handleCardDragEnd(active, over, originalListId, before)
      return
    }

    if (!over || active.id === over.id) return
    const oldIndex = sortedLists.findIndex(l => l.id === active.id)
    const newIndex = sortedLists.findIndex(l => l.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(sortedLists, oldIndex, newIndex)
    const newOrder = reordered.map(l => l.id)
    const before = { lists, order }

    setLists(reordered)
    setOrder(newOrder)

    // Refused (a list added or archived meanwhile) or not sent: the lists go
    // back to where they were, and are fetched again to show what's saved.
    apiFetch(`/api/v1/boards/${boardId}/lists/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_ids: newOrder }),
    })
      .then(r => r.ok, () => false)
      .then(saved => {
        if (saved) return
        setLists(before.lists)
        setOrder(before.order)
        setFailure(t('common.moveFailed'))
        fetchLists()
      })
  }

  if (accessDenied) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={handleLocaleChanged}
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
          <Button variant="contained" component={RouterLink} to="/boards">
            {t('board.backToBoards')}
          </Button>
        </Box>
      </>
    )
  }

  if (boardFailed || listsFailed || meFailed) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={handleLocaleChanged}
        />
        <Toolbar />
        <Box sx={{ p: 3 }}>
          <LoadFailure message={t('board.loadFailed')} onRetry={retryLoad} />
        </Box>
      </>
    )
  }

  if (board?.is_archived) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={handleLocaleChanged}
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
          <Button variant="contained" component={RouterLink} to="/boards">
            {t('board.backToBoards')}
          </Button>
        </Box>
      </>
    )
  }

  // Restoring/deleting in the archive view can change what the board looks
  // like (a restored list needs to reappear, a deleted card's stale cache
  // needs to go) — force a full refetch instead of showing whatever was
  // cached before.
  function returnFromArchive() {
    setShowArchive(false)
    fetchLists()
    setCardsByList({})
    setOrderByList({})
    setCardsFailed(new Set())
  }

  if (showArchive) {
    return (
      <>
        <MainAppBar
          onLocaleChanged={handleLocaleChanged}
          search={boardId ? { boardId, archived: true } : undefined}
        />
        <ArchivedListsView
          boardId={boardId ?? ''}
          boardName={board?.name ?? ''}
          activeLists={lists}
          numberLocale={numberLocale}
          dateFormat={dateFormat}
          isOwner={isOwner}
          highlightCardId={highlightCardId}
          onReturn={returnFromArchive}
          onOpenCard={(cardId) => {
            returnFromArchive()
            setSearchParams(prev => {
              const next = new URLSearchParams(prev)
              next.set('card', cardId)
              return next
            })
          }}
        />
      </>
    )
  }

  return (
    <>
      <MainAppBar
        onLocaleChanged={handleLocaleChanged}
        // A card carries its members' and assignees' avatar state, so an
        // avatar change of the viewer's own only lands on a refetch.
        onAvatarChanged={() => lists.forEach(l => fetchCardsForList(l.id))}
        // A template holds no cards, so there's nothing to search on it.
        search={boardId && !isTemplate ? { boardId } : undefined}
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
          {isTemplate && (
            <Tooltip title={t('board.templateHint')}>
              <Chip label={t('board.templateChip')} size="small" color="primary" variant="outlined" sx={{ mr: 2 }} />
            </Tooltip>
          )}
          <Button
            variant="contained"
            color="primary"
            startIcon={<Add />}
            size="small"
            onClick={() => setCreateListOpen(true)}
          >
            {t('board.addList')}
          </Button>
          {!isTemplate && (
            <>
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
            </>
          )}
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
          {/* The board menu only holds e-mail notifications, which a
              template has nothing to send about. */}
          {!isTemplate && (
            <IconButton color="inherit" aria-label={t('board.boardMenu')} onClick={openBoardMenu}>
              <MenuIcon />
            </IconButton>
          )}
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
        accessibility={boardDragAccessibility}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        // Escape puts everything back, as a drop outside every list does.
        onDragCancel={event => handleDragEnd({ ...event, over: null })}
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
                cardsFailed={cardsFailed.has(list.id)}
                onRetryCards={() => retryCards(list.id)}
                numberLocale={numberLocale}
                dateFormat={dateFormat}
                sortMode={sortMode}
                color={colors.lists[list.id] ?? null}
                cardColors={colors.cards}
                onColorChanged={(listId, color) => handleColorChanged('lists', listId, color)}
                onRenamed={handleListRenamed}
                onArchived={handleListArchived}
                onArchiveFailed={handleListArchiveFailed}
                onCardCreated={handleCardCreated}
                onCardArchived={handleCardArchived}
                onCardArchiveFailed={handleCardArchiveFailed}
                onArchiveAllCardsFailed={handleArchiveAllCardsFailed}
                onCardUpdated={handleCardUpdated}
                onCardColorChanged={(cardId, color) => handleColorChanged('cards', cardId, color)}
                onChecklistCopied={handleChecklistCopied}
                isTemplate={isTemplate}
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
              color={colors.cards[activeCard.id] ?? null}
              onColorChanged={() => {}}
              onArchived={() => {}}
              onArchiveFailed={() => {}}
              onUpdated={() => {}}
              onCopied={() => {}}
              onChecklistCopied={() => {}}
              dragOverlay
            />
          ) : activeList ? (
            <BoardListColumn
              list={activeList}
              cards={cardsByList[activeList.id] ?? []}
              customOrderIds={orderByList[activeList.id] ?? []}
              cardsFailed={cardsFailed.has(activeList.id)}
              onRetryCards={() => {}}
              numberLocale={numberLocale}
              dateFormat={dateFormat}
              sortMode={sortMode}
              color={colors.lists[activeList.id] ?? null}
              cardColors={colors.cards}
              onColorChanged={() => {}}
              onRenamed={() => {}}
              onArchived={() => {}}
              onArchiveFailed={() => {}}
              onCardCreated={() => {}}
              onCardArchived={() => {}}
              onCardArchiveFailed={() => {}}
              onArchiveAllCardsFailed={() => {}}
              onCardUpdated={() => {}}
              onCardColorChanged={() => {}}
              onChecklistCopied={() => {}}
              isTemplate={isTemplate}
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
        onClose={closeManageLabels}
        boardId={boardId ?? ''}
        onChanged={() => { labelsChangedRef.current = true }}
      />

      {deepLinkedCard && (
        <CardDialog
          open
          onClose={closeDeepLinkedCard}
          listId={deepLinkedCard.list_id}
          boardId={boardId ?? ''}
          numberLocale={numberLocale}
          card={deepLinkedCard}
          onUpdated={(card) => handleCardUpdated(card.list_id, card)}
          onCopied={handleCardCreated}
          onChecklistCopied={handleChecklistCopied}
        />
      )}

      <FailureMessage message={failure} onClose={() => setFailure(null)} />
    </>
  )
}
