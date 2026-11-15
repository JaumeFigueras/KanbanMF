import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { LabelRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeLabel } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CardLabelPickerDialog from './CardLabelPickerDialog'

const BOARD_LABELS = '/api/v1/boards/:boardId/labels'
const BUG = makeLabel({ id: 'label-1', board_id: 'board-7', name: 'Bug' })
const FEATURE = makeLabel({ id: 'label-2', board_id: 'board-7', name: 'Feature' })
const URGENT = makeLabel({ id: 'label-3', board_id: 'board-7', name: 'Urgent' })

function boardHas(labels: LabelRead[] = [BUG, FEATURE, URGENT]) {
  return fakeEndpoint('get', BOARD_LABELS, () => HttpResponse.json(labels))
}

function renderDialog({ open = true, selectedIds = ['label-2'] }: { open?: boolean; selectedIds?: string[] } = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  const dialog = (isOpen: boolean, ids: string[]) => (
    <CardLabelPickerDialog open={isOpen} onClose={onClose} boardId="board-7" selectedIds={ids} onSave={onSave} />
  )
  const result = renderWithProviders(dialog(open, selectedIds))
  // Closes the dialog and opens it again, as the card dialog does, with the
  // card's labels as they are by then.
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

describe('CardLabelPickerDialog', () => {
  it("lists the board's labels, with the card's own ticked", async () => {
    const loaded = boardHas()
    renderDialog({ selectedIds: ['label-2'] })
    expect(await screen.findByRole('checkbox', { name: 'Bug' })).not.toBeChecked()
    expect(box('Feature')).toBeChecked()
    expect(box('Urgent')).not.toBeChecked()
    expect(screen.getByRole('dialog', { name: 'Select Labels' })).toBeInTheDocument()
    expect(loaded.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7/labels'])
  })

  it("ticks a label with a click on its name, and unticks it with another", async () => {
    boardHas()
    const { user } = renderDialog()
    await screen.findByRole('checkbox', { name: 'Bug' })
    await user.click(screen.getByText('Bug'))
    expect(box('Bug')).toBeChecked()
    await user.click(screen.getByText('Bug'))
    expect(box('Bug')).not.toBeChecked()
  })

  it('ticks a label with its box too', async () => {
    boardHas()
    const { user } = renderDialog()
    await user.click(await screen.findByRole('checkbox', { name: 'Urgent' }))
    expect(box('Urgent')).toBeChecked()
  })

  it("hands over the ticked labels, in the board's order, then closes", async () => {
    boardHas()
    const { user, onSave, onClose } = renderDialog({ selectedIds: ['label-3'] })
    await user.click(await screen.findByRole('checkbox', { name: 'Bug' }))
    await user.click(button('Save'))
    expect(onSave.mock.calls).toEqual([[[BUG, URGENT]]])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops a label the board no longer has', async () => {
    boardHas()
    const { user, onSave } = renderDialog({ selectedIds: ['label-2', 'label-deleted'] })
    await screen.findByRole('checkbox', { name: 'Bug' })
    await user.click(button('Save'))
    expect(onSave.mock.calls).toEqual([[[FEATURE]]])
  })

  it('says so when the board has no labels', async () => {
    boardHas([])
    renderDialog()
    expect(await screen.findByText('No labels yet.')).toBeInTheDocument()
  })

  it("keeps Save off until the labels are here, rather than saying there are none", async () => {
    const held = heldAnswer(() => HttpResponse.json([BUG]))
    fakeEndpoint('get', BOARD_LABELS, held.answer)
    renderDialog()

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByText('No labels yet.')).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()

    held.release()
    expect(await screen.findByRole('checkbox', { name: 'Bug' })).toBeInTheDocument()
    expect(button('Save')).toBeEnabled()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it("says so when the labels can't be loaded, and keeps Save off", async () => {
    fakeEndpoint('get', BOARD_LABELS, () => new HttpResponse(null, { status: 500 }))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The labels couldn't be loaded. Please close this and try again.",
    )
    expect(screen.queryByText('No labels yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
  })

  it('loads the labels again on each opening, with the ticks of that moment', async () => {
    fakeEndpoint('get', BOARD_LABELS, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog({ selectedIds: ['label-2'] })
    await screen.findByRole('alert')

    boardHas()
    reopen(['label-1'])

    expect(await screen.findByRole('checkbox', { name: 'Bug' })).toBeChecked()
    expect(box('Feature')).not.toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button('Save')).toBeEnabled()
    await user.click(box('Feature'))
    expect(box('Feature')).toBeChecked()
  })

  it('waits for the new labels on reopening, instead of showing the last ones', async () => {
    boardHas([BUG])
    const { reopen } = renderDialog()
    await screen.findByRole('checkbox', { name: 'Bug' })

    const held = heldAnswer(() => HttpResponse.json([FEATURE]))
    fakeEndpoint('get', BOARD_LABELS, held.answer)
    reopen(['label-2'])

    expect(screen.queryByRole('checkbox', { name: 'Bug' })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(button('Save')).toBeDisabled()
    held.release()
    expect(await screen.findByRole('checkbox', { name: 'Feature' })).toBeChecked()
  })

  it('loads nothing while closed', async () => {
    const loaded = boardHas()
    renderDialog({ open: false })
    // Gives a request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(loaded.requests).toEqual([])
  })

  it('closes on Cancel without saving', async () => {
    boardHas()
    const { user, onSave, onClose } = renderDialog()
    await user.click(await screen.findByRole('checkbox', { name: 'Bug' }))
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
