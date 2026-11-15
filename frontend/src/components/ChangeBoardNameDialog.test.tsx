import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ChangeBoardNameDialog from './ChangeBoardNameDialog'

const PATCH_BOARD = '/api/v1/boards/:boardId'
const BOARD = makeBoard({ id: 'board-7', name: 'Website redesign' })

function renderDialog(board: BoardRead | null = BOARD) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, shown: BoardRead | null) => (
    <ChangeBoardNameDialog open={open} onClose={onClose} board={shown} onSaved={onSaved} />
  )
  const result = renderWithProviders(dialog(true, board))
  // Closes the dialog and opens it again, as the boards page does; `next` is
  // the board by then (renamed meanwhile by someone it is shared with, say).
  let shown = board
  function reopen(next: BoardRead | null) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onSaved, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Board name' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

function savesBoard() {
  return fakeEndpoint('patch', PATCH_BOARD, () => HttpResponse.json(BOARD))
}

describe('ChangeBoardNameDialog', () => {
  it("opens with the board's current name", () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Change Name' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Website redesign')
  })

  it('takes at most 255 characters, as the backend does', () => {
    renderDialog()
    expect(nameField()).toHaveAttribute('maxlength', '255')
  })

  it('saves the new name, trimmed, then tells the caller and closes', async () => {
    const saved = savesBoard()
    const { user, onClose, onSaved } = renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), '  Website relaunch  ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7', { name: 'Website relaunch' }],
    ])
    expect(onSaved).toHaveBeenCalledWith('board-7', 'Website relaunch')
  })

  it('saves on Enter too', async () => {
    const saved = savesBoard()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests).toHaveLength(1)
  })

  it('refuses a blank name, sending nothing', async () => {
    const saved = savesBoard()
    const { user } = renderDialog()
    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Board name is required.')
    expect(saved.requests).toEqual([])
  })

  it('says so, and stays open, when saving fails', async () => {
    fakeEndpoint('patch', PATCH_BOARD, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onSaved } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends nothing more while a save runs, by button or by Enter', async () => {
    const held = heldAnswer(() => HttpResponse.json(BOARD))
    const saved = fakeEndpoint('patch', PATCH_BOARD, held.answer)
    const { user, onClose } = renderDialog()

    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(saved.requests).toHaveLength(1))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()
    await user.type(nameField(), '{Enter}')

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests).toHaveLength(1)
  })

  it("reopens with the board's name again, and without the last error", async () => {
    fakeEndpoint('patch', PATCH_BOARD, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog()
    await user.type(nameField(), ' 2')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen(makeBoard({ id: 'board-7', name: 'Website relaunch' }))

    expect(nameField()).toHaveValue('Website relaunch')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without saving', async () => {
    const saved = savesBoard()
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saved.requests).toEqual([])
  })

  it('saves nothing without a board', async () => {
    const saved = savesBoard()
    const { user, onSaved } = renderDialog(null)
    await user.type(nameField(), 'Website relaunch')
    await user.click(button('Save'))
    expect(saved.requests).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
