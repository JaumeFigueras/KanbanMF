import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import ChangePasswordDialog from './ChangePasswordDialog'

const PASSWORD = '/api/v1/users/me/password'

function renderDialog() {
  const onClose = vi.fn()
  const dialog = (open: boolean) => <ChangePasswordDialog open={open} onClose={onClose} />
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the app bar's menu does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, reopen }
}

// Password fields have no role, so they're found by their label.
function field(label: 'Current password' | 'New password' | 'Confirm password') {
  return screen.getByLabelText(label)
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

// Fills the three fields; each can be left out with ''.
async function fill(user: ReturnType<typeof renderDialog>['user'], current: string, next: string, confirm: string) {
  if (current) await user.type(field('Current password'), current)
  if (next) await user.type(field('New password'), next)
  if (confirm) await user.type(field('Confirm password'), confirm)
}

describe('ChangePasswordDialog', () => {
  it('opens empty, with the passwords hidden, and says it signs out other devices', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Change password' })
    for (const label of ['Current password', 'New password', 'Confirm password'] as const) {
      expect(field(label)).toHaveValue('')
      expect(field(label)).toHaveAttribute('type', 'password')
    }
    expect(dialog).toHaveTextContent('This signs you out on every other device and browser. You stay signed in here.')
  })

  it("shows or hides each password with its own button, named for what it'll do", async () => {
    const { user } = renderDialog()
    const [showCurrent] = screen.getAllByRole('button', { name: 'Show password' })

    await user.click(showCurrent)

    expect(field('Current password')).toHaveAttribute('type', 'text')
    expect(field('New password')).toHaveAttribute('type', 'password')
    expect(screen.getAllByRole('button', { name: 'Hide password' })).toHaveLength(1)
    await user.click(button('Hide password'))
    expect(field('Current password')).toHaveAttribute('type', 'password')
  })

  it('shows the new password and its confirmation with their own buttons', async () => {
    const { user } = renderDialog()
    await user.click(screen.getAllByRole('button', { name: 'Show password' })[1])
    expect(field('New password')).toHaveAttribute('type', 'text')
    await user.click(screen.getAllByRole('button', { name: 'Show password' })[1])
    expect(field('Confirm password')).toHaveAttribute('type', 'text')
  })

  it('sends the current and the new password, then closes', async () => {
    const changed = fakeEndpoint('put', PASSWORD)
    const { user, onClose } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 1')
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(changed.requests.map((r) => r.body)).toEqual([{ old_password: 'old secret', new_password: 'new secret 1' }])
  })

  it.each([
    ['the current password', '', 'new secret 1', 'new secret 1', 'Current password is required.'],
    ['the new password', 'old secret', '', 'new secret 1', 'New password is required.'],
    ['the confirmation', 'old secret', 'new secret 1', '', 'Please confirm your new password.'],
  ])('asks for %s, sending nothing', async (_, current, next, confirm, message) => {
    const changed = fakeEndpoint('put', PASSWORD)
    const { user } = renderDialog()
    await fill(user, current, next, confirm)
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(changed.requests).toEqual([])
  })

  it("refuses a new password the backend wouldn't take, sending nothing", async () => {
    const changed = fakeEndpoint('put', PASSWORD)
    const { user } = renderDialog()
    await fill(user, 'old secret', 'short', 'short')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('The password must be at least 8 characters long.')
    expect(changed.requests).toEqual([])
  })

  it("refuses a confirmation that doesn't match, sending nothing", async () => {
    const changed = fakeEndpoint('put', PASSWORD)
    const { user } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 2')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(changed.requests).toEqual([])
  })

  it('says so when the current password is wrong', async () => {
    fakeEndpoint('put', PASSWORD, () =>
      HttpResponse.json({ detail: 'Current password is incorrect' }, { status: 400 }))
    const { user, onClose } = renderDialog()
    await fill(user, 'wrong', 'new secret 1', 'new secret 1')
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says something went wrong for any other refusal', async () => {
    fakeEndpoint('put', PASSWORD, () => HttpResponse.json({ detail: 'No local account found' }, { status: 400 }))
    const { user, onClose } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 1')
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says to wait after too many attempts', async () => {
    fakeEndpoint('put', PASSWORD, () => HttpResponse.json({ detail: 'Too many requests' }, { status: 429 }))
    const { user, onClose } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 1')
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait a few minutes and try again.',
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so, and stays open, when the change fails', async () => {
    fakeEndpoint('put', PASSWORD, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 1')
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be saved again or cancelled while saving", async () => {
    const held = heldAnswer()
    fakeEndpoint('put', PASSWORD, held.answer)
    const { user, onClose } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 1')

    await user.click(button('Save'))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('reopens empty and hidden, without the last error', async () => {
    const { user, reopen } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 2')
    for (const show of screen.getAllByRole('button', { name: 'Show password' })) await user.click(show)
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen()

    for (const label of ['Current password', 'New password', 'Confirm password'] as const) {
      expect(field(label)).toHaveValue('')
      expect(field(label)).toHaveAttribute('type', 'password')
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without sending anything', async () => {
    const changed = fakeEndpoint('put', PASSWORD)
    const { user, onClose } = renderDialog()
    await fill(user, 'old secret', 'new secret 1', 'new secret 1')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(changed.requests).toEqual([])
  })
})
