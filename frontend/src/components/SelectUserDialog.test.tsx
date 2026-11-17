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
  loadFailed = false,
  selectedIds = ['user-2'],
}: { candidates?: PersonSummary[] | null; loadFailed?: boolean; selectedIds?: string[] } = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  const dialog = (open: boolean, ids: string[], people: PersonSummary[] | null) => (
    <SelectUserDialog
      open={open}
      onClose={onClose}
      title="Select Members"
      candidates={people}
      loadFailed={loadFailed}
      selectedIds={ids}
      onSave={onSave}
    />
  )
  const result = renderWithProviders(dialog(true, selectedIds, candidates))
  // Closes the dialog and opens it again, as the card dialog does, with the
  // card's people as they are by then.
  let shown = selectedIds
  function reopen(ids: string[]) {
    result.rerender(dialog(false, shown, candidates))
    shown = ids
    result.rerender(dialog(true, ids, candidates))
  }
  // The board's people arriving while it's open.
  function arrive(people: PersonSummary[]) {
    result.rerender(dialog(true, shown, people))
  }
  return { ...result, onClose, onSave, reopen, arrive }
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

  it("reads each person's name once: their avatar, beside it, is hidden from screen readers", () => {
    renderDialog({ candidates: [LIAM, { ...EMMA, has_avatar: true }] })
    expect(screen.getByText('LC')).toBeVisible()
    expect(screen.queryAllByRole('img')).toEqual([])
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

  it("waits for the board's people: a spinner, no word of nobody, and no Save", () => {
    renderDialog({ candidates: null })
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByText('No users available yet.')).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeEnabled()
  })

  it('offers them, ticked as chosen, and can be saved, once they arrive', async () => {
    const { user, onSave, arrive } = renderDialog({ candidates: null })

    arrive([LIAM, EMMA])

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(box('Emma Wilson')).toBeChecked()
    await user.click(button('Save'))
    expect(onSave).toHaveBeenCalledWith([EMMA])
  })

  it("says the board's people couldn't be loaded, and offers no Save", () => {
    renderDialog({ candidates: null, loadFailed: true })
    expect(screen.getByRole('alert')).toHaveTextContent(
      "The board's people couldn't be loaded. Please close this and try again.",
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('No users available yet.')).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
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
