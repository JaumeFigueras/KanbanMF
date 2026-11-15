import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import DuplicateTemplateDialog from './DuplicateTemplateDialog'

const DUPLICATE = '/api/v1/boards/:boardId/duplicate'
const TEMPLATE = makeBoard({ id: 'board-4', name: 'Sprint', is_template: true })
const COPY = makeBoard({ id: 'board-9', name: 'Copy of Sprint', is_template: true })

function renderDialog(template: BoardRead | null = TEMPLATE) {
  const onClose = vi.fn()
  const onDuplicated = vi.fn()
  const dialog = (open: boolean) => (
    <DuplicateTemplateDialog open={open} onClose={onClose} template={template} onDuplicated={onDuplicated} />
  )
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the boards page does. The form
  // starts fresh because the dialog unmounts it once closed, which happens
  // at the end of the closing animation, so that's waited for.
  async function reopen() {
    result.rerender(dialog(false))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onDuplicated, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Template name' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

function duplicates() {
  return fakeEndpoint('post', DUPLICATE, () => HttpResponse.json(COPY, { status: 201 }))
}

describe('DuplicateTemplateDialog', () => {
  it('opens with "Copy of" the template\'s name, and says what the copy gets', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Duplicate template' })
    expect(nameField()).toHaveValue('Copy of Sprint')
    expect(dialog).toHaveTextContent('It gets the lists and your own colors, but not who it is shared with.')
  })

  it('cuts that name to 255 characters, as the backend allows', () => {
    renderDialog(makeBoard({ name: 'x'.repeat(250), is_template: true }))
    expect(nameField()).toHaveValue(`Copy of ${'x'.repeat(247)}`)
    expect(nameField()).toHaveAttribute('maxlength', '255')
  })

  it('cuts it by characters, so an emoji at the cut stays whole', () => {
    // "Copy of " and the x's make 254 characters, so the emoji is the 255th:
    // it's kept, not split into half a character the backend can't store.
    renderDialog(makeBoard({ name: `${'x'.repeat(246)}😀 later`, is_template: true }))
    expect(nameField()).toHaveValue(`Copy of ${'x'.repeat(246)}😀`)
  })

  it("duplicates it with the trimmed name, then hands the caller the backend's copy and closes", async () => {
    const duplicated = duplicates()
    const { user, onClose, onDuplicated } = renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), '  Sprint 2  ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(duplicated.requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/api/v1/boards/board-4/duplicate', { name: 'Sprint 2' }],
    ])
    expect(onDuplicated).toHaveBeenCalledWith(COPY)
  })

  it('duplicates on Enter too', async () => {
    const duplicated = duplicates()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(duplicated.requests).toHaveLength(1)
  })

  it('refuses a blank name, sending nothing', async () => {
    const duplicated = duplicates()
    const { user } = renderDialog()
    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Template name is required.')
    expect(duplicated.requests).toEqual([])
  })

  it('says so, and stays open, when duplicating fails', async () => {
    // The board was deleted meanwhile. FastAPI's error has a JSON body,
    // which mustn't be taken for the new one.
    fakeEndpoint('post', DUPLICATE, () => HttpResponse.json({ detail: 'Board not found' }, { status: 404 }))
    const { user, onClose, onDuplicated } = renderDialog()
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onDuplicated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('makes one copy, not two, when Enter is pressed again while saving', async () => {
    const held = heldAnswer(() => HttpResponse.json(COPY, { status: 201 }))
    const duplicated = fakeEndpoint('post', DUPLICATE, held.answer)
    const { user, onClose } = renderDialog()

    await user.type(nameField(), '{Enter}')
    await waitFor(() => expect(duplicated.requests).toHaveLength(1))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()
    await user.type(nameField(), '{Enter}')

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(duplicated.requests).toHaveLength(1)
  })

  it('reopens with the default name again, and without the last error', async () => {
    fakeEndpoint('post', DUPLICATE, () => new HttpResponse(null, { status: 500 }))
    const { user, reopen } = renderDialog()
    await user.type(nameField(), ' (old)')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    await reopen()

    expect(nameField()).toHaveValue('Copy of Sprint')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without duplicating', async () => {
    const duplicated = duplicates()
    const { user, onClose } = renderDialog()
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(duplicated.requests).toEqual([])
  })

  it('shows no form without a template', () => {
    renderDialog(null)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
