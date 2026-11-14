import { describe, expect, it } from 'vitest'
import { luminance, prefersDarkText } from './contrast'

describe('luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(luminance([0, 0, 0])).toBe(0)
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 10)
  })

  it('weighs green most and blue least', () => {
    expect(luminance([255, 0, 0])).toBeCloseTo(0.2126, 10)
    expect(luminance([0, 255, 0])).toBeCloseTo(0.7152, 10)
    expect(luminance([0, 0, 255])).toBeCloseTo(0.0722, 10)
  })

  it('follows the sRGB curve, which is a straight line near black', () => {
    // Mid gray is far darker than half.
    expect(luminance([128, 128, 128])).toBeCloseTo(0.2159, 3)
    expect(luminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 10)
  })
})

describe('prefersDarkText', () => {
  it('prefers dark text on light colours and white on dark ones', () => {
    expect(prefersDarkText([255, 255, 255])).toBe(true)
    expect(prefersDarkText([255, 235, 59])).toBe(true)
    expect(prefersDarkText([0, 0, 0])).toBe(false)
    expect(prefersDarkText([127, 0, 0])).toBe(false)
  })

  it('switches to dark text between the grays #757575 and #767676', () => {
    // Both contrasts are about 4.6:1 there, at a luminance of about 0.18.
    expect(prefersDarkText([0x75, 0x75, 0x75])).toBe(false)
    expect(prefersDarkText([0x76, 0x76, 0x76])).toBe(true)
  })
})
