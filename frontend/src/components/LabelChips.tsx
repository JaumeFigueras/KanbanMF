import { Box, Chip } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { contrastColor } from '../utils/labelColor'
import { capLabels, sortLabels } from '../utils/labelList'

interface ChipLabel {
  name: string
  color: string
}

interface Props {
  labels: readonly ChipLabel[]
  // With a max the labels are sorted alphabetically and only the first `max`
  // are drawn, followed by a "+N" chip for the rest. Without one, every label
  // is drawn in the order given.
  max?: number
  sx?: SxProps<Theme>
}

// A wrapping row of small chips, each in its label's color with readable
// text. Draws nothing when there are no labels.
export default function LabelChips({ labels, max, sx }: Props) {
  if (labels.length === 0) return null
  const { shown, hidden } = max === undefined
    ? { shown: labels, hidden: 0 }
    : capLabels(sortLabels(labels), max)

  return (
    <Box sx={[{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {shown.map((label, i) => (
        <Chip
          key={`${label.name}-${label.color}-${i}`}
          label={label.name}
          size="small"
          sx={{ bgcolor: label.color, color: contrastColor(label.color) }}
        />
      ))}
      {hidden > 0 && <Chip label={`+${hidden}`} size="small" variant="outlined" />}
    </Box>
  )
}
