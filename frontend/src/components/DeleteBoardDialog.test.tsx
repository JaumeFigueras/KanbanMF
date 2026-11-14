import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import DeleteBoardDialog from './DeleteBoardDialog'

const DELETE_BOARD = '/api/v1/boards/:boardId'

function renderDialog(board: BoardRead | null = makeBoard({ id: 'board-7', name: 'Website redesign' })) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  const result = renderWithProviders(
    <DeleteBoardDialog open onClose={onClose} board={board} onDeleted={onDeleted} />,
  )
  return { ...result, onClose, onDeleted }
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('DeleteBoardDialog', () => {
  it('asks to confirm deleting the board, by name', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Delete Board' })).toHaveTextContent(
      'Are you sure you want to permanently delete "Website redesign"? This cannot be undone.',
    )
  })

  it('says template for a template', () => {
    renderDialog(makeBoard({ is_template: true }))
    expect(screen.getByRole('dialog', { name: 'Delete Template' })).toBeInTheDocument()
  })

  it('deletes the board, then tells the caller and closes', async () => {
    const deleted = fakeEndpoint('delete', DELETE_BOARD)
    const { user, onClose, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7'])
    expect(onDeleted).toHaveBeenCalledWith('board-7')
  })

  it('says so, and stays open, when the deletion fails', async () => {
    fakeEndpoint('delete', DELETE_BOARD, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be cancelled or closed while the deletion runs", async () => {
    const held = heldAnswer()
    fakeEndpoint('delete', DELETE_BOARD, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Delete'))
    expect(button('Delete')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()
    // Disabling the clicked button drops the focus; MUI's focus trap puts it
    // back in the dialog a moment later, and Escape only works from there.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on Cancel, or Escape, without deleting', async () => {
    const deleted = fakeEndpoint('delete', DELETE_BOARD)
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(deleted.requests).toEqual([])
  })

  it('forgets the error of a failed attempt once cancelled', async () => {
    fakeEndpoint('delete', DELETE_BOARD, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await user.click(button('Delete'))
    await screen.findByRole('alert')

    await user.click(button('Cancel'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does nothing without a board', async () => {
    const deleted = fakeEndpoint('delete', DELETE_BOARD)
    const { user, onClose, onDeleted } = renderDialog(null)
    await user.click(button('Delete'))
    expect(deleted.requests).toEqual([])
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
