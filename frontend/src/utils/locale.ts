import 'dayjs/locale/en-gb'
import 'dayjs/locale/ca'

// Supported date/time display locales.
// code       → stored in backend number_locale
// intlCode   → used with Intl.DateTimeFormat
// dayjsLocale → used to load the matching dayjs locale pack
export const DATE_LOCALES = [
  { code: 'en', intlCode: 'en-US', dayjsLocale: 'en', label: 'English (US)' },
  { code: 'en_GB', intlCode: 'en-GB', dayjsLocale: 'en-gb', label: 'English (UK / Europe)' },
  { code: 'ca_ES', intlCode: 'ca-ES', dayjsLocale: 'ca', label: 'Català' },
] as const

export type DateLocaleCode = (typeof DATE_LOCALES)[number]['code']
export type DateFormat = 'numeric' | 'textual'

export function intlCodeFor(numberLocale: string): string {
  return DATE_LOCALES.find((l) => l.code === numberLocale)?.intlCode ?? 'en-US'
}

export function dayjsLocaleFor(numberLocale: string): string {
  return DATE_LOCALES.find((l) => l.code === numberLocale)?.dayjsLocale ?? 'en'
}

export function formatDateTime(date: Date | string, intlCode: string, dateFormat: DateFormat): string {
  const options: Intl.DateTimeFormatOptions = dateFormat === 'textual'
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  return new Intl.DateTimeFormat(intlCode, options).format(new Date(date))
}
