import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ChangeBoardColorDialog from './ChangeBoardColorDialog'

const BOARD_COLOR = '/api/v1/boards/:boardId/color'
const BOARD = makeBoard({ id: 'board-7' })

function renderDialog({ board = BOARD, currentColor = '#2196F3' }: { board?: BoardRead | null; currentColor?: string | null } = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, color: string | null) => (
    <ChangeBoardColorDialog open={open} onClose={onClose} board={board} currentColor={color} onSaved={onSaved} />
  )
  const result = renderWithProviders(dialog(true, currentColor))
  // Closes the dialog and opens it again, as the boards page does; `color` is the
  // board's colour by then (changed in another tab, and picked up by a refetch,
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

describe('ChangeBoardColorDialog', () => {
  it("opens with the board's colour", () => {
    renderDialog({ currentColor: '#2196F3' })
    expect(screen.getByRole('dialog', { name: 'Change Color' })).toBeInTheDocument()
    expect(hexField()).toHaveValue('#2196F3')
    expect(chosenSwatch()).toHaveAccessibleName('#2196F3')
  })

  it('opens with the default purple when the board has no colour of its own', () => {
    renderDialog({ currentColor: null })
    expect(hexField()).toHaveValue('#9C27B0')
    expect(chosenSwatch()).toHaveAccessibleName('#9C27B0')
  })

  it('saves the picked colour, then tells the caller and closes', async () => {
    const saved = fakeEndpoint('put', BOARD_COLOR)
    const { user, onClose, onSaved } = renderDialog()

    await user.click(button('#4CAF50'))
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7/color', { color: '#4CAF50' }],
    ])
    expect(onSaved).toHaveBeenCalledWith('#4CAF50')
  })

  it('goes back to the default colour on Reset, then tells the caller and closes', async () => {
    const reset = fakeEndpoint('delete', BOARD_COLOR)
    const { user, onClose, onSaved } = renderDialog()

    await user.click(button('Reset to default'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(reset.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7/color'])
    expect(onSaved).toHaveBeenCalledWith(null)
  })

  it('says so, and stays open, when saving fails', async () => {
    fakeEndpoint('put', BOARD_COLOR, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onSaved } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so, and stays open, when resetting fails', async () => {
    fakeEndpoint('delete', BOARD_COLOR, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onSaved } = renderDialog()
    await user.click(button('Reset to default'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes no other click while a save runs', async () => {
    const held = heldAnswer()
    fakeEndpoint('put', BOARD_COLOR, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Save'))
    for (const name of ['Save', 'Cancel', 'Reset to default']) expect(button(name)).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('takes no other click while a reset runs', async () => {
    const held = heldAnswer()
    fakeEndpoint('delete', BOARD_COLOR, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Reset to default'))
    for (const name of ['Save', 'Cancel', 'Reset to default']) expect(button(name)).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("reopens with the board's colour again, and without the last error", async () => {
    fakeEndpoint('put', BOARD_COLOR, () => new HttpResponse(null, { status: 500 }))
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
    const saved = fakeEndpoint('put', BOARD_COLOR)
    const reset = fakeEndpoint('delete', BOARD_COLOR)
    const { user, onClose } = renderDialog()
    await user.click(button('#4CAF50'))
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saved.requests).toEqual([])
    expect(reset.requests).toEqual([])
  })

  it('saves nothing without a board', async () => {
    const saved = fakeEndpoint('put', BOARD_COLOR)
    const reset = fakeEndpoint('delete', BOARD_COLOR)
    const { user, onSaved } = renderDialog({ board: null })
    await user.click(button('Save'))
    await user.click(button('Reset to default'))
    expect(saved.requests).toEqual([])
    expect(reset.requests).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
