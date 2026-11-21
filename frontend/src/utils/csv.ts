// A CSV file's text, made to be opened in a spreadsheet (Excel, LibreOffice,
// Numbers).
//
// Cell values can come from other people: a card's or a board's name, or a
// label, written by anyone on a board shared with you. A spreadsheet runs a
// cell that starts like a formula (=HYPERLINK(…), +cmd|…, @SUM(…)), so such a
// cell gets a leading apostrophe and stays text (CSV injection, OWASP's
// list of starting characters: = + - @ tab and carriage return). A comment
// that starts with "-" then shows its apostrophe, which is the price.
//
// The text starts with a byte-order mark: without one, Excel reads the file
// in the computer's legacy encoding, and "Català" shows as "CatalÃ ".

const FORMULA_START = /^[=+\-@\t\r]/

// One cell: quoted, its quotes doubled, a formula's start made text.
export function csvCell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return `"${text.replace(/"/g, '""')}"`
}

// The whole file: rows on CRLF lines (as RFC 4180 has them), behind a
// byte-order mark.
export function toCsv(rows: string[][]): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
