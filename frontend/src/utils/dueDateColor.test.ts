import dayjs from 'dayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dueDateStyle } from './dueDateColor'

// The tests run in Europe/Madrid (vite.config.ts), so the offsets below are
// that zone's: +01:00 in winter, +02:00 in summer. setup.ts puts the real
// clock back after each test.
const NOW = '2026-11-14T12:00:00+01:00'

const DARK_TEXT = 'rgba(0, 0, 0, 0.87)'
const WHITE_TEXT = '#fff'

function styleFor(dueAt: string) {
  return dueDateStyle(dayjs(dueAt))
}

describe('dueDateStyle', () => {
  beforeEach(() => {
    vi.setSystemTime(NOW)
  })

  it('is dark red with white text once the due day has passed', () => {
    expect(styleFor('2026-11-13T18:00:00+01:00')).toEqual({ background: 'rgb(127, 0, 0)', color: WHITE_TEXT })
  })

  it('is red with dark text on the due day, even after the due time', () => {
    expect(styleFor('2026-11-14T08:00:00+01:00')).toEqual({ background: 'rgb(244, 67, 54)', color: DARK_TEXT })
  })

  it('is orange with dark text the day before', () => {
    expect(styleFor('2026-11-15T10:00:00+01:00')).toEqual({ background: 'rgb(255, 152, 0)', color: DARK_TEXT })
  })

  it('is mostly yellow 4 days before', () => {
    expect(styleFor('2026-11-18T10:00:00+01:00')).toEqual({ background: 'rgb(255, 214, 44)', color: DARK_TEXT })
  })

  it('is yellow with dark text 5 days before', () => {
    expect(styleFor('2026-11-19T10:00:00+01:00')).toEqual({ background: 'rgb(255, 235, 59)', color: DARK_TEXT })
  })

  it('is between yellow and green 7 days before', () => {
    expect(styleFor('2026-11-21T10:00:00+01:00')).toEqual({ background: 'rgb(183, 211, 67)', color: DARK_TEXT })
  })

  it('is green with dark text 10 days before or earlier', () => {
    const green = { background: 'rgb(76, 175, 80)', color: DARK_TEXT }
    expect(styleFor('2026-11-24T10:00:00+01:00')).toEqual(green)
    expect(styleFor('2026-12-14T10:00:00+01:00')).toEqual(green)
  })

  it('counts calendar days, not periods of 24 hours', () => {
    vi.setSystemTime('2026-11-14T23:00:00+01:00')
    // Two hours away, but tomorrow: orange, not the red of the due day.
    expect(styleFor('2026-11-15T01:00:00+01:00').background).toBe('rgb(255, 152, 0)')
  })

  it('still counts 2 days across the spring clock change', () => {
    // 29 March 2026 has 23 hours, so only 47 hours separate the two
    // midnights: dividing milliseconds by 24 hours would give 1 day.
    vi.setSystemTime('2026-03-28T12:00:00+01:00')
    expect(styleFor('2026-03-30T12:00:00+02:00').background).toBe('rgb(255, 173, 15)')
  })
})
