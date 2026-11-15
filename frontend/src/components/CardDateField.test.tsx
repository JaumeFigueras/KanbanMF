import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/en-gb'
import { renderWithProviders } from '../test/render'
import CardDateField from './CardDateField'

// The field as the card dialog holds it: the value lives in its parent.
function renderField(initial: Dayjs | null = null) {
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
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
      <Parent />
    </LocalizationProvider>,
  )
  // What the field last said about being incomplete.
  const incomplete = () => onIncompleteChange.mock.calls[onIncompleteChange.mock.calls.length - 1][0]
  return { ...result, onChange, incomplete }
}

const sections = () => within(screen.getByRole('group', { name: 'Start Date' })).getAllByRole('spinbutton')
const shown = () => sections().map((s) => s.textContent).join('|')
const removeButton = () => screen.getByRole('button', { name: 'Remove the start date' })
// Hidden, it isn't offered to anyone, screen readers included.
const noRemoveButton = () => expect(screen.queryByRole('button', { name: 'Remove the start date' })).not.toBeInTheDocument()

async function typeDate(user: ReturnType<typeof renderField>['user'], digits: string) {
  await user.click(sections()[0])
  await user.keyboard(digits)
}

describe('CardDateField', () => {
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
      const { user, onChange, incomplete } = renderField()
      await typeDate(user, '050320261030')
      // Each minute digit is a date of its own: 10:03, then 10:30.
      expect(onChange.mock.lastCall?.[0].format('YYYY-MM-DD HH:mm')).toBe('2026-03-05 10:30')
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

  it('reports an impossible date as incomplete too, and says it is invalid', async () => {
    const { user, incomplete } = renderField()
    await typeDate(user, '310220261000')
    expect(incomplete()).toBe(true)
    expect(screen.getByText('Invalid date or time.')).toBeInTheDocument()
  })

  it('is named by its label, and its remove button by the date it removes', () => {
    renderField(dayjs('2026-03-05T10:30:00'))
    expect(screen.getByRole('group', { name: 'Start Date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove the start date' })).toBeInTheDocument()
  })

  it('offers no remove button while empty', () => {
    const { incomplete } = renderField()
    noRemoveButton()
    expect(incomplete()).toBe(false)
  })

  it('removes a full date with the remove button', async () => {
    const { user, onChange } = renderField(dayjs('2026-03-05T10:30:00'))
    expect(shown()).toBe('05|03|2026|10|30')

    await user.click(removeButton())

    expect(onChange).toHaveBeenCalledWith(null)
    expect(shown()).toBe('DD|MM|YYYY|hh|mm')
  })
})
