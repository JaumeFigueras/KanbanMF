import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { screen, waitForElementToBeRemoved, within } from '@testing-library/react'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/en-gb'
import 'dayjs/locale/ca'
import i18n from '../i18n'
import { renderWithProviders } from '../test/render'
import CardDateField from './CardDateField'

// The field as the card dialog holds it: the value lives in its parent, and
// the dialog's LocalizationProvider sets the date format from the user's
// number locale (en-gb unless a test says otherwise).
function renderField(initial: Dayjs | null = null, locale = 'en-gb') {
  const onChange = vi.fn()
  const onIncompleteChange = vi.fn()
  function Parent() {
    const [value, setValue] = useState<Dayjs | null>(initial)
    return (
      <CardDateField
        label="Start Date"
        removeLabel="Remove the start date"
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
        onIncompleteChange={onIncompleteChange}
      />
    )
  }
  const result = renderWithProviders(
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale}>
      <Parent />
    </LocalizationProvider>,
  )
  // What the field last said about being incomplete.
  const incomplete = () => onIncompleteChange.mock.calls[onIncompleteChange.mock.calls.length - 1][0]
  // The last date it handed over, as text.
  const lastDate = () => (onChange.mock.lastCall?.[0] as Dayjs | null)?.format('YYYY-MM-DD HH:mm')
  return { ...result, onChange, incomplete, lastDate }
}

const sections = () => within(screen.getByRole('group', { name: 'Start Date' })).getAllByRole('spinbutton')
const shown = () => sections().map((s) => s.textContent).join('|')
const removeButton = () => screen.getByRole('button', { name: 'Remove the start date' })
// Hidden, it isn't offered to anyone, screen readers included.
const noRemoveButton = () => expect(screen.queryByRole('button', { name: 'Remove the start date' })).not.toBeInTheDocument()

async function typeDate(user: ReturnType<typeof renderField>['user'], digits: string, section = 0) {
  await user.click(sections()[section])
  await user.keyboard(digits)
}

// Opens the picker (its calendar, in a dialog of its own) and picks a day of
// the month it shows.
async function pickDay(user: ReturnType<typeof renderField>['user'], day: string) {
  await user.click(screen.getByRole('button', { name: 'Choose date' }))
  const picker = await screen.findByRole('dialog')
  await user.click(within(picker).getByRole('gridcell', { name: day }))
  return picker
}

// Leaves the picker with one of its buttons. Until it has gone, the page
// behind it is hidden from screen readers, the field included.
async function leavePicker(user: ReturnType<typeof renderField>['user'], picker: HTMLElement, button: 'OK' | 'Cancel') {
  await user.click(within(picker).getByRole('button', { name: button }))
  await waitForElementToBeRemoved(picker)
}

describe('CardDateField', () => {
  describe('the date shown', () => {
    it.each([
      ['en-gb', '05|03|2026|10|30'],
      ['ca', '05|03|2026|10|30'],
      ['en', '03|05|2026|10|30|AM'],
    ])('follows the format of the locale it is given (%s)', (locale, expected) => {
      renderField(dayjs('2026-03-05T10:30:00'), locale)
      expect(shown()).toBe(expected)
    })

    it('can be changed by typing over a part of it', async () => {
      const { user, lastDate, incomplete } = renderField(dayjs('2026-03-05T10:30:00'))
      expect(incomplete()).toBe(false)

      // The day, then the hour.
      await typeDate(user, '07')
      await typeDate(user, '16', 3)

      expect(shown()).toBe('07|03|2026|16|30')
      expect(lastDate()).toBe('2026-03-07 16:30')
      expect(incomplete()).toBe(false)
    })
  })

  describe('a date typed only in part', () => {
    it("is reported as incomplete, as the field hands over no date", async () => {
      const { user, onChange, incomplete } = renderField()
      await typeDate(user, '05032026')
      expect(onChange).not.toHaveBeenCalled()
      expect(incomplete()).toBe(true)
    })

    it('is reported as incomplete when pasted, once the field is left', async () => {
      const { user, incomplete } = renderField()
      await user.click(sections()[0])
      await user.paste('05')

      // Left with a click elsewhere: no key is pressed at all.
      await user.click(document.body)

      expect(incomplete()).toBe(true)
      expect(removeButton()).toBeEnabled()
    })

    it('is reported complete once its time is typed too', async () => {
      const { user, lastDate, incomplete } = renderField()
      await typeDate(user, '050320261030')
      // Each minute digit is a date of its own: 10:03, then 10:30.
      expect(lastDate()).toBe('2026-03-05 10:30')
      expect(incomplete()).toBe(false)
    })

    it('can be removed with the remove button, which empties the field', async () => {
      const { user, incomplete } = renderField()
      await typeDate(user, '05')
      expect(removeButton()).toBeEnabled()

      await user.click(removeButton())

      expect(shown()).toBe('DD|MM|YYYY|hh|mm')
      expect(incomplete()).toBe(false)
      noRemoveButton()
    })
  })

  describe('an impossible date', () => {
    it('is reported as incomplete too, and said to be invalid', async () => {
      const { user, incomplete } = renderField()
      await typeDate(user, '310220261000')
      expect(incomplete()).toBe(true)
      expect(screen.getByText('Invalid date or time.')).toBeInTheDocument()
    })

    it('is complete, with no message, once corrected', async () => {
      const { user, lastDate, incomplete } = renderField()
      await typeDate(user, '310220261000')
      expect(screen.getByText('Invalid date or time.')).toBeInTheDocument()

      await typeDate(user, '28')

      expect(lastDate()).toBe('2026-02-28 10:00')
      expect(incomplete()).toBe(false)
      expect(screen.queryByText('Invalid date or time.')).not.toBeInTheDocument()
    })
  })

  it('is named by its label, and its remove button by the date it removes', () => {
    renderField(dayjs('2026-03-05T10:30:00'))
    expect(screen.getByRole('group', { name: 'Start Date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove the start date' })).toBeInTheDocument()
  })

  it('offers no remove button while empty, and the hidden one is disabled', () => {
    const { incomplete } = renderField()
    noRemoveButton()
    // A hidden element has no accessible name, so it's found by its label.
    expect(screen.getByLabelText('Remove the start date')).toBeDisabled()
    expect(incomplete()).toBe(false)
  })

  it('removes a full date with the remove button', async () => {
    const { user, onChange } = renderField(dayjs('2026-03-05T10:30:00'))
    expect(shown()).toBe('05|03|2026|10|30')

    await user.click(removeButton())

    expect(onChange).toHaveBeenCalledWith(null)
    expect(shown()).toBe('DD|MM|YYYY|hh|mm')
  })

  describe("the picker's own texts", () => {
    // Everything the open picker shows or names, on its date view and then on
    // its time view, as text.
    async function pickerTexts(user: ReturnType<typeof renderField>['user'], open: string, next: string) {
      await user.click(screen.getByRole('button', { name: open }))
      const picker = await screen.findByRole('dialog')
      const named = (role: string) => within(picker).getAllByRole(role).map((e) => e.getAttribute('aria-label') ?? e.textContent)
      const date = {
        title: picker.querySelector('.MuiPickersToolbar-title')?.textContent,
        tabs: named('tab'),
        weekdays: within(picker).getAllByRole('columnheader').map((e) => e.textContent),
        buttons: within(picker).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent),
      }
      await user.click(within(picker).getByRole('gridcell', { name: '10' }))
      await user.click(within(picker).getByRole('button', { name: next }))
      const time = {
        columns: named('listbox'),
        firstHours: named('option').slice(0, 2),
        buttons: within(picker).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent),
      }
      return { date, time }
    }

    it("are MUI's own English in English, with two-letter weekdays", async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-03-05T13:33:40Z'))
      const { user } = renderField()
      expect(shown()).toBe('DD|MM|YYYY|hh|mm')

      const { date, time } = await pickerTexts(user, 'Choose date', 'Next')

      expect(date.title).toBe('Select date & time')
      expect(date.tabs).toEqual(['pick date', 'pick time'])
      expect(date.weekdays).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
      expect(date.buttons).toEqual(expect.arrayContaining(['Previous month', 'Next month', 'Cancel', 'Next']))
      expect(time.columns).toEqual(['Select hours', 'Select minutes'])
      expect(time.firstHours).toEqual(['0 hours', '1 hour'])
      expect(time.buttons).toEqual(expect.arrayContaining(['Cancel', 'OK']))
    })

    it("are KanbanMF's Catalan in Catalan, not MUI's", async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-03-05T13:33:40Z'))
      await i18n.changeLanguage('ca')
      const { user } = renderField(null, 'ca')
      expect(shown()).toBe('DD|MM|AAAA|hh|mm')

      const { date, time } = await pickerTexts(user, 'Tria la data', 'Següent')

      expect(date.title).toBe("Tria la data i l'hora")
      expect(date.tabs).toEqual(['tria la data', "tria l'hora"])
      // MUI's one letter would be a D for every day.
      expect(date.weekdays).toEqual(['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'])
      expect(date.buttons).toEqual(expect.arrayContaining(['Mes anterior', 'Mes següent', 'Cancel·la', 'Següent']))
      expect(time.columns).toEqual(['Tria les hores', 'Tria els minuts'])
      expect(time.firstHours).toEqual(['0 hores', '1 hora'])
      expect(time.buttons).toEqual(expect.arrayContaining(['Cancel·la', "D'acord"]))
    })
  })

  describe('the picker, on an empty field', () => {
    // Only Date is faked: the picker's own timers keep running.
    const at = (instant: string) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(instant))
    }

    it('gives a picked day the time of now, to the nearest 5 minutes', async () => {
      // 14:33:40 in Madrid, the tests' time zone: nearer 14:35 than 14:30,
      // and MUI on its own would give midnight.
      at('2026-03-05T13:33:40Z')
      const { user, lastDate } = renderField()

      const picker = await pickDay(user, '10')
      await user.click(within(picker).getByRole('button', { name: 'Next' }))
      await leavePicker(user, picker, 'OK')

      expect(lastDate()).toBe('2026-03-10 14:35')
      expect(shown()).toBe('10|03|2026|14|35')
      expect(removeButton()).toBeEnabled()
    })

    it('takes the time afresh each time it opens', async () => {
      at('2026-03-05T13:33:40Z')
      const { user, lastDate } = renderField()
      let picker = await pickDay(user, '10')
      await leavePicker(user, picker, 'Cancel')
      expect(shown()).toBe('DD|MM|YYYY|hh|mm')

      // 15:58 in Madrid: the nearest 5 minutes are in the next hour.
      vi.setSystemTime(new Date('2026-03-05T14:58:00Z'))
      picker = await pickDay(user, '10')
      await user.click(within(picker).getByRole('button', { name: 'Next' }))
      await leavePicker(user, picker, 'OK')

      expect(lastDate()).toBe('2026-03-10 16:00')
      expect(shown()).toBe('10|03|2026|16|00')
    })
  })
})
