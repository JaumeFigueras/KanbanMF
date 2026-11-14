import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { TimeEntryRead } from '../types/timeTracker'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeTimeEntry } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import DeleteTimeEntryDialog from './DeleteTimeEntryDialog'

const DELETE_ENTRY = '/api/v1/time-entries/:entryId'

function renderDialog(entry: TimeEntryRead | null = makeTimeEntry({ id: 'entry-7', card_name: 'Homepage layout' })) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  const result = renderWithProviders(
    <DeleteTimeEntryDialog open onClose={onClose} entry={entry} onDeleted={onDeleted} />,
  )
  return { ...result, onClose, onDeleted }
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('DeleteTimeEntryDialog', () => {
  it("asks to confirm deleting the entry, by its card's name", () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Delete time entry?' })).toHaveTextContent(
      'Delete the recorded time for "Homepage layout"? This cannot be undone.',
    )
  })

  it('deletes the entry, then tells the caller and closes', async () => {
    const deleted = fakeEndpoint('delete', DELETE_ENTRY)
    const { user, onClose, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/time-entries/entry-7'])
    expect(onDeleted).toHaveBeenCalledWith('entry-7')
  })

  it('says so, and stays open, when the deletion fails', async () => {
    fakeEndpoint('delete', DELETE_ENTRY, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onDeleted } = renderDialog()

    await user.click(button('Delete'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be cancelled or closed while the deletion runs", async () => {
    const held = heldAnswer()
    fakeEndpoint('delete', DELETE_ENTRY, held.answer)
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
    const deleted = fakeEndpoint('delete', DELETE_ENTRY)
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(deleted.requests).toEqual([])
  })

  it('forgets the error of a failed attempt once cancelled', async () => {
    fakeEndpoint('delete', DELETE_ENTRY, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await user.click(button('Delete'))
    await screen.findByRole('alert')

    await user.click(button('Cancel'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does nothing without an entry', async () => {
    const deleted = fakeEndpoint('delete', DELETE_ENTRY)
    const { user, onClose, onDeleted } = renderDialog(null)
    await user.click(button('Delete'))
    expect(deleted.requests).toEqual([])
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
