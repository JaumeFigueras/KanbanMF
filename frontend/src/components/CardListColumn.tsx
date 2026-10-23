import { Box, Card, Paper, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { ListCardsRead, SearchField } from '../types/board'
import type { DateFormat } from '../utils/locale'
import CardFace from './CardFace'
import { DEFAULT_COLOR } from './ChangeBoardColorDialog'
import { STRONG_TINT_WEIGHT, tintColor } from '../utils/colorTint'

interface Props {
  list: ListCardsRead
  numberLocale: string
  dateFormat: DateFormat
  // The viewer's colors for the cards of the board this list belongs to,
  // keyed by card id — same shape the board page passes down.
  cardColors: Record<string, string>
  onCardClick: (card: { id: string; list_id: string }) => void
  // Search results only: which fields of each card matched, keyed by card
  // id, shown under the card since its face only shows the name.
  matchedIn?: Record<string, SearchField[]>
}

// A read-only echo of BoardListColumn for the pages that gather cards from
// many boards (overdue tasks, search results): same 330px column, same tints,
// same card face — but no drag handles, menus or add buttons, since nothing
// here is editable in place. Clicking a card is the column's only
// interaction; the page decides where it leads.
export default function CardListColumn({
  list,
  numberLocale,
  dateFormat,
  cardColors,
  onCardClick,
  matchedIn,
}: Props) {
  const { t } = useTranslation()
  const listColor = list.color ?? DEFAULT_COLOR

  return (
    <Paper
      elevation={2}
      sx={{
        width: 330,
        flexShrink: 0,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: (theme) => tintColor(listColor, theme.palette.background.paper, STRONG_TINT_WEIGHT),
          borderBottom: `1px solid ${listColor}`,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.9625rem' }} noWrap>
          {list.list_name}
        </Typography>
      </Box>

      <Box
        sx={{
          p: 1,
          bgcolor: (theme) => tintColor(listColor, theme.palette.background.paper, STRONG_TINT_WEIGHT),
        }}
      >
        {list.cards.map((card) => {
          const cardColor = cardColors[card.id] ?? DEFAULT_COLOR
          return (
            <Card
              key={card.id}
              variant="outlined"
              onClick={() => onCardClick(card)}
              sx={{
                mb: 1,
                cursor: 'pointer',
                // Opaque (not alpha) so this doesn't blend with the column's
                // own tint behind it — see utils/colorTint.
                bgcolor: (theme) => tintColor(cardColor, theme.palette.background.paper, STRONG_TINT_WEIGHT),
                borderColor: cardColor,
              }}
            >
              <CardFace
                card={card}
                numberLocale={numberLocale}
                dateFormat={dateFormat}
                color={cardColor}
              />
              {matchedIn?.[card.id]?.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pb: 1 }}>
                  {t('search.foundIn', {
                    fields: matchedIn[card.id].map((field) => t(`search.field.${field}`)).join(', '),
                  })}
                </Typography>
              ) : null}
            </Card>
          )
        })}
      </Box>
    </Paper>
  )
}
