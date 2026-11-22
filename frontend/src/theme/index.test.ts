import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import 'dayjs/locale/ca'
import { enUS, type PickersLocaleText } from '@mui/x-date-pickers/locales'
import { appTheme } from '.'

function autocomplete(language: string) {
  return appTheme(false, language).components?.MuiAutocomplete?.defaultProps
}

function pickers(language: string) {
  return appTheme(false, language).components?.MuiLocalizationProvider?.defaultProps?.localeText as PickersLocaleText
}

const MUI_ENGLISH = enUS.components.MuiLocalizationProvider.defaultProps.localeText as PickersLocaleText

describe('appTheme', () => {
  it('is light or dark, with the dark purple', () => {
    expect(appTheme(false, 'en').palette.mode).toBe('light')
    expect(appTheme(true, 'en').palette.mode).toBe('dark')
    expect(appTheme(true, 'ca').palette.primary.main).toBe('#9C27B0')
  })

  describe('in English', () => {
    it("gives the drop-downs and the alerts MUI's own English", () => {
      expect(autocomplete('en')).toEqual({
        openText: 'Open', closeText: 'Close', clearText: 'Clear', noOptionsText: 'No options', loadingText: 'Loading…',
      })
      expect(appTheme(false, 'en').components?.MuiAlert?.defaultProps).toEqual({ closeText: 'Close' })
    })

    it("gives the date pickers MUI's own English", () => {
      const texts = pickers('en')
      const plain = [
        'dateTimePickerToolbarTitle', 'cancelButtonLabel', 'nextStepButtonLabel', 'okButtonLabel', 'dateTableLabel',
        'timeTableLabel', 'previousMonth', 'nextMonth', 'openPreviousView', 'openNextView',
      ] as const
      for (const key of plain) expect([key, texts[key]]).toEqual([key, MUI_ENGLISH[key]])
      for (const view of ['year', 'day'] as const) {
        expect(texts.calendarViewSwitchingButtonAriaLabel(view)).toBe(MUI_ENGLISH.calendarViewSwitchingButtonAriaLabel(view))
      }
      for (const view of ['hours', 'minutes', 'seconds', 'meridiem'] as const) {
        expect(texts.selectViewText(view)).toBe(MUI_ENGLISH.selectViewText(view))
      }
      expect(texts.clockLabelText('hours', null)).toBe(MUI_ENGLISH.clockLabelText('hours', null))
      expect(texts.clockLabelText('minutes', '17:05')).toBe(MUI_ENGLISH.clockLabelText('minutes', '17:05'))
      expect(texts.fieldYearPlaceholder({ digitAmount: 4, format: 'YYYY' })).toBe('YYYY')
    })

    it('says "1 hour", where MUI says "1 hours"', () => {
      expect(pickers('en').hoursClockNumberText('1')).toBe('1 hour')
      expect(pickers('en').hoursClockNumberText('05')).toBe('5 hours')
      expect(pickers('en').minutesClockNumberText('1')).toBe('1 minute')
      expect(pickers('en').minutesClockNumberText('00')).toBe('0 minutes')
    })

    it("adds none of MUI's translations", () => {
      expect(appTheme(false, 'en').components?.MuiPagination).toBeUndefined()
      expect(pickers('en').empty).toBeUndefined()
    })
  })

  describe('in Catalan', () => {
    it("gives the drop-downs and the alerts KanbanMF's Catalan, not MUI's", () => {
      expect(autocomplete('ca')).toEqual({
        openText: 'Obre', closeText: 'Tanca', clearText: 'Esborra', noOptionsText: 'Cap opció', loadingText: 'S\'està carregant…',
      })
      expect(appTheme(false, 'ca').components?.MuiAlert?.defaultProps).toEqual({ closeText: 'Tanca' })
    })

    it("gives the date pickers KanbanMF's Catalan", () => {
      const texts = pickers('ca')
      expect(texts).toMatchObject({
        dateTimePickerToolbarTitle: 'Tria la data i l\'hora',
        cancelButtonLabel: 'Cancel·la',
        nextStepButtonLabel: 'Següent',
        okButtonLabel: 'D\'acord',
        dateTableLabel: 'tria la data',
        timeTableLabel: 'tria l\'hora',
        previousMonth: 'Mes anterior',
        nextMonth: 'Mes següent',
        openPreviousView: 'Obre la vista anterior',
        openNextView: 'Obre la vista següent',
      })
      expect(texts.calendarViewSwitchingButtonAriaLabel('year')).toBe('la vista d\'anys està oberta, canvia a la vista de calendari')
      expect(texts.calendarViewSwitchingButtonAriaLabel('day')).toBe('la vista de calendari està oberta, canvia a la vista d\'anys')
      expect(['hours', 'minutes', 'seconds', 'meridiem'].map((v) => texts.selectViewText(v as 'hours')))
        .toEqual(['Tria les hores', 'Tria els minuts', 'Tria els segons', 'Tria AM o PM'])
      expect(texts.clockLabelText('hours', null)).toBe('Tria les hores. No s\'ha triat cap hora')
      expect(texts.clockLabelText('minutes', '17:05')).toBe('Tria els minuts. L\'hora triada és 17:05')
      expect(['0', '1', '13'].map((h) => texts.hoursClockNumberText(h))).toEqual(['0 hores', '1 hora', '13 hores'])
      expect(['1', '05'].map((m) => texts.minutesClockNumberText(m))).toEqual(['1 minut', '5 minuts'])
      expect(texts.fieldYearPlaceholder({ digitAmount: 4, format: 'YYYY' })).toBe('AAAA')
      expect(texts.fieldYearPlaceholder({ digitAmount: 2, format: 'YY' })).toBe('AA')
    })

    it("keeps MUI's Catalan for the rest", () => {
      expect(pickers('ca').empty).toBe('Buit')
      expect(pickers('ca').calendarWeekNumberHeaderLabel).toBe('Número de la setmana')
      expect(appTheme(false, 'ca').components?.MuiPagination?.defaultProps?.['aria-label']).toBe('Navegació entre pàgines')
    })
  })

  it("writes the calendar's weekdays in two letters, in the calendar's language", () => {
    const formatter = appTheme(false, 'en').components?.MuiDateCalendar?.defaultProps?.dayOfWeekFormatter
    const week = (locale: string) =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => formatter?.(dayjs('2026-11-22').locale(locale).add(d, 'day')))
    expect(week('en')).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
    expect(week('ca')).toEqual(['Dg', 'Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds'])
  })
})
