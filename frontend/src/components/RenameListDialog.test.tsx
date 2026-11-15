import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardListRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import RenameListDialog from './RenameListDialog'

const PATCH_LIST = '/api/v1/boards/:boardId/lists/:listId'
const LIST = makeList({ id: 'list-3', board_id: 'board-7', name: 'In progress' })

function renderDialog(list: BoardListRead | null = LIST) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const dialog = (open: boolean, shown: BoardListRead | null) => (
    <RenameListDialog open={open} onClose={onClose} list={shown} onSaved={onSaved} />
  )
  const result = renderWithProviders(dialog(true, list))
  // Closes the dialog and opens it again, as the board page does; `next` is
  // the list by then (renamed meanwhile by someone else on the board, say).
  let shown = list
  function reopen(next: BoardListRead | null) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onSaved, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'List name' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

function savesList() {
  return fakeEndpoint('patch', PATCH_LIST, () => HttpResponse.json(LIST))
}

describe('RenameListDialog', () => {
  it("opens with the list's current name", () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Rename List' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('In progress')
  })

  it('takes at most 255 characters, as the backend does', () => {
    renderDialog()
    expect(nameField()).toHaveAttribute('maxlength', '255')
  })

  it('saves the new name, trimmed, then tells the caller and closes', async () => {
    const saved = savesList()
    const { user, onClose, onSaved } = renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), '  Doing  ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-7/lists/list-3', { name: 'Doing' }],
    ])
    expect(onSaved).toHaveBeenCalledWith('list-3', 'Doing')
  })

  it('saves on Enter too', async () => {
    const saved = savesList()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(saved.requests).toHaveLength(1)
  })

  it('refuses a blank name, sending nothing', async () => {
    const saved = savesList()
    const { user } = renderDialog()
    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('List name is required.')
    expect(saved.requests).toEqual([])
  })

  it('says so, and stays open, when saving fails', async () => {
    fakeEndpoint('patch', PATCH_LIST, () => new HttpResponse(null, { status: 500 }))
    const { user, onClose, onSaved } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends nothing more while a save runs, by button or by Enter', async () => {
    const held = heldAnswer(() => HttpResponse.json(LIST))
    const saved = fakeEndpoint('patch', PATCH_LIST, held.answer)
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

  it("reopens with the list's name again, and without the last error", async () => {
    fakeEndpoint('patch', PATCH_LIST, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog()
    await user.type(nameField(), ' 2')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen(makeList({ id: 'list-3', board_id: 'board-7', name: 'Doing' }))

    expect(nameField()).toHaveValue('Doing')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without saving', async () => {
    const saved = savesList()
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(saved.requests).toEqual([])
  })

  it('saves nothing without a list', async () => {
    const saved = savesList()
    const { user, onSaved } = renderDialog(null)
    await user.type(nameField(), 'Doing')
    await user.click(button('Save'))
    expect(saved.requests).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
