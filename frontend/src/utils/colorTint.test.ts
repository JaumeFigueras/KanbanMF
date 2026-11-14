import { describe, expect, it } from 'vitest'
import { STRONG_TINT_WEIGHT, tintColor } from './colorTint'

describe('tintColor', () => {
  it('gives the base colour at weight 0', () => {
    // 0x0d also checks that one-digit channels keep their leading zero.
    expect(tintColor('#1976d2', '#0d47a1', 0)).toBe('#0d47a1')
  })

  it('gives the colour itself at weight 1', () => {
    expect(tintColor('#1976d2', '#ffffff', 1)).toBe('#1976d2')
  })

  it('rounds each channel of the blend', () => {
    // 127.5 on every channel.
    expect(tintColor('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('reads a 3-digit base such as #fff as #ffffff', () => {
    // MUI's light theme gives its backgrounds as '#fff'.
    const tint = tintColor('#1976D2', '#fff', STRONG_TINT_WEIGHT)
    expect(tint).toMatch(/^#[0-9a-f]{6}$/)
    expect(tint).toBe(tintColor('#1976D2', '#ffffff', STRONG_TINT_WEIGHT))
  })

  it('takes upper- or lowercase input and answers in lowercase', () => {
    expect(tintColor('#1976D2', '#FFFFFF', 0.5)).toBe('#8cbbe9')
    expect(tintColor('#1976d2', '#ffffff', 0.5)).toBe('#8cbbe9')
  })
})
