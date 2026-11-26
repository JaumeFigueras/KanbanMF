import { describe, expect, it, onTestFinished, vi } from 'vitest'
import i18n from '../i18n'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse } from 'msw'
import type { LabelRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeLabel } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { heard, pickUp } from '../test/drag'
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
  const onChanged = vi.fn()
  const dialog = (open: boolean) => (
    <ManageLabelsDialog open={open} onClose={onClose} boardId="board-7" onChanged={onChanged} />
  )
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the board page does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onChanged, reopen }
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

// A label row's Edit or Delete button, named after its label.
function rowButton(action: 'Edit' | 'Delete', label: string) {
  return screen.getByRole('button', { name: `${action} the label ${label}` })
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

  it("names each row's buttons after its label (7E)", async () => {
    boardHas()
    renderDialog()
    await screen.findByText('Bug')
    for (const label of ['Bug', 'Feature']) {
      for (const action of ['Move', 'Edit', 'Delete']) {
        expect(within(labelsDialog()).getByRole('button', { name: `${action} the label ${label}` })).toBeInTheDocument()
      }
    }
    for (const button of within(labelsDialog()).getAllByRole('button')) expect(button).toHaveAccessibleName()
  })

  it('names them in Catalan for a user who reads Catalan', async () => {
    await i18n.changeLanguage('ca')
    boardHas()
    renderDialog()
    expect(await screen.findByRole('button', { name: "Mou l'etiqueta Bug" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Edita l'etiqueta Bug" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Elimina l'etiqueta Feature" })).toBeInTheDocument()
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
    await user.click(rowButton('Edit', 'Bug'))
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

    await user.click(rowButton('Edit', 'Feature'))
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

    await user.click(rowButton('Edit', 'Bug'))
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

    await user.click(rowButton('Delete', 'Bug'))
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

    await user.click(rowButton('Delete', 'Bug'))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete label?' })).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete label?' })).not.toBeInTheDocument())
    expect(deleted.requests).toEqual([])
    expect(screen.getByText('Bug')).toBeInTheDocument()
  })

  describe('telling the board the cards need fetching again (they show their labels)', () => {
    it('tells it once a label is renamed or recoloured', async () => {
      boardHas()
      fakeEndpoint('patch', ONE_LABEL, () => HttpResponse.json({ ...FEATURE, name: 'Feature request' }))
      const { user, onChanged } = renderDialog()
      await screen.findByText('Feature')

      await user.click(rowButton('Edit', 'Feature'))
      await user.type(within(form('Edit label')).getByRole('textbox', { name: 'Label name' }), ' request{Enter}')

      await formClosed('Edit label')
      expect(onChanged).toHaveBeenCalledTimes(1)
    })

    it('tells it once a label is deleted', async () => {
      boardHas()
      fakeEndpoint('delete', ONE_LABEL)
      const { user, onChanged } = renderDialog()
      await screen.findByText('Bug')

      await user.click(rowButton('Delete', 'Bug'))
      await user.click(within(screen.getByRole('dialog', { name: 'Delete label?' })).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    })

    it('tells it nothing for a new label, which is on no card yet', async () => {
      boardHas([BUG])
      fakeEndpoint('post', BOARD_LABELS, () => HttpResponse.json({ ...FEATURE, id: 'label-9' }, { status: 201 }))
      const { user, onChanged } = renderDialog()
      await screen.findByText('Bug')

      await user.click(button('Create New Label'))
      await user.type(within(form('Create New Label')).getByRole('textbox', { name: 'Label name' }), 'Urgent{Enter}')

      await formClosed('Create New Label')
      expect(onChanged).not.toHaveBeenCalled()
    })

    it('tells it nothing when a change is refused, or a deletion cancelled', async () => {
      boardHas()
      fakeEndpoint('patch', ONE_LABEL, REFUSED)
      const deleted = fakeEndpoint('delete', ONE_LABEL)
      const { user, onChanged } = renderDialog()
      await screen.findByText('Bug')
      await user.click(rowButton('Edit', 'Bug'))
      await user.type(within(form('Edit label')).getByRole('textbox', { name: 'Label name' }), '{Enter}')
      await within(form('Edit label')).findByRole('alert')
      await user.click(within(form('Edit label')).getByRole('button', { name: 'Cancel' }))
      await formClosed('Edit label')

      await user.click(rowButton('Delete', 'Bug'))
      await user.click(within(screen.getByRole('dialog', { name: 'Delete label?' })).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete label?' })).not.toBeInTheDocument())
      expect(deleted.requests).toEqual([])
      expect(onChanged).not.toHaveBeenCalled()
    })
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

  describe('moving a label with the keyboard (7A)', () => {
    function firstHandle() {
      return within(labelsDialog()).getByRole('button', { name: 'Move the label Bug' })
    }

    it('tells a screen reader how, in the reader\'s language', async () => {
      boardHas()
      renderDialog()
      await screen.findByText('Bug')
      expect(firstHandle()).toHaveAttribute('aria-roledescription', 'movable')
      expect(firstHandle()).toHaveAccessibleDescription(
        'Press Space or Enter to pick it up, the arrow keys to move it, and Space or Enter again to drop it, or Escape to cancel.',
      )
    })

    it('tells it in Catalan to a user who reads Catalan', async () => {
      await i18n.changeLanguage('ca')
      boardHas()
      renderDialog()
      const handle = await screen.findByRole('button', { name: "Mou l'etiqueta Bug" })
      expect(handle).toHaveAttribute('aria-roledescription', 'movible')
      expect(handle).toHaveAccessibleDescription(/^Prem la barra d'espai o la tecla de retorn per agafar-lo/)
    })

    it('cancels the move on Escape, and stays open', async () => {
      boardHas()
      const saved = fakeEndpoint('put', `${BOARD_LABELS}/order`)
      const { user, onClose } = renderDialog()
      await screen.findByText('Bug')
      await pickUp(user, firstHandle(), 'the label Bug')
      await user.keyboard('{Escape}')
      await heard('Move cancelled: the label Bug is back in its place.')
      expect(onClose).not.toHaveBeenCalled()
      expect(labelsDialog()).toHaveTextContent(/Bug.*Feature/)
      expect(saved.requests).toEqual([])
      // With nothing moving, Escape closes it as before.
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('a label moved to another place (7D)', () => {
    const URGENT = makeLabel({ id: 'label-3', board_id: 'board-7', name: 'Urgent', color: '#F57C00', position: 2 })
    const MOVE_FAILED = "The move couldn't be saved, and has been undone. Please try again."

    // jsdom lays nothing out, so every row would be in the same place, and
    // the arrow keys would find nowhere to go: each row gets one of its own,
    // one under the other.
    function layOutRows() {
      const tops: Record<string, number> = { Bug: 0, Feature: 50, Urgent: 100 }
      const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const top = tops[this.textContent ?? '']
        return top === undefined ? new DOMRect() : new DOMRect(0, top, 300, 40)
      })
      onTestFinished(() => spy.mockRestore())
    }

    // The labels, in the order the rows show them.
    function shownOrder() {
      return within(labelsDialog()).getAllByRole('button', { name: /^Move the label / }).map((handle) => handle.parentElement!.textContent)
    }

    async function moveBugDown(user: UserEvent) {
      layOutRows()
      await pickUp(user, within(labelsDialog()).getByRole('button', { name: 'Move the label Bug' }), 'the label Bug')
      await user.keyboard('{ArrowDown}')
      await heard('Moving the label Bug, over the label Feature.')
      await user.keyboard('[Space]')
    }

    it('saves the new order, and tells the board, as the cards show their labels in it', async () => {
      boardHas()
      const saved = fakeEndpoint('put', `${BOARD_LABELS}/order`, () => HttpResponse.json([FEATURE, BUG]))
      const { user, onChanged } = renderDialog()
      await screen.findByText('Bug')

      await moveBugDown(user)

      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
      expect(saved.requests.map((request) => request.body)).toEqual([{ label_ids: ['label-2', 'label-1'] }])
      expect(shownOrder()).toEqual(['Feature', 'Bug'])
      expect(within(labelsDialog()).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('puts it back and says so when the order is refused, then shows the labels as they are now, so trying again works', async () => {
      boardHas()
      const refused = () => HttpResponse.json({ detail: 'label_ids must list every label on this board exactly once.' }, { status: 422 })
      fakeEndpoint('put', `${BOARD_LABELS}/order`, refused)
      const { user, onChanged } = renderDialog()
      await screen.findByText('Bug')
      // Added in another tab, which the order sent leaves out.
      boardHas([BUG, FEATURE, URGENT])

      await moveBugDown(user)

      expect(await within(labelsDialog()).findByRole('alert')).toHaveTextContent(MOVE_FAILED)
      await screen.findByText('Urgent')
      expect(shownOrder()).toEqual(['Bug', 'Feature', 'Urgent'])
      expect(onChanged).not.toHaveBeenCalled()

      const saved = fakeEndpoint('put', `${BOARD_LABELS}/order`, () => HttpResponse.json([FEATURE, BUG, URGENT]))
      await moveBugDown(user)
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
      expect(saved.requests.map((request) => request.body)).toEqual([{ label_ids: ['label-2', 'label-1', 'label-3'] }])
      expect(within(labelsDialog()).queryByRole('alert')).not.toBeInTheDocument()
    })

    it("puts it back and says so when the order can't be sent, even if the labels can't be loaded again", async () => {
      boardHas()
      fakeEndpoint('put', `${BOARD_LABELS}/order`, () => HttpResponse.error())
      const { user, onChanged } = renderDialog()
      await screen.findByText('Bug')
      const reloaded = fakeEndpoint('get', BOARD_LABELS, () => HttpResponse.error())

      await moveBugDown(user)

      await waitFor(() => expect(reloaded.requests).toHaveLength(1))
      // Gives the failed load time to arrive.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(within(labelsDialog()).getByRole('alert')).toHaveTextContent(MOVE_FAILED)
      expect(shownOrder()).toEqual(['Bug', 'Feature'])
      expect(onChanged).not.toHaveBeenCalled()
    })
  })

  it('closes on Close', async () => {
    boardHas()
    const { user, onClose } = renderDialog()
    await screen.findByText('Bug')
    await user.click(within(labelsDialog()).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
