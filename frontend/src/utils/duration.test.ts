import { describe, expect, it } from 'vitest'
import { decimalHours, durationSeconds, formatDuration, formatRunning } from './duration'

const NOW = Date.parse('2026-11-14T10:30:15Z')

describe('durationSeconds', () => {
  it('counts the whole seconds between start and end, rounded down', () => {
    expect(durationSeconds('2026-11-14T09:00:00Z', '2026-11-14T09:01:30.900Z', NOW)).toBe(90)
  })

  it('measures an entry with no end up to now', () => {
    expect(durationSeconds('2026-11-14T09:00:00Z', null, NOW)).toBe(5415)
  })

  it('gives 0 when the end is before the start', () => {
    expect(durationSeconds('2026-11-14T10:00:00Z', '2026-11-14T09:00:00Z', NOW)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('shows hours and padded minutes, leaving the seconds out', () => {
    expect(formatDuration(7531)).toBe('2:05')
    expect(formatDuration(3599)).toBe('0:59')
    expect(formatDuration(59)).toBe('0:00')
    expect(formatDuration(0)).toBe('0:00')
  })

  it('keeps counting hours past a day', () => {
    expect(formatDuration(26 * 3600)).toBe('26:00')
    expect(formatDuration(100 * 3600 + 60)).toBe('100:01')
  })
})

describe('formatRunning', () => {
  it('adds padded seconds', () => {
    expect(formatRunning(7531)).toBe('2:05:31')
    expect(formatRunning(3600)).toBe('1:00:00')
    expect(formatRunning(9)).toBe('0:00:09')
  })
})

describe('decimalHours', () => {
  it('gives the hours with two decimals', () => {
    expect(decimalHours(5400)).toBe('1.50')
    expect(decimalHours(1200)).toBe('0.33')
    expect(decimalHours(2400)).toBe('0.67')
    expect(decimalHours(0)).toBe('0.00')
  })
})
