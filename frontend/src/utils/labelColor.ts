import { prefersDarkText, type RGB } from './contrast'

// Black or white text for a label's #RRGGBB background, whichever contrasts
// more (the same rule as the due-date chips).
export function contrastColor(hex: string): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB
  return prefersDarkText(rgb) ? '#000000' : '#ffffff'
}
