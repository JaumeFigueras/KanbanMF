import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { LabelRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeLabel } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import ManageLabelsDialog from './ManageLabelsDialog'

const BOARD_LABELS = '/api/v1/boards/:boardId/labels'
const ONE_LABEL = '/api/v1/boards/:boardId/labels/:labelId'
const BUG = makeLabel({ id: 'label-1', board_id: 'board-7', name: 'Bug', color: '#D32F2F', position: 0 })
const FEATURE = makeLabel({ id: 'label-2', board_id: 'board-7', name: 'Feature', color: '#1976D2', position: 1 })

// FastAPI's answer to a label that fails validation: its message is
// English, and mustn't reach the screen as is.
const REFUSED = () => HttpResponse.json({ detail: 'Label name cannot be blank.' }, { status: 422 })

function boardHas(labels: LabelRead[] = [BUG, FEATURE]) {
  return fakeEndpoint('get', BOARD_LABELS, () => HttpResponse.json(labels))
}

function renderDialog() {
  const onClose = vi.fn()
  const dialog = (open: boolean) => <ManageLabelsDialog open={open} onClose={onClose} boardId="board-7" />
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the board page does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, reopen }
}

function labelsDialog() {
  return screen.getByRole('dialog', { name: 'Labels' })
}

// The form, for a new label or to edit one.
function form(name: 'Create New Label' | 'Edit label') {
  return screen.getByRole('dialog', { name })
}

async function formClosed(name: 'Create New Label' | 'Edit label') {
  await waitFor(() => expect(screen.queryByRole('dialog', { name })).not.toBeInTheDocument())
}

// A label row's Edit or Delete button; the rows are in the board's order.
function rowButton(name: 'Edit label' | 'Delete label', row: number) {
  return screen.getAllByRole('button', { name })[row]
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('ManageLabelsDialog', () => {
  it("lists the board's labels, in order", async () => {
    const loaded = boardHas()
    renderDialog()
    await screen.findByText('Bug')
    expect(labelsDialog()).toHaveTextContent(/Bug.*Feature/)
    expect(loaded.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7/labels'])
  })

  it('says so when the board has no labels', async () => {
    boardHas([])
    renderDialog()
    expect(await screen.findByText('No labels yet.')).toBeInTheDocument()
  })

  it("says so, in the app's words, when the labels can't be loaded", async () => {
    fakeEndpoint('get', BOARD_LABELS, () => new HttpResponse(null, { status: 500 }))
    renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The labels couldn't be loaded. Please close this and try again.",
    )
    expect(screen.queryByText('No labels yet.')).not.toBeInTheDocument()
  })

  it('lets that message be dismissed', async () => {
    fakeEndpoint('get', BOARD_LABELS, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('creates a label: the form opens blank, and the new label joins the list', async () => {
    boardHas([BUG])
    const created = makeLabel({ id: 'label-9', board_id: 'board-7', name: 'Urgent', color: '#6366F1', position: 1 })
    const posted = fakeEndpoint('post', BOARD_LABELS, () => HttpResponse.json(created, { status: 201 }))
    const { user } = renderDialog()
    await screen.findByText('Bug')

    await user.click(button('Create New Label'))
    expect(within(form('Create New Label')).getByRole('textbox', { name: 'Label name' })).toHaveValue('')
    await user.type(within(form('Create New Label')).getByRole('textbox', { name: 'Label name' }), 'Urgent')
    await user.click(within(form('Create New Label')).getByRole('button', { name: 'Save' }))

    await formClosed('Create New Label')
    expect(posted.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7/labels', { name: 'Urgent', color: '#6366F1' }],
    ])
    expect(labelsDialog()).toHaveTextContent(/Bug.*Urgent/)
  })

  it("says so in the form, in the app's words, and keeps it open, when creating fails", async () => {
    boardHas([])
    fakeEndpoint('post', BOARD_LABELS, REFUSED)
    const { user } = renderDialog()
    await screen.findByText('No labels yet.')

    await user.click(button('Create New Label'))
    await user.type(within(form('Create New Label')).getByRole('textbox', { name: 'Label name' }), 'Urgent{Enter}')

    expect(await within(form('Create New Label')).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    // Only there: the list behind the form doesn't repeat it.
    expect(screen.getAllByRole('alert', { hidden: true })).toHaveLength(1)
  })

  it('opens the form for a new label blank, after editing one', async () => {
    boardHas()
    const { user } = renderDialog()
    await screen.findByText('Bug')
    await user.click(rowButton('Edit label', 0))
    await user.click(within(form('Edit label')).getByRole('button', { name: 'Cancel' }))
    await formClosed('Edit label')

    await user.click(button('Create New Label'))

    expect(within(form('Create New Label')).getByRole('textbox', { name: 'Label name' })).toHaveValue('')
  })

  it("forgets a failed attempt's error once the form is cancelled", async () => {
    boardHas([BUG])
    fakeEndpoint('post', BOARD_LABELS, REFUSED)
    const { user } = renderDialog()
    await screen.findByText('Bug')
    await user.click(button('Create New Label'))
    await user.type(within(form('Create New Label')).getByRole('textbox', { name: 'Label name' }), 'Urgent{Enter}')
    await within(form('Create New Label')).findByRole('alert')

    await user.click(within(form('Create New Label')).getByRole('button', { name: 'Cancel' }))

    await formClosed('Create New Label')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("opens the form without the list's error", async () => {
    fakeEndpoint('get', BOARD_LABELS, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await screen.findByRole('alert')

    await user.click(button('Create New Label'))

    expect(within(form('Create New Label')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('edits a label: the form opens with it, and the list shows the change', async () => {
    boardHas()
    const patched = fakeEndpoint('patch', ONE_LABEL, () => HttpResponse.json({ ...FEATURE, name: 'Feature request' }))
    const { user } = renderDialog()
    await screen.findByText('Feature')

    await user.click(rowButton('Edit label', 1))
    const name = within(form('Edit label')).getByRole('textbox', { name: 'Label name' })
    expect(name).toHaveValue('Feature')
    await user.type(name, ' request{Enter}')

    await formClosed('Edit label')
    expect(patched.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7/labels/label-2', { name: 'Feature request', color: '#1976D2' }],
    ])
    expect(labelsDialog()).toHaveTextContent(/Bug.*Feature request/)
  })

  it("says so in the form, in the app's words, and keeps it open, when editing fails", async () => {
    boardHas()
    fakeEndpoint('patch', ONE_LABEL, REFUSED)
    const { user } = renderDialog()
    await screen.findByText('Bug')

    await user.click(rowButton('Edit label', 0))
    await user.type(within(form('Edit label')).getByRole('textbox', { name: 'Label name' }), '{Enter}')

    expect(await within(form('Edit label')).findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })

  it('asks before deleting a label, and takes it off the list once deleted', async () => {
    boardHas()
    const deleted = fakeEndpoint('delete', ONE_LABEL)
    const { user } = renderDialog()
    await screen.findByText('Bug')

    await user.click(rowButton('Delete label', 0))
    const confirm = screen.getByRole('dialog', { name: 'Delete label?' })
    expect(confirm).toHaveTextContent('Delete the label "Bug"?')
    expect(deleted.requests).toEqual([])
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete label?' })).not.toBeInTheDocument())
    expect(deleted.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-7/labels/label-1'])
    expect(screen.queryByText('Bug')).not.toBeInTheDocument()
    expect(screen.getByText('Feature')).toBeInTheDocument()
  })

  it('keeps the label when the deletion is cancelled', async () => {
    boardHas()
    const deleted = fakeEndpoint('delete', ONE_LABEL)
    const { user } = renderDialog()
    await screen.findByText('Bug')

    await user.click(rowButton('Delete label', 0))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete label?' })).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete label?' })).not.toBeInTheDocument())
    expect(deleted.requests).toEqual([])
    expect(screen.getByText('Bug')).toBeInTheDocument()
  })

  it('loads the labels again when reopened, without the last error', async () => {
    fakeEndpoint('get', BOARD_LABELS, () => new HttpResponse(null, { status: 500 }))
    const { reopen } = renderDialog()
    await screen.findByRole('alert')

    boardHas()
    reopen()

    expect(await screen.findByText('Bug')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("doesn't show, on the next opening, a load that failed after closing", async () => {
    const held = heldAnswer(() => new HttpResponse(null, { status: 500 }))
    const slow = fakeEndpoint('get', BOARD_LABELS, held.answer)
    const { rerender } = renderWithProviders(<ManageLabelsDialog open onClose={vi.fn()} boardId="board-7" />)
    await waitFor(() => expect(slow.requests).toHaveLength(1))

    rerender(<ManageLabelsDialog open={false} onClose={vi.fn()} boardId="board-7" />)
    held.release()
    // Gives the failed answer time to arrive while the dialog is closed.
    await new Promise((resolve) => setTimeout(resolve, 50))
    boardHas()
    rerender(<ManageLabelsDialog open onClose={vi.fn()} boardId="board-7" />)

    expect(await screen.findByText('Bug')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads nothing while closed', async () => {
    const loaded = boardHas()
    renderWithProviders(<ManageLabelsDialog open={false} onClose={vi.fn()} boardId="board-7" />)
    // Gives a request, if any, time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(loaded.requests).toEqual([])
  })

  it('closes on Close', async () => {
    boardHas()
    const { user, onClose } = renderDialog()
    await screen.findByText('Bug')
    await user.click(within(labelsDialog()).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
