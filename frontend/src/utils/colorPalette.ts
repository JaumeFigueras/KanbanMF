// Curated, ordered swatch table used by every color picker (board/list/card
// color) — rendering our own fixed grid, instead of the browser's native
// <input type="color">, is what keeps the picker looking identical across
// browsers (the native picker differs wildly between Chrome and Firefox).
//
// One column per hue, 7 shades each ordered light (row 0) to dark (row 6).
// Row 0 intentionally starts at a visibly-tinted shade rather than a
// near-white one, so every column reads as a distinct color even at a
// glance. The white/gray columns split a single light-to-dark neutral ramp
// between them so the two columns read as a continuous scale.
export interface PaletteColumn {
  name: string
  shades: readonly string[]
}

export const PALETTE_COLUMNS: readonly PaletteColumn[] = [
  { name: 'blue', shades: ['#BBDEFB', '#90CAF9', '#64B5F6', '#2196F3', '#1976D2', '#1565C0', '#0D47A1'] },
  { name: 'green', shades: ['#C8E6C9', '#A5D6A7', '#81C784', '#4CAF50', '#388E3C', '#2E7D32', '#1B5E20'] },
  { name: 'yellow', shades: ['#FFF9C4', '#FFF59D', '#FFF176', '#FFEB3B', '#FBC02D', '#F9A825', '#F57F17'] },
  { name: 'orange', shades: ['#FFE0B2', '#FFCC80', '#FFB74D', '#FF9800', '#F57C00', '#EF6C00', '#E65100'] },
  { name: 'red', shades: ['#FFCDD2', '#EF9A9A', '#E57373', '#F44336', '#D32F2F', '#C62828', '#B71C1C'] },
  { name: 'purple', shades: ['#E1BEE7', '#CE93D8', '#BA68C8', '#9C27B0', '#7B1FA2', '#6A1B9A', '#4A148C'] },
  { name: 'brown', shades: ['#D7CCC8', '#BCAAA4', '#A1887F', '#795548', '#5D4037', '#4E342E', '#3E2723'] },
  { name: 'pink', shades: ['#F8BBD0', '#F48FB1', '#F06292', '#E91E63', '#C2185B', '#AD1457', '#880E4F'] },
  { name: 'white', shades: ['#FFFFFF', '#FAFAFA', '#F5F5F5', '#EEEEEE', '#E0E0E0', '#BDBDBD', '#9E9E9E'] },
  { name: 'gray', shades: ['#757575', '#616161', '#424242', '#303030', '#212121', '#121212', '#000000'] },
] as const
