// Dark or white text on a coloured background: the due-date chips and the
// labels both pick it here, so they follow one rule.

export type RGB = [number, number, number]

// Relative luminance (WCAG), from 0 for black to 1 for white.
export function luminance([r, g, b]: RGB): number {
  const [rr, gg, bb] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
}

// Whether dark text contrasts more with the background than white does
// (WCAG contrast ratio, (lighter + 0.05) / (darker + 0.05)). White only wins
// on dark backgrounds, below a luminance of about 0.18; on mid tones such as
// red, orange or green, dark text is far easier to read.
export function prefersDarkText(background: RGB): boolean {
  const level = luminance(background)
  return (level + 0.05) / 0.05 >= 1.05 / (level + 0.05)
}
