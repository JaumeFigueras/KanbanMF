import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CreateListDialog from './CreateListDialog'

const POST_LIST = '/api/v1/boards/:boardId/lists'
const CREATED = makeList({ id: 'list-9', board_id: 'board-7', name: 'Done' })

function renderDialog() {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  const dialog = (open: boolean) => (
    <CreateListDialog open={open} onClose={onClose} boardId="board-7" onCreated={onCreated} />
  )
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the board page does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onCreated, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'List name' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

function createsList() {
  return fakeEndpoint('post', POST_LIST, () => HttpResponse.json(CREATED, { status: 201 }))
}

describe('CreateListDialog', () => {
  it('opens with an empty name', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create a new List' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('')
  })

  it('takes at most 255 characters, as the backend does', () => {
    renderDialog()
    expect(nameField()).toHaveAttribute('maxlength', '255')
  })

  it("creates the list with the trimmed name, then hands the caller the backend's list and closes", async () => {
    const created = createsList()
    const { user, onClose, onCreated } = renderDialog()

    await user.type(nameField(), '  Done  ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7/lists', { name: 'Done' }],
    ])
    expect(onCreated).toHaveBeenCalledWith(CREATED)
  })

  it('creates it on Enter too', async () => {
    const created = createsList()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), 'Done{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests).toHaveLength(1)
  })

  it('refuses a blank name, sending nothing', async () => {
    const created = createsList()
    const { user } = renderDialog()
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('List name is required.')
    expect(created.requests).toEqual([])
  })

  it('says so, and stays open, when creating fails', async () => {
    // The board was deleted meanwhile. FastAPI's error has a JSON body,
    // which mustn't be taken for the new one.
    fakeEndpoint('post', POST_LIST, () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 }))
    const { user, onClose, onCreated } = renderDialog()
    await user.type(nameField(), 'Done')
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('creates one list, not two, when Enter is pressed again while saving', async () => {
    const held = heldAnswer(() => HttpResponse.json(CREATED, { status: 201 }))
    const created = fakeEndpoint('post', POST_LIST, held.answer)
    const { user, onClose } = renderDialog()

    await user.type(nameField(), 'Done{Enter}')
    await waitFor(() => expect(created.requests).toHaveLength(1))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()
    await user.type(nameField(), '{Enter}')

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests).toHaveLength(1)
  })

  it('reopens empty, without the last name or error', async () => {
    fakeEndpoint('post', POST_LIST, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog()
    await user.type(nameField(), 'Done')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen()

    expect(nameField()).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without creating anything', async () => {
    const created = createsList()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), 'Done')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(created.requests).toEqual([])
  })
})
