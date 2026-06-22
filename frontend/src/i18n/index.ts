import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import ca from './locales/ca'

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ca', label: 'Català' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ca: { translation: ca },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
