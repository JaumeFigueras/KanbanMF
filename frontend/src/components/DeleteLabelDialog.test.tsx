import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { LabelRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeLabel } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import DeleteLabelDialog from './DeleteLabelDialog'

const DELETE_LABEL = '/api/v1/boards/:boardId/labels/:labelId'

function renderDialog(label: LabelRead | null = makeLabel({ id: 'label-3', board_id: 'board-7', name: 'Bug' })) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  const result = renderWithProviders(
    <DeleteLabelDialog open onClose={onClose} boardId="board-7" label={label} onDeleted={onDeleted} />,
  )
  return { ...result, onClose, onDeleted }
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('DeleteLabelDialog', () => {
  it('asks first, by name, saying the label comes off every card', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Delete label?' })).toHaveTextContent(
      'Delete the label "Bug"? It will be taken off every card on this board.',
    )
  })

  it('deletes the label, then tells the caller and closes', async () => {
    const deleted = fakeEndpoint('delete', DELETE_LABEL)
    const { user, onClose, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7/labels/label-3'])
    expect(onDeleted).toHaveBeenCalledWith('label-3')
  })

  it('says so, and stays open, when the deletion fails', async () => {
    fakeEndpoint('delete', DELETE_LABEL, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so too when the connection drops, instead of failing silently', async () => {
    fakeEndpoint('delete', DELETE_LABEL, () => HttpResponse.error())
    const { user, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it("can't be cancelled or closed while the deletion runs", async () => {
    const held = heldAnswer()
    fakeEndpoint('delete', DELETE_LABEL, held.answer)
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
    const deleted = fakeEndpoint('delete', DELETE_LABEL)
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(deleted.requests).toEqual([])
  })

  it('forgets the error of a failed attempt once cancelled', async () => {
    fakeEndpoint('delete', DELETE_LABEL, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await user.click(button('Delete'))
    await screen.findByRole('alert')

    await user.click(button('Cancel'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does nothing without a label', async () => {
    const deleted = fakeEndpoint('delete', DELETE_LABEL)
    const { user, onClose, onDeleted } = renderDialog(null)
    await user.click(button('Delete'))
    expect(deleted.requests).toEqual([])
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
