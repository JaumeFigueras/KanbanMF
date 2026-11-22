import { createTheme, type ThemeOptions } from '@mui/material/styles'
import { caES as materialCaES } from '@mui/material/locale'
import { caES as pickersCaES, type PickersLocaleText } from '@mui/x-date-pickers/locales'
import type { TimeView } from '@mui/x-date-pickers/models'
import type {} from '@mui/x-date-pickers/AdapterDayjs'
import type {} from '@mui/x-date-pickers/themeAugmentation'
import i18n from '../i18n'

const lightOptions: ThemeOptions = {
  palette: {
    mode: 'light',
  },
}

const darkOptions: ThemeOptions = {
  palette: {
    mode: 'dark',
    primary: {
      main: '#9C27B0',        // purple[500]
      light: '#CE93D8',       // purple[200]
      dark: '#7B1FA2',        // purple[700]
      contrastText: '#ffffff',
    },
    divider: 'rgba(156, 39, 176, 0.5)',
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
}

// MUI's own translations, for what KanbanMF doesn't give it itself (the date
// pickers' week numbers and range texts, the empty field's sections...).
// English needs none: it is MUI's own language.
const MUI_LOCALES: Partial<Record<string, object[]>> = {
  ca: [materialCaES, pickersCaES],
}

// The texts MUI shows in KanbanMF, from the app's translations. MUI's Catalan
// gets some wrong ("Obert", the adjective, for a drop-down's Open button;
// "Tancat" for an alert's Close; the date and time tabs swapped) and puts the
// rest in the infinitive, where KanbanMF uses the imperative.
function muiTexts(language: string): ThemeOptions {
  const t = i18n.getFixedT(language)
  const selectView: Record<TimeView | 'meridiem', string> = {
    hours: t('mui.selectHours'),
    minutes: t('mui.selectMinutes'),
    seconds: t('mui.selectSeconds'),
    meridiem: t('mui.selectMeridiem'),
  }
  const localeText: Partial<PickersLocaleText> = {
    dateTimePickerToolbarTitle: t('mui.dateTimePickerTitle'),
    cancelButtonLabel: t('common.cancel'),
    nextStepButtonLabel: t('mui.next'),
    okButtonLabel: t('mui.ok'),
    dateTableLabel: t('mui.dateTab'),
    timeTableLabel: t('mui.timeTab'),
    previousMonth: t('mui.previousMonth'),
    nextMonth: t('mui.nextMonth'),
    calendarViewSwitchingButtonAriaLabel: (view) =>
      view === 'year' ? t('mui.yearViewOpen') : t('mui.calendarViewOpen'),
    openPreviousView: t('mui.openPreviousView'),
    openNextView: t('mui.openNextView'),
    selectViewText: (view) => selectView[view],
    clockLabelText: (view, time) =>
      `${selectView[view]}. ${time ? t('mui.selectedTime', { time }) : t('mui.noTimeSelected')}`,
    hoursClockNumberText: (hours) => t('mui.hoursNumber', { count: Number(hours) }),
    minutesClockNumberText: (minutes) => t('mui.minutesNumber', { count: Number(minutes) }),
    fieldYearPlaceholder: ({ digitAmount }) => t('mui.yearLetter').repeat(digitAmount),
  }
  return {
    components: {
      MuiAutocomplete: {
        defaultProps: {
          openText: t('common.open'),
          closeText: t('common.close'),
          clearText: t('mui.clear'),
          noOptionsText: t('mui.noOptions'),
          loadingText: t('mui.loading'),
        },
      },
      MuiAlert: { defaultProps: { closeText: t('common.close') } },
      MuiLocalizationProvider: { defaultProps: { localeText } },
      // The calendar's weekdays in two letters, not MUI's one: one letter
      // repeats (T, S in English), and in Catalan every day is a D.
      MuiDateCalendar: { defaultProps: { dayOfWeekFormatter: (day) => day.format('dd') } },
    },
  }
}

// The app's theme: light or dark, with MUI's texts in the given language.
export function appTheme(dark: boolean, language: string) {
  return createTheme(dark ? darkOptions : lightOptions, ...(MUI_LOCALES[language] ?? []), muiTexts(language))
}
