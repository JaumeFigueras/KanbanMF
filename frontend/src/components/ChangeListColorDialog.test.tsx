import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardListRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ChangeListColorDialog from './ChangeListColorDialog'

const LIST_COLOR = '/api/v1/boards/:boardId/lists/:listId/color'
const LIST = makeList({ id: 'list-3', board_id: 'board-7' })

function renderDialog({ list = LIST, currentColor = '#2196F3' }: { list?: BoardListRead | null; currentColor?: string | null } = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, color: string | null) => (
    <ChangeListColorDialog open={open} onClose={onClose} list={list} currentColor={color} onSaved={onSaved} />
  )
  const result = renderWithProviders(dialog(true, currentColor))
  // Closes the dialog and opens it again, as the board page does; `color` is the
  // list's colour by then (changed in another tab, and picked up by a refetch,
  // say). The picker's field starts fresh because the dialog unmounts it once closed,
  // at the end of the closing animation, so that's waited for.
  let shown = currentColor
  async function reopen(color: string | null) {
    result.rerender(dialog(false, shown))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    shown = color
    result.rerender(dialog(true, color))
  }
  return { ...result, onClose, onSaved, reopen }
}

function hexField() {
  return screen.getByRole('textbox', { name: 'Hex color code' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

function chosenSwatch() {
  return screen.getByRole('button', { pressed: true })
}

describe('ChangeListColorDialog', () => {
  it("opens with the list's colour", () => {
    renderDialog({ currentColor: '#2196F3' })
    expect(screen.getByRole('dialog', { name: 'Change Color' })).toBeInTheDocument()
    expect(hexField()).toHaveValue('#2196F3')
    expect(chosenSwatch()).toHaveAccessibleName('#2196F3')
  })

  it('opens with the default purple when the list has no colour of its own', () => {
    renderDialog({ currentColor: null })
    expect(hexField()).toHaveValue('#9C27B0')
    expect(chosenSwatch()).toHaveAccessibleName('#9C27B0')
  })

  it('saves the picked colour, then tells the caller and closes', async () => {
    const saved = fakeEndpoint('put', LIST_COLOR)
    const { user, onClose, onSaved } = renderDialog()

    await user.click(button('#4CAF50'))
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7/lists/list-3/color', { color: '#4CAF50' }],
    ])
    expect(onSaved).toHaveBeenCalledWith('#4CAF50')
  })

  it('goes back to the default colour on Reset, then tells the caller and closes', async () => {
    const reset = fakeEndpoint('delete', LIST_COLOR)
    const { user, onClose, onSaved } = renderDialog()

    await user.click(button('Reset to default'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(reset.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7/lists/list-3/color'])
    expect(onSaved).toHaveBeenCalledWith(null)
  })

  it('says so, and stays open, when saving fails', async () => {
    fakeEndpoint('put', LIST_COLOR, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onSaved } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so, and stays open, when resetting fails', async () => {
    fakeEndpoint('delete', LIST_COLOR, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onSaved } = renderDialog()
    await user.click(button('Reset to default'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes no other click while a save runs', async () => {
    const held = heldAnswer()
    fakeEndpoint('put', LIST_COLOR, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Save'))
    for (const name of ['Save', 'Cancel', 'Reset to default']) expect(button(name)).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('takes no other click while a reset runs', async () => {
    const held = heldAnswer()
    fakeEndpoint('delete', LIST_COLOR, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Reset to default'))
    for (const name of ['Save', 'Cancel', 'Reset to default']) expect(button(name)).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("reopens with the list's colour again, and without the last error", async () => {
    fakeEndpoint('put', LIST_COLOR, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog({ currentColor: '#2196F3' })
    await user.click(button('#4CAF50'))
    await user.click(button('Save'))
    await screen.findByRole('alert')

    await reopen('#F44336')

    expect(hexField()).toHaveValue('#F44336')
    expect(chosenSwatch()).toHaveAccessibleName('#F44336')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without saving', async () => {
    const saved = fakeEndpoint('put', LIST_COLOR)
    const reset = fakeEndpoint('delete', LIST_COLOR)
    const { user, onClose } = renderDialog()
    await user.click(button('#4CAF50'))
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saved.requests).toEqual([])
    expect(reset.requests).toEqual([])
  })

  it('saves nothing without a list', async () => {
    const saved = fakeEndpoint('put', LIST_COLOR)
    const reset = fakeEndpoint('delete', LIST_COLOR)
    const { user, onSaved } = renderDialog({ list: null })
    await user.click(button('Save'))
    await user.click(button('Reset to default'))
    expect(saved.requests).toEqual([])
    expect(reset.requests).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
