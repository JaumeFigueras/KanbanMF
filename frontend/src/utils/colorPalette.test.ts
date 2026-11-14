import { describe, expect, it } from 'vitest'
import { PALETTE_COLUMNS } from './colorPalette'

// Relative luminance (WCAG), from 0 for black to 1 for white.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('PALETTE_COLUMNS', () => {
  it('has 10 columns of 7 shades, each written as #RRGGBB', () => {
    expect(PALETTE_COLUMNS).toHaveLength(10)
    for (const column of PALETTE_COLUMNS) {
      expect(column.shades, column.name).toHaveLength(7)
      for (const shade of column.shades) expect(shade, column.name).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('never repeats a colour or a column name', () => {
    const shades = PALETTE_COLUMNS.flatMap((c) => c.shades)
    const names = PALETTE_COLUMNS.map((c) => c.name)
    expect(new Set(shades).size).toBe(shades.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('goes from light to dark down each column, and gray carries on where white stops', () => {
    for (const column of PALETTE_COLUMNS) {
      const levels = column.shades.map(luminance)
      const notDarker = levels.slice(1).filter((level, i) => level >= levels[i])
      expect(notDarker, column.name).toEqual([])
    }
    const white = PALETTE_COLUMNS.find((c) => c.name === 'white')!
    const gray = PALETTE_COLUMNS.find((c) => c.name === 'gray')!
    expect(luminance(gray.shades[0])).toBeLessThan(luminance(white.shades[6]))
  })
})
