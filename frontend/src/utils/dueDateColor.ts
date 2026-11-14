import dayjs, { type Dayjs } from 'dayjs'

type RGB = [number, number, number]

const GREEN: RGB = [76, 175, 80]
const YELLOW: RGB = [255, 235, 59]
const ORANGE: RGB = [255, 152, 0]
const RED: RGB = [244, 67, 54]
const DARK_RED: RGB = [127, 0, 0]

function mix(a: RGB, b: RGB, t: number): RGB {
  const clamped = Math.min(1, Math.max(0, t))
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * clamped)) as RGB
}

// Relative luminance (WCAG), from 0 for black to 1 for white.
function luminance([r, g, b]: RGB): number {
  const [rr, gg, bb] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
}

export interface DueDateStyle {
  background: string
  color: string
}

// Green while there's a comfortable margin, fading through yellow/orange as the
// due date approaches, red on the day itself, dark red once it's passed.
export function dueDateStyle(dueAt: Dayjs): DueDateStyle {
  const daysUntil = dueAt.startOf('day').diff(dayjs().startOf('day'), 'day')

  let rgb: RGB
  if (daysUntil < 0) rgb = DARK_RED
  else if (daysUntil === 0) rgb = RED
  else if (daysUntil < 5) rgb = mix(YELLOW, ORANGE, (5 - daysUntil) / 4)
  else if (daysUntil <= 10) rgb = mix(GREEN, YELLOW, (10 - daysUntil) / 5)
  else rgb = GREEN

  // The text takes whichever of dark and white contrasts more with the
  // background (WCAG contrast ratio, (lighter + 0.05) / (darker + 0.05)).
  // White only wins on dark backgrounds, below a luminance of about 0.18,
  // such as the overdue dark red; on red, orange and green, dark text is far
  // easier to read.
  const background = luminance(rgb)
  const contrastWithWhite = 1.05 / (background + 0.05)
  const contrastWithDark = (background + 0.05) / 0.05
  return {
    background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    color: contrastWithDark >= contrastWithWhite ? 'rgba(0, 0, 0, 0.87)' : '#fff',
  }
}