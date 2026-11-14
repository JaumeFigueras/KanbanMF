import dayjs, { type Dayjs } from 'dayjs'
import { prefersDarkText, type RGB } from './contrast'

const GREEN: RGB = [76, 175, 80]
const YELLOW: RGB = [255, 235, 59]
const ORANGE: RGB = [255, 152, 0]
const RED: RGB = [244, 67, 54]
const DARK_RED: RGB = [127, 0, 0]

function mix(a: RGB, b: RGB, t: number): RGB {
  const clamped = Math.min(1, Math.max(0, t))
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * clamped)) as RGB
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

  // Only the overdue dark red keeps white text.
  return {
    background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    color: prefersDarkText(rgb) ? 'rgba(0, 0, 0, 0.87)' : '#fff',
  }
}