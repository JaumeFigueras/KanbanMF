import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { TimeEntryRead } from '../types/timeTracker'
import { fakeCardChoices } from '../test/cardChoices'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { makeTimeEntry } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import TimeTracker from './TimeTracker'

const RUNNING = makeTimeEntry({ id: 'entry-1', card_name: 'Homepage layout', started_at: '2026-01-16T09:00:00Z', ended_at: null })
const DONE = makeTimeEntry({ id: 'entry-2', card_name: 'Footer links' })

// The user's time entries as the server has them: one running and one done,
// unless told otherwise. `server.update()` changes them, `server.fail()`
// makes the load fail from then on (a server error, unless told otherwise),
// and `server.recover()` makes it work again. The years with entries are
// 2026's alone, unless told otherwise.
function entriesServer(initial: TimeEntryRead[] = [RUNNING, DONE], years: Answer = () => HttpResponse.json([2026])) {
  let entries = initial
  let down: Answer | null = null
  const loads = fakeEndpoint('get', '/api/v1/time-entries', (request) => (down ?? (() => HttpResponse.json(entries)))(request))
  const yearLoads = fakeEndpoint('get', '/api/v1/time-entries/years', years)
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    loads: () => loads.requests.length,
    // The period each load asked for, as [from, to].
    periods: () => loads.requests.map((r) => [r.url.searchParams.get('from'), r.url.searchParams.get('to')]),
    yearLoads: () => yearLoads.requests.length,
    update: (next: TimeEntryRead[]) => { entries = next },
    // Holds the next loads' answers until released.
    hold: () => {
      const held = heldAnswer(() => HttpResponse.json(entries))
      down = held.answer
      return held
    },
    fail: (answer: Answer = SERVER_ERROR) => { down = answer },
    recover: () => { down = null },
  }
}

const renderTracker = () => renderWithProviders(<TimeTracker />, { route: '/time-tracker', auth: true })

// As the viewer who reads dates day first ("English (UK / Europe)"), unless
// told otherwise.
const renderAs = (formats: { number_locale?: string; date_format?: string; language_locale?: string } = {}) => (
  renderWithProviders(<TimeTracker />, { route: '/time-tracker', auth: { number_locale: 'en_GB', ...formats } })
)

// "Now" is 11:30:00 in Madrid, the tests' time zone, on Friday 16 January
// 2026. Only the date is faked: the running entry's clock still ticks every
// real second, reading the faked date.
const NOW = '2026-01-16T10:30:00Z'
function fixClock(at = NOW) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(at))
}

// The strip above the table, which shows the entry being tracked.
const strip = () => screen.getByText(/^(Currently tracking|No task is being tracked right now\.)$/).closest<HTMLElement>('.MuiPaper-root')!
const table = () => screen.getByRole('table')

// The table's rows below its header, each as its cells' texts: a day's row
// holds its date and total, an entry's row its times, names and comment.
const rows = () => within(table()).getAllByRole('row').slice(1)
  .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent).filter(Boolean))

// The row of the entry for a card.
const entryRow = (card: string) => within(table()).getByText(card).closest('tr')!

const chooseIn = async (user: ReturnType<typeof renderTracker>['user'], which: 0 | 1, option: string) => {
  await user.click(screen.getAllByRole('combobox')[which])
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

// Being tracked since 10:00 in Madrid, on the day of NOW, and the same once
// ended at NOW.
const TRACKING = makeTimeEntry({
  id: 'entry-1',
  card_name: 'Homepage layout',
  board_name: 'Website redesign',
  started_at: '2026-01-16T09:00:00Z',
  ended_at: null,
  comment: 'Client call',
  labels: [{ name: 'Design', color: '#1976D2' }],
})
const ENDED = { ...TRACKING, ended_at: NOW }
// Recorded the day before NOW, 10:00 to 11:00 in Madrid, and on the day
// before that.
const FOOTER = makeTimeEntry({ id: 'entry-2', card_name: 'Footer links', started_at: '2026-01-15T09:00:00Z', ended_at: '2026-01-15T10:00:00Z' })
const CONTACT = makeTimeEntry({ id: 'entry-3', card_name: 'Contact form', started_at: '2026-01-14T09:00:00Z', ended_at: '2026-01-14T10:00:00Z' })

const STOP = '/api/v1/time-entries/:entryId/stop'
const OVERLAP = 'This entry overlaps another one.'

// The message at the foot of the page, and the one when ending fails.
const failure = () => screen.findByRole('alert')
const STOP_FAILED = 'The task "Homepage layout" couldn\'t be ended. Please try again.'

// Whether each End button, the bar's then the strip's, is disabled.
const endsDisabled = () => screen.getAllByRole('button', { name: 'End' }).map((b) => (b as HTMLButtonElement).disabled)

describe('TimeTracker', () => {
  describe('the entry being tracked', () => {
    it('shows it above the table, with its board, start, comment and labels, its time ticking', async () => {
      fixClock()
      entriesServer([TRACKING, FOOTER])
      renderAs()

      expect(await screen.findByText('1:30:00')).toBeInTheDocument()
      const shown = within(strip())
      expect(shown.getByText('Currently tracking')).toBeInTheDocument()
      expect(shown.getByText('Homepage layout')).toBeInTheDocument()
      expect(await shown.findByText('Website redesign · 16/01/2026, 10:00')).toBeInTheDocument()
      expect(shown.getByText('Client call')).toBeInTheDocument()
      expect(shown.getByText('Design')).toBeInTheDocument()
      expect(within(table()).queryByText('Homepage layout')).not.toBeInTheDocument()

      vi.setSystemTime(new Date('2026-01-16T10:30:05Z'))

      expect(await shown.findByText('1:30:05')).toBeInTheDocument()
    })

    it('offers End and not Start while an entry is being tracked', async () => {
      entriesServer([TRACKING, FOOTER])
      renderAs()
      await screen.findByText('Currently tracking')

      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
      expect(screen.getAllByRole('button', { name: 'End' }).map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false])
    })

    it('offers Start and not End when nothing is being tracked', async () => {
      entriesServer([FOOTER])
      renderAs()
      await screen.findByText('Footer links')

      expect(within(strip()).getByText('No task is being tracked right now.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'End' })).toBeDisabled()
    })

    it.each([
      ['bar', 0],
      ['strip above the table', 1],
    ])('ends it from the %s, and shows it among the recorded entries', async (_where, index) => {
      fixClock()
      const server = entriesServer([TRACKING, FOOTER])
      const stopped = fakeEndpoint('post', STOP, () => HttpResponse.json(ENDED))
      const { user } = renderAs()
      await screen.findByText('1:30:00')
      server.update([ENDED, FOOTER])

      await user.click(screen.getAllByRole('button', { name: 'End' })[index])

      expect(await screen.findByText('No task is being tracked right now.')).toBeInTheDocument()
      expect(stopped.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/time-entries/entry-1/stop'])
      expect(entryRow('Homepage layout')).toHaveTextContent('1:30')
      expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'End' })).toBeDisabled()
      await waitFor(() => expect(server.loads()).toBe(2))
      expect(server.yearLoads()).toBe(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('disables both End buttons while ending it is on its way, so a double click ends it once', async () => {
      fixClock()
      const server = entriesServer([TRACKING, FOOTER])
      const held = heldAnswer(() => HttpResponse.json(ENDED))
      const stopped = fakeEndpoint('post', STOP, held.answer)
      const { user } = renderAs()
      await screen.findByText('1:30:00')
      server.update([ENDED, FOOTER])

      await user.dblClick(screen.getAllByRole('button', { name: 'End' })[1])

      await waitFor(() => expect(stopped.requests).toHaveLength(1))
      expect(endsDisabled()).toEqual([true, true])
      held.release()

      expect(await within(strip()).findByText('No task is being tracked right now.')).toBeInTheDocument()
      await waitFor(() => expect(server.loads()).toBe(2))
      expect(stopped.requests).toHaveLength(1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows the ended entry at once, while the month is fetched again', async () => {
      fixClock()
      const server = entriesServer([TRACKING, FOOTER])
      fakeEndpoint('post', STOP, () => HttpResponse.json(ENDED))
      const { user } = renderAs()
      await screen.findByText('1:30:00')
      server.update([ENDED, FOOTER])
      server.hold()

      await user.click(screen.getAllByRole('button', { name: 'End' })[0])

      expect(await within(table()).findByText('Homepage layout')).toBeInTheDocument()
      expect(rows().map((row) => row[row.length - 1])).toEqual(['1:30', 'Client call', '1:00', 'Footer links'])
      expect(within(strip()).getByText('No task is being tracked right now.')).toBeInTheDocument()
      expect(server.loads()).toBe(2)
    })

    it('lets the month decide what stays once an entry ends: one started the month before leaves the table', async () => {
      fixClock()
      // Since 23:00 in Madrid on 31 December: the server sends the entry
      // being tracked whatever the month, but not once it has ended.
      const lastYear = { ...TRACKING, started_at: '2025-12-31T22:00:00Z' }
      const server = entriesServer([lastYear, FOOTER])
      fakeEndpoint('post', STOP, () => HttpResponse.json({ ...lastYear, ended_at: NOW }))
      const { user } = renderAs()
      await screen.findByText('Currently tracking')
      server.update([FOOTER])

      await user.click(screen.getAllByRole('button', { name: 'End' })[0])

      await waitFor(() => expect(server.loads()).toBe(2))
      await waitFor(() => expect(within(table()).queryByText('Homepage layout')).not.toBeInTheDocument())
      expect(within(table()).getByText('Footer links')).toBeInTheDocument()
    })

    it("says it couldn't be ended when the connection drops, and keeps it running, End offered again", async () => {
      fixClock()
      const server = entriesServer([TRACKING, FOOTER])
      const stopped = fakeEndpoint('post', STOP, DROPPED)
      const { user } = renderAs()
      await screen.findByText('1:30:00')

      await user.click(screen.getAllByRole('button', { name: 'End' })[0])

      expect(await failure()).toHaveTextContent(STOP_FAILED)
      expect(stopped.requests).toHaveLength(1)
      expect(within(strip()).getByText('Currently tracking')).toBeInTheDocument()
      expect(within(table()).queryByText('Homepage layout')).not.toBeInTheDocument()
      expect(endsDisabled()).toEqual([false, false])
      expect(server.loads()).toBe(1)
    })

    it("says it couldn't be ended when refused, and fetches the month again, where it still runs", async () => {
      fixClock()
      const server = entriesServer([TRACKING, FOOTER])
      fakeEndpoint('post', STOP, SERVER_ERROR)
      const { user } = renderAs()
      await screen.findByText('1:30:00')

      await user.click(screen.getAllByRole('button', { name: 'End' })[1])

      expect(await failure()).toHaveTextContent(STOP_FAILED)
      await waitFor(() => expect(server.loads()).toBe(2))
      expect(within(strip()).getByText('Currently tracking')).toBeInTheDocument()
      expect(within(table()).queryByText('Homepage layout')).not.toBeInTheDocument()
      expect(endsDisabled()).toEqual([false, false])
    })

    it("says it couldn't be ended when it was ended elsewhere meanwhile, and shows it ended once the month is fetched again", async () => {
      fixClock()
      const server = entriesServer([TRACKING, FOOTER])
      fakeEndpoint('post', STOP, () => HttpResponse.json({ detail: 'This time entry has already ended.' }, { status: 409 }))
      const { user } = renderAs()
      await screen.findByText('1:30:00')
      // Ended at 11:00 in Madrid, from another tab.
      server.update([{ ...TRACKING, ended_at: '2026-01-16T10:00:00Z' }, FOOTER])

      await user.click(screen.getAllByRole('button', { name: 'End' })[0])

      expect(await failure()).toHaveTextContent(STOP_FAILED)
      expect(await within(strip()).findByText('No task is being tracked right now.')).toBeInTheDocument()
      expect(entryRow('Homepage layout')).toHaveTextContent('1:00')
      expect(screen.getByRole('button', { name: 'End' })).toBeDisabled()
    })

    it("closes the message that it couldn't be ended with the close button", async () => {
      entriesServer([TRACKING, FOOTER])
      fakeEndpoint('post', STOP, DROPPED)
      const { user } = renderAs()
      await screen.findByText('Currently tracking')
      await user.click(screen.getAllByRole('button', { name: 'End' })[0])
      const message = await failure()

      await user.click(within(message).getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })
  })

  describe('starting, adding, editing and deleting entries', () => {
    // The add and start dialogs' card picker, and the last end the add
    // dialog starts from: none.
    function dialogsServer() {
      fakeCardChoices()
      fakeEndpoint('get', '/api/v1/time-entries/last-end', () => HttpResponse.json(null))
    }

    it('starts tracking a card from Start, and shows it above the table', async () => {
      fixClock()
      const server = entriesServer([FOOTER])
      dialogsServer()
      const started = fakeEndpoint('post', '/api/v1/time-entries/start', () => HttpResponse.json(TRACKING, { status: 201 }))
      const { user } = renderAs()
      await screen.findByText('Footer links')

      await user.click(screen.getByRole('button', { name: 'Start' }))
      const dialog = await screen.findByRole('dialog', { name: 'Start Tracking' })
      await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Card' })).toHaveTextContent('Homepage layout'))
      await user.click(within(dialog).getByRole('button', { name: 'Start' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(within(strip()).getByText('Homepage layout')).toBeInTheDocument()
      expect(within(strip()).getByText('1:30:00')).toBeInTheDocument()
      expect(started.requests).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
      await waitFor(() => expect(server.yearLoads()).toBe(2))
      expect(server.loads()).toBe(1)
    })

    it('adds an entry from Add entry, and fetches the month again', async () => {
      fixClock()
      // Older than the entry already there, so it goes after it.
      const added = makeTimeEntry({ id: 'entry-9', card_name: 'Search page', started_at: '2026-01-14T08:30:00Z', ended_at: '2026-01-14T09:30:00Z' })
      const server = entriesServer([FOOTER])
      dialogsServer()
      const recorded = fakeEndpoint('post', '/api/v1/time-entries', () => HttpResponse.json(added, { status: 201 }))
      const { user } = renderAs()
      await screen.findByText('Footer links')
      server.update([added, FOOTER])
      server.hold()

      await user.click(screen.getByRole('button', { name: 'Add entry' }))
      const dialog = await screen.findByRole('dialog', { name: 'Add Time Entry' })
      await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Card' })).toHaveTextContent('Homepage layout'))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      expect(within(table()).getByText('Search page')).toBeInTheDocument()
      expect(rows().map((row) => row[row.length - 1])).toEqual(['1:00', 'Footer links', '1:00', 'Search page'])
      expect(recorded.requests).toHaveLength(1)
      expect(server.loads()).toBe(2)
      await waitFor(() => expect(server.yearLoads()).toBe(2))
    })

    it('edits the entry of the row, showing the change at once while the month is fetched again', async () => {
      const server = entriesServer([FOOTER, CONTACT])
      const saved = fakeEndpoint('patch', '/api/v1/time-entries/:entryId', () => HttpResponse.json({ ...FOOTER, comment: 'Fixed the links' }))
      const { user } = renderAs()
      await screen.findByText('Footer links')

      await user.click(within(entryRow('Footer links')).getByRole('button', { name: 'Edit entry' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit Time Entry' })
      expect(within(dialog).getByRole('textbox', { name: 'Card' })).toHaveValue('Footer links')
      await user.click(within(dialog).getByRole('textbox', { name: 'Comment' }))
      await user.paste('Fixed the links')
      server.hold()
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      expect(within(entryRow('Footer links')).getByText('Fixed the links')).toBeInTheDocument()
      expect(saved.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/time-entries/entry-2'])
      expect(server.loads()).toBe(2)
      await waitFor(() => expect(server.yearLoads()).toBe(2))
    })

    it('lets the month decide what stays once an entry is saved: one moved to another month leaves the table', async () => {
      const server = entriesServer([FOOTER, CONTACT])
      fakeEndpoint('patch', '/api/v1/time-entries/:entryId', () => HttpResponse.json({ ...FOOTER, started_at: '2026-02-02T09:00:00Z', ended_at: '2026-02-02T10:00:00Z' }))
      const { user } = renderAs()
      await screen.findByText('Footer links')
      server.update([CONTACT])

      await user.click(within(entryRow('Footer links')).getByRole('button', { name: 'Edit entry' }))
      await user.click(within(await screen.findByRole('dialog', { name: 'Edit Time Entry' })).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(server.loads()).toBe(2))
      await waitFor(() => expect(within(table()).queryByText('Footer links')).not.toBeInTheDocument())
      expect(within(table()).getByText('Contact form')).toBeInTheDocument()
    })

    it('opens Add entry empty after an entry was edited', async () => {
      entriesServer([FOOTER])
      dialogsServer()
      const { user } = renderAs()
      await screen.findByText('Footer links')
      await user.click(within(entryRow('Footer links')).getByRole('button', { name: 'Edit entry' }))
      await user.click(within(await screen.findByRole('dialog', { name: 'Edit Time Entry' })).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Add entry' }))

      const dialog = await screen.findByRole('dialog', { name: 'Add Time Entry' })
      expect(within(dialog).queryByRole('textbox', { name: 'Card' })).not.toBeInTheDocument()
      expect(within(dialog).getByRole('textbox', { name: 'Comment' })).toHaveValue('')
    })

    it('deletes the entry of the row once asked', async () => {
      const server = entriesServer([FOOTER, CONTACT])
      const deleted = fakeEndpoint('delete', '/api/v1/time-entries/:entryId')
      const { user } = renderAs()
      await screen.findByText('Footer links')

      await user.click(within(entryRow('Footer links')).getByRole('button', { name: 'Delete entry' }))
      const dialog = await screen.findByRole('dialog', { name: 'Delete time entry?' })
      expect(dialog).toHaveTextContent('Delete the recorded time for "Footer links"? This cannot be undone.')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(within(table()).queryByText('Footer links')).not.toBeInTheDocument())
      expect(within(table()).getByText('Contact form')).toBeInTheDocument()
      expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/time-entries/entry-2'])
      await waitFor(() => expect(server.yearLoads()).toBe(2))
      expect(server.loads()).toBe(1)
    })

    it.each([
      ['Start', 'Start Tracking'],
      ['Add entry', 'Add Time Entry'],
      ['Edit entry', 'Edit Time Entry'],
      ['Delete entry', 'Delete time entry?'],
    ])('closes the dialog %s opens on Cancel, sending nothing', async (opener, title) => {
      entriesServer([FOOTER])
      dialogsServer()
      const sent = [
        fakeEndpoint('post', '/api/v1/time-entries/start'),
        fakeEndpoint('post', '/api/v1/time-entries'),
        fakeEndpoint('patch', '/api/v1/time-entries/:entryId'),
        fakeEndpoint('delete', '/api/v1/time-entries/:entryId'),
      ]
      const { user } = renderAs()
      await screen.findByText('Footer links')
      const inRow = opener === 'Edit entry' || opener === 'Delete entry'

      await user.click((inRow ? within(entryRow('Footer links')) : screen).getByRole('button', { name: opener }))
      await user.click(within(await screen.findByRole('dialog', { name: title })).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(sent.map((endpoint) => endpoint.requests.length)).toEqual([0, 0, 0, 0])
    })
  })

  describe('the year and month shown', () => {
    const years = () => screen.getAllByRole('combobox')[0]
    const months = () => screen.getAllByRole('combobox')[1]

    it('offers the years with entries and this year, newest first, and starts on this month', async () => {
      fixClock()
      const server = entriesServer([FOOTER], () => HttpResponse.json([2025, 2023]))
      const { user } = renderAs()
      await screen.findByText('Footer links')

      expect(years()).toHaveTextContent('2026')
      expect(months()).toHaveTextContent('January')
      // January in Madrid, from its first midnight to February's.
      expect(server.periods()).toEqual([['2025-12-31T23:00:00.000Z', '2026-01-31T23:00:00.000Z']])
      await waitFor(() => expect(server.yearLoads()).toBe(1))
      await user.click(years())
      await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026', '2025', '2023']))
    })

    it('fetches the year and month chosen, from midnight to midnight where you are, and the whole year with All months', async () => {
      fixClock()
      const server = entriesServer([FOOTER], () => HttpResponse.json([2025]))
      const { user } = renderAs()
      await screen.findByText('Footer links')
      await waitFor(() => expect(server.yearLoads()).toBe(1))

      await chooseIn(user, 0, '2025')
      await waitFor(() => expect(server.periods().at(-1)).toEqual(['2024-12-31T23:00:00.000Z', '2025-01-31T23:00:00.000Z']))
      // Summer time: midnight in Madrid is 22:00 UTC.
      await chooseIn(user, 1, 'July')
      await waitFor(() => expect(server.periods().at(-1)).toEqual(['2025-06-30T22:00:00.000Z', '2025-07-31T22:00:00.000Z']))
      await chooseIn(user, 1, 'All months')
      await waitFor(() => expect(server.periods().at(-1)).toEqual(['2024-12-31T23:00:00.000Z', '2025-12-31T23:00:00.000Z']))

      expect(server.loads()).toBe(4)
      expect(years()).toHaveTextContent('2025')
      expect(months()).toHaveTextContent('All months')
      await user.click(years())
      expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026', '2025'])
    })

    it.each([
      ['refused', SERVER_ERROR],
      ['cut off', DROPPED],
    ])("offers this year alone when the years can't be loaded (%s)", async (_case, answer: Answer) => {
      fixClock()
      const server = entriesServer([FOOTER], answer)
      const { user } = renderAs()
      await screen.findByText('Footer links')
      await waitFor(() => expect(server.yearLoads()).toBe(1))

      await user.click(years())

      expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026'])
    })

    it("names the months as the viewer's date format does", async () => {
      fixClock()
      entriesServer([FOOTER])
      renderAs({ number_locale: 'ca_ES' })

      await waitFor(() => expect(months()).toHaveTextContent('gener'))
    })
  })

  describe('the recorded entries', () => {
    // On 15 January in Madrid: 14:00 to 14:45, 10:00 to 11:00, and 00:15 to
    // 00:45, still the 14th in UTC. Then one from 23:30 on the 14th to 01:30
    // on the 15th. Newest first, as the server sends them.
    const DAY = [
      makeTimeEntry({ id: 'entry-4', card_name: 'Contact form', started_at: '2026-01-15T13:00:00Z', ended_at: '2026-01-15T13:45:00Z' }),
      FOOTER,
      makeTimeEntry({ id: 'entry-7', card_name: 'Hotfix', started_at: '2026-01-14T23:15:00Z', ended_at: '2026-01-14T23:45:00Z' }),
      makeTimeEntry({ id: 'entry-5', card_name: 'Release', started_at: '2026-01-14T22:30:00Z', ended_at: '2026-01-15T00:30:00Z' }),
    ]

    it('groups them by the day they started, newest first, each day with its total, and totals the month', async () => {
      entriesServer(DAY)
      renderAs()
      await screen.findByText('15/01/2026, 14:00')

      expect(rows()).toEqual([
        ['Thursday, 15/01/2026', '2:15'],
        ['15/01/2026, 14:00', '15/01/2026, 14:45', '0:45', 'Website redesign', 'Contact form'],
        ['15/01/2026, 10:00', '15/01/2026, 11:00', '1:00', 'Website redesign', 'Footer links'],
        ['15/01/2026, 00:15', '15/01/2026, 00:45', '0:30', 'Website redesign', 'Hotfix'],
        ['Wednesday, 14/01/2026', '2:00'],
        ['14/01/2026, 23:30', '15/01/2026, 01:30', '2:00', 'Website redesign', 'Release'],
      ])
      expect(screen.getByText('4 entries · 4:15 total')).toBeInTheDocument()
    })

    it("writes the dates in the viewer's own format", async () => {
      entriesServer([FOOTER])
      renderAs({ date_format: 'textual' })

      expect(await screen.findByText('Thursday, 15 January 2026')).toBeInTheDocument()
      expect(rows()[1].slice(0, 2)).toEqual(['15 January 2026 at 10:00', '15 January 2026 at 11:00'])
    })

    it('flags the entries that overlap, and not one that only touches another', async () => {
      entriesServer([
        makeTimeEntry({ id: 'entry-6', card_name: 'Release', started_at: '2026-01-15T10:30:00Z', ended_at: '2026-01-15T11:00:00Z' }),
        makeTimeEntry({ id: 'entry-4', card_name: 'Contact form', started_at: '2026-01-15T09:30:00Z', ended_at: '2026-01-15T10:30:00Z' }),
        FOOTER,
      ])
      renderAs()
      await screen.findByText('Release')

      expect(within(entryRow('Footer links')).getByLabelText(OVERLAP)).toBeInTheDocument()
      expect(within(entryRow('Contact form')).getByLabelText(OVERLAP)).toBeInTheDocument()
      expect(within(entryRow('Release')).queryByLabelText(OVERLAP)).not.toBeInTheDocument()
    })

    it('flags the entry being tracked when it overlaps a recorded one', async () => {
      fixClock()
      entriesServer([TRACKING, makeTimeEntry({ id: 'entry-4', card_name: 'Contact form', started_at: '2026-01-16T09:30:00Z', ended_at: '2026-01-16T10:00:00Z' }), FOOTER])
      renderAs()
      await screen.findByText('Contact form')

      expect(within(strip()).getByLabelText(OVERLAP)).toBeInTheDocument()
      expect(within(entryRow('Contact form')).getByLabelText(OVERLAP)).toBeInTheDocument()
      expect(within(entryRow('Footer links')).queryByLabelText(OVERLAP)).not.toBeInTheDocument()
    })

    it('totals the recorded entries only, not the one being tracked', async () => {
      fixClock()
      entriesServer([TRACKING, FOOTER, CONTACT])
      renderAs()

      expect(await screen.findByText('2 entries · 2:00 total')).toBeInTheDocument()
    })

    it.each([
      ['one entry', 'en', [FOOTER], '1 entry · 1:00 total'],
      ['one entry, in Catalan', 'ca_ES', [FOOTER], '1 registre · 1:00 en total'],
      ['two entries, in Catalan', 'ca_ES', [FOOTER, CONTACT], '2 registres · 2:00 en total'],
    ])('counts %s in the right form', async (_case, language_locale, entries, total) => {
      entriesServer(entries)
      renderAs({ language_locale })

      expect(await screen.findByText(total)).toBeInTheDocument()
    })

    it('says no time is recorded when only the entry being tracked is in, and offers nothing to export', async () => {
      fixClock()
      entriesServer([TRACKING])
      renderAs()

      expect(await screen.findByText('No time recorded for this period.')).toBeInTheDocument()
      expect(within(strip()).getByText('Homepage layout')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
      expect(screen.queryByText(/ total$/)).not.toBeInTheDocument()
    })
  })

  describe('loads that fail', () => {
    it("says the entries couldn't be loaded, rather than that nothing is tracked, and loads them with Try again", async () => {
      const server = entriesServer()
      server.fail()
      const { user } = renderTracker()

      expect(await screen.findByRole('alert')).toHaveTextContent("Your time entries couldn't be loaded.")
      expect(screen.queryByText('No task is being tracked right now.')).not.toBeInTheDocument()
      expect(screen.queryByText('No time recorded for this period.')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
      server.recover()
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('Footer links')).toBeInTheDocument()
      expect(screen.getByText('Homepage layout')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(server.loads()).toBe(2)
    })

    it('takes the message away while Try again loads, and brings it back if it fails again', async () => {
      const server = entriesServer()
      server.fail()
      const { user } = renderTracker()
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      server.fail(held.answer)

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("Your time entries couldn't be loaded.")
    })

    it('says so when the connection drops', async () => {
      entriesServer().fail(DROPPED)
      renderTracker()

      expect(await screen.findByRole('alert')).toHaveTextContent("Your time entries couldn't be loaded.")
    })

    it('says nothing is tracked only once the answer is in', async () => {
      entriesServer([])
      renderTracker()

      expect(screen.queryByText('No task is being tracked right now.')).not.toBeInTheDocument()
      expect(screen.queryByText('No time recorded for this period.')).not.toBeInTheDocument()
      expect(await screen.findByText('No time recorded for this period.')).toBeInTheDocument()
      expect(screen.getByText('No task is being tracked right now.')).toBeInTheDocument()
    })

    it('leaves nothing to end or export when the entries for another month fail', async () => {
      const server = entriesServer()
      const { user } = renderTracker()
      await screen.findByText('Footer links')
      expect(screen.getAllByRole('button', { name: 'End' })[0]).toBeEnabled()
      server.fail()

      await user.click(screen.getAllByRole('combobox')[1])
      await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'All months' }))

      expect(await screen.findByRole('alert')).toHaveTextContent("Your time entries couldn't be loaded.")
      expect(screen.queryByText('Homepage layout')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'End' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    })
  })

  describe('answers that come back out of order (6R)', () => {
    it("keeps the month chosen last when an earlier month's answer comes after it", async () => {
      const MARCH = makeTimeEntry({ id: 'entry-3', card_name: 'Contact form' })
      const APRIL = makeTimeEntry({ id: 'entry-4', card_name: 'Search page' })
      entriesServer()
      const { user } = renderTracker()
      await screen.findByText('Footer links')
      // The first month chosen gets its answer last.
      const held = heldAnswer(() => HttpResponse.json([MARCH]))
      let first = true
      const loads = fakeEndpoint('get', '/api/v1/time-entries', (request) => {
        const answer: Answer = first ? held.answer : () => HttpResponse.json([APRIL])
        first = false
        return answer(request)
      })
      const chooseMonth = async (name: string) => {
        await user.click(screen.getAllByRole('combobox')[1])
        await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }))
      }

      await chooseMonth('March')
      await chooseMonth('April')
      expect(await screen.findByText('Search page')).toBeInTheDocument()
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(loads.requests).toHaveLength(2)
      expect(screen.getByText('Search page')).toBeInTheDocument()
      expect(screen.queryByText('Contact form')).not.toBeInTheDocument()
      expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('April')
    })
  })

  describe('the CSV export (6F)', () => {
    // jsdom has neither blob URLs nor downloads: the file the page makes is
    // kept, and the link's click only records the name it would be saved as.
    function catchDownload() {
      const files: Blob[] = []
      const names: string[] = []
      URL.createObjectURL = vi.fn((blob: Blob) => {
        files.push(blob)
        return 'blob:time-entries'
      })
      URL.revokeObjectURL = vi.fn()
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download)
      })
      onTestFinished(() => {
        click.mockRestore()
        // @ts-expect-error -- jsdom doesn't have them; put it back that way.
        delete URL.createObjectURL
        // @ts-expect-error -- as above.
        delete URL.revokeObjectURL
      })
      return { files, names }
    }

    // Read as bytes, since decoding as text drops a leading byte-order
    // mark; with jsdom's FileReader, as the Blob is jsdom's too.
    function bytesOf(blob: Blob): Promise<Uint8Array> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(blob)
      })
    }

    it('starts the file with a byte-order mark, and keeps cells that start like a formula as text', async () => {
      entriesServer([makeTimeEntry({
        id: 'entry-3',
        board_name: 'Català',
        card_name: '=HYPERLINK("https://example.com/x","Click")',
        labels: [{ name: '@risk', color: '#E53935' }, { name: 'Design', color: '#1976D2' }],
        comment: '-5 minutes for the "review"',
      })])
      // January 2026, the month the page then shows and names the file after.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-01-20T12:00:00Z'))
      const download = catchDownload()
      const { user } = renderTracker()
      await screen.findByText('=HYPERLINK("https://example.com/x","Click")')

      await user.click(screen.getByRole('button', { name: 'Export CSV' }))

      expect(download.names).toEqual(['time-entries-2026-01.csv'])
      expect(download.files).toHaveLength(1)
      expect(download.files[0].type).toBe('text/csv;charset=utf-8')
      const bytes = await bytesOf(download.files[0])
      expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
      expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).split('\r\n')).toEqual([
        '\uFEFF"Start","End","Duration","Hours","Board","Card","Labels","Comment"',
        '"2026-01-15 10:00","2026-01-15 11:00","1:00","1.00","Català","\'=HYPERLINK(""https://example.com/x"",""Click"")","\'@risk, Design","\'-5 minutes for the ""review"""',
      ])
    })

    it('names the file after the year with All months, and leaves out the entry being tracked', async () => {
      fixClock()
      entriesServer([TRACKING, FOOTER])
      const download = catchDownload()
      const { user } = renderAs()
      await screen.findByText('Footer links')
      await chooseIn(user, 1, 'All months')

      await user.click(screen.getByRole('button', { name: 'Export CSV' }))

      expect(download.names).toEqual(['time-entries-2026.csv'])
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await bytesOf(download.files[0]))
      expect(text.split('\r\n').slice(1)).toEqual([
        '"2026-01-15 10:00","2026-01-15 11:00","1:00","1.00","Website redesign","Footer links","",""',
      ])
    })
  })
})
