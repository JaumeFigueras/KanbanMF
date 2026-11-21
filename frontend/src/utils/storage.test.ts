import { describe, expect, it } from 'vitest'
import { blockSiteData } from '../test/blockSiteData'
import { readStored, removeStored, writeStored } from './storage'

describe('storage', () => {
  it('reads, writes and removes, in localStorage and in sessionStorage', () => {
    writeStored('local', 'theme', 'dark')
    writeStored('session', 'kanbanmf.return_to', '/boards/board-1')

    expect(localStorage.getItem('theme')).toBe('dark')
    expect(sessionStorage.getItem('kanbanmf.return_to')).toBe('/boards/board-1')
    expect(readStored('local', 'theme')).toBe('dark')
    expect(readStored('session', 'kanbanmf.return_to')).toBe('/boards/board-1')
    expect(readStored('local', 'kanbanmf.return_to')).toBeNull()
    removeStored('local', 'theme')
    removeStored('session', 'kanbanmf.return_to')
    expect(readStored('local', 'theme')).toBeNull()
    expect(readStored('session', 'kanbanmf.return_to')).toBeNull()
  })

  it('acts as if nothing were stored when the browser blocks site data', () => {
    blockSiteData()

    expect(() => window.localStorage).toThrow('Access is denied')
    expect(readStored('local', 'theme')).toBeNull()
    expect(readStored('session', 'kanbanmf.return_to')).toBeNull()
    expect(() => writeStored('local', 'theme', 'dark')).not.toThrow()
    expect(() => writeStored('session', 'kanbanmf.return_to', '/boards')).not.toThrow()
    expect(() => removeStored('local', 'theme')).not.toThrow()
    expect(() => removeStored('session', 'kanbanmf.return_to')).not.toThrow()
  })

  it('forgets a write the browser refuses, such as with storage full', () => {
    const full = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = full
    try {
      expect(() => writeStored('local', 'theme', 'dark')).not.toThrow()
    } finally {
      Storage.prototype.setItem = setItem
    }
    expect(readStored('local', 'theme')).toBeNull()
  })
})
