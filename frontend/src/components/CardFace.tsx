import type { ReactNode } from 'react'
import {
  AvatarGroup,
  Box,
  CardActions,
  CardContent,
  Chip,
  Typography,
} from '@mui/material'
import { CalendarToday, CheckCircle, Checklist as ChecklistIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { CardRead } from '../types/board'
import { formatDateTime, intlCodeFor, type DateFormat } from '../utils/locale'
import { dueDateStyle } from '../utils/dueDateColor'
import { contrastColor } from '../utils/labelColor'
import PersonAvatar from './PersonAvatar'

interface Props {
  card: CardRead
  numberLocale: string
  dateFormat: DateFormat
  // Rendered at the end of the header row, next to the card name — the
  // drag handle + menu button for the interactive board, nothing for a
  // read-only surface like the archive view.
  headerActions?: ReactNode
}

// The card's visual content shared by CardItem (interactive, on the board)
// and the read-only archive view — both surfaces show the exact same face,
// only the interactivity wrapped around it differs.
export default function CardFace({ card, numberLocale, dateFormat, headerActions }: Props) {
  const { t } = useTranslation()

  const isCompleted = Boolean(card.end_at)
  const hasDates = Boolean(card.due_at || card.end_at)
  const hasLabels = card.labels.length > 0
  const hasChecklists = card.checklists.length > 0
  const intlCode = intlCodeFor(numberLocale)
  // A defined end date means the task is done — the due date no longer needs an urgency color.
  const dueStyle = card.due_at && !isCompleted ? dueDateStyle(dayjs(card.due_at)) : null

  return (
    <>
      <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            ...((hasLabels || hasDates || hasChecklists) && {
              borderBottom: 1,
              borderColor: 'divider',
              pb: 1,
            }),
          }}
        >
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word', fontSize: '0.9625rem' }}>
            {card.name}
          </Typography>

          {isCompleted && (
            // Sized to match IconButton's own box (22px icon + 5px padding on
            // each side) so it lines up with the buttons next to it.
            <Box sx={{ width: 33, height: 33, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle sx={{ fontSize: 22, color: 'success.main' }} />
            </Box>
          )}

          {headerActions}
        </Box>

        {(hasLabels || hasDates || hasChecklists) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
            {hasLabels && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {card.labels.map((label) => (
                  <Chip
                    key={label.id}
                    label={label.name}
                    size="small"
                    sx={{ bgcolor: label.color, color: contrastColor(label.color), fontWeight: 700, fontSize: '0.89375rem' }}
                  />
                ))}
              </Box>
            )}
            {card.due_at && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  width: 'fit-content',
                  ...(dueStyle && { bgcolor: dueStyle.background, color: dueStyle.color }),
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.825rem' }}>
                  {t('board.dueLabel')}
                </Typography>
                <CalendarToday sx={{ fontSize: 15 }} />
                <Typography variant="caption" sx={{ fontSize: '0.825rem' }}>
                  {formatDateTime(card.due_at, intlCode, dateFormat)}
                </Typography>
              </Box>
            )}
            {card.end_at && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  width: 'fit-content',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.825rem' }}>
                  {t('board.endLabel')}
                </Typography>
                <CalendarToday sx={{ fontSize: 15 }} />
                <Typography variant="caption" sx={{ fontSize: '0.825rem' }}>
                  {formatDateTime(card.end_at, intlCode, dateFormat)}
                </Typography>
              </Box>
            )}
            {hasChecklists && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {card.checklists.map((checklist) => {
                  const total = checklist.items.length
                  const done = checklist.items.filter((item) => item.is_done).length
                  const percent = total > 0 ? Math.round((done / total) * 100) : 0
                  return (
                    <Box
                      key={checklist.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
                    >
                      <ChecklistIcon sx={{ fontSize: 15 }} color="action" />
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '0.825rem',
                        }}
                      >
                        {checklist.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ flexShrink: 0, fontSize: '0.825rem' }}
                      >
                        {done}/{total} ({percent}%)
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            )}
          </Box>
        )}
      </CardContent>

      {card.assignees.length > 0 && (
        <CardActions sx={{ px: 1, py: 0.5, justifyContent: 'flex-end' }}>
          <AvatarGroup max={5}>
            {card.assignees.map((person) => (
              <PersonAvatar key={person.id} person={person} size={35} />
            ))}
          </AvatarGroup>
        </CardActions>
      )}
    </>
  )
}
