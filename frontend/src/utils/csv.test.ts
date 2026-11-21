import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('quotes every cell, so commas and line breaks stay inside it', () => {
    expect(csvCell('Website redesign')).toBe('"Website redesign"')
    expect(csvCell('Design, review')).toBe('"Design, review"')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('')).toBe('""')
  })

  it('doubles the quotes inside a cell', () => {
    expect(csvCell('The "new" homepage')).toBe('"The ""new"" homepage"')
  })

  // A card on a shared board can be named by anyone on it.
  it.each([
    ['=', '=HYPERLINK("https://example.com/x","Click")', '"\'=HYPERLINK(""https://example.com/x"",""Click"")"'],
    ['+', '+cmd|\' /C calc\'!A0', '"\'+cmd|\' /C calc\'!A0"'],
    ['-', '-2+3', '"\'-2+3"'],
    ['@', '@SUM(1,1)', '"\'@SUM(1,1)"'],
    ['a tab', '\t=1+1', '"\'\t=1+1"'],
    ['a carriage return', '\r=1+1', '"\'\r=1+1"'],
  ])('keeps a cell that starts with %s as text, behind an apostrophe', (_start, value, cell) => {
    expect(csvCell(value)).toBe(cell)
  })

  it('leaves those characters alone further in', () => {
    expect(csvCell('Fix a+b = c @home - now')).toBe('"Fix a+b = c @home - now"')
    expect(csvCell(' =1+1')).toBe('" =1+1"')
  })
})

describe('toCsv', () => {
  it('puts one row on each CRLF line, behind a byte-order mark', () => {
    expect(toCsv([['Board', 'Card'], ['Català', '=1+1']])).toBe('\uFEFF"Board","Card"\r\n"Català","\'=1+1"')
  })

  it('is just the byte-order mark with no rows', () => {
    expect(toCsv([])).toBe('\uFEFF')
  })
})
