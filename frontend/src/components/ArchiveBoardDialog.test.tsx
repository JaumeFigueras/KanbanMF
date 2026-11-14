import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ArchiveBoardDialog from './ArchiveBoardDialog'

const PATCH_BOARD = '/api/v1/boards/:boardId'

function renderDialog(board: BoardRead | null = makeBoard({ id: 'board-7', name: 'Website redesign' })) {
  const onClose = vi.fn()
  const onArchived = vi.fn()
  const result = renderWithProviders(
    <ArchiveBoardDialog open onClose={onClose} board={board} onArchived={onArchived} />,
  )
  return { ...result, onClose, onArchived }
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('ArchiveBoardDialog', () => {
  it('asks to confirm archiving the board, by name', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Archive Board' })).toHaveTextContent(
      'Are you sure you want to archive "Website redesign"? It will be hidden from your boards list.',
    )
  })

  it('says template for a template', () => {
    renderDialog(makeBoard({ is_template: true }))
    expect(screen.getByRole('dialog', { name: 'Archive Template' })).toBeInTheDocument()
  })

  it('archives the board, then tells the caller and closes', async () => {
    const archived = fakeEndpoint('patch', PATCH_BOARD, () => HttpResponse.json(makeBoard()))
    const { user, onClose, onArchived } = renderDialog()

    await user.click(button('Archive'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(archived.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7', { is_archived: true }],
    ])
    expect(onArchived).toHaveBeenCalledWith('board-7')
  })

  it('says so, and stays open, when archiving fails', async () => {
    fakeEndpoint('patch', PATCH_BOARD, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onArchived } = renderDialog()

    await user.click(button('Archive'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onArchived).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be cancelled or closed while archiving runs", async () => {
    const held = heldAnswer()
    fakeEndpoint('patch', PATCH_BOARD, held.answer)
    const { user, onClose } = renderDialog()

    await user.click(button('Archive'))
    expect(button('Archive')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()
    // Disabling the clicked button drops the focus; MUI's focus trap puts it
    // back in the dialog a moment later, and Escape only works from there.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('closes on Cancel, or Escape, without archiving', async () => {
    const archived = fakeEndpoint('patch', PATCH_BOARD)
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(archived.requests).toEqual([])
  })

  it('forgets the error of a failed attempt once cancelled', async () => {
    fakeEndpoint('patch', PATCH_BOARD, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await user.click(button('Archive'))
    await screen.findByRole('alert')

    await user.click(button('Cancel'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does nothing without a board', async () => {
    const archived = fakeEndpoint('patch', PATCH_BOARD)
    const { user, onClose, onArchived } = renderDialog(null)
    await user.click(button('Archive'))
    expect(archived.requests).toEqual([])
    expect(onArchived).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
