import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import {
  scopeFromParams,
  searchApiParams,
  searchPlaceholderKey,
  searchUrl,
  type SearchScope,
} from './search'

// The four scopes: every live board, one board, one board's archive, and
// the archived boards.
const SCOPES: SearchScope[] = [{}, { boardId: 'b1' }, { boardId: 'b1', archived: true }, { archived: true }]

describe('searchUrl', () => {
  it('writes each scope into the /search address', () => {
    expect(SCOPES.map((scope) => searchUrl('logo', scope))).toEqual([
      '/search?q=logo',
      '/search?q=logo&board=b1',
      '/search?q=logo&board=b1&archived=1',
      '/search?q=logo&archived=1',
    ])
  })

  it('keeps a query with spaces, accents and & intact', () => {
    const url = searchUrl('café & bar', { boardId: 'b1' })
    expect(url).toBe('/search?q=caf%C3%A9+%26+bar&board=b1')
    expect(new URLSearchParams(url.split('?')[1]).get('q')).toBe('café & bar')
  })
})

describe('scopeFromParams', () => {
  it('reads back the scope searchUrl wrote', () => {
    const readBack = SCOPES.map((scope) => scopeFromParams(new URLSearchParams(searchUrl('logo', scope).split('?')[1])))
    expect(readBack).toEqual([
      { boardId: undefined, archived: false },
      { boardId: 'b1', archived: false },
      { boardId: 'b1', archived: true },
      { boardId: undefined, archived: true },
    ])
  })

  it('takes archived only when its value is 1', () => {
    expect(scopeFromParams(new URLSearchParams('q=logo&archived=true')).archived).toBe(false)
    expect(scopeFromParams(new URLSearchParams('q=logo&archived=0')).archived).toBe(false)
    expect(scopeFromParams(new URLSearchParams('q=logo&archived=1')).archived).toBe(true)
  })
})

describe('searchPlaceholderKey', () => {
  it('names a different, existing placeholder for each scope', () => {
    const keys = SCOPES.map(searchPlaceholderKey)
    expect(keys).toEqual(['search.allBoards', 'search.thisBoard', 'search.boardArchive', 'search.archivedBoards'])
    expect(keys.filter((key) => !i18n.exists(key))).toEqual([])
  })
})

describe('searchApiParams', () => {
  it('uses the backend parameter names', () => {
    expect(SCOPES.map((scope) => searchApiParams('logo', scope))).toEqual([
      'q=logo',
      'q=logo&board_id=b1',
      'q=logo&board_id=b1&archived=true',
      'q=logo&archived=true',
    ])
  })
})
