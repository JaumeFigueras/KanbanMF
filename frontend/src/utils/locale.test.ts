import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'
import {
  DATE_LOCALES,
  dayjsLocaleFor,
  formatDateTime,
  getBrowserTimezone,
  intlCodeFor,
  TIMEZONES,
} from './locale'

// Intl's exact output (separators, the space before "PM") varies between
// ICU versions, so these tests check the parts that matter rather than
// whole strings. The tests run in Europe/Madrid (vite.config.ts).
const WINTER = '2026-11-14T13:05:00Z' // Saturday, 14:05 in Madrid

describe('intlCodeFor and dayjsLocaleFor', () => {
  it('give the codes of each supported locale', () => {
    expect(DATE_LOCALES.map((l) => [l.code, intlCodeFor(l.code), dayjsLocaleFor(l.code)])).toEqual([
      ['en', 'en-US', 'en'],
      ['en_GB', 'en-GB', 'en-gb'],
      ['ca_ES', 'ca-ES', 'ca'],
    ])
  })

  it('fall back to US English for an unknown code', () => {
    expect(intlCodeFor('fr_FR')).toBe('en-US')
    expect(dayjsLocaleFor('')).toBe('en')
  })
})

it('has every dayjs locale it lists loaded', () => {
  // dayjs.Ls holds the locales imported so far; an unloaded one would
  // silently fall back to English.
  const missing = DATE_LOCALES.map((l) => l.dayjsLocale).filter((name) => !(name in dayjs.Ls))
  expect(missing).toEqual([])
})

describe('formatDateTime', () => {
  it('puts the month first and uses AM/PM in US English', () => {
    const text = formatDateTime(WINTER, 'en-US', 'numeric')
    expect(text).toMatch(/^11\/14\/2026\b/)
    expect(text).toMatch(/\b02:05\sPM$/)
  })

  it('puts the day first and uses 24 hours in British English and Catalan', () => {
    for (const intlCode of ['en-GB', 'ca-ES']) {
      const text = formatDateTime(WINTER, intlCode, 'numeric')
      expect(text, intlCode).toMatch(/^14\/11\/2026\b/)
      expect(text, intlCode).toMatch(/\b14:05$/)
    }
  })

  it('writes the weekday and the month in the language when textual', () => {
    expect(formatDateTime(WINTER, 'en-US', 'textual')).toMatch(/Saturday.*November/)
    expect(formatDateTime(WINTER, 'ca-ES', 'textual')).toMatch(/dissabte.*novembre/)
  })

  it('shows the time in the browser time zone, from a Date or an ISO string', () => {
    expect(formatDateTime('2026-11-14T09:30:00Z', 'en-GB', 'numeric')).toMatch(/\b10:30$/)
    expect(formatDateTime(new Date('2026-07-01T09:30:00Z'), 'en-GB', 'numeric')).toMatch(/\b11:30$/)
  })
})

describe('time zones', () => {
  it('lists the IANA zones, and gives the browser one', () => {
    expect(TIMEZONES).toEqual(expect.arrayContaining(['Europe/Madrid', 'America/New_York']))
    expect(getBrowserTimezone()).toBe('Europe/Madrid')
  })

  it('lists none on a browser without Intl.supportedValuesOf', async () => {
    const intl = Intl as { supportedValuesOf?: unknown }
    const original = intl.supportedValuesOf
    intl.supportedValuesOf = undefined
    try {
      // TIMEZONES is computed when the module loads, so load a fresh copy.
      vi.resetModules()
      const fresh = await import('./locale')
      expect(fresh.TIMEZONES).toEqual([])
    } finally {
      intl.supportedValuesOf = original
    }
  })
})
