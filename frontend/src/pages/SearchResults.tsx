import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowBack, ExpandMore, Search } from '@mui/icons-material'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import MainAppBar from '../components/MainAppBar'
import CardListColumn from '../components/CardListColumn'
import { DEFAULT_COLOR } from '../components/ChangeBoardColorDialog'
import { apiFetch } from '../api/client'
import { subscribeToNotifications } from '../api/ws'
import type { BoardRead, SearchResults as SearchResultsData } from '../types/board'
import type { DateFormat } from '../utils/locale'
import { LIGHT_TINT_WEIGHT, tintColor } from '../utils/colorTint'
import { MIN_SEARCH_LENGTH, scopeFromParams, searchApiParams, searchPlaceholderKey } from '../utils/search'

// How long typing has to pause before the search runs.
const SEARCH_DEBOUNCE_MS = 300

// The search results, laid out like the overdue tasks page: one section per
// board, its lists side by side holding the matching cards. Everything comes
// from the address (see utils/search), and typing in the box here updates
// the address in place, so Back leaves the page rather than stepping through
// every keystroke.
export default function SearchResults() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').trim()
  const { boardId, archived } = scopeFromParams(searchParams)
  const scope = { boardId, archived }

  const [numberLocale, setNumberLocale] = useState('en')
  const [dateFormat, setDateFormat] = useState<DateFormat>('numeric')
  const [text, setText] = useState(q)
  // The results with the query they answer, so a slow answer to an older
  // query is never shown for the current one.
  const [results, setResults] = useState<{ key: string; data: SearchResultsData } | null>(null)
  const [boardName, setBoardName] = useState('')
  // Board sections start open; this holds the ones the user folded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Follow the address when it changes from outside (Back, a new search
  // from the top bar). Done while rendering, so the box never shows a stale
  // value for a frame.
  const [shownQ, setShownQ] = useState(q)
  if (q !== shownQ) {
    setShownQ(q)
    if (q !== text.trim()) setText(q)
  }

  // Typing updates the address once it pauses.
  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === q) return
    const handle = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('q', trimmed)
        return next
      }, { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [text, q, setSearchParams])

  const key = searchApiParams(q, { boardId, archived })
  useEffect(() => {
    if (q.length < MIN_SEARCH_LENGTH) return
    const fetchResults = () => {
      apiFetch(`/api/v1/search?${key}`)
        .then((r) => (r.ok ? (r.json() as Promise<SearchResultsData>) : null))
        .then((data) => { if (data) setResults({ key, data }) })
        .catch(() => {})
    }
    fetchResults()
    // Any change anywhere can add or remove a match, so this page just
    // searches again on every notification, as the overdue page does.
    return subscribeToNotifications(() => fetchResults())
  }, [key, q])

  // The board's name, for the heading and the back button.
  useEffect(() => {
    if (!boardId) return
    apiFetch(`/api/v1/boards/${boardId}`)
      .then((r) => (r.ok ? (r.json() as Promise<BoardRead>) : null))
      .then((board) => { if (board) setBoardName(board.name) })
      .catch(() => {})
  }, [boardId])

  const data = q.length >= MIN_SEARCH_LENGTH && results?.key === key ? results.data : null

  let scopeText: string
  let backLabel: string
  let backTo: string
  if (boardId && archived) {
    scopeText = t('search.scopeBoardArchive', { name: boardName })
    backLabel = t('search.backToArchive')
    backTo = `/boards/${boardId}?archive=1`
  } else if (boardId) {
    scopeText = t('search.scopeBoard', { name: boardName })
    backLabel = t('search.backToBoard', { name: boardName })
    backTo = `/boards/${boardId}`
  } else {
    scopeText = t(archived ? 'search.scopeArchivedBoards' : 'search.scopeAll')
    backLabel = t('overdue.backToBoards')
    backTo = archived ? '/boards?archived=1' : '/boards'
  }

  // Where a result leads. Live cards open on their board, with their dialog
  // up; archived ones can't be opened, so they lead to where they're kept.
  function openCard(cardBoardId: string, cardId: string) {
    if (!archived) navigate(`/boards/${cardBoardId}?card=${cardId}`)
    else if (boardId) navigate(`/boards/${cardBoardId}?archive=1&highlight=${cardId}`)
    else navigate('/boards?archived=1')
  }

  function openBoard(matchedBoardId: string) {
    navigate(archived ? '/boards?archived=1' : `/boards/${matchedBoardId}`)
  }

  const cardCount = data?.boards.reduce((sum, b) => sum + b.match_count, 0) ?? 0

  return (
    <>
      <MainAppBar
        onLocaleChanged={(num, fmt) => {
          setNumberLocale(num)
          setDateFormat(fmt)
        }}
      />

      <Toolbar />{/* spacer for the fixed AppBar */}
      <Box sx={{ mt: 4, px: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Button size="small" startIcon={<ArrowBack />} onClick={() => navigate(backTo)}>
            {backLabel}
          </Button>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {t('search.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {scopeText}
          </Typography>
        </Box>

        <TextField
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(searchPlaceholderKey(scope))}
          autoFocus
          size="small"
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': t(searchPlaceholderKey(scope)), enterKeyHint: 'search' },
          }}
          sx={{ maxWidth: 520, mb: 3 }}
        />

        {q.length < MIN_SEARCH_LENGTH ? (
          <Typography variant="body2" color="text.secondary">
            {t('search.tooShort', { count: MIN_SEARCH_LENGTH })}
          </Typography>
        ) : data && (
          <>
            {data.matching_boards.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('search.boards')}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {data.matching_boards.map((board) => (
                    <Chip
                      key={board.board_id}
                      label={board.board_name}
                      onClick={() => openBoard(board.board_id)}
                      variant="outlined"
                      sx={{
                        borderColor: board.color ?? undefined,
                        bgcolor: (theme) => board.color
                          ? tintColor(board.color, theme.palette.background.default, LIGHT_TINT_WEIGHT)
                          : undefined,
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {data.boards.length === 0 && data.matching_boards.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('search.noResults', { q })}
              </Typography>
            )}

            {data.truncated && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('search.truncated', { count: cardCount })}
              </Alert>
            )}

            {data.boards.length > 0 && data.matching_boards.length > 0 && (
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('search.cards')}</Typography>
            )}

            {data.boards.map((board) => (
              <Accordion
                key={board.board_id}
                expanded={!collapsed[board.board_id]}
                onChange={(_, isExpanded) =>
                  setCollapsed((prev) => ({ ...prev, [board.board_id]: !isExpanded }))
                }
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {board.board_name} ({board.match_count})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails
                  sx={{
                    // Same tint and side-by-side columns as the overdue page.
                    bgcolor: (theme) =>
                      tintColor(board.color ?? DEFAULT_COLOR, theme.palette.background.default, LIGHT_TINT_WEIGHT),
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 2,
                    overflowX: 'auto',
                  }}
                >
                  {board.lists.map((list) => (
                    <CardListColumn
                      key={list.list_id}
                      list={list}
                      numberLocale={numberLocale}
                      dateFormat={dateFormat}
                      cardColors={board.card_colors}
                      matchedIn={board.matched_in}
                      onCardClick={(card) => openCard(board.board_id, card.id)}
                    />
                  ))}
                </AccordionDetails>
              </Accordion>
            ))}
          </>
        )}
      </Box>
    </>
  )
}
