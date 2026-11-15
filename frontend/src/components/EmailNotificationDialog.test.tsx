import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardNotificationSettingsRead, BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer, type Answer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import EmailNotificationDialog from './EmailNotificationDialog'

const SETTINGS = '/api/v1/boards/:boardId/notifications'
const BOARD = makeBoard({ id: 'board-1' })
const OTHER_BOARD = makeBoard({ id: 'board-2', name: 'Marketing' })

// Saved settings far from the defaults (on, 09:00, Monday to Friday, no
// days, no repeat), so the dialog can't pass for right by showing those.
const SAVED_BODY = {
  is_enabled: true,
  notify_hour: 8,
  notify_weekdays: [1, 3, 5],
  offset_days: [-3, 0],
  overdue_repeat_after_days: 2,
}
const SAVED: BoardNotificationSettingsRead = { board_id: 'board-1', ...SAVED_BODY }

const OFF: BoardNotificationSettingsRead = {
  board_id: 'board-1',
  is_enabled: false,
  notify_hour: 7,
  notify_weekdays: [6, 7],
  offset_days: [-1],
  overdue_repeat_after_days: null,
}

function fakeSettings(settings: BoardNotificationSettingsRead | Answer = SAVED) {
  const loads = fakeEndpoint('get', SETTINGS, typeof settings === 'function' ? settings : () => HttpResponse.json(settings))
  // The backend answers a save with the settings saved.
  const saves = fakeEndpoint('put', SETTINGS, async (request) => HttpResponse.json(await request.json()))
  return { loads, saves }
}

const failed = () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 })

interface Shown {
  open: boolean
  board: BoardRead | null
}

function renderDialog(first: Partial<Shown> = {}) {
  const onClose = vi.fn()
  let shown: Shown = { open: true, board: BOARD, ...first }
  const dialog = ({ open, board }: Shown) => <EmailNotificationDialog open={open} onClose={onClose} board={board} />
  const result = renderWithProviders(dialog(shown))
  // Closes the dialog and opens it again (on another board, if given), as
  // the board menus do.
  function reopen(next: Partial<Shown> = {}) {
    result.rerender(dialog({ ...shown, open: false }))
    shown = { ...shown, ...next, open: true }
    result.rerender(dialog(shown))
  }
  return { ...result, onClose, reopen }
}

const enabledBox = () => screen.getByRole('checkbox', { name: 'E-mail me about my due dates on this board' })
const hourSelect = () => screen.getByRole('combobox', { name: 'Notification hour' })
const weekday = (name: string) => screen.getByRole('button', { name })
const offsetField = () => screen.getByRole('spinbutton', { name: 'Notify these days before/after the due date' })
const repeatBox = () => screen.getByRole('checkbox', { name: 'Send e-mails daily past … days the due date' })
const repeatField = () => screen.getByRole('spinbutton', { name: 'Days overdue' })
const dayChip = (label: string) => screen.getByRole('button', { name: label })

// What each save sent.
const sent = (saves: ReturnType<typeof fakeSettings>['saves']) => saves.requests.map((r) => r.body)

async function loaded() {
  await screen.findByRole('checkbox', { name: 'E-mail me about my due dates on this board' })
}

describe('EmailNotificationDialog', () => {
  describe('opening', () => {
    it("shows the board's saved settings", async () => {
      fakeSettings()
      renderDialog()
      await loaded()
      expect(screen.getByRole('dialog', { name: 'My e-mail notifications' })).toBeInTheDocument()
      expect(enabledBox()).toBeChecked()
      expect(hourSelect()).toHaveTextContent('08:00')
      for (const day of ['Monday', 'Wednesday', 'Friday']) expect(weekday(day)).toHaveAttribute('aria-pressed', 'true')
      for (const day of ['Tuesday', 'Thursday', 'Saturday', 'Sunday']) expect(weekday(day)).toHaveAttribute('aria-pressed', 'false')
      expect(dayChip('-3')).toBeInTheDocument()
      expect(dayChip('0')).toBeInTheDocument()
      expect(repeatBox()).toBeChecked()
      expect(repeatField()).toHaveValue(2)
    })

    it('shows days after the due date with a plus sign', async () => {
      fakeSettings({ ...SAVED, offset_days: [2] })
      renderDialog()
      await loaded()
      expect(dayChip('+2')).toBeInTheDocument()
    })

    it('says when no days are set yet', async () => {
      fakeSettings({ ...SAVED, offset_days: [] })
      renderDialog()
      await loaded()
      expect(screen.getByText('No notification days configured yet.')).toBeInTheDocument()
    })

    it('shows an empty number, and a switched-off box, when nothing repeats', async () => {
      fakeSettings({ ...SAVED, overdue_repeat_after_days: null })
      renderDialog()
      await loaded()
      expect(repeatBox()).not.toBeChecked()
      expect(repeatField()).toHaveValue(null)
      expect(repeatField()).toBeDisabled()
    })

    it('shows only the switch while reminders are off', async () => {
      fakeSettings(OFF)
      renderDialog()
      await loaded()
      expect(enabledBox()).not.toBeChecked()
      expect(screen.queryByRole('combobox', { name: 'Notification hour' })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'Send e-mails daily past … days the due date' })).not.toBeInTheDocument()
    })

    it('offers nothing to change until the settings have loaded', async () => {
      const held = heldAnswer(() => HttpResponse.json(SAVED))
      fakeSettings(held.answer)
      renderDialog()
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

      held.release()

      await loaded()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it("says the settings couldn't be loaded, and offers nothing to change", async () => {
      // Shown, the defaults would be saved over the real settings by the
      // first click.
      const { saves } = fakeSettings(failed)
      renderDialog()
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Your e-mail notification settings for this board couldn't be loaded. Please close this and try again.",
      )
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(saves.requests).toEqual([])
    })

    it('says nothing of a failed load once a reopening loads them', async () => {
      fakeSettings(failed)
      const { reopen } = renderDialog()
      await screen.findByRole('alert')
      fakeSettings()

      reopen()

      await loaded()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("doesn't show the last board's settings while the next board's load", async () => {
      fakeSettings()
      const { reopen } = renderDialog()
      await loaded()
      const held = heldAnswer(() => HttpResponse.json({ ...OFF, board_id: 'board-2' }))
      fakeEndpoint('get', SETTINGS, held.answer)

      reopen({ board: OTHER_BOARD })

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      held.release()
      await loaded()
      expect(enabledBox()).not.toBeChecked()
    })

    it("drops a late answer for the last board, once opened on another", async () => {
      const held = heldAnswer(() => HttpResponse.json(SAVED))
      const { loads } = fakeSettings(held.answer)
      const { reopen } = renderDialog()
      await waitFor(() => expect(loads.requests).toHaveLength(1))
      fakeEndpoint('get', SETTINGS, () => HttpResponse.json({ ...OFF, board_id: 'board-2' }))
      reopen({ board: OTHER_BOARD })
      await loaded()

      held.release()

      // Gives the late answer time to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(enabledBox()).not.toBeChecked()
    })

    it("drops a late failure for the last board too", async () => {
      const held = heldAnswer(failed)
      const { loads } = fakeSettings(held.answer)
      const { reopen } = renderDialog()
      await waitFor(() => expect(loads.requests).toHaveLength(1))
      fakeEndpoint('get', SETTINGS, () => HttpResponse.json({ ...OFF, board_id: 'board-2' }))
      reopen({ board: OTHER_BOARD })
      await loaded()

      held.release()

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('loads them again on every opening', async () => {
      fakeSettings()
      const { reopen } = renderDialog()
      await loaded()
      // Changed meanwhile, say from another device.
      fakeEndpoint('get', SETTINGS, () => HttpResponse.json(OFF))

      reopen()

      await waitFor(() => expect(enabledBox()).not.toBeChecked())
    })

    it('loads the settings of the board it is opened for', async () => {
      const { loads } = fakeSettings()
      const { reopen } = renderDialog()
      await loaded()
      reopen({ board: OTHER_BOARD })
      await waitFor(() => expect(loads.requests).toHaveLength(2))
      expect(loads.requests[1].url.pathname).toBe('/api/v1/boards/board-2/notifications')
    })

    it('loads nothing while closed, or without a board', async () => {
      const { loads } = fakeSettings()
      renderDialog({ open: false })
      renderDialog({ board: null })
      // Gives a request, if any, time to arrive.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(loads.requests).toEqual([])
    })
  })

  describe('saving every change at once', () => {
    it('turning reminders on saves the whole set as loaded, and shows the rest', async () => {
      const { saves } = fakeSettings(OFF)
      const { user } = renderDialog()
      await loaded()

      await user.click(enabledBox())

      await waitFor(() => expect(sent(saves)).toEqual([{
        is_enabled: true, notify_hour: 7, notify_weekdays: [6, 7], offset_days: [-1], overdue_repeat_after_days: null,
      }]))
      expect(saves.requests[0].url.pathname).toBe('/api/v1/boards/board-1/notifications')
      expect(hourSelect()).toHaveTextContent('07:00')
    })

    it('turning them off saves that, and hides the rest', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.click(enabledBox())

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, is_enabled: false }]))
      expect(screen.queryByRole('combobox', { name: 'Notification hour' })).not.toBeInTheDocument()
    })

    it('saves another hour', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.click(hourSelect())
      await user.click(screen.getByRole('option', { name: '14:00' }))

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, notify_hour: 14 }]))
      expect(hourSelect()).toHaveTextContent('14:00')
    })

    it('offers every hour of the day', async () => {
      fakeSettings()
      const { user } = renderDialog()
      await loaded()
      await user.click(hourSelect())
      const hours = screen.getAllByRole('option').map((o) => o.textContent)
      expect(hours).toHaveLength(24)
      expect([hours[0], hours[23]]).toEqual(['00:00', '23:00'])
    })

    it('switching a day off saves the days left', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.click(weekday('Wednesday'))

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, notify_weekdays: [1, 5] }]))
      expect(weekday('Wednesday')).toHaveAttribute('aria-pressed', 'false')
    })

    it('switching a day on saves the days in week order', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.click(weekday('Tuesday'))

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, notify_weekdays: [1, 2, 3, 5] }]))
    })

    it("can't switch the last day off", async () => {
      fakeSettings({ ...SAVED, notify_weekdays: [3] })
      renderDialog()
      await loaded()
      expect(weekday('Wednesday')).toBeDisabled()
      expect(weekday('Thursday')).toBeEnabled()
    })

    it('adding a day saves the days in order, and empties the field', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.type(offsetField(), '-1')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, offset_days: [-3, -1, 0] }]))
      expect(dayChip('-1')).toBeInTheDocument()
      expect(offsetField()).toHaveValue(null)
    })

    it('adds a day with Enter too', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.type(offsetField(), '5{Enter}')

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, offset_days: [-3, 0, 5] }]))
      expect(dayChip('+5')).toBeInTheDocument()
    })

    it('adds nothing for a day already set', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.type(offsetField(), '0{Enter}')

      expect(saves.requests).toEqual([])
      expect(offsetField()).toHaveValue(0)
    })

    it('adds nothing for an empty field, not even the day itself', async () => {
      const { saves } = fakeSettings({ ...SAVED, offset_days: [-3] })
      const { user } = renderDialog()
      await loaded()

      await user.click(screen.getByRole('button', { name: 'Add' }))
      await user.click(offsetField())
      await user.keyboard('{Enter}')

      expect(saves.requests).toEqual([])
      expect(screen.queryByRole('button', { name: '0' })).not.toBeInTheDocument()
    })

    it('removing a day saves the rest', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.click(within(dayChip('-3')).getByTestId('CancelIcon'))

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, offset_days: [0] }]))
      expect(screen.queryByRole('button', { name: '-3' })).not.toBeInTheDocument()
    })

    it('removes a day from the keyboard too', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      dayChip('-3').focus()
      await user.keyboard('{Delete}')

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, offset_days: [0] }]))
    })

    it('turning the repeat on starts it at one day', async () => {
      const { saves } = fakeSettings({ ...SAVED, overdue_repeat_after_days: null })
      const { user } = renderDialog()
      await loaded()

      await user.click(repeatBox())

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, overdue_repeat_after_days: 1 }]))
      expect(repeatField()).toHaveValue(1)
      expect(repeatField()).toBeEnabled()
    })

    it('turning it off saves no repeat, and on again the number kept', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.click(repeatBox())
      await waitFor(() => expect(saves.requests).toHaveLength(1))
      expect(repeatField()).toHaveValue(2)
      expect(repeatField()).toBeDisabled()
      await user.click(repeatBox())

      await waitFor(() => expect(sent(saves)).toEqual([
        { ...SAVED_BODY, overdue_repeat_after_days: null },
        { ...SAVED_BODY, overdue_repeat_after_days: 2 },
      ]))
    })

    it('saves no repeat with the other changes while it is off, though a number is kept', async () => {
      const { saves } = fakeSettings({ ...SAVED, overdue_repeat_after_days: null })
      const { user } = renderDialog()
      await loaded()
      await user.click(repeatBox())
      await user.click(repeatBox())
      await waitFor(() => expect(saves.requests).toHaveLength(2))
      expect(repeatField()).toHaveValue(1)

      await user.click(weekday('Tuesday'))

      await waitFor(() => expect(saves.requests).toHaveLength(3))
      expect(saves.requests[2].body).toEqual({ ...SAVED_BODY, notify_weekdays: [1, 2, 3, 5], overdue_repeat_after_days: null })
    })

    it('saves another number of days once the field is left, not while typing', async () => {
      const { saves } = fakeSettings()
      const { user } = renderDialog()
      await loaded()

      await user.clear(repeatField())
      await user.type(repeatField(), '5')
      expect(saves.requests).toEqual([])
      await user.tab()

      await waitFor(() => expect(sent(saves)).toEqual([{ ...SAVED_BODY, overdue_repeat_after_days: 5 }]))
    })

    it("says so, and stays open, when a change can't be saved", async () => {
      fakeSettings()
      fakeEndpoint('put', SETTINGS, () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 }))
      const { user, onClose } = renderDialog()
      await loaded()

      await user.click(weekday('Tuesday'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('clears the error when the next change is saved', async () => {
      fakeSettings()
      const refused = fakeEndpoint('put', SETTINGS, () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 }))
      const { user } = renderDialog()
      await loaded()
      await user.click(weekday('Tuesday'))
      await screen.findByRole('alert')
      fakeSettings()

      await user.click(weekday('Thursday'))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(refused.requests).toHaveLength(1)
    })
  })

  describe('closing', () => {
    it('closes on Close, saving nothing', async () => {
      const { saves } = fakeSettings()
      const { user, onClose } = renderDialog()
      await loaded()
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(saves.requests).toEqual([])
    })

    it('forgets the last error once closed', async () => {
      fakeSettings()
      fakeEndpoint('put', SETTINGS, () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 }))
      const { user, onClose, reopen } = renderDialog()
      await loaded()
      await user.click(weekday('Tuesday'))
      await screen.findByRole('alert')

      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      reopen()

      await loaded()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('forgets it when closed with Escape too', async () => {
      fakeSettings()
      fakeEndpoint('put', SETTINGS, () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 }))
      const { user, onClose, reopen } = renderDialog()
      await loaded()
      await user.click(weekday('Tuesday'))
      await screen.findByRole('alert')

      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
      reopen()

      await loaded()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('forgets a day typed but not added', async () => {
      fakeSettings()
      const { user, reopen } = renderDialog()
      await loaded()
      await user.type(offsetField(), '4')

      reopen()

      await loaded()
      expect(offsetField()).toHaveValue(null)
    })
  })
})
