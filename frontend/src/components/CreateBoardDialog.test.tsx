import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { BoardListRead, BoardRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard, makeList } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CreateBoardDialog from './CreateBoardDialog'

const BOARDS = '/api/v1/boards'
const LISTS = '/api/v1/boards/:boardId/lists'
const ORDER = '/api/v1/boards/:boardId/lists/order'
const COLORS = '/api/v1/boards/:boardId/colors'

const SPRINT = makeBoard({ id: 'board-11', name: 'Sprint', is_template: true, owner_id: 'user-1' })
const KANBAN = makeBoard({
  id: 'board-12', name: 'Kanban', is_template: true, owner_id: 'user-2', owner_display_name: 'Emma Wilson',
})
const CREATED = makeBoard({ id: 'board-30', name: 'Website relaunch' })

// Sprint's lists, as the API sends them (by creation), its stored order and
// this user's colour for one of them.
const SPRINT_LISTS = [
  makeList({ id: 'list-13', board_id: 'board-11', name: 'Done' }),
  makeList({ id: 'list-11', board_id: 'board-11', name: 'Backlog' }),
  makeList({ id: 'list-12', board_id: 'board-11', name: 'Doing' }),
]
const KANBAN_LISTS = [makeList({ id: 'list-21', board_id: 'board-12', name: 'Ideas' })]

function templatesHave(lists: Record<string, BoardListRead[]> = { 'board-11': SPRINT_LISTS, 'board-12': KANBAN_LISTS }) {
  const idOf = (request: Request) => new URL(request.url).pathname.split('/')[4]
  fakeEndpoint('get', LISTS, (request) => HttpResponse.json(lists[idOf(request)]))
  fakeEndpoint('get', ORDER, (request) =>
    HttpResponse.json({ board_id: idOf(request), list_ids: idOf(request) === 'board-11' ? ['list-11', 'list-12', 'list-13'] : [] }))
  fakeEndpoint('get', COLORS, () => HttpResponse.json({ board: null, lists: { 'list-11': '#2196F3' }, cards: {} }))
}

function creates() {
  return fakeEndpoint('post', BOARDS, () => HttpResponse.json(CREATED, { status: 201 }))
}

function renderDialog({ mode = 'board', templates = [SPRINT, KANBAN] }: { mode?: 'board' | 'template'; templates?: BoardRead[] } = {}) {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  const dialog = (open: boolean) => (
    <CreateBoardDialog
      open={open}
      onClose={onClose}
      onCreated={onCreated}
      mode={mode}
      templates={templates}
      currentUserId="user-1"
    />
  )
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the boards page does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onCreated, reopen }
}

function nameField(name = 'Board name') {
  return screen.getByRole('textbox', { name })
}

function templateSelect() {
  return screen.getByRole('combobox', { name: 'Template' })
}

function starBox() {
  return screen.getByRole('checkbox', { name: 'Starred' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

async function chooseTemplate(user: ReturnType<typeof renderDialog>['user'], option: string | RegExp) {
  await user.click(templateSelect())
  await user.click(screen.getByRole('option', { name: option }))
}

// The preview: its caption, then one chip per list.
function preview() {
  return screen.getByText('Lists to be created').parentElement!
}

describe('CreateBoardDialog', () => {
  it('opens blank for a board: no name, not starred, no template', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Create a new Board' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('')
    expect(nameField()).toHaveAttribute('maxlength', '255')
    expect(starBox()).not.toBeChecked()
    expect(templateSelect()).toHaveTextContent('None (empty board)')
  })

  it('offers no template choice when there are no templates', () => {
    renderDialog({ templates: [] })
    expect(screen.queryByRole('combobox', { name: 'Template' })).not.toBeInTheDocument()
  })

  it('creates the board, with the name trimmed, then hands it over and closes', async () => {
    const created = creates()
    const { user, onCreated, onClose } = renderDialog()
    await user.type(nameField(), '  Website relaunch  ')
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => r.body)).toEqual([{ name: 'Website relaunch', is_starred: false, template_id: null }])
    expect(onCreated).toHaveBeenCalledWith(CREATED)
  })

  it('creates it starred when ticked', async () => {
    const created = creates()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), 'Website relaunch')
    await user.click(starBox())
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => r.body)).toEqual([expect.objectContaining({ is_starred: true })])
  })

  it('creates it from the chosen template', async () => {
    templatesHave()
    const created = creates()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), 'Website relaunch')
    await chooseTemplate(user, 'Sprint')
    await user.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => r.body)).toEqual([expect.objectContaining({ template_id: 'board-11' })])
  })

  it("offers the templates, saying whose the shared ones are", async () => {
    const { user } = renderDialog()
    await user.click(templateSelect())
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'None (empty board)', 'Sprint', "Kanban(Emma Wilson's template)",
    ])
  })

  it("previews the template's lists in its own order, in the user's colours", async () => {
    templatesHave()
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    await waitFor(() => expect(preview()).toHaveTextContent('Lists to be createdBacklogDoingDone'))
    expect(screen.getByText('Backlog')).toHaveStyle({ borderColor: '#2196F3' })
    // Lists without a colour of their own show the default purple.
    expect(screen.getByText('Doing')).toHaveStyle({ borderColor: '#9C27B0' })
  })

  it('puts lists missing from the stored order last', async () => {
    templatesHave({ 'board-11': [...SPRINT_LISTS, makeList({ id: 'list-14', name: 'Later' })], 'board-12': KANBAN_LISTS })
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    await waitFor(() => expect(preview()).toHaveTextContent('Lists to be createdBacklogDoingDoneLater'))
  })

  it("still previews the lists, as they come, when their order and colours can't be read", async () => {
    fakeEndpoint('get', LISTS, () => HttpResponse.json(SPRINT_LISTS))
    fakeEndpoint('get', ORDER, () => new HttpResponse(null, { status: 500 }))
    fakeEndpoint('get', COLORS, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    await waitFor(() => expect(preview()).toHaveTextContent('Lists to be createdDoneBacklogDoing'))
    expect(screen.getByText('Backlog')).toHaveStyle({ borderColor: '#9C27B0' })
  })

  it('shows a spinner while the preview loads', async () => {
    templatesHave()
    const held = heldAnswer(() => HttpResponse.json(SPRINT_LISTS))
    fakeEndpoint('get', LISTS, held.answer)
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    held.release()
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(preview()).toHaveTextContent('Backlog')
  })

  it("drops the last template's preview while the next one loads", async () => {
    templatesHave()
    const held = heldAnswer(() => HttpResponse.json(KANBAN_LISTS))
    fakeEndpoint('get', LISTS, (request) =>
      request.url.includes('board-12') ? held.answer(request) : HttpResponse.json(SPRINT_LISTS))
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    await waitFor(() => expect(preview()).toHaveTextContent('Backlog'))

    await chooseTemplate(user, /^Kanban/)

    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(preview()).not.toHaveTextContent('Backlog')
    held.release()
    await waitFor(() => expect(preview()).toHaveTextContent('Ideas'))
  })

  it("says the lists couldn't be loaded, rather than that there are none, when the preview fails", async () => {
    templatesHave()
    fakeEndpoint('get', LISTS, () => new HttpResponse(null, { status: 500 }))
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    expect(await screen.findByText("The lists couldn't be loaded.")).toBeInTheDocument()
    expect(screen.queryByText('This template has no lists.')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says when a template has no lists', async () => {
    templatesHave({ 'board-11': [], 'board-12': KANBAN_LISTS })
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    expect(await screen.findByText('This template has no lists.')).toBeInTheDocument()
  })

  it("keeps the last template's preview when an earlier one answers late", async () => {
    templatesHave()
    const held = heldAnswer(() => HttpResponse.json(SPRINT_LISTS))
    fakeEndpoint('get', LISTS, (request) =>
      request.url.includes('board-11') ? held.answer(request) : HttpResponse.json(KANBAN_LISTS))
    const { user } = renderDialog()

    await chooseTemplate(user, 'Sprint')
    await chooseTemplate(user, /^Kanban/)
    await waitFor(() => expect(preview()).toHaveTextContent('Ideas'))
    held.release()
    // Gives Sprint's late answer time to land, if it would.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(preview()).toHaveTextContent('Lists to be createdIdeas')
  })

  it("keeps the last template's preview when an earlier one fails late", async () => {
    templatesHave()
    const held = heldAnswer(() => new HttpResponse(null, { status: 500 }))
    fakeEndpoint('get', LISTS, (request) =>
      request.url.includes('board-11') ? held.answer(request) : HttpResponse.json(KANBAN_LISTS))
    const { user } = renderDialog()

    await chooseTemplate(user, 'Sprint')
    await chooseTemplate(user, /^Kanban/)
    await waitFor(() => expect(preview()).toHaveTextContent('Ideas'))
    held.release()
    // Gives Sprint's late failure time to land, if it would.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText("The lists couldn't be loaded.")).not.toBeInTheDocument()
    expect(preview()).toHaveTextContent('Lists to be createdIdeas')
  })

  it('drops the preview on going back to no template', async () => {
    templatesHave()
    const { user } = renderDialog()
    await chooseTemplate(user, 'Sprint')
    await waitFor(() => expect(preview()).toHaveTextContent('Backlog'))
    await chooseTemplate(user, 'None (empty board)')
    expect(screen.queryByText('Lists to be created')).not.toBeInTheDocument()
  })

  it('creates a template in template mode, without a star or a template to start from', async () => {
    const created = creates()
    const { user, onClose } = renderDialog({ mode: 'template' })
    expect(screen.getByRole('dialog', { name: 'Create a new Template' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Starred' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Template' })).not.toBeInTheDocument()

    await user.type(nameField('Template name'), ' Sprint 2 ')
    await user.click(button('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(created.requests.map((r) => r.body)).toEqual([{ name: 'Sprint 2', is_template: true }])
  })

  it('refuses a blank name, sending nothing', async () => {
    const created = creates()
    const { user } = renderDialog()
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Board name is required.')
    expect(created.requests).toEqual([])
  })

  it('refuses a blank template name, saying template', async () => {
    const created = creates()
    const { user } = renderDialog({ mode: 'template' })
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Template name is required.')
    expect(created.requests).toEqual([])
  })

  it('says so, and stays open, when creating fails', async () => {
    fakeEndpoint('post', BOARDS, () => HttpResponse.json({ detail: 'Template not found' }, { status: 404 }))
    const { user, onCreated, onClose } = renderDialog()
    await user.type(nameField(), 'Website relaunch')
    await user.click(button('Save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("can't be saved again or cancelled while creating", async () => {
    const held = heldAnswer(() => HttpResponse.json(CREATED, { status: 201 }))
    fakeEndpoint('post', BOARDS, held.answer)
    const { user, onClose } = renderDialog()
    await user.type(nameField(), 'Website relaunch')

    await user.click(button('Save'))
    expect(button('Save')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('reopens blank, without the last template, preview or error', async () => {
    templatesHave()
    const { user, reopen } = renderDialog()
    await user.type(nameField(), '   ')
    await user.click(starBox())
    await chooseTemplate(user, 'Sprint')
    await waitFor(() => expect(preview()).toHaveTextContent('Backlog'))
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen()

    expect(nameField()).toHaveValue('')
    expect(starBox()).not.toBeChecked()
    expect(templateSelect()).toHaveTextContent('None (empty board)')
    expect(screen.queryByText('Lists to be created')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without creating anything', async () => {
    const created = creates()
    const { user, onClose } = renderDialog()
    await user.type(nameField(), 'Website relaunch')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(created.requests).toEqual([])
  })
})
