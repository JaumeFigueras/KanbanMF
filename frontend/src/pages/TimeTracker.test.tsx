import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { makeTimeEntry } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import TimeTracker from './TimeTracker'

const RUNNING = makeTimeEntry({ id: 'entry-1', card_name: 'Homepage layout', started_at: '2026-01-16T09:00:00Z', ended_at: null })
const DONE = makeTimeEntry({ id: 'entry-2', card_name: 'Footer links' })

// The user's time entries as the server has them: one running and one done,
// unless told otherwise. `server.fail()` makes the load fail from then on (a
// server error, unless told otherwise), and `server.recover()` makes it work
// again.
function entriesServer(entries = [RUNNING, DONE]) {
  let down: Answer | null = null
  const loads = fakeEndpoint('get', '/api/v1/time-entries', (request) => (down ?? (() => HttpResponse.json(entries)))(request))
  fakeEndpoint('get', '/api/v1/time-entries/years', () => HttpResponse.json([2026]))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    loads: () => loads.requests.length,
    fail: (answer: Answer = SERVER_ERROR) => { down = answer },
    recover: () => { down = null },
  }
}

const renderTracker = () => renderWithProviders(<TimeTracker />, { route: '/time-tracker', auth: true })

describe('TimeTracker', () => {
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
  })
})
