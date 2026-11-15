import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { TimeEntryRead } from '../types/timeTracker'
import { fakeCardChoices } from '../test/cardChoices'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeTimeEntry } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import TimeEntryDialog from './TimeEntryDialog'

const ENTRIES = '/api/v1/time-entries'
const ENTRY = '/api/v1/time-entries/:entryId'
const LAST_END = '/api/v1/time-entries/last-end'

// 10:00 to 11:00 in Madrid, the tests' time zone, on 15 January.
const LOGGED = makeTimeEntry({
  id: 'entry-1',
  started_at: '2026-01-15T09:00:00Z',
  ended_at: '2026-01-15T10:00:00Z',
  board_name: 'Website redesign',
  card_name: 'Homepage layout',
  comment: 'Client call',
})
const SAVED = makeTimeEntry({ id: 'entry-1', card_name: 'Saved' })

function renderDialog(entry: TimeEntryRead | null) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, shown: TimeEntryRead | null) => (
    <TimeEntryDialog open={open} onClose={onClose} entry={shown} numberLocale="en_GB" onSaved={onSaved} />
  )
  const result = renderWithProviders(dialog(true, entry))
  // Closes the dialog and opens it again, as the time tracker page does,
  // with the entry as it is by then.
  let shown = entry
  function reopen(next: TimeEntryRead | null) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onSaved, reopen }
}

// A date and time field, as its sections read: "15/01/2026 10:00".
function shownTime(name: 'Start' | 'End') {
  const [day, month, year, hours, minutes] = within(screen.getByRole('group', { name }))
    .getAllByRole('spinbutton').map((s) => s.textContent)
  return `${day}/${month}/${year} ${hours}:${minutes}`
}

// Types into one section of a date and time field, as a keyboard user does.
async function typeTime(user: ReturnType<typeof renderDialog>['user'], name: 'Start' | 'End', section: 'Hours' | 'Minutes', digits: string) {
  await user.click(within(screen.getByRole('group', { name })).getByRole('spinbutton', { name: section }))
  await user.keyboard(digits)
}

function textbox(name: 'Board' | 'Card' | 'Comment') {
  return screen.getByRole('textbox', { name })
}

function recopyBox() {
  return screen.getByRole('checkbox', { name: 'Copy the details from a card again' })
}

function select(name: 'Board' | 'List' | 'Card') {
  return screen.getByRole('combobox', { name })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

async function choose(user: ReturnType<typeof renderDialog>['user'], from: 'Board' | 'List' | 'Card', option: string) {
  await user.click(select(from))
  await user.click(screen.getByRole('option', { name: option }))
}

async function pickerLoaded() {
  await waitFor(() => expect(select('Card')).toHaveTextContent('Homepage layout'))
}

describe('TimeEntryDialog, adding an entry', () => {
  // "Now" is 14:30:20 in Madrid; the form works to the minute.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-05T13:30:20Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // No previous task unless a test says otherwise.
  function lastEnd(answer: string | null = null) {
    return fakeEndpoint('get', LAST_END, () => HttpResponse.json(answer))
  }

  it('opens on the hour ending now, on the card used most', async () => {
    fakeCardChoices()
    lastEnd()
    renderDialog(null)
    expect(screen.getByRole('dialog', { name: 'Add Time Entry' })).toBeInTheDocument()
    expect(shownTime('Start')).toBe('05/03/2026 13:30')
    expect(shownTime('End')).toBe('05/03/2026 14:30')
    await pickerLoaded()
    expect(textbox('Comment')).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'Board' })).not.toBeInTheDocument()
  })

  it('records it on the chosen card, with the comment, then hands it over and closes', async () => {
    fakeCardChoices()
    lastEnd()
    const recorded = fakeEndpoint('post', ENTRIES, () => HttpResponse.json(SAVED, { status: 201 }))
    const { user, onSaved, onClose } = renderDialog(null)
    await pickerLoaded()

    await choose(user, 'List', 'To do')
    await waitFor(() => expect(select('Card')).toHaveTextContent('Contact form'))
    await user.type(textbox('Comment'), 'Client call')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(recorded.requests.map((r) => r.body)).toEqual([{
      board_id: 'board-1',
      list_id: 'list-1',
      card_id: 'card-3',
      started_at: '2026-03-05T12:30:00.000Z',
      ended_at: '2026-03-05T13:30:00.000Z',
      comment: 'Client call',
    }])
    expect(onSaved).toHaveBeenCalledWith(SAVED)
  })

  it('starts where the last task ended, when that was within the hour', async () => {
    fakeCardChoices()
    lastEnd('2026-03-05T13:10:42Z')
    renderDialog(null)
    await waitFor(() => expect(shownTime('Start')).toBe('05/03/2026 14:10'))
    expect(shownTime('End')).toBe('05/03/2026 14:30')
  })

  it('ignores a last end more than an hour ago', async () => {
    fakeCardChoices()
    const asked = lastEnd('2026-03-05T12:20:00Z')
    renderDialog(null)
    await waitFor(() => expect(asked.requests).toHaveLength(1))
    await pickerLoaded()
    expect(shownTime('Start')).toBe('05/03/2026 13:30')
  })

  it('ignores a last end in the future, which is no previous task', async () => {
    fakeCardChoices()
    const asked = lastEnd('2026-03-05T14:00:00Z')
    renderDialog(null)
    await waitFor(() => expect(asked.requests).toHaveLength(1))
    await pickerLoaded()
    expect(shownTime('Start')).toBe('05/03/2026 13:30')
  })

  it('keeps the entry a minute long when the last task ended this very minute', async () => {
    fakeCardChoices()
    lastEnd('2026-03-05T13:30:05Z')
    renderDialog(null)
    await waitFor(() => expect(shownTime('Start')).toBe('05/03/2026 14:30'))
    expect(shownTime('End')).toBe('05/03/2026 14:31')
  })

  it('keeps a start already changed when the last end arrives', async () => {
    fakeCardChoices()
    const held = heldAnswer(() => HttpResponse.json('2026-03-05T13:10:00Z'))
    const asked = fakeEndpoint('get', LAST_END, held.answer)
    const { user } = renderDialog(null)
    await waitFor(() => expect(asked.requests).toHaveLength(1))

    await typeTime(user, 'Start', 'Hours', '12')
    held.release()
    // Gives the late answer time to land, if it would.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(shownTime('Start')).toBe('05/03/2026 12:30')
  })

  it("keeps the default hour when the last end can't be read", async () => {
    fakeCardChoices()
    const asked = fakeEndpoint('get', LAST_END, () => new HttpResponse(null, { status: 500 }))
    renderDialog(null)
    await waitFor(() => expect(asked.requests).toHaveLength(1))
    await pickerLoaded()
    expect(shownTime('Start')).toBe('05/03/2026 13:30')
  })

  it('asks for a card first when the list has none, sending nothing', async () => {
    fakeCardChoices()
    lastEnd()
    const recorded = fakeEndpoint('post', ENTRIES)
    const { user } = renderDialog(null)
    await pickerLoaded()
    await choose(user, 'Board', 'Marketing')
    await waitFor(() => expect(select('List')).toHaveTextContent('Ideas'))
    await choose(user, 'List', 'Done')
    await screen.findByText('No cards in this list.')

    await user.click(button('Save'))

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a card first.')
    expect(recorded.requests).toEqual([])
  })
})

describe('TimeEntryDialog, editing an entry', () => {
  it("opens with the entry's times, names and comment, without a card picker", () => {
    renderDialog(LOGGED)
    expect(screen.getByRole('dialog', { name: 'Edit Time Entry' })).toBeInTheDocument()
    expect(shownTime('Start')).toBe('15/01/2026 10:00')
    expect(shownTime('End')).toBe('15/01/2026 11:00')
    expect(textbox('Board')).toHaveValue('Website redesign')
    expect(textbox('Card')).toHaveValue('Homepage layout')
    expect(textbox('Comment')).toHaveValue('Client call')
    expect(screen.getByText(/were copied from the card when the entry was recorded/)).toBeInTheDocument()
    expect(recopyBox()).not.toBeChecked()
    expect(screen.queryByRole('combobox', { name: 'Card' })).not.toBeInTheDocument()
  })

  it('takes at most 255 characters for the names and 2000 for the comment, as the backend does', () => {
    renderDialog(LOGGED)
    expect(textbox('Board')).toHaveAttribute('maxlength', '255')
    expect(textbox('Card')).toHaveAttribute('maxlength', '255')
    expect(textbox('Comment')).toHaveAttribute('maxlength', '2000')
  })

  it('saves the changed times, names and comment, then hands the entry over and closes', async () => {
    const saved = fakeEndpoint('patch', ENTRY, () => HttpResponse.json(SAVED))
    const { user, onSaved, onClose } = renderDialog(LOGGED)

    await typeTime(user, 'End', 'Hours', '12')
    await user.type(textbox('Board'), ' 2')
    await user.type(textbox('Card'), ' v2')
    await user.type(textbox('Comment'), ' and notes')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([['/api/v1/time-entries/entry-1', {
      started_at: '2026-01-15T09:00:00.000Z',
      ended_at: '2026-01-15T11:00:00.000Z',
      comment: 'Client call and notes',
      board_name: 'Website redesign 2',
      card_name: 'Homepage layout v2',
    }]])
    expect(onSaved).toHaveBeenCalledWith(SAVED)
  })

  it('drops the seconds a live-tracked entry had, as the fields show none', async () => {
    const saved = fakeEndpoint('patch', ENTRY, () => HttpResponse.json(SAVED))
    const { user, onClose } = renderDialog({ ...LOGGED, started_at: '2026-01-15T09:00:37Z', ended_at: '2026-01-15T10:00:12Z' })
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => r.body)).toEqual([expect.objectContaining({
      started_at: '2026-01-15T09:00:00.000Z',
      ended_at: '2026-01-15T10:00:00.000Z',
    })])
  })

  it('sends a blank comment, which is how a comment is removed', async () => {
    const saved = fakeEndpoint('patch', ENTRY, () => HttpResponse.json(SAVED))
    const { user, onClose } = renderDialog(LOGGED)
    await user.clear(textbox('Comment'))
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => r.body)).toEqual([expect.objectContaining({ comment: '' })])
  })

  it('refuses an end before the start, saying so under the end', async () => {
    const saved = fakeEndpoint('patch', ENTRY)
    const { user } = renderDialog(LOGGED)

    await typeTime(user, 'End', 'Hours', '09')

    expect(screen.getByText('The end time must be after the start time.')).toBeInTheDocument()
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('The end time must be after the start time.')
    expect(saved.requests).toEqual([])
  })

  it('refuses an end in the same minute as the start', async () => {
    // 10:00:10 to 10:00:50: the same minute once seconds are dropped.
    const saved = fakeEndpoint('patch', ENTRY)
    const { user } = renderDialog({ ...LOGGED, started_at: '2026-01-15T09:00:10Z', ended_at: '2026-01-15T09:00:50Z' })
    expect(screen.getByText('The end time must be after the start time.')).toBeInTheDocument()
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('The end time must be after the start time.')
    expect(saved.requests).toEqual([])
  })

  it('asks for both times', async () => {
    // The entry still running has no end yet.
    const saved = fakeEndpoint('patch', ENTRY)
    const { user } = renderDialog({ ...LOGGED, ended_at: null })
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Both a start and an end time are required.')
    expect(saved.requests).toEqual([])
  })

  it('copies the details from a card again when ticked, instead of sending the names', async () => {
    fakeCardChoices()
    const saved = fakeEndpoint('patch', ENTRY, () => HttpResponse.json(SAVED))
    const { user, onClose } = renderDialog(LOGGED)

    await user.click(recopyBox())

    expect(textbox('Board')).toBeDisabled()
    expect(textbox('Card')).toBeDisabled()
    await pickerLoaded()
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => r.body)).toEqual([{
      started_at: '2026-01-15T09:00:00.000Z',
      ended_at: '2026-01-15T10:00:00.000Z',
      comment: 'Client call',
      board_id: 'board-1',
      list_id: 'list-2',
      card_id: 'card-7',
    }])
  })

  it('asks for a card when copying again from a list without cards', async () => {
    fakeCardChoices()
    const saved = fakeEndpoint('patch', ENTRY)
    const { user } = renderDialog(LOGGED)
    await user.click(recopyBox())
    await pickerLoaded()
    await choose(user, 'Board', 'Marketing')
    await waitFor(() => expect(select('List')).toHaveTextContent('Ideas'))
    await choose(user, 'List', 'Done')
    await screen.findByText('No cards in this list.')

    await user.click(button('Save'))

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a card first.')
    expect(saved.requests).toEqual([])
  })

  it("doesn't look up the last end, which only a new entry starts from", async () => {
    const asked = fakeEndpoint('get', LAST_END, () => HttpResponse.json('2026-01-15T09:30:00Z'))
    renderDialog(LOGGED)
    // Gives a request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(asked.requests).toEqual([])
    expect(shownTime('Start')).toBe('15/01/2026 10:00')
  })

  it('says so, and stays open, when saving fails', async () => {
    // Deleted meanwhile in another tab. FastAPI's error has a JSON body,
    // which mustn't be taken for the saved entry.
    fakeEndpoint('patch', ENTRY, () => HttpResponse.json({ detail: 'Time entry not found' }, { status: 404 }))
    const { user, onSaved, onClose } = renderDialog(LOGGED)
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes nothing while saving', async () => {
    const held = heldAnswer(() => HttpResponse.json(SAVED))
    fakeEndpoint('patch', ENTRY, held.answer)
    const { user, onClose } = renderDialog(LOGGED)

    await user.click(button('Save'))
    for (const name of ['Start', 'End'] as const) {
      expect(within(screen.getByRole('group', { name })).getAllByRole('spinbutton')[0]).toHaveAttribute('aria-disabled', 'true')
    }
    for (const name of ['Board', 'Card', 'Comment'] as const) expect(textbox(name)).toBeDisabled()
    expect(recopyBox()).toBeDisabled()
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('reopens with the entry of that moment, unticked, without the last error', async () => {
    fakeCardChoices()
    const { user, reopen } = renderDialog(LOGGED)
    await user.click(recopyBox())
    await typeTime(user, 'End', 'Hours', '09')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen({ ...LOGGED, id: 'entry-2', card_name: 'Footer', comment: null, started_at: '2026-01-16T08:00:00Z', ended_at: '2026-01-16T08:30:00Z' })

    expect(shownTime('Start')).toBe('16/01/2026 09:00')
    expect(shownTime('End')).toBe('16/01/2026 09:30')
    expect(textbox('Card')).toHaveValue('Footer')
    expect(textbox('Comment')).toHaveValue('')
    expect(recopyBox()).not.toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without saving', async () => {
    const saved = fakeEndpoint('patch', ENTRY)
    const { user, onClose } = renderDialog(LOGGED)
    await user.type(textbox('Card'), ' v2')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saved.requests).toEqual([])
  })
})
