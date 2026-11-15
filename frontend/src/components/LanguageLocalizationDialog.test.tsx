import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { DateFormat } from '../utils/locale'
import { formatDateTime } from '../utils/locale'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import LanguageLocalizationDialog from './LanguageLocalizationDialog'

const PREFERENCES = '/api/v1/users/me/preferences'
// The example under the settings shows "now": 14:30 in Madrid, the tests'
// time zone. Only Date is faked, so user-event's timers still run.
const NOW = new Date('2026-03-05T13:30:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

interface Current {
  language: string
  numberLocale: string
  dateFormat: DateFormat
  timezone: string
}

const CATALAN_IN_LONDON: Current = {
  language: 'ca_ES',
  numberLocale: 'en_GB',
  dateFormat: 'textual',
  timezone: 'Europe/London',
}

function renderDialog(current: Current = CATALAN_IN_LONDON) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, shown: Current) => (
    <LanguageLocalizationDialog
      open={open}
      onClose={onClose}
      currentLanguageLocale={shown.language}
      currentNumberLocale={shown.numberLocale}
      currentDateFormat={shown.dateFormat}
      currentTimezone={shown.timezone}
      onSaved={onSaved}
    />
  )
  const result = renderWithProviders(dialog(true, current))
  // Closes the dialog and opens it again, as the app bar's menu does, with
  // the settings as they are by then.
  let shown = current
  function reopen(next: Current) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onSaved, reopen }
}

function select(name: 'Display language' | 'Dates & times format' | 'Date display on cards') {
  return screen.getByRole('combobox', { name })
}

function timezoneField() {
  return screen.getByRole('combobox', { name: 'Timezone' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

async function choose(user: ReturnType<typeof renderDialog>['user'], from: HTMLElement, option: string) {
  await user.click(from)
  await user.click(screen.getByRole('option', { name: option }))
}

describe('LanguageLocalizationDialog', () => {
  it('opens with the current settings', () => {
    renderDialog(CATALAN_IN_LONDON)
    expect(screen.getByRole('dialog', { name: 'Language and Localization' })).toBeInTheDocument()
    expect(select('Display language')).toHaveTextContent('Català')
    expect(select('Dates & times format')).toHaveTextContent('English (UK / Europe)')
    expect(select('Date display on cards')).toHaveTextContent('Textual (e.g. 27 June 2026)')
    expect(timezoneField()).toHaveValue('Europe/London')
  })

  it("falls back to English, US dates and the browser's time zone for unknown or missing settings", () => {
    renderDialog({ language: 'fr', numberLocale: 'fr_FR', dateFormat: 'numeric', timezone: '' })
    expect(select('Display language')).toHaveTextContent('English')
    expect(select('Dates & times format')).toHaveTextContent('English (US)')
    expect(timezoneField()).toHaveValue('Europe/Madrid')
  })

  it('saves the chosen settings, then tells the caller and closes', async () => {
    const saved = fakeEndpoint('put', PREFERENCES)
    const { user, onSaved, onClose } = renderDialog(CATALAN_IN_LONDON)

    await choose(user, select('Display language'), 'English')
    await choose(user, select('Dates & times format'), 'Català')
    await choose(user, select('Date display on cards'), 'Numeric (e.g. 27/06/2026)')
    await user.clear(timezoneField())
    await user.type(timezoneField(), 'Tokyo')
    await user.click(screen.getByRole('option', { name: 'Asia/Tokyo' }))
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => r.body)).toEqual([
      { language_locale: 'en', number_locale: 'ca_ES', date_format: 'numeric', timezone: 'Asia/Tokyo' },
    ])
    expect(onSaved).toHaveBeenCalledWith('en', 'ca_ES', 'numeric', 'Asia/Tokyo')
  })

  it("sends Catalan as the backend's ca_ES", async () => {
    const saved = fakeEndpoint('put', PREFERENCES)
    const { user, onSaved, onClose } = renderDialog({ ...CATALAN_IN_LONDON, language: 'en' })
    await choose(user, select('Display language'), 'Català')
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => (r.body as { language_locale: string }).language_locale)).toEqual(['ca_ES'])
    expect(onSaved).toHaveBeenCalledWith('ca_ES', 'en_GB', 'textual', 'Europe/London')
  })

  it('shows what now looks like, both ways, in the chosen dates format', async () => {
    const { user } = renderDialog(CATALAN_IN_LONDON)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(formatDateTime(NOW, 'en-GB', 'textual'))
    expect(dialog).toHaveTextContent(formatDateTime(NOW, 'en-GB', 'numeric'))

    await choose(user, select('Dates & times format'), 'Català')

    expect(dialog).toHaveTextContent(formatDateTime(NOW, 'ca-ES', 'textual'))
    expect(dialog).toHaveTextContent(formatDateTime(NOW, 'ca-ES', 'numeric'))
  })

  it('says so, and stays open, when saving fails', async () => {
    fakeEndpoint('put', PREFERENCES, () => new HttpResponse(null, { status: 500 }))
    const { user, onSaved, onClose } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be saved again or cancelled while saving", async () => {
    const held = heldAnswer()
    fakeEndpoint('put', PREFERENCES, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Save'))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('reopens with the settings of that moment, and without the last error', async () => {
    fakeEndpoint('put', PREFERENCES, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog(CATALAN_IN_LONDON)
    await choose(user, select('Display language'), 'English')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen({ language: 'ca_ES', numberLocale: 'ca_ES', dateFormat: 'numeric', timezone: 'Asia/Tokyo' })

    expect(select('Display language')).toHaveTextContent('Català')
    expect(select('Dates & times format')).toHaveTextContent('Català')
    expect(select('Date display on cards')).toHaveTextContent('Numeric (e.g. 27/06/2026)')
    expect(timezoneField()).toHaveValue('Asia/Tokyo')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without saving', async () => {
    const saved = fakeEndpoint('put', PREFERENCES)
    const { user, onClose } = renderDialog()
    await choose(user, select('Display language'), 'English')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saved.requests).toEqual([])
  })
})
