import { useState } from 'react'
import { Box, TextField } from '@mui/material'
import { PALETTE_COLUMNS } from '../utils/colorPalette'

const SHADE_COUNT = PALETTE_COLUMNS[0].shades.length
const SWATCH_SIZE = 36

// Row-major order (row 0 = lightest shade of every column, ...) so the flat
// list lines up with a CSS grid using PALETTE_COLUMNS.length columns and
// the browser's default row-first auto-placement.
const GRID_SWATCHES = Array.from({ length: SHADE_COUNT }, (_, row) =>
  PALETTE_COLUMNS.map((col) => ({ name: col.name, hex: col.shades[row] })),
).flat()

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

interface Props {
  value: string
  onChange: (color: string) => void
}

// Shared by the board/list/card color dialogs. Renders our own fixed swatch
// table rather than delegating to the browser's native <input type="color">
// — that native picker looks completely different from browser to browser
// (a flat swatch grid in some, a full HSV wheel in others), which is what
// caused the picker to look inconsistent. The hex field next to the preview
// lets a user type any color the table doesn't cover.
export default function ColorPicker({ value, onChange }: Props) {
  const [hexInput, setHexInput] = useState(value)

  function handleHexChange(raw: string) {
    const normalized = `#${raw.replace(/^#+/, '')}`
    setHexInput(normalized)
    if (HEX_RE.test(normalized)) onChange(normalized)
  }

  function handleSwatchClick(hex: string) {
    setHexInput(hex)
    onChange(hex)
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: HEX_RE.test(hexInput) ? hexInput : value,
          }}
        />
        <TextField
          size="small"
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          error={!HEX_RE.test(hexInput)}
          slotProps={{ htmlInput: { maxLength: 7, style: { textTransform: 'uppercase' } } }}
          sx={{ width: 120 }}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${PALETTE_COLUMNS.length}, ${SWATCH_SIZE}px)`,
          gap: 0.5,
        }}
      >
        {GRID_SWATCHES.map(({ name, hex }, i) => (
          <Box
            key={`${name}-${i}`}
            component="button"
            type="button"
            onClick={() => handleSwatchClick(hex)}
            aria-label={hex}
            title={`${name} ${hex}`}
            sx={{
              width: SWATCH_SIZE,
              height: SWATCH_SIZE,
              borderRadius: 0.5,
              bgcolor: hex,
              cursor: 'pointer',
              p: 0,
              border: '2px solid',
              borderColor: value.toLowerCase() === hex.toLowerCase() ? 'text.primary' : 'divider',
              boxShadow: value.toLowerCase() === hex.toLowerCase() ? 2 : 'none',
            }}
          />
        ))}
      </Box>
    </Box>
  )
}
