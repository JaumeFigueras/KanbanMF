import { describe, expect, it } from 'vitest'
import { blockSiteData } from '../test/blockSiteData'
import { clearReturnTo, peekReturnTo, rememberReturnTo } from './returnTo'

// setup.ts empties sessionStorage after each test.
describe('returnTo', () => {
  it('remembers a path with its query and gives it back', () => {
    rememberReturnTo('/oauth/consent?request=abc')
    expect(peekReturnTo()).toBe('/oauth/consent?request=abc')
  })

  it('keeps the path when it is peeked at', () => {
    rememberReturnTo('/boards/b1')
    peekReturnTo()
    expect(peekReturnTo()).toBe('/boards/b1')
  })

  it('forgets the path once cleared', () => {
    rememberReturnTo('/boards/b1')
    clearReturnTo()
    expect(peekReturnTo()).toBeNull()
  })

  it('replaces an older path with a newer one', () => {
    rememberReturnTo('/boards/b1')
    rememberReturnTo('/time-tracker')
    expect(peekReturnTo()).toBe('/time-tracker')
  })

  it('refuses other sites and anything that is not a path of this app', () => {
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', 'boards/b1', '']) {
      rememberReturnTo(path)
      expect(peekReturnTo(), path).toBeNull()
    }
  })

  it('never remembers the sign-in page, and keeps the path it had', () => {
    rememberReturnTo('/boards/b1')
    rememberReturnTo('/signin')
    expect(peekReturnTo()).toBe('/boards/b1')
  })

  it('ignores a stored value that is not a path of this app', () => {
    // Written straight into the browser's storage, past rememberReturnTo.
    sessionStorage.setItem('kanbanmf.return_to', '//evil.example')
    expect(peekReturnTo()).toBeNull()
  })

  it('remembers nothing, without failing, when the browser blocks site data (6I)', () => {
    blockSiteData()
    expect(() => rememberReturnTo('/boards/board-1')).not.toThrow()
    expect(peekReturnTo()).toBeNull()
    expect(() => clearReturnTo()).not.toThrow()
  })
})
