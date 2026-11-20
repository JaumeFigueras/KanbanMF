import { describe, expect, it } from 'vitest'
import { fullOrder, isServerOrder } from './checklistOrder'

describe('isServerOrder', () => {
  it('is true when nothing moved', () => {
    expect(isServerOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true)
    expect(isServerOrder([], [])).toBe(true)
  })

  it('is true when some were removed and the rest kept their order', () => {
    expect(isServerOrder(['a', 'b', 'c'], ['a', 'c'])).toBe(true)
  })

  it('is true when new ones come after the rest, as the server puts them', () => {
    expect(isServerOrder(['a', 'b'], ['a', 'b', 'x', 'y'])).toBe(true)
    expect(isServerOrder([], ['x', 'y'])).toBe(true)
    expect(isServerOrder(['a', 'b'], ['b', 'x'])).toBe(true)
  })

  it('ignores what the server has that the dialog never showed', () => {
    expect(isServerOrder(['a', 'other', 'b'], ['a', 'b'])).toBe(true)
  })

  it('is false when two were swapped', () => {
    expect(isServerOrder(['a', 'b', 'c'], ['b', 'a', 'c'])).toBe(false)
  })

  it('is false when a new one comes before one the server had', () => {
    expect(isServerOrder(['a', 'b'], ['a', 'x', 'b'])).toBe(false)
    expect(isServerOrder(['a'], ['x', 'a'])).toBe(false)
  })
})

describe('fullOrder', () => {
  it("is the dialog's order when the server has the same ones", () => {
    expect(fullOrder(['b', 'a', 'c'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it("puts what the server has that the dialog never showed after the rest, in the server's order", () => {
    expect(fullOrder(['b', 'a'], ['a', 'copy', 'b', 'added'])).toEqual(['b', 'a', 'copy', 'added'])
  })

  it("leaves out what the server doesn't have", () => {
    expect(fullOrder(['b', 'gone', 'a'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  it('is empty when there is nothing on either side', () => {
    expect(fullOrder([], [])).toEqual([])
  })
})
