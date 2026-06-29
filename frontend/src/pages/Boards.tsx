import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Snackbar,
  Toolbar,
  Typography,
} from '@mui/material'
import { Add, ExpandMore } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import MainAppBar from '../components/MainAppBar'
import CreateBoardDialog from '../components/CreateBoardDialog'
import ChangeBoardNameDialog from '../components/ChangeBoardNameDialog'
import ArchiveBoardDialog from '../components/ArchiveBoardDialog'
import DeleteBoardDialog from '../components/DeleteBoardDialog'
import BoardCard from '../components/BoardCard'
import ArchivedBoardCard from '../components/ArchivedBoardCard'
import type { BoardOrderRead, BoardRead, BoardsResponse } from '../types/board'

const ACCORDION_KEY = 'kanbanmf.boards.accordions'

interface AccordionState {
  starred: boolean
  myBoards: boolean
  sharedWithMe: boolean
}

const DEFAULT_ACCORDION: AccordionState = { starred: true, myBoards: true, sharedWithMe: true }

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

const EMPTY_ORDER: BoardOrderRead = { starred_ids: [], owned_ids: [], shared_ids: [] }

export default function Boards() {
  const { t } = useTranslation()
  const { accessToken } = useAuth()

  // Locale settings received from MainAppBar (used for card date formatting)
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<'numeric' | 'textual'>('numeric')

  // Boards
  const [boards, setBoards] = useState<BoardsResponse>({ owned: [], shared: [] })
  const [order, setOrder] = useState<BoardOrderRead>(EMPTY_ORDER)

  // Board UI state
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const [changeBoardNameOpen, setChangeBoardNameOpen] = useState(false)
  const [selectedBoard, setSelectedBoard] = useState<BoardRead | null>(null)
  const [notImplementedOpen, setNotImplementedOpen] = useState(false)
  const [archiveBoardOpen, setArchiveBoardOpen] = useState(false)
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
        fetch('http://localhost:8000/api/v1/boards', {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        }),
        fetch('http://localhost:8000/api/v1/boards/order', {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
        }),
      ])
      if (boardsRes.ok) setBoards(await boardsRes.json())
      if (orderRes.ok) setOrder(await orderRes.json())
    } catch {
      // non-fatal
    }
  }, [accessToken])

  const fetchArchivedBoards = useCallback(async () => {
    try {
      const r = await fetch('http://localhost:8000/api/v1/boards/archived', {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
      if (r.ok) {
        const data: BoardRead[] = await r.json()
        setArchivedBoards(data)
      }
    } catch {
      // non-fatal
    }
  }, [accessToken])

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  // ── Board handlers ────────────────────────────────────────────────────────

  function handleBoardCreated(board: BoardRead) {
    setBoards(prev => ({ ...prev, owned: [...prev.owned, board] }))
    setOrder(prev => ({
      ...prev,
      owned_ids: [...prev.owned_ids, board.id],
      starred_ids: board.is_starred ? [...prev.starred_ids, board.id] : prev.starred_ids,
    }))
  }

  function handleStarToggle(boardId: string, starred: boolean) {
    const update = (list: BoardRead[]) =>
      list.map(b => b.id === boardId ? { ...b, is_starred: starred } : b)
    setBoards(prev => ({ owned: update(prev.owned), shared: update(prev.shared) }))
    // TODO: connect to POST/DELETE /api/v1/boards/{id}/star when endpoint is available
  }

  function handleChangeBoardName(board: BoardRead) {
    setSelectedBoard(board)
    setChangeBoardNameOpen(true)
  }

  function handleBoardNameSaved(boardId: string, newName: string) {
    const update = (list: BoardRead[]) =>
      list.map(b => b.id === boardId ? { ...b, name: newName } : b)
    setBoards(prev => ({ owned: update(prev.owned), shared: update(prev.shared) }))
  }

  function handleChangeBoardColor(_board: BoardRead) {
    setNotImplementedOpen(true)
  }

  function handleShareBoard(_board: BoardRead) {
    setNotImplementedOpen(true)
  }

  function handleArchiveBoard(board: BoardRead) {
    setSelectedBoard(board)
    setArchiveBoardOpen(true)
  }

  function handleBoardArchived(boardId: string) {
    const remove = (list: BoardRead[]) => list.filter(b => b.id !== boardId)
    setBoards(prev => ({ owned: remove(prev.owned), shared: remove(prev.shared) }))
    setOrder(prev => ({
      owned_ids: prev.owned_ids.filter(id => id !== boardId),
      starred_ids: prev.starred_ids.filter(id => id !== boardId),
      shared_ids: prev.shared_ids.filter(id => id !== boardId),
    }))
    if (showArchived) {
      const archived = boards.owned.find(b => b.id === boardId)
      if (archived) setArchivedBoards(prev => [{ ...archived, is_archived: true }, ...prev])
    }
  }

  async function handleRestoreBoard(board: BoardRead) {
    const r = await fetch(`http://localhost:8000/api/v1/boards/${board.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
      body: JSON.stringify({ is_archived: false }),
    })
    if (r.ok) {
      setArchivedBoards(prev => prev.filter(b => b.id !== board.id))
      setOrder(prev => ({ ...prev, owned_ids: [...prev.owned_ids, board.id] }))
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

  const sharedCardProps = {
    numberLocale,
    dateFormat,
    onStarToggle: handleStarToggle,
    onChangeName: handleChangeBoardName,
    onChangeColor: handleChangeBoardColor,
    onShare: handleShareBoard,
    onArchive: handleArchiveBoard,
  }

  return (
    <>
      <MainAppBar onLocaleChanged={handleLocaleChanged} />

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}

      <CreateBoardDialog
        open={createBoardOpen}
        onClose={() => setCreateBoardOpen(false)}
        accessToken={accessToken ?? ''}
        onCreated={handleBoardCreated}
      />

      <ChangeBoardNameDialog
        open={changeBoardNameOpen}
        onClose={() => setChangeBoardNameOpen(false)}
        board={selectedBoard}
        accessToken={accessToken ?? ''}
        onSaved={handleBoardNameSaved}
      />

      <ArchiveBoardDialog
        open={archiveBoardOpen}
        onClose={() => setArchiveBoardOpen(false)}
        board={selectedBoard}
        accessToken={accessToken ?? ''}
        onArchived={handleBoardArchived}
      />

      <DeleteBoardDialog
        open={deleteBoardOpen}
        onClose={() => setDeleteBoardOpen(false)}
        board={boardToDelete}
        accessToken={accessToken ?? ''}
        onDeleted={handleBoardDeleted}
      />

      <Snackbar
        open={notImplementedOpen}
        autoHideDuration={3000}
        onClose={() => setNotImplementedOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setNotImplementedOpen(false)}>
          {t('boards.notImplementedYet')}
        </Alert>
      </Snackbar>

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
              : <Box sx={BOARD_GRID_SX}>
                  {starredBoards.map(board => (
                    <BoardCard key={board.id} board={board} {...sharedCardProps} />
                  ))}
                </Box>
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
              : <Box sx={BOARD_GRID_SX}>
                  {myBoards.map(board => (
                    <BoardCard key={board.id} board={board} {...sharedCardProps} />
                  ))}
                </Box>
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
              : <Box sx={BOARD_GRID_SX}>
                  {sharedBoards.map(board => (
                    <BoardCard key={board.id} board={board} {...sharedCardProps} />
                  ))}
                </Box>
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

        {/* Show button only when accordion is hidden */}
        {!showArchived && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Button variant="outlined" color="error" size="small" onClick={handleToggleArchived}>
              {t('boards.showArchivedBoards')}
            </Button>
          </Box>
        )}
      </Box>
    </>
  )
}
