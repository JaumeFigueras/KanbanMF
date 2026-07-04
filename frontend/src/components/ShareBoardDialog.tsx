import { useEffect, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { BoardRead, PersonSummary } from '../types/board'
import { apiFetch } from '../api/client'
import PersonAvatar from './PersonAvatar'

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
}

// Debounce delay for the user-search lookahead, in milliseconds.
const SEARCH_DEBOUNCE_MS = 300

export default function ShareBoardDialog({ open, onClose, board }: Props) {
  const { t } = useTranslation()
  const [sharedPeople, setSharedPeople] = useState<PersonSummary[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<PersonSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PersonSummary | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Reset to the board's current shares (owner excluded) each time it's opened.
  useEffect(() => {
    if (!open || !board) return
    setSearchTerm('')
    setSearchResults([])
    setError(null)
    apiFetch(`http://localhost:8000/api/v1/boards/${board.id}/members`)
      .then((r) => r.ok ? r.json() as Promise<PersonSummary[]> : [])
      .then((members) => setSharedPeople(members.filter((m) => m.id !== board.owner_id)))
      .catch(() => setSharedPeople([]))
  }, [open, board])

  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      apiFetch(`http://localhost:8000/api/v1/users/search?q=${encodeURIComponent(term)}`)
        .then((r) => r.ok ? r.json() as Promise<PersonSummary[]> : [])
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [searchTerm])

  const sharedIds = new Set(sharedPeople.map((p) => p.id))
  const selectableResults = searchResults.filter(
    (p) => !sharedIds.has(p.id) && p.id !== board?.owner_id,
  )

  async function handleSelect(person: PersonSummary | null) {
    if (!person || !board) return
    setSearchTerm('')
    setSearchResults([])
    setError(null)
    setAdding(true)
    try {
      const r = await apiFetch(`http://localhost:8000/api/v1/boards/${board.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: person.id }),
      })
      if (!r.ok) throw new Error()
      const added: PersonSummary = await r.json()
      setSharedPeople((prev) => (prev.some((p) => p.id === added.id) ? prev : [...prev, added]))
    } catch {
      setError(t('common.saveError'))
    } finally {
      setAdding(false)
    }
  }

  async function handleRemoveConfirmed() {
    if (!removeTarget || !board) return
    setRemoveError(null)
    setRemoving(true)
    try {
      const r = await apiFetch(
        `http://localhost:8000/api/v1/boards/${board.id}/shares/${removeTarget.id}`,
        { method: 'DELETE' },
      )
      if (!r.ok) throw new Error()
      setSharedPeople((prev) => prev.filter((p) => p.id !== removeTarget.id))
      setRemoveTarget(null)
    } catch {
      setRemoveError(t('common.saveError'))
    } finally {
      setRemoving(false)
    }
  }

  function closeRemoveConfirm() {
    setRemoveTarget(null)
    setRemoveError(null)
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>{t('boards.shareBoardTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('boards.sharedWith')}
          </Typography>

          {sharedPeople.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('boards.noSharedUsers')}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              {sharedPeople.map((person) => (
                <PersonAvatar key={person.id} person={person} onClick={() => setRemoveTarget(person)} />
              ))}
            </Box>
          )}

          <Autocomplete
            options={selectableResults}
            getOptionLabel={(p) => p.display_name}
            filterOptions={(x) => x}
            loading={searching || adding}
            disabled={adding}
            inputValue={searchTerm}
            onInputChange={(_, value) => setSearchTerm(value)}
            onChange={(_, value) => handleSelect(value)}
            value={null}
            noOptionsText={searchTerm.trim() ? t('boards.noUsersFound') : t('boards.searchUserPlaceholder')}
            renderOption={(props, option) => (
              <Box component="li" {...props} key={option.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <PersonAvatar person={option} size={28} />
                <Typography variant="body2">{option.display_name}</Typography>
              </Box>
            )}
            renderInput={(params) => (
              <TextField {...params} placeholder={t('boards.searchUserPlaceholder')} size="small" />
            )}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(removeTarget)} onClose={closeRemoveConfirm} maxWidth="xs" fullWidth>
        <DialogTitle>{t('boards.removeShareConfirmTitle')}</DialogTitle>
        <DialogContent>
          {removeError && <Alert severity="error" sx={{ mb: 2 }}>{removeError}</Alert>}
          <Typography variant="body2">
            {t('boards.removeShareConfirmMessage', { name: removeTarget?.display_name ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeRemoveConfirm} color="inherit" disabled={removing}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleRemoveConfirmed} color="error" variant="contained" disabled={removing}>
            {t('boards.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
