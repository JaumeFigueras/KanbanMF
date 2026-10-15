import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Toolbar,
  Typography,
} from '@mui/material'
import { Add, ExpandMore } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client'
import { isOwnNotification, subscribeToNotifications } from '../api/ws'
import MainAppBar from '../components/MainAppBar'
import CreateBoardDialog from '../components/CreateBoardDialog'
import ChangeBoardNameDialog from '../components/ChangeBoardNameDialog'
import ArchiveBoardDialog from '../components/ArchiveBoardDialog'
import DeleteBoardDialog from '../components/DeleteBoardDialog'
import ShareBoardDialog from '../components/ShareBoardDialog'
import EmailNotificationDialog from '../components/EmailNotificationDialog'
import DuplicateTemplateDialog from '../components/DuplicateTemplateDialog'
import BoardCard from '../components/BoardCard'
import ArchivedBoardCard from '../components/ArchivedBoardCard'
import type { BoardOrderRead, BoardRead, BoardsResponse } from '../types/board'

const ACCORDION_KEY = 'kanbanmf.boards.accordions'

interface AccordionState {
  starred: boolean
  myBoards: boolean
  sharedWithMe: boolean
  templates: boolean
}

const DEFAULT_ACCORDION: AccordionState = { starred: true, myBoards: true, sharedWithMe: true, templates: true }

function readAccordionState(): AccordionState {
  try {
    const stored = localStorage.getItem(ACCORDION_KEY)
    return stored ? { ...DEFAULT_ACCORDION, ...JSON.parse(stored) } : DEFAULT_ACCORDION
  } catch {
    return DEFAULT_ACCORDION
  }
}

const BOARD_GRID_SX = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
  gap: 2,
  pt: 1,
}

const EMPTY_ORDER: BoardOrderRead = { starred_ids: [], owned_ids: [], shared_ids: [], template_ids: [] }

type Section = 'starred' | 'owned' | 'shared' | 'templates'

export default function Boards() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  // Locale settings received from MainAppBar (used for card date formatting)
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<'numeric' | 'textual'>('numeric')

  // Boards
  const [boards, setBoards] = useState<BoardsResponse>({ owned: [], shared: [], templates: [] })
  const [order, setOrder] = useState<BoardOrderRead>(EMPTY_ORDER)

  // Owned and shared templates share one section, so which ones this user
  // owns (and may rename/share/archive) is decided by owner_id, not section.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // This user's personal color per board, keyed by board id. Lifted up here
  // (rather than fetched inside BoardCard) because a starred board renders
  // twice — once in "Starred", once in "My Boards"/"Shared with me" — and
  // both instances must share and update the same color.
  const [boardColors, setBoardColors] = useState<Record<string, string | null>>({})
  const fetchedColorIdsRef = useRef(new Set<string>())

  // Shared across all four DnD sections (Starred / My Boards / Shared / Templates)
  // since a drag is only ever active in one at a time — drives the floating
  // <DragOverlay> clone each section renders.
  const [draggingBoardId, setDraggingBoardId] = useState<string | null>(null)

  // Board UI state
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false)
  const [changeBoardNameOpen, setChangeBoardNameOpen] = useState(false)
  const [selectedBoard, setSelectedBoard] = useState<BoardRead | null>(null)
  const [shareBoardOpen, setShareBoardOpen] = useState(false)
  const [emailNotificationOpen, setEmailNotificationOpen] = useState(false)
  const [archiveBoardOpen, setArchiveBoardOpen] = useState(false)
  const [duplicateTemplateOpen, setDuplicateTemplateOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [archivedBoards, setArchivedBoards] = useState<BoardRead[]>([])
  const [boardToDelete, setBoardToDelete] = useState<BoardRead | null>(null)
  const [deleteBoardOpen, setDeleteBoardOpen] = useState(false)
  const [accordion, setAccordion] = useState<AccordionState>(readAccordionState)

  function toggleAccordion(key: keyof AccordionState) {
    setAccordion(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(ACCORDION_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleLocaleChanged = useCallback((num: string, fmt: 'numeric' | 'textual') => {
    setNumberLocale(num)
    setDateFormat(fmt)
  }, [])

  const fetchBoards = useCallback(async () => {
    try {
      const [boardsRes, orderRes] = await Promise.all([
        apiFetch('/api/v1/boards'),
        apiFetch('/api/v1/boards/order'),
      ])
      if (boardsRes.ok) setBoards(await boardsRes.json())
      if (orderRes.ok) setOrder(await orderRes.json())
    } catch {
      // non-fatal
    }
  }, [])

  const fetchArchivedBoards = useCallback(async () => {
    try {
      const r = await apiFetch('/api/v1/boards/archived')
      if (r.ok) {
        const data: BoardRead[] = await r.json()
        setArchivedBoards(data)
      }
    } catch {
      // non-fatal
    }
  }, [])

  // Each board carries its owner's avatar state (owner_has_avatar) in the
  // payload it was fetched with, so changing your own avatar only shows up
  // on the cards you own once they're fetched again.
  const handleAvatarChanged = useCallback(() => {
    fetchBoards()
    if (showArchived) fetchArchivedBoards()
  }, [fetchBoards, fetchArchivedBoards, showArchived])

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  useEffect(() => {
    apiFetch('/api/v1/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCurrentUserId(data.id) })
      .catch(() => {})
  }, [])

  // Fetch this user's color for each board the first time it's seen; boards
  // already fetched are skipped so re-renders (e.g. a star toggle) don't
  // refetch colors that are already known.
  useEffect(() => {
    const allIds = [...boards.owned, ...boards.shared, ...boards.templates].map(b => b.id)
    const idsToFetch = allIds.filter(id => !fetchedColorIdsRef.current.has(id))
    if (idsToFetch.length === 0) return
    idsToFetch.forEach(id => fetchedColorIdsRef.current.add(id))

    Promise.all(
      idsToFetch.map(id =>
        apiFetch(`/api/v1/boards/${id}/color`)
          .then(r => r.ok ? r.json() as Promise<{ color: string | null }> : null)
          .then(data => [id, data?.color ?? null] as const)
          .catch(() => [id, null] as const)
      )
    ).then(entries => {
      setBoardColors(prev => {
        const next = { ...prev }
        for (const [id, color] of entries) next[id] = color
        return next
      })
    })
  }, [boards])

  function handleColorChanged(boardId: string, color: string | null) {
    setBoardColors(prev => ({ ...prev, [boardId]: color }))
  }

  // Board list changes made elsewhere (another tab, another session, or by
  // whoever a board is shared with) arrive here as bare notifications; a
  // notification we triggered ourselves is skipped since our own local state
  // is already up to date.
  useEffect(() => {
    return subscribeToNotifications((notification) => {
      // Invitations change only the share dialog, never the board list.
      if (isOwnNotification(notification) || notification.type === 'board_invitations_changed') return
      fetchBoards()
      if (showArchived) fetchArchivedBoards()
    })
  }, [fetchBoards, fetchArchivedBoards, showArchived])

  // ── Board handlers ────────────────────────────────────────────────────────

  function handleBoardCreated(board: BoardRead) {
    if (board.is_template) {
      setBoards(prev => ({ ...prev, templates: [...prev.templates, board] }))
      setOrder(prev => ({ ...prev, template_ids: [...prev.template_ids, board.id] }))
      return
    }
    setBoards(prev => ({ ...prev, owned: [...prev.owned, board] }))
    setOrder(prev => ({
      ...prev,
      owned_ids: [...prev.owned_ids, board.id],
      starred_ids: board.is_starred ? [...prev.starred_ids, board.id] : prev.starred_ids,
    }))
  }

  async function handleStarToggle(boardId: string, starred: boolean) {
    // Optimistic update
    const applyToggle = (list: BoardRead[], value: boolean) =>
      list.map(b => b.id === boardId ? { ...b, is_starred: value } : b)
    setBoards(prev => ({ ...prev, owned: applyToggle(prev.owned, starred), shared: applyToggle(prev.shared, starred) }))
    setOrder(prev => ({
      ...prev,
      starred_ids: starred
        ? [...prev.starred_ids, boardId]
        : prev.starred_ids.filter(id => id !== boardId),
    }))

    const r = await apiFetch(`/api/v1/boards/${boardId}/star`, {
      method: starred ? 'POST' : 'DELETE',
    })

    if (!r.ok) {
      // Revert on failure
      setBoards(prev => ({ ...prev, owned: applyToggle(prev.owned, !starred), shared: applyToggle(prev.shared, !starred) }))
      setOrder(prev => ({
        ...prev,
        starred_ids: starred
          ? prev.starred_ids.filter(id => id !== boardId)
          : [...prev.starred_ids, boardId],
      }))
    }
  }

  function handleChangeBoardName(board: BoardRead) {
    setSelectedBoard(board)
    setChangeBoardNameOpen(true)
  }

  function handleBoardNameSaved(boardId: string, newName: string) {
    const update = (list: BoardRead[]) =>
      list.map(b => b.id === boardId ? { ...b, name: newName } : b)
    setBoards(prev => ({ owned: update(prev.owned), shared: update(prev.shared), templates: update(prev.templates) }))
  }

  function handleShareBoard(board: BoardRead) {
    setSelectedBoard(board)
    setShareBoardOpen(true)
  }

  function handleEmailNotification(board: BoardRead) {
    setSelectedBoard(board)
    setEmailNotificationOpen(true)
  }

  function handleDuplicateTemplate(board: BoardRead) {
    setSelectedBoard(board)
    setDuplicateTemplateOpen(true)
  }

  function handleArchiveBoard(board: BoardRead) {
    setSelectedBoard(board)
    setArchiveBoardOpen(true)
  }

  function handleBoardArchived(boardId: string) {
    const remove = (list: BoardRead[]) => list.filter(b => b.id !== boardId)
    setBoards(prev => ({ owned: remove(prev.owned), shared: remove(prev.shared), templates: remove(prev.templates) }))
    setOrder(prev => ({
      owned_ids: prev.owned_ids.filter(id => id !== boardId),
      starred_ids: prev.starred_ids.filter(id => id !== boardId),
      shared_ids: prev.shared_ids.filter(id => id !== boardId),
      template_ids: prev.template_ids.filter(id => id !== boardId),
    }))
    if (showArchived) {
      const archived = [...boards.owned, ...boards.templates].find(b => b.id === boardId)
      if (archived) setArchivedBoards(prev => [{ ...archived, is_archived: true }, ...prev])
    }
  }

  async function handleRestoreBoard(board: BoardRead) {
    const r = await apiFetch(`/api/v1/boards/${board.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: false }),
    })
    if (r.ok) {
      setArchivedBoards(prev => prev.filter(b => b.id !== board.id))
      const orderKey = board.is_template ? 'template_ids' : 'owned_ids'
      setOrder(prev => ({ ...prev, [orderKey]: [...prev[orderKey], board.id] }))
      fetchBoards()
    }
  }

  function handleDeleteBoard(board: BoardRead) {
    setBoardToDelete(board)
    setDeleteBoardOpen(true)
  }

  function handleBoardDeleted(boardId: string) {
    setArchivedBoards(prev => prev.filter(b => b.id !== boardId))
    setOrder(prev => ({
      owned_ids: prev.owned_ids.filter(id => id !== boardId),
      starred_ids: prev.starred_ids.filter(id => id !== boardId),
      shared_ids: prev.shared_ids.filter(id => id !== boardId),
      template_ids: prev.template_ids.filter(id => id !== boardId),
    }))
  }

  function handleToggleArchived() {
    setShowArchived(true)
    fetchArchivedBoards()
  }

  // ── Derived board sections (sorted by stored order) ──────────────────────

  function applySectionOrder<T extends { id: string }>(items: T[], ids: string[]): T[] {
    const byId = new Map(items.map(i => [i.id, i]))
    const ordered = ids.filter(id => byId.has(id)).map(id => byId.get(id)!)
    const unordered = items.filter(i => !ids.includes(i.id))
    return [...ordered, ...unordered]
  }

  const starredBoards = useMemo(() => {
    const all = [...boards.owned, ...boards.shared].filter(b => b.is_starred)
    return applySectionOrder(all, order.starred_ids)
  }, [boards, order.starred_ids])

  const myBoards = useMemo(
    () => applySectionOrder(boards.owned, order.owned_ids),
    [boards.owned, order.owned_ids],
  )

  const sharedBoards = useMemo(
    () => applySectionOrder(boards.shared, order.shared_ids),
    [boards.shared, order.shared_ids],
  )

  const templateBoards = useMemo(
    () => applySectionOrder(boards.templates, order.template_ids),
    [boards.templates, order.template_ids],
  )

  // The "Starred" and "Templates" sections mix owned and shared boards, so
  // ownership has to be looked up per board rather than assumed from which
  // section it's in.
  const ownedBoardIds = useMemo(
    () => new Set([
      ...boards.owned.map(b => b.id),
      ...boards.templates.filter(b => b.owner_id === currentUserId).map(b => b.id),
    ]),
    [boards.owned, boards.templates, currentUserId],
  )

  function handleBoardDragStart(event: DragStartEvent) {
    setDraggingBoardId(event.active.id as string)
  }

  function handleSectionDragEnd(event: DragEndEvent, section: Section) {
    setDraggingBoardId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const sectionBoards = {
      starred: starredBoards,
      owned: myBoards,
      shared: sharedBoards,
      templates: templateBoards,
    }[section]
    const orderKey = ({
      starred: 'starred_ids',
      owned: 'owned_ids',
      shared: 'shared_ids',
      templates: 'template_ids',
    } as const)[section]

    const ids = sectionBoards.map(b => b.id)
    const oldIdx = ids.indexOf(active.id as string)
    const newIdx = ids.indexOf(over.id as string)
    if (oldIdx === -1 || newIdx === -1) return

    const newIds = arrayMove(ids, oldIdx, newIdx)
    const newOrder = { ...order, [orderKey]: newIds }
    setOrder(newOrder)

    apiFetch('/api/v1/boards/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder),
    }).catch(() => {})
  }

  const sharedCardProps = {
    numberLocale,
    dateFormat,
    onStarToggle: handleStarToggle,
    onChangeName: handleChangeBoardName,
    onShare: handleShareBoard,
    onArchive: handleArchiveBoard,
    onEmailNotification: handleEmailNotification,
    onDuplicate: handleDuplicateTemplate,
    onColorChanged: handleColorChanged,
  }

  const draggingBoard = draggingBoardId
    ? [...boards.owned, ...boards.shared, ...boards.templates].find(b => b.id === draggingBoardId) ?? null
    : null

  return (
    <>
      <MainAppBar onLocaleChanged={handleLocaleChanged} onAvatarChanged={handleAvatarChanged} />

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}

      <CreateBoardDialog
        open={createBoardOpen}
        onClose={() => setCreateBoardOpen(false)}
        onCreated={handleBoardCreated}
        templates={templateBoards}
        currentUserId={currentUserId}
      />

      <CreateBoardDialog
        mode="template"
        open={createTemplateOpen}
        onClose={() => setCreateTemplateOpen(false)}
        onCreated={handleBoardCreated}
      />

      <ChangeBoardNameDialog
        open={changeBoardNameOpen}
        onClose={() => setChangeBoardNameOpen(false)}
        board={selectedBoard}
        onSaved={handleBoardNameSaved}
      />

      <ShareBoardDialog
        open={shareBoardOpen}
        onClose={() => setShareBoardOpen(false)}
        board={selectedBoard}
        numberLocale={numberLocale}
        dateFormat={dateFormat}
      />

      <EmailNotificationDialog
        open={emailNotificationOpen}
        onClose={() => setEmailNotificationOpen(false)}
        board={selectedBoard}
      />

      {/* The copy is a new template owned by this user, so it lands in the
          Templates section exactly like a freshly created one. */}
      <DuplicateTemplateDialog
        open={duplicateTemplateOpen}
        onClose={() => setDuplicateTemplateOpen(false)}
        template={selectedBoard}
        onDuplicated={handleBoardCreated}
      />

      <ArchiveBoardDialog
        open={archiveBoardOpen}
        onClose={() => setArchiveBoardOpen(false)}
        board={selectedBoard}
        onArchived={handleBoardArchived}
      />

      <DeleteBoardDialog
        open={deleteBoardOpen}
        onClose={() => setDeleteBoardOpen(false)}
        board={boardToDelete}
        onDeleted={handleBoardDeleted}
      />

      {/* ── Main content ─────────────────────────────────────────────────── */}

      <Toolbar />{/* spacer for the fixed AppBar */}
      <Box sx={{ mt: 4, px: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}>
          <Button variant="contained" size="large" startIcon={<Add />} onClick={() => setCreateBoardOpen(true)}>
            {t('boards.createNewBoard')}
          </Button>
        </Box>

        {/* Starred */}
        <Accordion expanded={accordion.starred} onChange={() => toggleAccordion('starred')}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('boards.starredBoards')} ({starredBoards.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {starredBoards.length === 0
              ? <Typography variant="body2" color="text.secondary">{t('boards.noBoardsYet')}</Typography>
              : <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleBoardDragStart}
                  onDragEnd={e => handleSectionDragEnd(e, 'starred')}
                >
                  <SortableContext items={starredBoards.map(b => b.id)} strategy={rectSortingStrategy}>
                    <Box sx={BOARD_GRID_SX}>
                      {starredBoards.map(board => (
                        <BoardCard
                          key={board.id}
                          id={board.id}
                          board={board}
                          isOwned={ownedBoardIds.has(board.id)}
                          color={boardColors[board.id] ?? null}
                          {...sharedCardProps}
                        />
                      ))}
                    </Box>
                  </SortableContext>
                  <DragOverlay>
                    {draggingBoard ? (
                      <BoardCard
                        id={draggingBoard.id}
                        board={draggingBoard}
                        isOwned={ownedBoardIds.has(draggingBoard.id)}
                        color={boardColors[draggingBoard.id] ?? null}
                        {...sharedCardProps}
                        dragOverlay
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
            }
          </AccordionDetails>
        </Accordion>

        {/* My Boards */}
        <Accordion expanded={accordion.myBoards} onChange={() => toggleAccordion('myBoards')}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('boards.myBoards')} ({myBoards.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {myBoards.length === 0
              ? <Typography variant="body2" color="text.secondary">{t('boards.noBoardsYet')}</Typography>
              : <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleBoardDragStart}
                  onDragEnd={e => handleSectionDragEnd(e, 'owned')}
                >
                  <SortableContext items={myBoards.map(b => b.id)} strategy={rectSortingStrategy}>
                    <Box sx={BOARD_GRID_SX}>
                      {myBoards.map(board => (
                        <BoardCard
                          key={board.id}
                          id={board.id}
                          board={board}
                          isOwned={ownedBoardIds.has(board.id)}
                          color={boardColors[board.id] ?? null}
                          {...sharedCardProps}
                        />
                      ))}
                    </Box>
                  </SortableContext>
                  <DragOverlay>
                    {draggingBoard ? (
                      <BoardCard
                        id={draggingBoard.id}
                        board={draggingBoard}
                        isOwned={ownedBoardIds.has(draggingBoard.id)}
                        color={boardColors[draggingBoard.id] ?? null}
                        {...sharedCardProps}
                        dragOverlay
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
            }
          </AccordionDetails>
        </Accordion>

        {/* Shared with me */}
        <Accordion expanded={accordion.sharedWithMe} onChange={() => toggleAccordion('sharedWithMe')}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('boards.sharedWithMe')} ({sharedBoards.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {sharedBoards.length === 0
              ? <Typography variant="body2" color="text.secondary">{t('boards.noBoardsYet')}</Typography>
              : <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleBoardDragStart}
                  onDragEnd={e => handleSectionDragEnd(e, 'shared')}
                >
                  <SortableContext items={sharedBoards.map(b => b.id)} strategy={rectSortingStrategy}>
                    <Box sx={BOARD_GRID_SX}>
                      {sharedBoards.map(board => (
                        <BoardCard
                          key={board.id}
                          id={board.id}
                          board={board}
                          isOwned={ownedBoardIds.has(board.id)}
                          color={boardColors[board.id] ?? null}
                          {...sharedCardProps}
                        />
                      ))}
                    </Box>
                  </SortableContext>
                  <DragOverlay>
                    {draggingBoard ? (
                      <BoardCard
                        id={draggingBoard.id}
                        board={draggingBoard}
                        isOwned={ownedBoardIds.has(draggingBoard.id)}
                        color={boardColors[draggingBoard.id] ?? null}
                        {...sharedCardProps}
                        dragOverlay
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
            }
          </AccordionDetails>
        </Accordion>

        {/* Templates — owned and shared together; never starred */}
        <Accordion expanded={accordion.templates} onChange={() => toggleAccordion('templates')}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('boards.templates')} ({templateBoards.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <Button variant="outlined" size="small" startIcon={<Add />} onClick={() => setCreateTemplateOpen(true)}>
                {t('boards.newTemplate')}
              </Button>
            </Box>
            {templateBoards.length === 0
              ? <Typography variant="body2" color="text.secondary">{t('boards.noTemplatesYet')}</Typography>
              : <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleBoardDragStart}
                  onDragEnd={e => handleSectionDragEnd(e, 'templates')}
                >
                  <SortableContext items={templateBoards.map(b => b.id)} strategy={rectSortingStrategy}>
                    <Box sx={BOARD_GRID_SX}>
                      {templateBoards.map(board => (
                        <BoardCard
                          key={board.id}
                          id={board.id}
                          board={board}
                          isOwned={ownedBoardIds.has(board.id)}
                          color={boardColors[board.id] ?? null}
                          {...sharedCardProps}
                        />
                      ))}
                    </Box>
                  </SortableContext>
                  <DragOverlay>
                    {draggingBoard ? (
                      <BoardCard
                        id={draggingBoard.id}
                        board={draggingBoard}
                        isOwned={ownedBoardIds.has(draggingBoard.id)}
                        color={boardColors[draggingBoard.id] ?? null}
                        {...sharedCardProps}
                        dragOverlay
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
            }
          </AccordionDetails>
        </Accordion>

        {/* Archived Boards — shown when showArchived; collapsing the chevron hides it and restores the button */}
        {showArchived && (
          <Accordion
            expanded={showArchived}
            onChange={(_, expanded) => { if (!expanded) setShowArchived(false) }}
          >
            <AccordionSummary
              expandIcon={<ExpandMore sx={{ color: 'white' }} />}
              sx={{ bgcolor: 'error.main', color: 'white', borderRadius: 0 }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('boards.archivedBoards')} ({archivedBoards.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {archivedBoards.length === 0
                ? <Typography variant="body2" color="text.secondary">{t('boards.noBoardsYet')}</Typography>
                : <Box sx={BOARD_GRID_SX}>
                    {archivedBoards.map(board => (
                      <ArchivedBoardCard
                        key={board.id}
                        board={board}
                        numberLocale={numberLocale}
                        dateFormat={dateFormat}
                        onRestore={handleRestoreBoard}
                        onDelete={handleDeleteBoard}
                      />
                    ))}
                  </Box>
              }
            </AccordionDetails>
          </Accordion>
        )}

        {/* The archived button shows only while its accordion is hidden; the
            overdue one leads to its own page, so it's always available. */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 3 }}>
          {!showArchived && (
            <Button variant="outlined" color="error" size="small" onClick={handleToggleArchived}>
              {t('boards.showArchivedBoards')}
            </Button>
          )}
          <Button variant="outlined" color="warning" size="small" onClick={() => navigate('/overdue')}>
            {t('boards.showOverdueTasks')}
          </Button>
        </Box>
      </Box>
    </>
  )
}
