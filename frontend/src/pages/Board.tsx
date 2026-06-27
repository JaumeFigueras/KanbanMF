import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  IconButton,
  Toolbar,
  Typography,
} from '@mui/material'
import { Add, Menu as MenuIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import MainAppBar from '../components/MainAppBar'
import type { BoardRead } from '../types/board'

export default function Board() {
  const { t } = useTranslation()
  const { boardId } = useParams<{ boardId: string }>()
  const { accessToken } = useAuth()
  const [board, setBoard] = useState<BoardRead | null>(null)

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

  return (
    <>
      <MainAppBar />

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
          <Button variant="contained" color="primary" startIcon={<Add />} size="small">
            {t('board.addList')}
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

      {/* Board content area */}
      <Box sx={{ mt: 2, px: 3 }}>
        {/* Lists will go here */}
      </Box>
    </>
  )
}
