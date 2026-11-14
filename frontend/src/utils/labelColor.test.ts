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
    // #1976D2 is just on the dark side: white 4.60:1, black 4.56:1.
    for (const color of ['#000000', '#0D47A1', '#B71C1C', '#4A148C', '#1976D2']) {
      expect(contrastColor(color), color).toBe('#ffffff')
    }
  })

  it('gives black text on the mid tones, where white reads worse', () => {
    for (const color of ['#2196F3', '#4CAF50', '#388E3C', '#EF6C00', '#E65100', '#F44336', '#BA68C8', '#E91E63']) {
      expect(contrastColor(color), color).toBe('#000000')
    }
  })

  it('reads upper- and lowercase hex alike', () => {
    expect(contrastColor('#ffeb3b')).toBe('#000000')
    expect(contrastColor('#0d47a1')).toBe('#ffffff')
  })
})
