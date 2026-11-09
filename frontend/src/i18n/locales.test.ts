import { describe, expect, it } from 'vitest'
import en from './locales/en'
import ca from './locales/ca'

// Every translation as 'section.key' → text, however deeply nested.
function flatten(tree: object, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of flatten(value, path)) out.set(k, v)
    } else {
      out.set(path, value)
    }
  }
  return out
}

// The {{name}} placeholders in a text, sorted and without repeats.
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]))].sort()
}

const LANGUAGES = { en: flatten(en), ca: flatten(ca) }

describe('translations', () => {
  it('have the same keys in English and Catalan', () => {
    const missingInCa = [...LANGUAGES.en.keys()].filter((k) => !LANGUAGES.ca.has(k))
    const missingInEn = [...LANGUAGES.ca.keys()].filter((k) => !LANGUAGES.en.has(k))
    expect({ missingInCa, missingInEn }).toEqual({ missingInCa: [], missingInEn: [] })
  })

  it.each(Object.entries(LANGUAGES))('are all non-empty text in %s', (_lang, texts) => {
    const notText = [...texts].filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)
    expect(notText).toEqual([])
  })

  it('use the same {{placeholders}} in both languages', () => {
    const differ = [...LANGUAGES.en]
      .filter(([key]) => LANGUAGES.ca.has(key))
      .map(([key, text]) => ({
        key,
        en: placeholders(String(text)),
        ca: placeholders(String(LANGUAGES.ca.get(key))),
      }))
      .filter(({ en, ca }) => en.join() !== ca.join())
    expect(differ).toEqual([])
  })
})
