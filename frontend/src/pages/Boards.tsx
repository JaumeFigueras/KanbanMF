import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Add,
  AddPhotoAlternate,
  DarkMode,
  DriveFileRenameOutline,
  ExpandMore,
  Language,
  LightMode,
  Lock,
  Logout,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useThemeToggle } from '../context/ThemeToggleContext'
import ChangeDisplayNameDialog from '../components/ChangeDisplayNameDialog'
import ChangePasswordDialog from '../components/ChangePasswordDialog'
import UploadAvatarDialog from '../components/UploadAvatarDialog'
import LanguageLocalizationDialog from '../components/LanguageLocalizationDialog'
import CreateBoardDialog from '../components/CreateBoardDialog'
import ChangeBoardNameDialog from '../components/ChangeBoardNameDialog'
import ArchiveBoardDialog from '../components/ArchiveBoardDialog'
import DeleteBoardDialog from '../components/DeleteBoardDialog'
import BoardCard from '../components/BoardCard'
import ArchivedBoardCard from '../components/ArchivedBoardCard'
import type { BoardRead, BoardsResponse } from '../types/board'

const LOCALE_TO_I18N: Record<string, string> = { en: 'en', ca_ES: 'ca' }

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

export default function Boards() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { accessToken, logout } = useAuth()
  const { dark, toggleDark } = useThemeToggle()

  // User profile
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [initials, setInitials] = useState<string | null>(null)
  const [authProviders, setAuthProviders] = useState<string[]>([])
  const [languageLocale, setLanguageLocale] = useState('en')
  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<'numeric' | 'textual'>('numeric')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const avatarUrlRef = useRef<string | null>(null)

  // Boards
  const [boards, setBoards] = useState<BoardsResponse>({ owned: [], shared: [] })

  // UI state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [changeNameOpen, setChangeNameOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [uploadAvatarOpen, setUploadAvatarOpen] = useState(false)
  const [langLocOpen, setLangLocOpen] = useState(false)
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

  const fetchAvatar = useCallback(async () => {
    try {
      const r = await fetch('http://localhost:8000/api/v1/users/me/avatar', {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
      if (r.ok) {
        const blob = await r.blob()
        const url = URL.createObjectURL(blob)
        if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
        avatarUrlRef.current = url
        setAvatarUrl(url)
      } else {
        setAvatarUrl(null)
      }
    } catch {
      setAvatarUrl(null)
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

  const fetchBoards = useCallback(async () => {
    try {
      const r = await fetch('http://localhost:8000/api/v1/boards', {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      })
      if (r.ok) {
        const data: BoardsResponse = await r.json()
        setBoards(data)
      }
    } catch {
      // Leave boards as empty — non-fatal
    }
  }, [accessToken])

  useEffect(() => {
    fetch('http://localhost:8000/api/v1/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        setDisplayName(data.display_name)
        setInitials(data.initials ?? null)
        setAuthProviders(data.auth_providers ?? [])
        setLanguageLocale(data.language_locale ?? 'en')
        setNumberLocale(data.number_locale ?? 'en')
        setDateFormat(data.date_format ?? 'numeric')
        i18n.changeLanguage(LOCALE_TO_I18N[data.language_locale] ?? 'en')
      })
      .catch(() => navigate('/signin'))

    fetchAvatar()
    fetchBoards()

    return () => {
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current)
    }
  }, [accessToken, navigate, fetchAvatar, fetchBoards])

  // ── Board handlers ────────────────────────────────────────────────────────

  function handleBoardCreated(board: BoardRead) {
    setBoards(prev => ({ ...prev, owned: [board, ...prev.owned] }))
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
    // If the archived accordion is open, add the board to it
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
      fetchBoards()
    }
  }

  function handleDeleteBoard(board: BoardRead) {
    setBoardToDelete(board)
    setDeleteBoardOpen(true)
  }

  function handleBoardDeleted(boardId: string) {
    setArchivedBoards(prev => prev.filter(b => b.id !== boardId))
  }

  function handleToggleArchived() {
    setShowArchived(true)
    fetchArchivedBoards()
  }

  // ── Derived board sections ────────────────────────────────────────────────

  const starredBoards = [
    ...boards.owned.filter(b => b.is_starred),
    ...boards.shared.filter(b => b.is_starred),
  ]
  const myBoards = boards.owned
  const sharedBoards = boards.shared

  const sharedCardProps = {
    numberLocale,
    dateFormat,
    onStarToggle: handleStarToggle,
    onChangeName: handleChangeBoardName,
    onChangeColor: handleChangeBoardColor,
    onShare: handleShareBoard,
    onArchive: handleArchiveBoard,
  }

  // ── Sign out ──────────────────────────────────────────────────────────────

  async function handleSignOut() {
    setMenuAnchor(null)
    await logout()
    navigate('/signin')
  }

  return (
    <>
      <AppBar position="fixed">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: 0.5 }}>
            KanbanMF
          </Typography>

          <Tooltip title={t('boards.userProfile')}>
            <Box
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                borderRadius: 1,
                px: 0.5,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
              }}
            >
              <Avatar
                src={avatarUrl ?? undefined}
                sx={{
                  width: 32,
                  height: 32,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  bgcolor: 'primary.dark',
                  mr: displayName ? 1 : 0,
                }}
              >
                {initials}
              </Avatar>
              {displayName && (
                <Typography variant="body2">
                  {displayName}
                </Typography>
              )}
            </Box>
          </Tooltip>

          <Tooltip title={t('boards.signOut')}>
            <IconButton
              color="inherit"
              onClick={handleSignOut}
              aria-label={t('boards.signOut')}
              sx={{ ml: 1 }}
            >
              <Logout />
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          >
            <MenuItem onClick={() => { setMenuAnchor(null); setChangeNameOpen(true) }}>
              <ListItemIcon><DriveFileRenameOutline fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.changeDisplayName')}</ListItemText>
            </MenuItem>
            {authProviders.includes('local') && (
              <MenuItem onClick={() => { setMenuAnchor(null); setChangePasswordOpen(true) }}>
                <ListItemIcon><Lock fontSize="small" /></ListItemIcon>
                <ListItemText>{t('boards.changePassword')}</ListItemText>
              </MenuItem>
            )}
            <MenuItem onClick={() => { setMenuAnchor(null); setUploadAvatarOpen(true) }}>
              <ListItemIcon><AddPhotoAlternate fontSize="small" /></ListItemIcon>
              <ListItemText>
                {avatarUrl ? t('boards.changeRemoveAvatar') : t('boards.uploadAvatar')}
              </ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); setLangLocOpen(true) }}>
              <ListItemIcon><Language fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.languageLocalization')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); toggleDark() }}>
              <ListItemIcon>
                {dark ? <LightMode fontSize="small" /> : <DarkMode fontSize="small" />}
              </ListItemIcon>
              <ListItemText>
                {dark ? t('boards.changeToLight') : t('boards.changeToDark')}
              </ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleSignOut}>
              <ListItemIcon><Logout fontSize="small" /></ListItemIcon>
              <ListItemText>{t('boards.signOut')}</ListItemText>
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

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

      <UploadAvatarDialog
        open={uploadAvatarOpen}
        onClose={() => setUploadAvatarOpen(false)}
        accessToken={accessToken ?? ''}
        hasAvatar={avatarUrl !== null}
        currentAvatarUrl={avatarUrl}
        onSaved={fetchAvatar}
      />

      <LanguageLocalizationDialog
        open={langLocOpen}
        onClose={() => setLangLocOpen(false)}
        currentLanguageLocale={languageLocale}
        currentNumberLocale={numberLocale}
        currentDateFormat={dateFormat}
        accessToken={accessToken ?? ''}
        onSaved={(newLangLocale, newNumberLocale, newDateFormat) => {
          setLanguageLocale(newLangLocale)
          setNumberLocale(newNumberLocale)
          setDateFormat(newDateFormat)
          i18n.changeLanguage(LOCALE_TO_I18N[newLangLocale] ?? 'en')
        }}
      />

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        accessToken={accessToken ?? ''}
      />

      {displayName !== null && (
        <ChangeDisplayNameDialog
          open={changeNameOpen}
          onClose={() => setChangeNameOpen(false)}
          currentDisplayName={displayName}
          currentInitials={initials}
          accessToken={accessToken ?? ''}
          onSaved={(newName, newInitials) => {
            setDisplayName(newName)
            setInitials(newInitials)
          }}
        />
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}

      <Toolbar />{/* spacer matching the fixed AppBar height */}
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
