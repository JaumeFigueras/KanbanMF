import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { passwordProblem } from './password'

// The same rule as the backend (backend/src/schemas/auth.py): at least 8
// characters, at most 72 bytes of UTF-8.
describe('passwordProblem', () => {
  it('refuses fewer than 8 characters', () => {
    expect(passwordProblem('')).toBe('signUp.passwordTooShort')
    expect(passwordProblem('abcdefg')).toBe('signUp.passwordTooShort')
  })

  it('accepts 8 characters', () => {
    expect(passwordProblem('abcdefgh')).toBeNull()
  })

  it('accepts 72 plain characters and refuses 73', () => {
    expect(passwordProblem('a'.repeat(72))).toBeNull()
    expect(passwordProblem('a'.repeat(73))).toBe('signUp.passwordTooLong')
  })

  it('counts an accented letter as two bytes', () => {
    expect(passwordProblem('à'.repeat(36))).toBeNull()
    expect(passwordProblem('à'.repeat(37))).toBe('signUp.passwordTooLong')
  })

  it('answers with translation keys that exist', () => {
    const keys = [passwordProblem('short'), passwordProblem('a'.repeat(73))]
    expect(keys.filter((key) => !key || !i18n.exists(key))).toEqual([])
  })

  it('counts an emoji as one character, as the backend does', () => {
    // Python's len() counts code points; JavaScript's .length counts UTF-16
    // units, two for an emoji.
    expect(passwordProblem('😀😀😀😀')).toBe('signUp.passwordTooShort')
    expect(passwordProblem('abcdef😀')).toBe('signUp.passwordTooShort')
    expect(passwordProblem('abcdefg😀')).toBeNull()
  })
})
