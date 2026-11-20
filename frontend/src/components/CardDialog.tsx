import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  Add,
  ArrowOutward,
  Checklist as ChecklistIcon,
  ContentCopy,
  Delete,
  DragIndicator,
  Edit,
  Menu as HamburgerIcon,
  Label as LabelIcon,
  People as PeopleIcon,
} from '@mui/icons-material'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import dayjs, { type Dayjs } from 'dayjs'
import type { CardRead, ChecklistData, ChecklistItemData, ChecklistRead, LabelRead, PersonSummary } from '../types/board'
import CardDateField from './CardDateField'
import CardLabelPickerDialog from './CardLabelPickerDialog'
import ChecklistDialog from './ChecklistDialog'
import CopyCardDialog from './CopyCardDialog'
import CopyChecklistDialog from './CopyChecklistDialog'
import PersonAvatar from './PersonAvatar'
import SelectUserDialog from './SelectUserDialog'
import { dayjsLocaleFor } from '../utils/locale'
import { contrastColor } from '../utils/labelColor'
import { apiFetch } from '../api/client'
import { fullOrder, isServerOrder } from '../utils/checklistOrder'

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// A checklist request, which fails loudly: syncChecklists stops at the first
// change the server refuses instead of carrying on as if it had been saved.
async function send(url: string, init?: RequestInit): Promise<Response> {
  const r = await apiFetch(url, init)
  if (!r.ok) throw new Error()
  return r
}

// The card's checklists as the server has them, or null if they couldn't be
// fetched.
async function loadChecklists(checklistsUrl: string): Promise<ChecklistRead[] | null> {
  try {
    const r = await apiFetch(checklistsUrl)
    return r.ok ? await r.json() as ChecklistRead[] : null
  } catch {
    return null
  }
}

// What the dialog edits of each checklist.
function checklistData(checklists: ChecklistRead[]): ChecklistData[] {
  return checklists.map((cl) => ({
    id: cl.id,
    name: cl.name,
    items: cl.items.map((i) => ({ id: i.id, text: i.text, is_done: i.is_done })),
  }))
}

// A card's content as text, its keys in a fixed order, so two copies of it
// compare equal: the board hands over a new copy each time it reloads a list.
function contentOf(card: CardRead | null | undefined): string {
  return JSON.stringify(card ?? null, (_, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value)
}

// What saving the checklists keeps track of: the ids the dialog knows (the
// checklists and items it opened with, and those it has made), and the id
// the server gives each one it makes now, by the id the dialog gave it.
interface ChecklistIds {
  known: Set<string>
  made: Map<string, string>
}

// The ids of a card's checklists and of their items.
function idsIn(checklists: ChecklistData[]): string[] {
  return checklists.flatMap((c) => [c.id, ...c.items.map((i) => i.id)])
}

// Brings the card's checklists in line with the dialog's: deletes what the
// user removed, makes what they added, sends renames and changed items, then
// the order of what they moved. `saved` is what the server has as far as the
// dialog knows: what it opened with, or what the server had just before a
// second try. Only what the dialog knows is deleted, so a checklist or item
// it never showed (a copy made onto this card, one added elsewhere) is left
// alone, and an order names it after the rest, as the server refuses one
// that doesn't. An order is sent only when something moved: the server keeps
// its own order and puts what's new after the last one. Runs as part of the
// Save action, since checklists have no draft of their own on the server.
// It stops at the first request that fails, `ids.made` holding by then what
// was made.
async function syncChecklists(checklistsUrl: string, saved: ChecklistData[], shown: ChecklistData[], ids: ChecklistIds) {
  const shownIds = new Set(shown.map((c) => c.id))
  for (const checklist of saved) {
    if (ids.known.has(checklist.id) && !shownIds.has(checklist.id)) {
      await send(`${checklistsUrl}/${checklist.id}`, { method: 'DELETE' })
    }
  }

  const checklistsMoved = !isServerOrder(saved.map((c) => c.id), shown.map((c) => c.id))
  // The checklists whose items were moved.
  const itemsMoved: ChecklistData[] = []
  for (const checklist of shown) {
    const before = saved.find((c) => c.id === checklist.id)

    if (!before) {
      const r = await send(checklistsUrl, jsonInit('POST', { name: checklist.name }))
      const created: { id: string } = await r.json()
      ids.made.set(checklist.id, created.id)
      const itemsUrl = `${checklistsUrl}/${created.id}/items`
      for (const item of checklist.items) {
        const itemRes = await send(itemsUrl, jsonInit('POST', { text: item.text, is_done: item.is_done }))
        ids.made.set(item.id, (await itemRes.json() as { id: string }).id)
      }
      continue
    }

    if (before.name !== checklist.name) {
      await send(`${checklistsUrl}/${checklist.id}`, jsonInit('PATCH', { name: checklist.name }))
    }

    const itemsUrl = `${checklistsUrl}/${checklist.id}/items`
    const shownItemIds = new Set(checklist.items.map((i) => i.id))
    for (const item of before.items) {
      if (ids.known.has(item.id) && !shownItemIds.has(item.id)) {
        await send(`${itemsUrl}/${item.id}`, { method: 'DELETE' })
      }
    }
    for (const item of checklist.items) {
      const beforeItem = before.items.find((i) => i.id === item.id)
      if (!beforeItem) {
        const r = await send(itemsUrl, jsonInit('POST', { text: item.text, is_done: item.is_done }))
        ids.made.set(item.id, (await r.json() as { id: string }).id)
      } else if (beforeItem.text !== item.text || beforeItem.is_done !== item.is_done) {
        await send(`${itemsUrl}/${item.id}`, jsonInit('PATCH', { text: item.text, is_done: item.is_done }))
      }
    }
    if (!isServerOrder(before.items.map((i) => i.id), checklist.items.map((i) => i.id))) {
      itemsMoved.push(checklist)
    }
  }

  if (!checklistsMoved && itemsMoved.length === 0) return
  // What the server has now, so the orders name all of it.
  const current: ChecklistRead[] = await (await send(checklistsUrl)).json()
  const idOf = (id: string) => ids.made.get(id) ?? id
  if (checklistsMoved) {
    await send(`${checklistsUrl}/order`, jsonInit('PUT', {
      checklist_ids: fullOrder(shown.map((c) => idOf(c.id)), current.map((c) => c.id)),
    }))
  }
  for (const checklist of itemsMoved) {
    const serverItems = current.find((c) => c.id === checklist.id)?.items ?? []
    await send(`${checklistsUrl}/${checklist.id}/items/order`, jsonInit('PUT', {
      item_ids: fullOrder(checklist.items.map((i) => idOf(i.id)), serverItems.map((i) => i.id)),
    }))
  }
}

function SortableChecklistRow({
  checklist,
  onEdit,
  onRemove,
  onCopy,
  onToggleItem,
  onExtractItem,
  editLabel,
  menuLabel,
  copyLabel,
  removeLabel,
  dragLabel,
  extractLabel,
  extractItemLabel,
}: {
  checklist: ChecklistData
  onEdit: () => void
  onRemove: () => void
  onCopy: () => void
  onToggleItem: (itemId: string) => void
  // Undefined while the card itself hasn't been created yet — there is no
  // source card to copy labels/dates/people from, so the action is hidden
  // rather than shown broken.
  onExtractItem?: (item: ChecklistItemData) => void
  editLabel: string
  menuLabel: string
  copyLabel: string
  removeLabel: string
  dragLabel: string
  // The extract button's tooltip, and its name for one item.
  extractLabel: string
  extractItemLabel: (item: ChecklistItemData) => string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: checklist.id })
  const doneCount = checklist.items.filter((i) => i.is_done).length
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  function closeMenu() {
    setMenuAnchor(null)
  }

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 1,
        bgcolor: 'background.paper',
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton
          size="small"
          aria-label={dragLabel}
          sx={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <DragIndicator fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
          {checklist.name}
        </Typography>
        {checklist.items.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {doneCount}/{checklist.items.length}
          </Typography>
        )}
        <IconButton size="small" onClick={onEdit} aria-label={editLabel}>
          <Edit fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          aria-label={menuLabel}
        >
          <HamburgerIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
          <MenuItem onClick={() => { closeMenu(); onCopy() }}>
            <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
            <ListItemText>{copyLabel}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { closeMenu(); onRemove() }}>
            <ListItemIcon><Delete fontSize="small" /></ListItemIcon>
            <ListItemText>{removeLabel}</ListItemText>
          </MenuItem>
        </Menu>
      </Box>

      {checklist.items.length > 0 && (
        <Stack sx={{ mt: 0.5 }}>
          {checklist.items.map((item) => (
            // Flex row rather than a bare FormControlLabel so the extract
            // button sits at the right edge; every row shares the same
            // container width, which is what lines the buttons up as a
            // column without any fixed sizing.
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                sx={{ ml: 0, mr: 0, flex: 1, minWidth: 0 }}
                control={
                  <Checkbox
                    size="small"
                    checked={item.is_done}
                    onChange={() => onToggleItem(item.id)}
                  />
                }
                label={
                  <Typography
                    variant="body2"
                    sx={{
                      textDecoration: item.is_done ? 'line-through' : 'none',
                      color: item.is_done ? 'text.disabled' : 'text.primary',
                      wordBreak: 'break-word',
                    }}
                  >
                    {item.text}
                  </Typography>
                }
              />
              {onExtractItem && (
                <IconButton
                  size="small"
                  onClick={() => onExtractItem(item)}
                  aria-label={extractItemLabel(item)}
                  title={extractLabel}
                  sx={{ flexShrink: 0 }}
                >
                  <ArrowOutward fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  listId: string
  boardId: string
  numberLocale: string
  card?: CardRead | null
  listColor?: string | null
  // Reports the color the new card was created with (the inherited list
  // color, or null) alongside the card itself, so the caller can show it
  // with its final color immediately instead of a moment after — see
  // Board.tsx's handleCardCreated.
  onCreated?: (card: CardRead, color: string | null) => void
  onUpdated?: (card: CardRead) => void
  // Same shape as CardItem's own onCopied — fired when a checklist item is
  // extracted into a new card, so the board can show it straight away. The
  // extract action is hidden when this is absent.
  onCopied?: (targetListId: string, card: CardRead, color: string | null) => void
  // Fired after a checklist is copied onto another card, naming where the
  // copy landed so the board can refetch that card — the target card's face
  // shows its checklists, and nothing else tells the board they changed.
  onChecklistCopied?: (targetBoardId: string, targetListId: string) => void
}

export default function CardDialog({
  open,
  onClose,
  listId,
  boardId,
  numberLocale,
  card,
  listColor,
  onCreated,
  onUpdated,
  onCopied,
  onChecklistCopied,
}: Props) {
  const { t } = useTranslation()
  // The card this opening created, when saving it went only partly well: a
  // second Save edits it rather than creating another.
  const [createdCard, setCreatedCard] = useState<CardRead | null>(null)
  // Set when a save stopped partway through the checklists: what the server
  // has is no longer what the dialog compares against, so the next Save asks
  // for it first.
  const [baselineStale, setBaselineStale] = useState(false)
  // The ids the server gave the checklists and items earlier tries at saving
  // made: the dialog knows them, as it knows those it opened with.
  const [madeIds, setMadeIds] = useState<string[]>([])
  const editing = card ?? createdCard
  const isEdit = Boolean(editing)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState<Dayjs | null>(null)
  const [dueAt, setDueAt] = useState<Dayjs | null>(null)
  const [endAt, setEndAt] = useState<Dayjs | null>(null)
  // Which date fields hold a date that can't be saved (typed only in part,
  // or impossible), as each field reports it.
  const [incompleteDates, setIncompleteDates] = useState({ start: false, due: false, end: false })
  const [selectedLabels, setSelectedLabels] = useState<LabelRead[]>([])
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)
  const [members, setMembers] = useState<PersonSummary[]>([])
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  const [assignees, setAssignees] = useState<PersonSummary[]>([])
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  // The board's people, to choose members and assignees from: null until
  // this opening's answer arrives (the pickers wait for it).
  const [candidates, setCandidates] = useState<PersonSummary[] | null>(null)
  const [candidatesFailed, setCandidatesFailed] = useState(false)
  const [checklists, setChecklists] = useState<ChecklistData[]>([])
  const [initialChecklists, setInitialChecklists] = useState<ChecklistData[]>([])
  const [checklistDialogOpen, setChecklistDialogOpen] = useState(false)
  const [editingChecklist, setEditingChecklist] = useState<ChecklistData | null>(null)
  // The checklist item currently being extracted into its own card, or null.
  // Only its text is used — the item may still be a local draft with a
  // client-generated id that the server has never seen, so the extraction
  // copies the *card* and takes the item's text as the new card's name.
  const [extractingItem, setExtractingItem] = useState<ChecklistItemData | null>(null)
  // The checklist currently being copied onto another card, or null. Copied
  // from this local state rather than the server, so edits not yet saved on
  // this card still make it into the copy.
  const [copyingChecklist, setCopyingChecklist] = useState<ChecklistData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The card this opening created has one too, after a partial save.
  const creator = editing?.creator ?? null

  // Set when the card was changed elsewhere while the dialog was open: the
  // form keeps what the user typed, and says so.
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  // The card as it was when the dialog opened.
  const [openedWith, setOpenedWith] = useState<CardRead | null | undefined>(card)

  // Reset the form each time the dialog opens, and only then. The board
  // reloads a whole list (handing every card in it a new copy) whenever
  // anything in it changes elsewhere, and resetting then would throw away
  // what the user typed. Saving compares the checklists against those the
  // dialog opened with, so a checklist added elsewhere meanwhile isn't
  // deleted. Done while rendering rather than in an effect, so no frame shows
  // stale values.
  const [shown, setShown] = useState({ open: false, card })
  if (open !== shown.open || card !== shown.card) {
    setShown({ open, card })
    if (open && shown.open) {
      // A new copy while open: only worth a word if its content changed.
      setChangedElsewhere(contentOf(card) !== contentOf(openedWith))
    } else if (open) {
      setOpenedWith(card)
      setChangedElsewhere(false)
      setCreatedCard(null)
      setBaselineStale(false)
      setMadeIds([])
      setCandidates(null)
      setCandidatesFailed(false)
      setName(card?.name ?? '')
      setDescription(card?.description ?? '')
      setStartAt(card?.start_at ? dayjs(card.start_at) : null)
      setDueAt(card?.due_at ? dayjs(card.due_at) : null)
      setEndAt(card?.end_at ? dayjs(card.end_at) : null)
      setSelectedLabels(card?.labels ?? [])
      setMembers(card?.members ?? [])
      setAssignees(card?.assignees ?? [])
      const loadedChecklists = checklistData(card?.checklists ?? [])
      setChecklists(loadedChecklists)
      setInitialChecklists(loadedChecklists)
      setError(null)
    }
  }

  function handleAddChecklist() {
    setEditingChecklist(null)
    setChecklistDialogOpen(true)
  }

  function handleEditChecklist(checklist: ChecklistData) {
    setEditingChecklist(checklist)
    setChecklistDialogOpen(true)
  }

  function handleChecklistSaved(checklist: ChecklistData) {
    setChecklists((prev) => {
      const exists = prev.some((c) => c.id === checklist.id)
      return exists ? prev.map((c) => c.id === checklist.id ? checklist : c) : [...prev, checklist]
    })
  }

  function handleRemoveChecklist(checklistId: string) {
    setChecklists((prev) => prev.filter((c) => c.id !== checklistId))
  }

  function handleToggleChecklistItem(checklistId: string, itemId: string) {
    setChecklists((prev) => prev.map((c) => c.id !== checklistId ? c : {
      ...c,
      items: c.items.map((i) => i.id === itemId ? { ...i, is_done: !i.is_done } : i),
    }))
  }

  const checklistSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleChecklistDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setChecklists((prev) => {
      const oldIndex = prev.findIndex((c) => c.id === active.id)
      const newIndex = prev.findIndex((c) => c.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  useEffect(() => {
    if (!open) return
    // An answer for an earlier opening is dropped.
    let cancelled = false
    apiFetch(`/api/v1/boards/${boardId}/members`)
      .then((r) => r.ok ? r.json() as Promise<PersonSummary[]> : Promise.reject(new Error()))
      .then((people) => { if (!cancelled) setCandidates(people) })
      .catch(() => { if (!cancelled) setCandidatesFailed(true) })
    return () => { cancelled = true }
  }, [open, boardId])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('board.cardNameRequired'))
      return
    }
    // Saving would drop such a date without a word: the field never hands
    // it over.
    if (incompleteDates.start) {
      setError(t('board.startDateIncomplete'))
      return
    }
    if (incompleteDates.due) {
      setError(t('board.dueDateIncomplete'))
      return
    }
    if (incompleteDates.end) {
      setError(t('board.endDateIncomplete'))
      return
    }
    if (startAt && endAt && startAt.isAfter(endAt)) {
      setError(t('board.dateOrderError'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      await saveCard(trimmedName)
    } finally {
      setSaving(false)
    }
  }

  async function saveCard(trimmedName: string) {
    const cardsUrl = `/api/v1/boards/${boardId}/lists/${listId}/cards`
    // After a save that stopped partway, compare against what the server
    // has now, or a second Save would make some checklists twice.
    let baseline = initialChecklists
    if (baselineStale && editing) {
      const current = await loadChecklists(`${cardsUrl}/${editing.id}/checklists`)
      if (!current) {
        setError(t('common.saveError'))
        return
      }
      baseline = checklistData(current)
    }

    let result: CardRead
    try {
      const r = await apiFetch(editing ? `${cardsUrl}/${editing.id}` : cardsUrl, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
          start_at: startAt ? startAt.toISOString() : null,
          due_at: dueAt ? dueAt.toISOString() : null,
          end_at: endAt ? endAt.toISOString() : null,
          label_ids: selectedLabels.map((l) => l.id),
          member_ids: members.map((p) => p.id),
          assignee_ids: assignees.map((p) => p.id),
        }),
      })
      if (!r.ok) throw new Error()
      result = await r.json()
    } catch {
      setError(t('common.saveError'))
      return
    }

    // A new card inherits its list's own color (the viewer's per-user
    // choice) so it doesn't stick out — the backend's create_card stores
    // it, so cards made elsewhere (the MCP server) get it too; this is only
    // the color to show it with right away.
    const appliedColor = !editing && listColor ? listColor : null
    // The caller hears about the card as soon as it exists, saved in full or
    // not: a new card shows up on the board, an edited one shows its saved
    // fields.
    const report = (saved: CardRead) => {
      if (editing) onUpdated?.(saved)
      else onCreated?.(saved, appliedColor)
    }

    const checklistsUrl = `${cardsUrl}/${result.id}/checklists`
    const ids: ChecklistIds = { known: new Set([...idsIn(initialChecklists), ...madeIds]), made: new Map() }
    let synced = true
    try {
      await syncChecklists(checklistsUrl, baseline, checklists, ids)
    } catch {
      synced = false
    }
    // The checklists as the server has them now, whatever was saved.
    result.checklists = (await loadChecklists(checklistsUrl)) ?? result.checklists
    report(result)
    if (synced) {
      onClose()
      return
    }
    // The card is saved, some of its checklist changes aren't. The dialog
    // stays open on that card, so a second Save edits it, and the copy of it
    // the board was just handed isn't taken for a change made elsewhere.
    setCreatedCard(card ? null : result)
    setOpenedWith(card ? result : undefined)
    // The backend makes whoever creates a card one of its members, whatever
    // was sent: shown here, the second Save keeps them, instead of sending
    // the members without them and so taking them off.
    if (!card) setMembers(result.members)
    // What this try made goes by the server's id from now on, so a second
    // Save finds it on the server instead of making it again.
    const idOf = (id: string) => ids.made.get(id) ?? id
    setChecklists((prev) => prev.map((c) => ({ ...c, id: idOf(c.id), items: c.items.map((i) => ({ ...i, id: idOf(i.id) })) })))
    setMadeIds((prev) => [...prev, ...ids.made.values()])
    setBaselineStale(true)
    setError(t('board.checklistsNotSaved'))
  }

  const dayjsLocale = dayjsLocaleFor(numberLocale)

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {isEdit ? t('board.editCard') : t('board.createCard')}
      </DialogTitle>
      <DialogContent>
        {changedElsewhere && <Alert severity="warning" sx={{ mb: 2 }}>{t('board.cardChangedElsewhere')}</Alert>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          label={t('board.cardName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 255 } }}
          fullWidth
          required
          autoFocus
          sx={{ mt: 1 }}
        />
        <TextField
          slotProps={{ htmlInput: { maxLength: 20000 } }}
          label={t('board.cardDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={2}
          sx={{ mt: 1.5 }}
        />

        <Divider sx={{ mt: 2, mb: 1 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <LabelIcon fontSize="small" color="action" />
          <Typography variant="overline" color="text.secondary">
            {t('board.labels')}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          {selectedLabels.map((label) => (
            <Chip
              key={label.id}
              label={label.name}
              onClick={() => setLabelPickerOpen(true)}
              sx={{
                bgcolor: label.color,
                color: contrastColor(label.color),
                fontWeight: 700,
                fontSize: '0.9rem',
                height: 32,
                cursor: 'pointer',
              }}
            />
          ))}
          <IconButton
            size="small"
            onClick={() => setLabelPickerOpen(true)}
            aria-label={t('board.manageCardLabels')}
          >
            <Add fontSize="small" />
          </IconButton>
        </Box>

        <Divider sx={{ mt: 2, mb: 1 }} />

        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {t('board.dates')}
        </Typography>

        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocale}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            <CardDateField
              label={t('board.startDate')}
              removeLabel={t('board.removeStartDate')}
              value={startAt}
              onChange={setStartAt}
              onIncompleteChange={(start) => setIncompleteDates((prev) => ({ ...prev, start }))}
            />
            <CardDateField
              label={t('board.dueDate')}
              removeLabel={t('board.removeDueDate')}
              value={dueAt}
              onChange={setDueAt}
              onIncompleteChange={(due) => setIncompleteDates((prev) => ({ ...prev, due }))}
            />
            <CardDateField
              label={t('board.endDate')}
              removeLabel={t('board.removeEndDate')}
              value={endAt}
              onChange={setEndAt}
              onIncompleteChange={(end) => setIncompleteDates((prev) => ({ ...prev, end }))}
            />
          </Box>
        </LocalizationProvider>

        <Divider sx={{ mt: 2, mb: 1 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <PeopleIcon fontSize="small" color="action" />
          <Typography variant="overline" color="text.secondary">
            {t('board.people')}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('board.creator')}
            </Typography>
            {creator ? (
              <PersonAvatar person={creator} />
            ) : (
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: '2px dashed',
                  borderColor: 'divider',
                }}
              />
            )}
          </Box>

          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('board.members')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
              {members.map((person) => (
                <PersonAvatar
                  key={person.id}
                  person={person}
                  onClick={() => setMemberPickerOpen(true)}
                  actionLabel={t('board.changeMembersOf', { name: person.display_name })}
                />
              ))}
              <IconButton
                size="small"
                onClick={() => setMemberPickerOpen(true)}
                aria-label={t('board.manageMembers')}
              >
                <Add fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('board.assignees')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
              {assignees.map((person) => (
                <PersonAvatar
                  key={person.id}
                  person={person}
                  onClick={() => setAssigneePickerOpen(true)}
                  actionLabel={t('board.changeAssigneesOf', { name: person.display_name })}
                />
              ))}
              <IconButton
                size="small"
                onClick={() => setAssigneePickerOpen(true)}
                aria-label={t('board.manageAssignees')}
              >
                <Add fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Box>

        <Divider sx={{ mt: 2, mb: 1 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ChecklistIcon fontSize="small" color="action" />
            <Typography variant="overline" color="text.secondary">
              {t('board.checklists')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={handleAddChecklist} aria-label={t('board.addChecklist')}>
            <Add fontSize="small" />
          </IconButton>
        </Box>

        {checklists.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('board.noChecklists')}
          </Typography>
        )}

        <DndContext sensors={checklistSensors} collisionDetection={closestCenter} onDragEnd={handleChecklistDragEnd}>
          <SortableContext items={checklists.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <Stack spacing={1.5}>
              {checklists.map((checklist) => (
                <SortableChecklistRow
                  key={checklist.id}
                  checklist={checklist}
                  onEdit={() => handleEditChecklist(checklist)}
                  onRemove={() => handleRemoveChecklist(checklist.id)}
                  onCopy={() => setCopyingChecklist(checklist)}
                  onToggleItem={(itemId) => handleToggleChecklistItem(checklist.id, itemId)}
                  onExtractItem={card && onCopied ? setExtractingItem : undefined}
                  // Named after the checklist (or item), as every checklist
                  // has the same buttons.
                  editLabel={t('board.editChecklistNamed', { name: checklist.name })}
                  menuLabel={t('board.checklistMenuNamed', { name: checklist.name })}
                  copyLabel={t('board.copyChecklist')}
                  removeLabel={t('board.deleteChecklist')}
                  dragLabel={t('board.moveChecklistNamed', { name: checklist.name })}
                  extractLabel={t('board.extractToCard')}
                  extractItemLabel={(item) => t('board.extractItemNamed', { text: item.text })}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving}>
          {t('common.save')}
        </Button>
      </DialogActions>

      <CardLabelPickerDialog
        open={labelPickerOpen}
        onClose={() => setLabelPickerOpen(false)}
        boardId={boardId}
        selectedIds={selectedLabels.map((l) => l.id)}
        onSave={setSelectedLabels}
      />

      <SelectUserDialog
        open={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title={t('board.selectMembers')}
        candidates={candidates}
        loadFailed={candidatesFailed}
        selectedIds={members.map((p) => p.id)}
        onSave={setMembers}
      />

      <SelectUserDialog
        open={assigneePickerOpen}
        onClose={() => setAssigneePickerOpen(false)}
        title={t('board.selectAssignees')}
        candidates={candidates}
        loadFailed={candidatesFailed}
        selectedIds={assignees.map((p) => p.id)}
        onSave={setAssignees}
      />

      <ChecklistDialog
        open={checklistDialogOpen}
        onClose={() => setChecklistDialogOpen(false)}
        checklist={editingChecklist}
        onSave={handleChecklistSaved}
      />

      <CopyChecklistDialog
        open={copyingChecklist !== null}
        onClose={() => setCopyingChecklist(null)}
        boardId={boardId}
        listId={listId}
        cardId={editing?.id}
        checklist={copyingChecklist}
        onCopied={onChecklistCopied}
      />

      {card && onCopied && (
        <CopyCardDialog
          open={extractingItem !== null}
          onClose={() => setExtractingItem(null)}
          boardId={boardId}
          listId={listId}
          cardId={card.id}
          // Prefix the source card's title so the extracted card keeps the
          // context of where the checklist item came from.
          cardName={extractingItem ? `${name} - ${extractingItem.text}` : ''}
          title={t('board.extractToCard')}
          // The new card takes the source card's labels, dates, people and
          // color, but starts empty otherwise — see cards.py's copy_card.
          includeDescription={false}
          includeChecklists={false}
          onCopied={onCopied}
        />
      )}
    </Dialog>
  )
}
