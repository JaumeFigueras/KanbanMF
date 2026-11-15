import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import ChangeDisplayNameDialog from './ChangeDisplayNameDialog'

const ME = '/api/v1/users/me'
const PREFERENCES = '/api/v1/users/me/preferences'

interface Current {
  name: string
  initials: string | null
}

function renderDialog(current: Current = { name: 'Liam Chen', initials: 'LC' }) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, shown: Current) => (
    <ChangeDisplayNameDialog
      open={open}
      onClose={onClose}
      currentDisplayName={shown.name}
      currentInitials={shown.initials}
      onSaved={onSaved}
    />
  )
  const result = renderWithProviders(dialog(true, current))
  // Closes the dialog and opens it again, as the app bar's menu does, with
  // the name and initials as they are by then.
  let shown = current
  function reopen(next: Current) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onSaved, reopen }
}

// Both requests answer 204 unless a test says otherwise.
function savesBoth() {
  return { name: fakeEndpoint('put', ME), initials: fakeEndpoint('put', PREFERENCES) }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Display name' })
}

function initialsField() {
  return screen.getByRole('textbox', { name: 'Initials' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('ChangeDisplayNameDialog', () => {
  it('opens with the current name and initials', () => {
    renderDialog({ name: 'Liam Chen', initials: 'LC' })
    expect(screen.getByRole('dialog', { name: 'Change display name and initials' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Liam Chen')
    expect(initialsField()).toHaveValue('LC')
  })

  it('opens with the initials blank when none are set', () => {
    renderDialog({ name: 'Liam Chen', initials: null })
    expect(initialsField()).toHaveValue('')
  })

  it('takes at most 100 characters for the name and 3 for the initials, as the backend does', () => {
    renderDialog()
    expect(nameField()).toHaveAttribute('maxlength', '100')
    expect(initialsField()).toHaveAttribute('maxlength', '3')
  })

  it('saves the trimmed name and initials, then tells the caller, in capitals, and closes', async () => {
    const saved = savesBoth()
    const { user, onSaved, onClose } = renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), '  Liam Chen-Wu  ')
    await user.clear(initialsField())
    await user.type(initialsField(), ' lw')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.name.requests.map((r) => r.body)).toEqual([{ display_name: 'Liam Chen-Wu' }])
    expect(saved.initials.requests.map((r) => r.body)).toEqual([{ initials: 'lw' }])
    expect(onSaved).toHaveBeenCalledWith('Liam Chen-Wu', 'LW')
  })

  it('clears the initials when left blank, so the name gives them', async () => {
    const saved = savesBoth()
    const { user, onSaved, onClose } = renderDialog()
    await user.clear(initialsField())
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.initials.requests.map((r) => r.body)).toEqual([{ initials: null }])
    expect(onSaved).toHaveBeenCalledWith('Liam Chen', null)
  })

  it('takes accented initials, as the backend does', async () => {
    const saved = savesBoth()
    const { user, onSaved, onClose } = renderDialog({ name: 'Àngel Garcia', initials: null })
    await user.type(initialsField(), 'àg')
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.initials.requests.map((r) => r.body)).toEqual([{ initials: 'àg' }])
    expect(onSaved).toHaveBeenCalledWith('Àngel Garcia', 'ÀG')
  })

  it('refuses a blank name, sending nothing', async () => {
    const saved = savesBoth()
    const { user } = renderDialog()
    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Display name cannot be blank.')
    expect([...saved.name.requests, ...saved.initials.requests]).toEqual([])
  })

  it('refuses initials with anything but letters and digits, sending nothing', async () => {
    const saved = savesBoth()
    const { user } = renderDialog()
    await user.clear(initialsField())
    await user.type(initialsField(), 'L.C')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Initials must be 1–3 letters or digits.')
    expect([...saved.name.requests, ...saved.initials.requests]).toEqual([])
  })

  it('says so, and stays open, when the name fails to save', async () => {
    fakeEndpoint('put', ME, () => new HttpResponse(null, { status: 500 }))
    fakeEndpoint('put', PREFERENCES)
    const { user, onSaved, onClose } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so, and stays open, when the initials fail to save', async () => {
    fakeEndpoint('put', ME)
    fakeEndpoint('put', PREFERENCES, () => new HttpResponse(null, { status: 500 }))
    const { user, onSaved, onClose } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be saved again or cancelled while saving", async () => {
    const held = heldAnswer()
    fakeEndpoint('put', ME, held.answer)
    fakeEndpoint('put', PREFERENCES)
    const { user, onClose } = renderDialog()

    await user.click(button('Save'))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('reopens with the name and initials of that moment, and without the last error', async () => {
    const { user, reopen } = renderDialog({ name: 'Liam Chen', initials: 'LC' })
    await user.clear(nameField())
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen({ name: 'Liam Chen-Wu', initials: 'LW' })

    expect(nameField()).toHaveValue('Liam Chen-Wu')
    expect(initialsField()).toHaveValue('LW')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without saving', async () => {
    const saved = savesBoth()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), '-Wu')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect([...saved.name.requests, ...saved.initials.requests]).toEqual([])
  })
})
