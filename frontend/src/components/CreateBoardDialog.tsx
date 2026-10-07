import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { BoardColorsRead, BoardListOrderRead, BoardListRead, BoardRead } from '../types/board'
import { apiFetch } from '../api/client'
import { DEFAULT_COLOR } from './ChangeBoardColorDialog'

interface PreviewList {
  id: string
  name: string
  color: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (board: BoardRead) => void
  // 'template' creates a template instead: different wording, and no star
  // checkbox since templates are never starred.
  mode?: 'board' | 'template'
  // Templates the new board can start from, in the Templates section's order.
  // Board mode only; with none, the picker isn't shown.
  templates?: BoardRead[]
  // Tells the user's own templates from shared ones in the picker.
  currentUserId?: string | null
}

export default function CreateBoardDialog({
  open,
  onClose,
  onCreated,
  mode = 'board',
  templates = [],
  currentUserId = null,
}: Props) {
  const { t } = useTranslation()
  const isTemplate = mode === 'template'
  const [name, setName] = useState('')
  const [starred, setStarred] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [preview, setPreview] = useState<PreviewList[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Picking templates quickly fires overlapping preview loads; only the
  // latest one may land, so a slow earlier response can't overwrite it.
  const previewRequestRef = useRef(0)

  useEffect(() => {
    if (open) {
      setName('')
      setStarred(false)
      setTemplateId('')
      setPreview(null)
      setError(null)
    }
  }, [open])

  // The preview shows the lists exactly as the new board will get them: the
  // template's live lists in its stored order, in *this* user's own colors
  // (which are the colors the new board inherits — see the backend's
  // _copy_template_into).
  async function handleTemplateChange(id: string) {
    setTemplateId(id)
    setPreview(null)
    const request = ++previewRequestRef.current
    if (!id) return
    try {
      const [listsRes, orderRes, colorsRes] = await Promise.all([
        apiFetch(`/api/v1/boards/${id}/lists`),
        apiFetch(`/api/v1/boards/${id}/lists/order`),
        apiFetch(`/api/v1/boards/${id}/colors`),
      ])
      if (!listsRes.ok) throw new Error()
      const lists: BoardListRead[] = await listsRes.json()
      const order: string[] = orderRes.ok ? (await orderRes.json() as BoardListOrderRead).list_ids : []
      const colors: BoardColorsRead | null = colorsRes.ok ? await colorsRes.json() : null
      const position = new Map(order.map((listId, i) => [listId, i]))
      const sorted = [...lists].sort(
        (a, b) => (position.get(a.id) ?? order.length) - (position.get(b.id) ?? order.length),
      )
      if (request !== previewRequestRef.current) return
      setPreview(sorted.map(l => ({ id: l.id, name: l.name, color: colors?.lists[l.id] ?? DEFAULT_COLOR })))
    } catch {
      if (request === previewRequestRef.current) setPreview([])
    }
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t(isTemplate ? 'boards.templateNameRequired' : 'boards.boardNameRequired'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const r = await apiFetch('/api/v1/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isTemplate
            ? { name: trimmed, is_template: true }
            : { name: trimmed, is_starred: starred, template_id: templateId || null },
        ),
      })
      if (!r.ok) throw new Error()
      const board: BoardRead = await r.json()
      onCreated(board)
      onClose()
    } catch {
      setError(t('common.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t(isTemplate ? 'boards.createNewTemplate' : 'boards.createNewBoard')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t(isTemplate ? 'boards.templateName' : 'boards.boardName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 255 } }}
            fullWidth
            required
            autoFocus
          />
          {!isTemplate && templates.length > 0 && (
            <TextField
              select
              label={t('boards.useTemplate')}
              value={templateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              // '' is the "None" option; without these the empty value renders
              // as a blank field instead of showing "None (empty board)".
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              fullWidth
            >
              <MenuItem value="">
                <em>{t('boards.noTemplate')}</em>
              </MenuItem>
              {templates.map(template => (
                <MenuItem key={template.id} value={template.id}>
                  {template.owner_id === currentUserId
                    ? template.name
                    : <>
                        {template.name}
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                          ({t('boards.templateOwnedBy', { name: template.owner_display_name })})
                        </Typography>
                      </>}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!isTemplate && templateId && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('boards.templatePreview')}
              </Typography>
              {preview === null
                ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}><CircularProgress size={20} /></Box>
                : preview.length === 0
                  ? <Typography variant="body2" color="text.secondary">{t('boards.templateHasNoLists')}</Typography>
                  : <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                      {preview.map(list => (
                        <Box
                          key={list.id}
                          sx={{
                            px: 1,
                            py: 0.25,
                            borderRadius: 1,
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            bgcolor: `${list.color}26`,
                            border: `1px solid ${list.color}`,
                          }}
                        >
                          {list.name}
                        </Box>
                      ))}
                    </Box>}
            </Box>
          )}
          {!isTemplate && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={starred}
                  onChange={(e) => setStarred(e.target.checked)}
                />
              }
              label={t('boards.starred')}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="error" disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} color="success" variant="contained" disabled={saving}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
