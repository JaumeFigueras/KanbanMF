import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Close, MailOutlined } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { BoardRead, PersonSummary } from '../types/board'
import type { BoardInvitationRead, InvitationConflict } from '../types/invitation'
import { apiFetch } from '../api/client'
import { fetchAppConfig } from '../api/config'
import { isOwnNotification, subscribeToNotifications } from '../api/ws'
import { LANGUAGES } from '../i18n'
import PersonAvatar from './PersonAvatar'

interface Props {
  open: boolean
  onClose: () => void
  board: BoardRead | null
  numberLocale: string
  dateFormat: 'numeric' | 'textual'
}

// Debounce delay for the user-search lookahead, in milliseconds.
const SEARCH_DEBOUNCE_MS = 300

// Only a sanity check before enabling the button; the backend validates for real.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Outcome of the last invitation attempt, shown under the invite row.
type InviteFeedback =
  | { kind: 'sent'; email: string }
  | { kind: 'userExists'; email: string; person: PersonSummary; alreadyShared: boolean }
  | { kind: 'alreadyInvited'; email: string }
  | { kind: 'error'; message: string }

export default function ShareBoardDialog({ open, onClose, board, numberLocale, dateFormat }: Props) {
  const { t, i18n } = useTranslation()
  const [sharedPeople, setSharedPeople] = useState<PersonSummary[]>([])
  const [invitations, setInvitations] = useState<BoardInvitationRead[]>([])
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<PersonSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PersonSummary | null>(null)
  const [cancelTarget, setCancelTarget] = useState<BoardInvitationRead | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLanguage, setInviteLanguage] = useState('en')
  const [inviting, setInviting] = useState(false)
  const [inviteFeedback, setInviteFeedback] = useState<InviteFeedback | null>(null)

  // Templates can't be shared by invitation, only with existing users.
  const canInvite = board !== null && !board.is_template

  const loadShares = useCallback(() => {
    if (!board) return
    apiFetch(`/api/v1/boards/${board.id}/members`)
      .then((r) => r.ok ? r.json() as Promise<PersonSummary[]> : [])
      .then((members) => setSharedPeople(members.filter((m) => m.id !== board.owner_id)))
      .catch(() => setSharedPeople([]))
    if (board.is_template) {
      setInvitations([])
      return
    }
    apiFetch(`/api/v1/boards/${board.id}/invitations`)
      .then((r) => r.ok ? r.json() as Promise<BoardInvitationRead[]> : [])
      .then(setInvitations)
      .catch(() => setInvitations([]))
  }, [board])

  // Reset to the board's current shares and invitations each time it's opened.
  useEffect(() => {
    if (!open || !board) return
    setSearchTerm('')
    setSearchResults([])
    setError(null)
    setInviteEmail('')
    setInviteLanguage(LANGUAGES.some((l) => l.code === i18n.language) ? i18n.language : 'en')
    setInviteFeedback(null)
    loadShares()
    fetchAppConfig().then((config) => setEmailEnabled(config.email_enabled))
  }, [open, board, loadShares, i18n.language])

  // An invitation accepted (it becomes a share) or changed from another tab.
  useEffect(() => {
    if (!open || !board) return
    return subscribeToNotifications((notification) => {
      if (isOwnNotification(notification) || notification.board_id !== board.id) return
      if (
        notification.type === 'board_invitations_changed'
        || notification.type === 'board_shared'
        || notification.type === 'board_unshared'
      ) {
        loadShares()
      }
    })
  }, [open, board, loadShares])

  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      apiFetch(`/api/v1/users/search?q=${encodeURIComponent(term)}`)
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

  // Returns whether the share was made, so the one-click share can clear its prompt.
  async function handleSelect(person: PersonSummary | null): Promise<boolean> {
    if (!person || !board) return false
    setSearchTerm('')
    setSearchResults([])
    setError(null)
    setAdding(true)
    try {
      const r = await apiFetch(`/api/v1/boards/${board.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: person.id }),
      })
      if (!r.ok) throw new Error()
      const added: PersonSummary = await r.json()
      setSharedPeople((prev) => (prev.some((p) => p.id === added.id) ? prev : [...prev, added]))
      return true
    } catch {
      setError(t('common.saveError'))
      return false
    } finally {
      setAdding(false)
    }
  }

  async function handleShareExisting(person: PersonSummary) {
    if (await handleSelect(person)) {
      setInviteFeedback(null)
      setInviteEmail('')
    }
  }

  async function handleInvite() {
    if (!board) return
    const email = inviteEmail.trim()
    setInviteFeedback(null)
    setInviting(true)
    try {
      const r = await apiFetch(`/api/v1/boards/${board.id}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, language: inviteLanguage }),
      })
      if (r.status === 201) {
        const created: BoardInvitationRead = await r.json()
        setInvitations((prev) => [...prev.filter((i) => i.id !== created.id), created])
        setInviteFeedback({ kind: 'sent', email: created.email })
        setInviteEmail('')
      } else if (r.status === 409) {
        const conflict: InvitationConflict = (await r.json()).detail
        setInviteFeedback(
          conflict.code === 'user_exists'
            ? { kind: 'userExists', email, person: conflict.person, alreadyShared: conflict.already_shared }
            : { kind: 'alreadyInvited', email },
        )
      } else if (r.status === 503) {
        setEmailEnabled(false)
        setInviteFeedback({ kind: 'error', message: t('boards.emailNotConfigured') })
      } else if (r.status === 502) {
        setInviteFeedback({ kind: 'error', message: t('boards.invitationSendFailed') })
      } else {
        setInviteFeedback({ kind: 'error', message: t('common.saveError') })
      }
    } catch {
      setInviteFeedback({ kind: 'error', message: t('common.saveError') })
    } finally {
      setInviting(false)
    }
  }

  async function handleRemoveConfirmed() {
    if (!removeTarget || !board) return
    setRemoveError(null)
    setRemoving(true)
    try {
      const r = await apiFetch(
        `/api/v1/boards/${board.id}/shares/${removeTarget.id}`,
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

  async function handleCancelConfirmed() {
    if (!cancelTarget || !board) return
    setCancelError(null)
    setCancelling(true)
    try {
      const r = await apiFetch(
        `/api/v1/boards/${board.id}/invitations/${cancelTarget.id}`,
        { method: 'DELETE' },
      )
      // 404: already accepted, expired or cancelled elsewhere — gone either way.
      if (!r.ok && r.status !== 404) throw new Error()
      setInvitations((prev) => prev.filter((i) => i.id !== cancelTarget.id))
      setCancelTarget(null)
    } catch {
      setCancelError(t('common.saveError'))
    } finally {
      setCancelling(false)
    }
  }

  function closeRemoveConfirm() {
    setRemoveTarget(null)
    setRemoveError(null)
  }

  function closeCancelConfirm() {
    setCancelTarget(null)
    setCancelError(null)
  }

  const intlLocale = numberLocale.replace('_', '-')
  function formatExpiry(iso: string): string {
    return new Intl.DateTimeFormat(intlLocale, {
      dateStyle: dateFormat === 'textual' ? 'medium' : 'short',
    }).format(new Date(iso))
  }

  const inviteEmailValid = EMAIL_PATTERN.test(inviteEmail.trim())
  const sendButton = (
    <Button
      variant="contained"
      onClick={handleInvite}
      disabled={!emailEnabled || !inviteEmailValid || inviting}
      sx={{ whiteSpace: 'nowrap' }}
    >
      {t('boards.sendInvitation')}
    </Button>
  )

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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

          {canInvite && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t('boards.pendingInvitations')}
              </Typography>
              {invitations.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('boards.noPendingInvitations')}
                </Typography>
              ) : (
                <List dense disablePadding sx={{ mb: 2 }}>
                  {invitations.map((invitation) => (
                    <ListItem
                      key={invitation.id}
                      disableGutters
                      secondaryAction={
                        <Tooltip title={t('boards.cancelInvitation')}>
                          <IconButton
                            edge="end"
                            size="small"
                            aria-label={t('boards.cancelInvitation')}
                            onClick={() => setCancelTarget(invitation)}
                          >
                            <Close fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <MailOutlined fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={invitation.email}
                        secondary={`${t('boards.invitationExpires', { date: formatExpiry(invitation.expires_at) })} · ${invitation.language.toUpperCase()}`}
                        slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('boards.addPeople')}
          </Typography>
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

          {canInvite ? (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3, mb: 0.5 }}>
                {t('boards.inviteByEmail')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('boards.inviteByEmailHint')}
              </Typography>
              <Box
                component="form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (emailEnabled && inviteEmailValid && !inviting) handleInvite()
                }}
                sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
              >
                <TextField
                  type="email"
                  size="small"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t('boards.inviteEmailPlaceholder')}
                  disabled={!emailEnabled || inviting}
                  sx={{ flex: '1 1 200px' }}
                />
                <TextField
                  select
                  size="small"
                  label={t('boards.inviteLanguage')}
                  value={inviteLanguage}
                  onChange={(e) => setInviteLanguage(e.target.value)}
                  disabled={!emailEnabled || inviting}
                  sx={{ width: 140 }}
                >
                  {LANGUAGES.map((l) => (
                    <MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>
                  ))}
                </TextField>
                {emailEnabled ? sendButton : (
                  <Tooltip title={t('boards.emailNotConfigured')}>
                    {/* A disabled button fires no events, so the tooltip needs a wrapper. */}
                    <span>{sendButton}</span>
                  </Tooltip>
                )}
              </Box>
              {!emailEnabled && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {t('boards.emailNotConfigured')}
                </Typography>
              )}

              {inviteFeedback?.kind === 'sent' && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  {t('boards.invitationSent', { email: inviteFeedback.email })}
                </Alert>
              )}
              {inviteFeedback?.kind === 'userExists' && (
                <Alert
                  severity="info"
                  sx={{ mt: 2 }}
                  action={inviteFeedback.alreadyShared ? undefined : (
                    <Button
                      color="inherit"
                      size="small"
                      disabled={adding}
                      onClick={() => handleShareExisting(inviteFeedback.person)}
                    >
                      {t('boards.shareWithUser', { name: inviteFeedback.person.display_name })}
                    </Button>
                  )}
                >
                  {t(
                    inviteFeedback.alreadyShared ? 'boards.userAlreadyShared' : 'boards.userAlreadyExists',
                    { email: inviteFeedback.email, name: inviteFeedback.person.display_name },
                  )}
                </Alert>
              )}
              {inviteFeedback?.kind === 'alreadyInvited' && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {t('boards.alreadyInvited', { email: inviteFeedback.email })}
                </Alert>
              )}
              {inviteFeedback?.kind === 'error' && (
                <Alert severity="error" sx={{ mt: 2 }}>{inviteFeedback.message}</Alert>
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('boards.templateNoInvitations')}
            </Typography>
          )}
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

      <Dialog open={Boolean(cancelTarget)} onClose={closeCancelConfirm} maxWidth="xs" fullWidth>
        <DialogTitle>{t('boards.cancelInvitationConfirmTitle')}</DialogTitle>
        <DialogContent>
          {cancelError && <Alert severity="error" sx={{ mb: 2 }}>{cancelError}</Alert>}
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {t('boards.cancelInvitationConfirmMessage', { email: cancelTarget?.email ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeCancelConfirm} color="inherit" disabled={cancelling}>
            {t('boards.keepInvitation')}
          </Button>
          <Button onClick={handleCancelConfirmed} color="error" variant="contained" disabled={cancelling}>
            {t('boards.cancelInvitation')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
