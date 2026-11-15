import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { LabelRead } from '../types/board'
import { makeLabel } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import EditLabelDialog from './EditLabelDialog'

const BUG = makeLabel({ name: 'Bug', color: '#D32F2F' })

interface Shown {
  label?: LabelRead | null
  saving?: boolean
  error?: string | null
}

// The dialog only collects the form: ManageLabelsDialog sends it, and
// passes back `saving` and `error`, which the tests set directly.
function renderDialog(initial: Shown = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  let shown: Required<Shown> = { label: null, saving: false, error: null, ...initial }
  const dialog = (open: boolean) => (
    <EditLabelDialog open={open} onClose={onClose} {...shown} onSave={onSave} />
  )
  const result = renderWithProviders(dialog(true))
  function update(next: Shown) {
    shown = { ...shown, ...next }
    result.rerender(dialog(true))
  }
  // Closes the dialog and opens it again for `label`. The colour picker's
  // field starts fresh because the dialog unmounts it once closed, at the
  // end of the closing animation, so that's waited for.
  async function reopen(label: LabelRead | null) {
    result.rerender(dialog(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    shown = { ...shown, label }
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onSave, update, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Label name' })
}

function hexField() {
  return screen.getByRole('textbox', { name: 'Hex color code' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('EditLabelDialog', () => {
  it('opens blank for a new label, with the default colour', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create New Label' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('')
    expect(hexField()).toHaveValue('#6366F1')
  })

  it("opens with a label's name and colour to edit it", () => {
    renderDialog({ label: BUG })
    expect(screen.getByRole('dialog', { name: 'Edit label' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Bug')
    expect(hexField()).toHaveValue('#D32F2F')
  })

  it('takes at most 100 characters, as the backend does', () => {
    renderDialog()
    expect(nameField()).toHaveAttribute('maxlength', '100')
  })

  it('hands over the trimmed name and the picked colour', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.type(nameField(), '  Urgent  ')
    await user.click(button('#FF9800'))
    await user.click(button('Save'))
    expect(onSave.mock.calls).toEqual([[{ name: 'Urgent', color: '#FF9800' }]])
    // Closing is up to the caller, once the label is saved.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hands them over on Enter too', async () => {
    const { user, onSave } = renderDialog({ label: BUG })
    await user.type(nameField(), '{Enter}')
    expect(onSave.mock.calls).toEqual([[{ name: 'Bug', color: '#D32F2F' }]])
  })

  it('refuses a blank name, saying so under the field', async () => {
    const { user, onSave } = renderDialog()
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(nameField()).toBeInvalid()
    expect(nameField()).toHaveAccessibleDescription('Label name is required.')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('drops that message as soon as the name is typed again', async () => {
    const { user } = renderDialog()
    await user.click(button('Save'))
    await user.type(nameField(), 'U')
    expect(nameField()).toBeValid()
    expect(nameField()).not.toHaveAccessibleDescription()
  })

  it('shows the error it is given', () => {
    renderDialog({ error: 'Something went wrong. Please try again.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
  })

  it('takes nothing while the caller saves', () => {
    renderDialog({ saving: true })
    expect(nameField()).toBeDisabled()
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()
  })

  it('reopens with the next label, and without the last message', async () => {
    const { user, reopen } = renderDialog()
    await user.click(button('#FF9800'))
    await user.click(button('Save'))

    await reopen(BUG)

    expect(nameField()).toHaveValue('Bug')
    expect(hexField()).toHaveValue('#D32F2F')
    expect(nameField()).toBeValid()
  })

  it('closes on Cancel without handing anything over', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.type(nameField(), 'Urgent')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
