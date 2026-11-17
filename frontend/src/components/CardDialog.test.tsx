import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { CardRead, ChecklistRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeCard, makeLabel, makePerson } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CardDialog from './CardDialog'

const MEMBERS = '/api/v1/boards/:boardId/members'
const CARDS = '/api/v1/boards/:boardId/lists/:listId/cards'
const CARD_URL = `${CARDS}/:cardId`
const CHECKLISTS = `${CARD_URL}/checklists`
const refused = () => HttpResponse.json({ detail: 'Something failed' }, { status: 500 })

function checklist(id: string, name: string, items: string[]): ChecklistRead {
  return {
    id,
    card_id: 'card-7',
    name,
    position: 0,
    items: items.map((text, i) => ({
      id: `${id}-item-${i + 1}`,
      checklist_id: id,
      text,
      is_done: false,
      position: i,
      created_at: '2026-01-15T09:00:00Z',
      updated_at: '2026-01-15T09:00:00Z',
    })),
    created_at: '2026-01-15T09:00:00Z',
    updated_at: '2026-01-15T09:00:00Z',
  }
}

const LAUNCH = checklist('checklist-1', 'Launch', ['Write copy'])
const CARD = makeCard({
  id: 'card-7',
  list_id: 'list-2',
  name: 'Homepage layout',
  description: 'Hero and footer',
  labels: [makeLabel({ id: 'label-1', name: 'Urgent' })],
  checklists: [LAUNCH],
})

// The board's people (none needed here), and a save that answers with the
// card as sent, its checklists as the server then has them.
function fakeBackend(serverChecklists: ChecklistRead[] = [LAUNCH]) {
  fakeEndpoint('get', MEMBERS, () => HttpResponse.json([]))
  return {
    saved: fakeEndpoint('patch', CARD_URL, () => HttpResponse.json(CARD)),
    deleted: fakeEndpoint('delete', `${CHECKLISTS}/:checklistId`),
    checklistsOrdered: fakeEndpoint('put', `${CHECKLISTS}/order`),
    itemsOrdered: fakeEndpoint('put', `${CHECKLISTS}/:checklistId/items/order`),
    loaded: fakeEndpoint('get', CHECKLISTS, () => HttpResponse.json(serverChecklists)),
  }
}

// A fake server that keeps the card's checklists, so a test can look at what
// it ends up with. It refuses to create the checklists named in
// `refuseOnce`, the first time each is asked for.
function checklistServer(initial: ChecklistRead[] = [], refuseOnce: string[] = []) {
  const lists = structuredClone(initial)
  const toRefuse = new Set(refuseOnce)
  let made = 0
  const at = (request: Request, fromEnd: number) => new URL(request.url).pathname.split('/').at(-fromEnd)
  return {
    lists,
    loaded: fakeEndpoint('get', CHECKLISTS, () => HttpResponse.json(lists)),
    created: fakeEndpoint('post', CHECKLISTS, async (request) => {
      const { name } = await request.json() as { name: string }
      if (toRefuse.delete(name)) return refused()
      const list = checklist(`server-${++made}`, name, [])
      lists.push(list)
      return HttpResponse.json(list, { status: 201 })
    }),
    itemsCreated: fakeEndpoint('post', `${CHECKLISTS}/:checklistId/items`, async (request) => {
      const list = lists.find((l) => l.id === at(request, 2))
      if (!list) return HttpResponse.json({ detail: 'Checklist not found' }, { status: 404 })
      const { text } = await request.json() as { text: string }
      const item = { ...checklist('x', 'x', [text]).items[0], id: `server-item-${++made}`, checklist_id: list.id }
      list.items.push(item)
      return HttpResponse.json(item, { status: 201 })
    }),
    deleted: fakeEndpoint('delete', `${CHECKLISTS}/:checklistId`, (request) => {
      lists.splice(lists.findIndex((l) => l.id === at(request, 1)), 1)
      return new HttpResponse(null, { status: 204 })
    }),
    checklistsOrdered: fakeEndpoint('put', `${CHECKLISTS}/order`),
    itemsOrdered: fakeEndpoint('put', `${CHECKLISTS}/:checklistId/items/order`),
  }
}

// A new card's create, and any card's save, answering with the card.
function fakeCardSaves(saved: CardRead = CARD) {
  fakeEndpoint('get', MEMBERS, () => HttpResponse.json([]))
  return {
    created: fakeEndpoint('post', CARDS, () => HttpResponse.json(NEW_CARD, { status: 201 })),
    saved: fakeEndpoint('patch', CARD_URL, () => HttpResponse.json(saved)),
  }
}

const NEW_CARD = makeCard({ id: 'card-9', list_id: 'list-2', name: 'Launch plan' })

const EMMA = makePerson({ id: 'user-1', display_name: 'Emma Wilson' })
const LIAM = makePerson({ id: 'user-2', display_name: 'Liam Chen' })
const NOAH = makePerson({ id: 'user-3', display_name: 'Noah Garcia' })
const WITH_PEOPLE: CardRead = { ...CARD, members: [EMMA], assignees: [LIAM] }

// A card to edit, or null for a new one.
function renderDialog(card: CardRead | null = CARD) {
  const onClose = vi.fn()
  const onUpdated = vi.fn()
  const onCreated = vi.fn()
  const onCopied = vi.fn()
  const dialog = (open: boolean, shown: CardRead | null) => (
    <CardDialog open={open} onClose={onClose} listId="list-2" boardId="board-1" numberLocale="en_GB" card={shown}
      onUpdated={onUpdated} onCreated={onCreated} onCopied={onCopied} />
  )
  const result = renderWithProviders(dialog(true, card))
  let current = card
  return {
    ...result,
    onClose,
    onUpdated,
    onCreated,
    // Hands the open dialog a new copy of the card, as the board does each
    // time it reloads the card's list.
    handOver(next: CardRead) {
      current = next
      result.rerender(dialog(true, next))
    },
    // Closes the dialog and opens it again on the card as it is by then.
    reopen() {
      result.rerender(dialog(false, current))
      result.rerender(dialog(true, current))
    },
  }
}

const nameField = () => screen.getByRole('textbox', { name: /^Card name/ })
const saveButton = () => screen.getByRole('button', { name: 'Save' })

// Adds a checklist through its dialog, as a person does.
async function addChecklist(user: ReturnType<typeof renderDialog>['user'], name: string, items: string[]) {
  await user.click(screen.getByRole('button', { name: 'Add checklist' }))
  await user.type(screen.getByRole('textbox', { name: 'Checklist name' }), name)
  for (const text of items) await user.type(screen.getByRole('textbox', { name: 'Add an item' }), `${text}{Enter}`)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create Checklist' })).not.toBeInTheDocument())
}

async function removeChecklist(user: ReturnType<typeof renderDialog>['user'], name = 'Launch') {
  await user.click(screen.getByRole('button', { name: `Menu for the checklist ${name}` }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete Checklist' }))
}

// The same content, as a new object with its keys in another order.
function copyOf(card: CardRead): CardRead {
  return Object.fromEntries(Object.entries(structuredClone(card)).reverse()) as unknown as CardRead
}

async function typeIntoName(user: ReturnType<typeof renderDialog>['user'], text: string) {
  await user.click(nameField())
  await user.paste(text)
}

const CHANGED_ELSEWHERE = 'This card was changed elsewhere while you were editing it. Saving replaces those changes; Cancel to see them.'
const NOT_ALL_SAVED = "The card was saved, but some checklist changes weren't. Check its checklists and save again."

describe('CardDialog', () => {
  describe('changes made elsewhere while it is open', () => {
    it('keeps what you typed, and says nothing, when the board hands over a new copy of the same card', async () => {
      fakeBackend()
      const { user, handOver } = renderDialog()
      await typeIntoName(user, ' v2')

      handOver(copyOf(CARD))

      expect(nameField()).toHaveValue('Homepage layout v2')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps what you typed, and says so, when the card was changed elsewhere', async () => {
      fakeBackend()
      const { user, handOver } = renderDialog()
      await typeIntoName(user, ' v2')

      handOver({ ...CARD, name: 'Homepage', updated_at: '2026-01-16T09:00:00Z' })

      expect(nameField()).toHaveValue('Homepage layout v2')
      expect(screen.getByRole('alert')).toHaveTextContent(CHANGED_ELSEWHERE)
    })

    it('saves what you typed, after a change elsewhere', async () => {
      const { saved } = fakeBackend()
      const { user, handOver, onClose } = renderDialog()
      await typeIntoName(user, ' v2')
      handOver({ ...CARD, name: 'Homepage', updated_at: '2026-01-16T09:00:00Z' })

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(saved.requests.map((r) => (r.body as { name: string }).name)).toEqual(['Homepage layout v2'])
    })

    it('keeps, when saving, a checklist added elsewhere meanwhile', async () => {
      const added = checklist('checklist-2', 'Follow-up', ['Call back'])
      const { deleted } = fakeBackend([LAUNCH, added])
      const { user, handOver, onClose } = renderDialog()
      handOver({ ...CARD, checklists: [LAUNCH, added] })

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(deleted.requests).toEqual([])
    })

    it('says nothing more once the card is handed back as it was', async () => {
      fakeBackend()
      const { handOver } = renderDialog()
      handOver({ ...CARD, name: 'Homepage', updated_at: '2026-01-16T09:00:00Z' })
      expect(screen.getByRole('alert')).toBeInTheDocument()

      handOver(copyOf(CARD))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('starts afresh on the next opening: the card as it is then, and no warning', async () => {
      fakeBackend()
      const { user, handOver, reopen } = renderDialog()
      await typeIntoName(user, ' v2')
      handOver({ ...CARD, name: 'Homepage', updated_at: '2026-01-16T09:00:00Z' })

      reopen()

      expect(nameField()).toHaveValue('Homepage')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('compares later copies with the card as it was at that opening', async () => {
      fakeBackend()
      const changed = { ...CARD, name: 'Homepage', updated_at: '2026-01-16T09:00:00Z' }
      const { handOver, reopen } = renderDialog()
      handOver(changed)
      reopen()

      handOver(copyOf(changed))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('checklist changes that fail', () => {
    it("says the card was saved but some checklist changes weren't, and stays open", async () => {
      fakeCardSaves()
      const server = checklistServer([LAUNCH])
      fakeEndpoint('delete', `${CHECKLISTS}/:checklistId`, refused)
      const { user, onClose, onUpdated } = renderDialog()
      await removeChecklist(user)

      await user.click(saveButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(NOT_ALL_SAVED)
      expect(onClose).not.toHaveBeenCalled()
      expect(onUpdated).toHaveBeenCalledTimes(1)
      expect(server.lists.map((l) => l.name)).toEqual(['Launch'])
    })

    it('says the same when the connection drops after the card was saved', async () => {
      fakeCardSaves()
      checklistServer()
      fakeEndpoint('post', CHECKLISTS, () => HttpResponse.error())
      const { user, onClose } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])

      await user.click(saveButton())

      expect(await screen.findByRole('alert')).toHaveTextContent(NOT_ALL_SAVED)
      expect(onClose).not.toHaveBeenCalled()
    })

    it("stops at the first refused change: no items for a checklist that wasn't made", async () => {
      fakeCardSaves()
      const server = checklistServer([], ['Launch'])
      const { user } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])

      await user.click(saveButton())

      await screen.findByRole('alert')
      expect(server.itemsCreated.requests).toEqual([])
      expect(server.checklistsOrdered.requests).toEqual([])
    })

    it('tells the board about the new card at once, and about the second Save as an update', async () => {
      fakeCardSaves(NEW_CARD)
      checklistServer([], ['Launch'])
      const { user, onCreated, onUpdated, onClose } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])
      await user.click(saveButton())
      await screen.findByRole('alert')
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(onCreated.mock.calls[0][0].id).toBe('card-9')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(onCreated).toHaveBeenCalledTimes(1)
      expect(onUpdated.mock.calls.map(([card]) => card.id)).toEqual(['card-9'])
    })

    it('saves the card it created on a second Save, rather than creating another', async () => {
      const cards = fakeCardSaves(NEW_CARD)
      const server = checklistServer([], ['Launch'])
      const { user, onClose } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])
      await user.click(saveButton())
      await screen.findByRole('alert')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(cards.created.requests).toHaveLength(1)
      expect(cards.saved.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/boards/board-1/lists/list-2/cards/card-9'])
      expect(server.lists.map((l) => [l.name, l.items.map((i) => i.text)])).toEqual([['Launch', ['Write copy']]])
    })

    it('compares a second Save with what the server has, so no checklist is made twice', async () => {
      fakeCardSaves(NEW_CARD)
      const server = checklistServer([], ['Follow-up'])
      const { user, onClose } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])
      await addChecklist(user, 'Follow-up', ['Call back'])
      await user.click(saveButton())
      await screen.findByRole('alert')
      expect(server.lists.map((l) => l.name)).toEqual(['Launch'])

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(server.lists.map((l) => [l.name, l.items.map((i) => i.text)]).sort()).toEqual([
        ['Follow-up', ['Call back']],
        ['Launch', ['Write copy']],
      ])
    })

    it('says so, sending nothing, when the checklists to compare with cannot be fetched', async () => {
      const cards = fakeCardSaves()
      checklistServer([LAUNCH])
      fakeEndpoint('delete', `${CHECKLISTS}/:checklistId`, refused)
      const { user } = renderDialog()
      await removeChecklist(user)
      await user.click(saveButton())
      await screen.findByRole('alert')
      fakeEndpoint('get', CHECKLISTS, refused)

      await user.click(saveButton())

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.'))
      expect(cards.saved.requests).toHaveLength(1)
    })

    it('shows the board the checklists the server has after a partial save', async () => {
      fakeCardSaves(NEW_CARD)
      checklistServer([], ['Follow-up'])
      const { user, onCreated } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])
      await addChecklist(user, 'Follow-up', ['Call back'])

      await user.click(saveButton())

      await screen.findByRole('alert')
      expect(onCreated.mock.calls[0][0].checklists.map((l: ChecklistRead) => l.name)).toEqual(['Launch'])
    })

    it('creates a new card again once closed and reopened after a partial save', async () => {
      const cards = fakeCardSaves(NEW_CARD)
      checklistServer([], ['Launch'])
      const { user, reopen } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await addChecklist(user, 'Launch', ['Write copy'])
      await user.click(saveButton())
      await screen.findByRole('alert')

      reopen()
      await typeIntoName(user, 'Second card')
      await user.click(saveButton())

      await waitFor(() => expect(cards.created.requests).toHaveLength(2))
      expect(cards.saved.requests).toEqual([])
    })

    it('saves a reopened card without first asking for its checklists again', async () => {
      fakeCardSaves()
      checklistServer([LAUNCH])
      fakeEndpoint('delete', `${CHECKLISTS}/:checklistId`, refused)
      const { user, reopen, onClose } = renderDialog()
      await removeChecklist(user)
      await user.click(saveButton())
      await screen.findByRole('alert')
      fakeEndpoint('get', CHECKLISTS, refused)

      reopen()
      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it("doesn't take the card the board is handed after a partial save for a change made elsewhere", async () => {
      fakeCardSaves({ ...CARD, name: 'Homepage layout v2', updated_at: '2026-01-16T09:00:00Z' })
      checklistServer([LAUNCH])
      fakeEndpoint('delete', `${CHECKLISTS}/:checklistId`, refused)
      const { user, onUpdated, handOver } = renderDialog()
      await typeIntoName(user, ' v2')
      await removeChecklist(user)
      await user.click(saveButton())
      await screen.findByRole('alert')

      handOver(onUpdated.mock.calls[0][0])

      expect(screen.getByRole('alert')).toHaveTextContent(NOT_ALL_SAVED)
      expect(screen.queryByText(CHANGED_ELSEWHERE)).not.toBeInTheDocument()
    })
  })

  describe("the board's people, to choose members and assignees from", () => {
    const PEOPLE_FAILED = "The board's people couldn't be loaded. Please close this and try again."
    const picker = (title: 'Select Members' | 'Select Assignees') => screen.getByRole('dialog', { name: title })
    const pickerSave = (title: 'Select Members' | 'Select Assignees') =>
      within(picker(title)).getByRole('button', { name: 'Save' })
    // Cancels a picker, and waits for it to be gone: until then the card
    // dialog behind it is hidden from the screen reader, and its buttons with it.
    async function cancelPicker(user: ReturnType<typeof renderDialog>['user'], title: 'Select Members' | 'Select Assignees') {
      await user.click(within(picker(title)).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument())
    }

    it('makes the members picker wait for them before it can be saved', async () => {
      fakeBackend()
      const held = heldAnswer(() => HttpResponse.json([EMMA, LIAM, NOAH]))
      fakeEndpoint('get', MEMBERS, held.answer)
      const { user } = renderDialog(WITH_PEOPLE)

      await user.click(screen.getByRole('button', { name: 'Add members' }))

      expect(within(picker('Select Members')).getByRole('progressbar')).toBeInTheDocument()
      expect(pickerSave('Select Members')).toBeDisabled()
      held.release()
      expect(await within(picker('Select Members')).findByRole('checkbox', { name: 'Emma Wilson' })).toBeChecked()
      expect(pickerSave('Select Members')).toBeEnabled()
    })

    it("says they couldn't be loaded in both pickers, and the card keeps its people", async () => {
      const { saved } = fakeBackend()
      fakeEndpoint('get', MEMBERS, refused)
      const { user, onClose } = renderDialog(WITH_PEOPLE)

      await user.click(screen.getByRole('button', { name: 'Add members' }))
      expect(await within(picker('Select Members')).findByRole('alert')).toHaveTextContent(PEOPLE_FAILED)
      expect(pickerSave('Select Members')).toBeDisabled()
      await cancelPicker(user, 'Select Members')
      await user.click(screen.getByRole('button', { name: 'Add assignees' }))
      expect(within(picker('Select Assignees')).getByRole('alert')).toHaveTextContent(PEOPLE_FAILED)
      expect(pickerSave('Select Assignees')).toBeDisabled()
      await cancelPicker(user, 'Select Assignees')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(saved.requests.map((r) => {
        const { member_ids, assignee_ids } = r.body as { member_ids: string[]; assignee_ids: string[] }
        return [member_ids, assignee_ids]
      })).toEqual([[['user-1'], ['user-2']]])
    })

    it('loads them again on each opening', async () => {
      fakeBackend()
      fakeEndpoint('get', MEMBERS, refused)
      const { user, reopen } = renderDialog(WITH_PEOPLE)
      await user.click(screen.getByRole('button', { name: 'Add members' }))
      await within(picker('Select Members')).findByRole('alert')
      await cancelPicker(user, 'Select Members')
      fakeEndpoint('get', MEMBERS, () => HttpResponse.json([EMMA, LIAM]))

      reopen()
      await user.click(screen.getByRole('button', { name: 'Add members' }))

      expect(await within(picker('Select Members')).findByRole('checkbox', { name: 'Liam Chen' })).not.toBeChecked()
      expect(within(picker('Select Members')).queryByRole('alert')).not.toBeInTheDocument()
    })

    it("doesn't offer the last opening's people while loading them again", async () => {
      fakeBackend()
      fakeEndpoint('get', MEMBERS, () => HttpResponse.json([EMMA, LIAM]))
      const { user, reopen } = renderDialog(WITH_PEOPLE)
      await user.click(screen.getByRole('button', { name: 'Add members' }))
      await within(picker('Select Members')).findByRole('checkbox', { name: 'Liam Chen' })
      await cancelPicker(user, 'Select Members')
      const held = heldAnswer(() => HttpResponse.json([EMMA, LIAM]))
      fakeEndpoint('get', MEMBERS, held.answer)

      reopen()
      await user.click(screen.getByRole('button', { name: 'Add members' }))

      expect(within(picker('Select Members')).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(pickerSave('Select Members')).toBeDisabled()
      held.release()
      await within(picker('Select Members')).findByRole('checkbox', { name: 'Liam Chen' })
    })

    it("drops a late answer for the last opening", async () => {
      fakeBackend()
      const held = heldAnswer(() => HttpResponse.json([NOAH]))
      const loads = fakeEndpoint('get', MEMBERS, held.answer)
      const { user, reopen } = renderDialog(WITH_PEOPLE)
      await waitFor(() => expect(loads.requests).toHaveLength(1))
      fakeEndpoint('get', MEMBERS, () => HttpResponse.json([EMMA, LIAM]))
      reopen()
      await user.click(screen.getByRole('button', { name: 'Add members' }))
      await within(picker('Select Members')).findByRole('checkbox', { name: 'Liam Chen' })

      held.release()

      // Gives the late answer time to land.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(within(picker('Select Members')).queryByRole('checkbox', { name: 'Noah Garcia' })).not.toBeInTheDocument()
    })

    it('drops a late failure for the last opening too', async () => {
      fakeBackend()
      const held = heldAnswer(refused)
      const loads = fakeEndpoint('get', MEMBERS, held.answer)
      const { user, reopen } = renderDialog(WITH_PEOPLE)
      await waitFor(() => expect(loads.requests).toHaveLength(1))
      fakeEndpoint('get', MEMBERS, () => HttpResponse.json([EMMA, LIAM]))
      reopen()
      await user.click(screen.getByRole('button', { name: 'Add members' }))
      await within(picker('Select Members')).findByRole('checkbox', { name: 'Liam Chen' })

      held.release()

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(within(picker('Select Members')).queryByRole('alert')).not.toBeInTheDocument()
      expect(pickerSave('Select Members')).toBeEnabled()
    })
  })

  describe("dates that can't be saved", () => {
    // The start, due and end date fields, in that order.
    const dateField = (index: number) => screen.getByRole('group', { name: ['Start Date', 'Due date', 'End date'][index] })
    async function typeDate(user: ReturnType<typeof renderDialog>['user'], index: number, digits: string) {
      await user.click(within(dateField(index)).getAllByRole('spinbutton')[0])
      await user.keyboard(digits)
    }
    const sentDates = (saved: ReturnType<typeof fakeBackend>['saved']) => saved.requests.map((r) => {
      const { start_at, due_at, end_at } = r.body as Record<string, string | null>
      return [start_at, due_at, end_at]
    })

    it.each([
      [0, 'Complete the start date, or remove it.'],
      [1, 'Complete the due date, or remove it.'],
      [2, 'Complete the end date, or remove it.'],
    ])('refuses a date typed without its time (field %i), saying which, and sends nothing', async (index, message) => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog()
      await typeDate(user, index, '05032026')

      await user.click(saveButton())

      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(saved.requests).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it('refuses an impossible date the same way', async () => {
      const { saved } = fakeBackend()
      const { user } = renderDialog()
      await typeDate(user, 0, '310220261000')

      await user.click(saveButton())

      expect(screen.getByRole('alert')).toHaveTextContent('Complete the start date, or remove it.')
      expect(saved.requests).toEqual([])
    })

    it('saves the date once its time is typed too', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog()
      await typeDate(user, 0, '05032026')
      await user.click(saveButton())
      await screen.findByRole('alert')

      await user.click(within(dateField(0)).getByRole('spinbutton', { name: 'Hours' }))
      await user.keyboard('1030')
      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentDates(saved)).toEqual([['2026-03-05T09:30:00.000Z', null, null]])
    })

    it('saves without it once removed', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog()
      await typeDate(user, 0, '05')

      await user.click(screen.getByRole('button', { name: 'Remove the start date' }))
      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentDates(saved)).toEqual([[null, null, null]])
    })
  })

  describe('names for screen readers', () => {
    it('names each date field, and each remove button after its date', () => {
      fakeBackend()
      renderDialog({ ...CARD, start_at: '2026-03-02T08:00:00Z', due_at: '2026-03-05T16:00:00Z', end_at: '2026-03-04T12:00:00Z' })
      for (const name of ['Start Date', 'Due date', 'End date']) {
        expect(screen.getByRole('group', { name })).toBeInTheDocument()
      }
      for (const name of ['Remove the start date', 'Remove the due date', 'Remove the end date']) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
    })

    it("names each checklist's buttons after the checklist", () => {
      fakeBackend()
      renderDialog({ ...CARD, checklists: [LAUNCH, checklist('checklist-2', 'Follow-up', ['Call back'])] })
      for (const name of ['Launch', 'Follow-up']) {
        expect(screen.getByRole('button', { name: `Edit the checklist ${name}` })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: `Menu for the checklist ${name}` })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: `Move the checklist ${name}` })).toBeInTheDocument()
      }
    })

    it('names each extract button after its item', () => {
      fakeBackend()
      renderDialog({ ...CARD, checklists: [checklist('checklist-1', 'Launch', ['Write copy', 'Book the room'])] })
      expect(screen.getByRole('button', { name: 'Extract "Write copy" to a new card' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Extract "Book the room" to a new card' })).toBeInTheDocument()
    })

    it('names the creator, whose avatar is the only sign of them', () => {
      fakeBackend()
      renderDialog({ ...CARD, creator: NOAH })
      expect(screen.getByRole('img', { name: 'Noah Garcia' })).toBeInTheDocument()
    })

    it('names the member and assignee avatars by what a click on them changes', async () => {
      fakeBackend()
      const { user } = renderDialog(WITH_PEOPLE)

      await user.click(screen.getByRole('button', { name: 'Change the assignees: Liam Chen' }))

      expect(screen.getByRole('dialog', { name: 'Select Assignees' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change the members: Emma Wilson', hidden: true })).toBeInTheDocument()
    })
  })
})
