import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Toolbar,
  Typography,
} from '@mui/material'
import { Add, Label, Menu as MenuIcon } from '@mui/icons-material'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import MainAppBar from '../components/MainAppBar'
import CreateListDialog from '../components/CreateListDialog'
import ManageLabelsDialog from '../components/ManageLabelsDialog'
import BoardListColumn from '../components/BoardListColumn'
import type { BoardListRead, BoardListOrderRead, BoardRead } from '../types/board'
import type { DateFormat } from '../utils/locale'

export default function Board() {
  const { t } = useTranslation()
  const { boardId } = useParams<{ boardId: string }>()
  const { accessToken } = useAuth()
  const [board, setBoard] = useState<BoardRead | null>(null)
  const [lists, setLists] = useState<BoardListRead[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [createListOpen, setCreateListOpen] = useState(false)
  const [manageLabelsOpen, setManageLabelsOpen] = useState(false)
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')

  const sensors = useSensors(useSensor(PointerSensor))

  useEffect(() => {
    if (!boardId) return
    fetch(`http://localhost:8000/api/v1/boards/${boardId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBoard(data) })
      .catch(() => {})
  }, [boardId, accessToken])

  useEffect(() => {
    if (!boardId) return
    Promise.all([
      fetch(`http://localhost:8000/api/v1/boards/${boardId}/lists`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      }).then(r => r.ok ? r.json() as Promise<BoardListRead[]> : []),
      fetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/order`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      }).then(r => r.ok ? r.json() as Promise<BoardListOrderRead> : { board_id: boardId, list_ids: [] }),
    ])
      .then(([fetchedLists, fetchedOrder]) => {
        setLists(fetchedLists)
        setOrder(fetchedOrder.list_ids)
      })
      .catch(() => {})
  }, [boardId, accessToken])

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

  function handleListRenamed(listId: string, newName: string) {
    setLists(prev => prev.map(l => l.id === listId ? { ...l, name: newName } : l))
  }

  function handleListArchived(listId: string) {
    setLists(prev => prev.filter(l => l.id !== listId))
    setOrder(prev => prev.filter(id => id !== listId))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = sortedLists.findIndex(l => l.id === active.id)
    const newIndex = sortedLists.findIndex(l => l.id === over.id)
    const reordered = arrayMove(sortedLists, oldIndex, newIndex)
    const newOrder = reordered.map(l => l.id)

    setLists(reordered)
    setOrder(newOrder)

    fetch(`http://localhost:8000/api/v1/boards/${boardId}/lists/order`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
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
          <Box sx={{ flexGrow: 1 }} />
          <IconButton color="inherit" aria-label={t('board.boardMenu')}>
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Two spacers: one per fixed bar */}
      <Toolbar />
      <Toolbar />

      {/* Scrollable lists container */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                accessToken={accessToken ?? ''}
                numberLocale={numberLocale}
                dateFormat={dateFormat}
                onRenamed={handleListRenamed}
                onArchived={handleListArchived}
              />
            ))}
          </Box>
        </SortableContext>
      </DndContext>

      <CreateListDialog
        open={createListOpen}
        onClose={() => setCreateListOpen(false)}
        boardId={boardId ?? ''}
        accessToken={accessToken ?? ''}
        onCreated={handleListCreated}
      />

      <ManageLabelsDialog
        open={manageLabelsOpen}
        onClose={() => setManageLabelsOpen(false)}
        boardId={boardId ?? ''}
        accessToken={accessToken ?? ''}
      />
    </>
  )
}
