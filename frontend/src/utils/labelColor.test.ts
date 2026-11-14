import { describe, expect, it } from 'vitest'
import { contrastColor } from './labelColor'

// Label colours come from the palette and are always #RRGGBB: the backend
// refuses any other form.
describe('contrastColor', () => {
  it('gives black text on light colours', () => {
    for (const color of ['#FFFFFF', '#FFEB3B', '#BBDEFB', '#FF9800']) {
      expect(contrastColor(color), color).toBe('#000000')
    }
  })

  it('gives white text on dark colours', () => {
    for (const color of ['#000000', '#0D47A1', '#B71C1C', '#4A148C']) {
      expect(contrastColor(color), color).toBe('#ffffff')
    }
  })

  it('reads upper- and lowercase hex alike', () => {
    expect(contrastColor('#ffeb3b')).toBe('#000000')
    expect(contrastColor('#0d47a1')).toBe('#ffffff')
  })
})
