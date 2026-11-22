import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { CardRead, ChecklistRead } from '../types/board'
import type { DateFormat } from '../utils/locale'
import { makeCard, makeLabel, makePerson } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { appTheme } from '../theme'
import CardFace from './CardFace'

interface FaceOptions {
  numberLocale?: string
  dateFormat?: DateFormat
  color?: string
  headerActions?: ReactNode
}

function renderFace(card: CardRead, { numberLocale = 'en_GB', dateFormat = 'numeric', ...rest }: FaceOptions = {}) {
  return renderWithProviders(<CardFace card={card} numberLocale={numberLocale} dateFormat={dateFormat} {...rest} />)
}

// A checklist with the given items, ticked or not.
function checklist(name: string, ticks: boolean[]): ChecklistRead {
  return {
    id: `checklist-${name}`,
    card_id: 'card-1',
    name,
    position: 0,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    items: ticks.map((is_done, position) => ({
      id: `item-${name}-${position}`,
      checklist_id: `checklist-${name}`,
      text: `Item ${position + 1}`,
      is_done,
      position,
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-15T10:00:00Z',
    })),
  }
}

// The row with the card's name, the tick and the caller's buttons.
const headerRow = () => screen.getByText('Homepage layout').parentElement!
// A date's box: its word ("Due", "End"), icon and the date itself.
const dateBox = (word: string) => screen.getByText(word).parentElement!
// The chip a label's name is drawn in.
const chip = (name: string) => screen.getByText(name).parentElement!

// The tests run in Europe/Madrid (vite.config.ts): +01:00 until 29 March.
const NOW = '2026-03-05T12:00:00+01:00'
const atNow = () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
}

const DARK_TEXT = 'rgba(0, 0, 0, 0.87)'
const WHITE_TEXT = '#fff'

describe('CardFace', () => {
  it("shows the card's name, and nothing below it on a bare card", () => {
    renderFace(makeCard({ name: 'Homepage layout' }))
    expect(headerRow()).toHaveTextContent(/^Homepage layout$/)
    // No separator under the name, and no avatar row.
    expect(headerRow()).not.toHaveStyle({ borderBottomWidth: '1px' })
    expect(headerRow().nextSibling).toBeNull()
    expect(screen.queryByText('Due')).not.toBeInTheDocument()
    expect(screen.queryByText('End')).not.toBeInTheDocument()
  })

  it('says a finished card is done in words, not only with a tick', () => {
    renderFace(makeCard({ end_at: '2026-03-04T12:00:00Z' }))
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument()
  })

  it('shows no tick on a card not finished', () => {
    renderFace(makeCard())
    expect(screen.queryByRole('img', { name: 'Done' })).not.toBeInTheDocument()
  })

  it('puts the buttons it is given at the end of the name row', () => {
    renderFace(makeCard({ end_at: '2026-03-04T12:00:00Z' }), { headerActions: <button type="button">Card menu</button> })
    const row = headerRow()
    expect(within(row).getByRole('button', { name: 'Card menu' })).toBe(row.lastElementChild)
  })

  it('draws each label in its colour, with text that reads on it', () => {
    renderFace(makeCard({
      labels: [makeLabel({ name: 'Urgent', color: '#b71c1c' }), makeLabel({ name: 'Idea', color: '#fff176' })],
    }))
    expect(chip('Urgent')).toHaveStyle({ backgroundColor: '#b71c1c', color: '#ffffff' })
    expect(chip('Idea')).toHaveStyle({ backgroundColor: '#fff176', color: '#000000' })
    // In the card's order.
    expect(chip('Urgent').compareDocumentPosition(chip('Idea'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  describe('the separator under the name', () => {
    it.each([
      ['a label', { labels: [makeLabel({ name: 'Urgent' })] }],
      ['a due date', { due_at: '2026-03-20T10:00:00Z' }],
      ['an end date', { end_at: '2026-03-04T10:00:00Z' }],
      ['a checklist', { checklists: [checklist('Launch', [])] }],
    ])("is drawn in the card's colour above %s alone", (_, fields) => {
      renderFace(makeCard(fields), { color: '#2196F3' })
      expect(headerRow()).toHaveStyle({ borderBottomWidth: '1px', borderBottomColor: '#2196F3' })
    })

    it("is drawn in the theme's divider colour when the card has none (the archive)", () => {
      renderFace(makeCard({ due_at: '2026-03-20T10:00:00Z' }))
      expect(headerRow()).toHaveStyle({ borderBottomWidth: '1px', borderBottomColor: appTheme(false, 'en').palette.divider })
    })
  })

  describe('the due date', () => {
    it.each([
      ['numeric', 'en_GB', /^05\/03\/2026\b.*\b11:00$/],
      ['numeric', 'en', /^03\/05\/2026\b.*\b11:00\sAM$/],
      ['textual', 'en_GB', /^Thursday.*5 March 2026\b.*\b11:00$/],
      // "de 2026" or "del 2026", depending on the ICU version.
      ['textual', 'ca_ES', /^dijous.*5 de març.*2026.*\b11:00$/],
    ] as const)('is written in the chosen format (%s, %s), in the device time zone', (dateFormat, numberLocale, expected) => {
      renderFace(makeCard({ due_at: '2026-03-05T10:00:00Z' }), { dateFormat, numberLocale })
      expect(dateBox('Due')).toHaveTextContent(/^Due/)
      expect(dateBox('Due').lastElementChild).toHaveTextContent(expected)
    })

    it.each([
      ['dark red, with white text, once its day has passed', '2026-03-04T22:00:00Z', 'rgb(127, 0, 0)', WHITE_TEXT],
      ['red on its day, even once its time has passed', '2026-03-05T08:00:00Z', 'rgb(244, 67, 54)', DARK_TEXT],
      ['green while more than 10 days away', '2026-03-20T10:00:00Z', 'rgb(76, 175, 80)', DARK_TEXT],
    ])('is %s', (_, dueAt, background, color) => {
      atNow()
      renderFace(makeCard({ due_at: dueAt }))
      expect(dateBox('Due')).toHaveStyle({ backgroundColor: background, color })
    })

    it('loses its colour once the card is done, however late', () => {
      atNow()
      renderFace(makeCard({ due_at: '2026-03-01T10:00:00Z', end_at: '2026-03-04T10:00:00Z' }))
      expect(dateBox('Due').style.backgroundColor).toBe('')
      expect(getComputedStyle(dateBox('Due')).backgroundColor).not.toBe('rgb(127, 0, 0)')
    })
  })

  it('shows the end date under the due date, with no colour', () => {
    atNow()
    renderFace(makeCard({ due_at: '2026-03-01T10:00:00Z', end_at: '2026-03-04T17:30:00Z' }))
    expect(dateBox('End').lastElementChild).toHaveTextContent(/^04\/03\/2026\b.*\b18:30$/)
    expect(getComputedStyle(dateBox('End')).backgroundColor).not.toBe('rgb(127, 0, 0)')
    expect(dateBox('Due').compareDocumentPosition(dateBox('End'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows no start date', () => {
    renderFace(makeCard({ start_at: '2026-03-01T10:00:00Z' }))
    expect(screen.queryByText(/01\/03\/2026/)).not.toBeInTheDocument()
    expect(headerRow().nextSibling).toBeNull()
  })

  describe('the checklists', () => {
    // A checklist's row: its name, then "done/total (percent)".
    const progress = (name: string) => screen.getByText(name).nextSibling

    it('shows each one with how many items are ticked, and the percentage rounded', () => {
      renderFace(makeCard({
        checklists: [checklist('Launch', [true, true, false]), checklist('Review', [true, false, false])],
      }))
      expect(progress('Launch')).toHaveTextContent(/^2\/3 \(67%\)$/)
      expect(progress('Review')).toHaveTextContent(/^1\/3 \(33%\)$/)
    })

    it('shows an empty one as 0/0 (0%)', () => {
      renderFace(makeCard({ checklists: [checklist('Launch', [])] }))
      expect(progress('Launch')).toHaveTextContent(/^0\/0 \(0%\)$/)
    })

    it('shows a finished one as 100%', () => {
      renderFace(makeCard({ checklists: [checklist('Launch', [true, true])] }))
      expect(progress('Launch')).toHaveTextContent(/^2\/2 \(100%\)$/)
    })
  })

  describe('the people', () => {
    const NAMES = ['Emma Wilson', 'Liam Chen', 'Olivia Brown', 'Noah Garcia', 'Ava Martin', 'Lucas Petit']
    const people = (count: number) => NAMES.slice(0, count).map((display_name) => makePerson({ display_name }))

    // Each avatar is an image named after the person, for screen readers.
    const avatar = (name: string) => screen.getByRole('img', { name })
    const noAvatar = (name: string) => expect(screen.queryByRole('img', { name })).not.toBeInTheDocument()

    it('shows the assignees, by their initials and named, but not the members', () => {
      renderFace(makeCard({ assignees: people(2), members: [makePerson({ display_name: 'Mia Rossi' })] }))
      expect(avatar('Emma Wilson')).toHaveTextContent(/^EW$/)
      expect(avatar('Liam Chen')).toHaveTextContent(/^LC$/)
      noAvatar('Mia Rossi')
    })

    it('names an assignee with a picture too', () => {
      renderFace(makeCard({ assignees: [makePerson({ display_name: 'Emma Wilson', has_avatar: true })] }))
      expect(screen.getAllByRole('img').map((img) => img.getAttribute('aria-label'))).toEqual(['Emma Wilson'])
    })

    it('shows up to five assignees', () => {
      renderFace(makeCard({ assignees: people(5) }))
      for (const name of NAMES.slice(0, 5)) expect(avatar(name)).toBeInTheDocument()
      expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
    })

    it('folds a sixth one and beyond into a count, keeping five places', () => {
      renderFace(makeCard({ assignees: people(6) }))
      for (const name of NAMES.slice(0, 4)) expect(avatar(name)).toBeInTheDocument()
      noAvatar('Ava Martin')
      expect(screen.getByText('+2')).toBeInTheDocument()
    })
  })
})
