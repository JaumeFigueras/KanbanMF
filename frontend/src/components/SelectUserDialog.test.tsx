import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { PersonSummary } from '../types/board'
import { makePerson } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import SelectUserDialog from './SelectUserDialog'

const LIAM = makePerson({ id: 'user-1', display_name: 'Liam Chen' })
const EMMA = makePerson({ id: 'user-2', display_name: 'Emma Wilson' })
const NOAH = makePerson({ id: 'user-3', display_name: 'Noah Garcia' })

function renderDialog({
  candidates = [LIAM, EMMA, NOAH],
  selectedIds = ['user-2'],
}: { candidates?: PersonSummary[]; selectedIds?: string[] } = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  const dialog = (open: boolean, ids: string[]) => (
    <SelectUserDialog
      open={open}
      onClose={onClose}
      title="Select Members"
      candidates={candidates}
      selectedIds={ids}
      onSave={onSave}
    />
  )
  const result = renderWithProviders(dialog(true, selectedIds))
  // Closes the dialog and opens it again, as the card dialog does, with the
  // card's people as they are by then.
  let shown = selectedIds
  function reopen(ids: string[]) {
    result.rerender(dialog(false, shown))
    shown = ids
    result.rerender(dialog(true, ids))
  }
  return { ...result, onClose, onSave, reopen }
}

function box(name: string) {
  return screen.getByRole('checkbox', { name })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('SelectUserDialog', () => {
  it('lists the people to choose from under its title, with the chosen ones ticked', () => {
    renderDialog({ selectedIds: ['user-2'] })
    expect(screen.getByRole('dialog', { name: 'Select Members' })).toBeInTheDocument()
    expect(box('Liam Chen')).not.toBeChecked()
    expect(box('Emma Wilson')).toBeChecked()
    expect(box('Noah Garcia')).not.toBeChecked()
  })

  it('ticks a person with a click on their name, and unticks them with another', async () => {
    const { user } = renderDialog()
    await user.click(screen.getByText('Liam Chen'))
    expect(box('Liam Chen')).toBeChecked()
    await user.click(screen.getByText('Liam Chen'))
    expect(box('Liam Chen')).not.toBeChecked()
  })

  it('ticks a person with their box too', async () => {
    const { user } = renderDialog()
    await user.click(box('Noah Garcia'))
    expect(box('Noah Garcia')).toBeChecked()
  })

  it('hands over the ticked people, in the order shown, then closes', async () => {
    const { user, onSave, onClose } = renderDialog({ selectedIds: ['user-3'] })
    await user.click(box('Liam Chen'))
    await user.click(button('Save'))
    expect(onSave.mock.calls).toEqual([[[LIAM, NOAH]]])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops a chosen person who is no longer among those to choose from', async () => {
    const { user, onSave } = renderDialog({ selectedIds: ['user-2', 'user-gone'] })
    await user.click(button('Save'))
    expect(onSave.mock.calls).toEqual([[[EMMA]]])
  })

  it('says so when there is nobody to choose', () => {
    renderDialog({ candidates: [], selectedIds: [] })
    expect(screen.getByText('No users available yet.')).toBeInTheDocument()
  })

  it('reopens with the people chosen by then, forgetting unsaved ticks', async () => {
    const { user, reopen } = renderDialog({ selectedIds: ['user-2'] })
    await user.click(box('Liam Chen'))
    await user.click(button('Cancel'))

    reopen(['user-3'])

    expect(box('Liam Chen')).not.toBeChecked()
    expect(box('Emma Wilson')).not.toBeChecked()
    expect(box('Noah Garcia')).toBeChecked()
  })

  it('closes on Cancel without saving', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.click(box('Liam Chen'))
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
