import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { CardRead, ChecklistRead } from '../types/board'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeBoard, makeCard, makeLabel, makeList, makePerson } from '../test/fixtures'
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
// `refuseOnce`, the first time each is asked for. Like the backend, it
// refuses an order that doesn't name every checklist (or item) it has.
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
    renamed: fakeEndpoint('patch', `${CHECKLISTS}/:checklistId`, async (request) => {
      const list = lists.find((l) => l.id === at(request, 1))!
      list.name = (await request.json() as { name: string }).name
      return HttpResponse.json(list)
    }),
    itemsChanged: fakeEndpoint('patch', `${CHECKLISTS}/:checklistId/items/:itemId`, async (request) => {
      const item = lists.find((l) => l.id === at(request, 3))!.items.find((i) => i.id === at(request, 1))!
      Object.assign(item, await request.json() as { text: string; is_done: boolean })
      return HttpResponse.json(item)
    }),
    itemsDeleted: fakeEndpoint('delete', `${CHECKLISTS}/:checklistId/items/:itemId`, (request) => {
      const list = lists.find((l) => l.id === at(request, 3))!
      list.items.splice(list.items.findIndex((i) => i.id === at(request, 1)), 1)
      return new HttpResponse(null, { status: 204 })
    }),
    checklistsOrdered: fakeEndpoint('put', `${CHECKLISTS}/order`, async (request) => {
      const { checklist_ids } = await request.json() as { checklist_ids: string[] }
      if (!sameIds(checklist_ids, lists)) return HttpResponse.json({ detail: 'Not every checklist' }, { status: 422 })
      lists.sort((a, b) => checklist_ids.indexOf(a.id) - checklist_ids.indexOf(b.id))
      return HttpResponse.json(lists)
    }),
    itemsOrdered: fakeEndpoint('put', `${CHECKLISTS}/:checklistId/items/order`, async (request) => {
      const list = lists.find((l) => l.id === at(request, 3))!
      const { item_ids } = await request.json() as { item_ids: string[] }
      if (!sameIds(item_ids, list.items)) return HttpResponse.json({ detail: 'Not every item' }, { status: 422 })
      list.items.sort((a, b) => item_ids.indexOf(a.id) - item_ids.indexOf(b.id))
      return HttpResponse.json(list.items)
    }),
  }
}

// Whether `ids` names each of `things` exactly once.
function sameIds(ids: string[], things: { id: string }[]) {
  return ids.length === things.length && things.every((thing) => ids.includes(thing.id))
}

// A checklist as the server has it: its name, and its items with their ticks.
const contents = (lists: ChecklistRead[]) => lists.map((l) => [l.name, l.items.map((i) => [i.text, i.is_done])])

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

// A card to edit, or null for a new one, on a list of that colour. Without
// `takesCopies`, the board takes no copies (no onCopied), as in the archive.
function renderDialog(card: CardRead | null = CARD, listColor: string | null = null, takesCopies = true) {
  const onClose = vi.fn()
  const onUpdated = vi.fn()
  const onCreated = vi.fn()
  const onCopied = vi.fn()
  const onChecklistCopied = vi.fn()
  const dialog = (open: boolean, shown: CardRead | null) => (
    <CardDialog open={open} onClose={onClose} listId="list-2" boardId="board-1" numberLocale="en_GB" card={shown}
      listColor={listColor} onUpdated={onUpdated} onCreated={onCreated} onCopied={takesCopies ? onCopied : undefined}
      onChecklistCopied={onChecklistCopied} />
  )
  const result = renderWithProviders(dialog(true, card))
  let current = card
  return {
    ...result,
    onClose,
    onUpdated,
    onCreated,
    onCopied,
    onChecklistCopied,
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

// The start, due and end date fields, in that order.
const dateField = (index: number) => screen.getByRole('group', { name: ['Start Date', 'Due date', 'End date'][index] })
// What a date field shows, section by section: "05|03|2026|10|30".
const shownDate = (index: number) => within(dateField(index)).getAllByRole('spinbutton').map((s) => s.textContent).join('|')
// Types digits into a date field from its first section, as a person does.
async function typeDate(user: ReturnType<typeof renderDialog>['user'], index: number, digits: string) {
  await user.click(within(dateField(index)).getAllByRole('spinbutton')[0])
  await user.keyboard(digits)
}
const sentDates = (saved: { requests: { body: unknown }[] }) => saved.requests.map((r) => {
  const { start_at, due_at, end_at } = r.body as Record<string, string | null>
  return [start_at, due_at, end_at]
})

const descriptionField = () => screen.getByRole('textbox', { name: 'Description' })
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' })
// The board's labels, for the label picker.
const URGENT = CARD.labels[0]
const DESIGN = makeLabel({ id: 'label-2', name: 'Design', color: '#1976D2' })
const boardLabels = () => fakeEndpoint('get', '/api/v1/boards/:boardId/labels', () => HttpResponse.json([URGENT, DESIGN]))

// Ticks (or unticks) labels in the label picker, then saves it.
async function pickLabels(user: ReturnType<typeof renderDialog>['user'], opener: HTMLElement, names: string[]) {
  await user.click(opener)
  const picker = screen.getByRole('dialog', { name: 'Select Labels' })
  for (const name of names) await user.click(await within(picker).findByRole('checkbox', { name }))
  await user.click(within(picker).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Select Labels' })).not.toBeInTheDocument())
}

// A card with something in every field this step is about.
const FILLED: CardRead = { ...CARD, start_at: '2026-03-02T08:00:00Z', due_at: '2026-03-05T16:00:00Z' }

// The people pickers, by their titles.
type PeoplePicker = 'Select Members' | 'Select Assignees'
const picker = (title: PeoplePicker) => screen.getByRole('dialog', { name: title })
const pickerSave = (title: PeoplePicker) => within(picker(title)).getByRole('button', { name: 'Save' })
// Waits for a picker to be gone: until then the card dialog behind it is
// hidden from the screen reader, and its buttons with it.
const pickerGone = (title: PeoplePicker) =>
  waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument())
async function cancelPicker(user: ReturnType<typeof renderDialog>['user'], title: PeoplePicker) {
  await user.click(within(picker(title)).getByRole('button', { name: 'Cancel' }))
  await pickerGone(title)
}
// Ticks (or unticks) people in a picker, then saves it.
async function pickPeople(user: ReturnType<typeof renderDialog>['user'], opener: HTMLElement, title: PeoplePicker, names: string[]) {
  await user.click(opener)
  for (const name of names) await user.click(await within(picker(title)).findByRole('checkbox', { name }))
  await user.click(pickerSave(title))
  await pickerGone(title)
}
// The board's people, all three.
const boardPeople = () => fakeEndpoint('get', MEMBERS, () => HttpResponse.json([EMMA, LIAM, NOAH]))
// Who the dialog shows as members, and as assignees, by their avatars.
const shownPeople = (role: 'members' | 'assignees') =>
  screen.queryAllByRole('button', { name: new RegExp(`^Change the ${role}: `) })
    .map((avatar) => avatar.getAttribute('aria-label')!.replace(`Change the ${role}: `, ''))
// The people a save sent.
const sentPeople = (saved: { requests: { body: unknown }[] }) => saved.requests.map((r) => {
  const { member_ids, assignee_ids } = r.body as { member_ids: string[]; assignee_ids: string[] }
  return [member_ids, assignee_ids]
})

const CHANGED_ELSEWHERE = 'This card was changed elsewhere while you were editing it. Saving replaces those changes; Cancel to see them.'
const NOT_ALL_SAVED = "The card was saved, but some checklist changes weren't. Check its checklists and save again."

describe('CardDialog', () => {
  describe('a new card', () => {
    it('opens empty, as Create Card', () => {
      fakeCardSaves()
      renderDialog(null)
      expect(screen.getByRole('dialog', { name: 'Create Card' })).toBeInTheDocument()
      expect(nameField()).toHaveValue('')
      expect(descriptionField()).toHaveValue('')
      // No dates: none of them can be removed.
      for (const date of ['start', 'due', 'end']) {
        expect(screen.queryByRole('button', { name: `Remove the ${date} date` })).not.toBeInTheDocument()
      }
      expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
    })

    it("creates it with what was filled in, and hands it to the board with its list's colour", async () => {
      const { created, saved } = fakeCardSaves()
      fakeEndpoint('get', CHECKLISTS, () => HttpResponse.json([]))
      const { user, onCreated, onUpdated, onClose } = renderDialog(null, '#4CAF50')
      await typeIntoName(user, 'Launch plan')
      await user.click(descriptionField())
      await user.paste('Goals and dates')
      await typeDate(user, 1, '050320261030')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(created.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/lists/list-2/cards', {
          name: 'Launch plan',
          description: 'Goals and dates',
          start_at: null,
          due_at: '2026-03-05T09:30:00.000Z',
          end_at: null,
          label_ids: [],
          member_ids: [],
          assignee_ids: [],
        }],
      ])
      expect(onCreated.mock.calls).toEqual([[expect.objectContaining({ id: 'card-9' }), '#4CAF50']])
      expect(onUpdated).not.toHaveBeenCalled()
      expect(saved.requests).toEqual([])
    })

    it('hands it to the board with no colour when its list has none', async () => {
      fakeCardSaves()
      fakeEndpoint('get', CHECKLISTS, () => HttpResponse.json([]))
      const { user, onCreated } = renderDialog(null, null)
      await typeIntoName(user, 'Launch plan')

      await user.click(saveButton())

      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
      expect(onCreated.mock.calls[0][1]).toBeNull()
    })
  })

  describe('editing a card', () => {
    it('opens on the card, as Edit Card', () => {
      fakeBackend()
      renderDialog(FILLED)
      expect(screen.getByRole('dialog', { name: 'Edit Card' })).toBeInTheDocument()
      expect(nameField()).toHaveValue('Homepage layout')
      expect(descriptionField()).toHaveValue('Hero and footer')
      expect(screen.getByRole('button', { name: 'Urgent' })).toBeInTheDocument()
      // In the device's time zone (Madrid here), in the user's date format.
      expect(shownDate(0)).toBe('02|03|2026|09|00')
      expect(shownDate(1)).toBe('05|03|2026|17|00')
      expect(screen.queryByRole('button', { name: 'Remove the end date' })).not.toBeInTheDocument()
    })

    it('saves every field, and tells the board, with no colour of its own', async () => {
      const { saved } = fakeBackend()
      const { user, onUpdated, onCreated, onClose } = renderDialog(FILLED, '#4CAF50')
      await typeIntoName(user, ' v2')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(saved.requests.map((r) => [r.url.pathname, r.body])).toEqual([
        ['/api/v1/boards/board-1/lists/list-2/cards/card-7', {
          name: 'Homepage layout v2',
          description: 'Hero and footer',
          start_at: '2026-03-02T08:00:00.000Z',
          due_at: '2026-03-05T16:00:00.000Z',
          end_at: null,
          label_ids: ['label-1'],
          member_ids: [],
          assignee_ids: [],
        }],
      ])
      expect(onUpdated.mock.calls).toEqual([[expect.objectContaining({ id: 'card-7' })]])
      expect(onCreated).not.toHaveBeenCalled()
    })

    it('sends an emptied description, and a removed date, as none', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog(FILLED)
      await user.clear(descriptionField())
      await user.click(screen.getByRole('button', { name: 'Remove the due date' }))

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      const body = saved.requests[0].body as Record<string, unknown>
      expect([body.description, body.start_at, body.due_at]).toEqual([null, '2026-03-02T08:00:00.000Z', null])
    })
  })

  describe('checks before saving', () => {
    it('requires a name, spaces not counting, and sends nothing', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog()
      await user.clear(nameField())
      await user.paste('   ')

      await user.click(saveButton())

      expect(screen.getByRole('alert')).toHaveTextContent('Card name is required.')
      expect(saved.requests).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it('refuses a start date after the end date, and sends nothing', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog(FILLED)
      await typeDate(user, 2, '010320260900')

      await user.click(saveButton())

      expect(screen.getByRole('alert')).toHaveTextContent('Start date must be before the end date.')
      expect(saved.requests).toEqual([])
      expect(onClose).not.toHaveBeenCalled()
    })

    it('accepts a start and an end at the same moment', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog(FILLED)
      await typeDate(user, 2, '020320260900')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentDates(saved)).toEqual([['2026-03-02T08:00:00.000Z', '2026-03-05T16:00:00.000Z', '2026-03-02T08:00:00.000Z']])
    })

    it('trims the name and the description', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog()
      await user.clear(nameField())
      await user.paste('  Home page  ')
      await user.clear(descriptionField())
      await user.paste('  Hero only \n')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      const body = saved.requests[0].body as Record<string, unknown>
      expect([body.name, body.description]).toEqual(['Home page', 'Hero only'])
    })

    it('sends a description of only spaces as none', async () => {
      const { saved } = fakeBackend()
      const { user, onClose } = renderDialog()
      await user.clear(descriptionField())
      await user.paste('   ')

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect((saved.requests[0].body as Record<string, unknown>).description).toBeNull()
    })
  })

  describe('labels', () => {
    it('adds labels through their picker, shows them in their colours, and saves them', async () => {
      const { saved } = fakeBackend()
      boardLabels()
      const { user, onClose } = renderDialog()

      await pickLabels(user, screen.getByRole('button', { name: 'Add labels' }), ['Design'])

      expect(screen.getByRole('button', { name: 'Design' })).toHaveStyle({ backgroundColor: '#1976D2' })
      expect(screen.getByRole('button', { name: 'Urgent' })).toHaveStyle({ backgroundColor: '#d32f2f' })
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect((saved.requests[0].body as Record<string, unknown>).label_ids).toEqual(['label-1', 'label-2'])
    })

    it("takes a label off through the picker, opened from the label's chip", async () => {
      const { saved } = fakeBackend()
      boardLabels()
      const { user, onClose } = renderDialog()

      await pickLabels(user, screen.getByRole('button', { name: 'Urgent' }), ['Urgent'])

      expect(screen.queryByRole('button', { name: 'Urgent' })).not.toBeInTheDocument()
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect((saved.requests[0].body as Record<string, unknown>).label_ids).toEqual([])
    })
  })

  describe('saving', () => {
    it('disables Save and Cancel while the card is saved', async () => {
      fakeBackend()
      const held = heldAnswer(() => HttpResponse.json(CARD))
      fakeEndpoint('patch', CARD_URL, held.answer)
      const { user, onClose } = renderDialog()

      await user.click(saveButton())

      await waitFor(() => expect(saveButton()).toBeDisabled())
      expect(cancelButton()).toBeDisabled()
      held.release()
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('says so when the save is refused, keeps what was typed, and tells the board nothing', async () => {
      fakeBackend()
      const saved = fakeEndpoint('patch', CARD_URL, refused)
      const { user, onUpdated, onClose } = renderDialog()
      await typeIntoName(user, ' v2')

      await user.click(saveButton())

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(saved.requests).toHaveLength(1)
      expect(nameField()).toHaveValue('Homepage layout v2')
      expect(onUpdated).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      // Ready for another try.
      expect(saveButton()).toBeEnabled()
      expect(cancelButton()).toBeEnabled()
    })

    it('says the same when the connection drops', async () => {
      const { created } = fakeCardSaves()
      fakeEndpoint('post', CARDS, () => HttpResponse.error())
      const { user, onCreated, onClose } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')

      await user.click(saveButton())

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
      expect(created.requests).toEqual([])
      expect(onCreated).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('Cancel, and opening again', () => {
    it('closes on Cancel, sending nothing and telling the board nothing', async () => {
      const { saved } = fakeBackend()
      const { user, onClose, onUpdated } = renderDialog()
      await typeIntoName(user, ' v2')

      await user.click(cancelButton())

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(saved.requests).toEqual([])
      expect(onUpdated).not.toHaveBeenCalled()
    })

    it('opens a card as it is again, whatever was changed and said before', async () => {
      fakeBackend()
      boardLabels()
      const { user, reopen } = renderDialog(FILLED)
      await user.clear(descriptionField())
      await user.click(screen.getByRole('button', { name: 'Remove the due date' }))
      await pickLabels(user, screen.getByRole('button', { name: 'Add labels' }), ['Design'])
      await user.clear(nameField())
      await user.click(saveButton())
      expect(screen.getByRole('alert')).toHaveTextContent('Card name is required.')

      reopen()

      expect(nameField()).toHaveValue('Homepage layout')
      expect(descriptionField()).toHaveValue('Hero and footer')
      expect(shownDate(1)).toBe('05|03|2026|17|00')
      expect(screen.queryByRole('button', { name: 'Design' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Urgent' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('opens a new card empty again', async () => {
      fakeCardSaves()
      boardLabels()
      const { user, reopen } = renderDialog(null)
      await typeIntoName(user, 'Launch plan')
      await user.click(descriptionField())
      await user.paste('Goals')
      await pickLabels(user, screen.getByRole('button', { name: 'Add labels' }), ['Design'])

      reopen()

      expect(nameField()).toHaveValue('')
      expect(descriptionField()).toHaveValue('')
      expect(screen.queryByRole('button', { name: 'Design' })).not.toBeInTheDocument()
    })
  })

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

    // A new card as the backend makes it: whoever creates it (Emma) is one
    // of its members, whatever was sent.
    async function partlySavedNewCard(pickedMembers: string[] = []) {
      boardPeople()
      const made = { ...NEW_CARD, creator: EMMA, members: [EMMA, ...[LIAM, NOAH].filter((p) => pickedMembers.includes(p.display_name))] }
      const created = fakeEndpoint('post', CARDS, () => HttpResponse.json(made, { status: 201 }))
      const saved = fakeEndpoint('patch', CARD_URL, () => HttpResponse.json(made))
      checklistServer([], ['Launch'])
      const rendered = renderDialog(null)
      await typeIntoName(rendered.user, 'Launch plan')
      if (pickedMembers.length) {
        await pickPeople(rendered.user, screen.getByRole('button', { name: 'Add members' }), 'Select Members', pickedMembers)
      }
      await addChecklist(rendered.user, 'Launch', ['Write copy'])
      await rendered.user.click(saveButton())
      expect(await screen.findByRole('alert')).toHaveTextContent(NOT_ALL_SAVED)
      return { ...rendered, created, saved }
    }

    it('shows a new card as the server made it after a partial save: its creator, and them among its members', async () => {
      await partlySavedNewCard(['Liam Chen'])

      expect(screen.getByRole('img', { name: 'Emma Wilson' })).toBeInTheDocument()
      expect(shownPeople('members')).toEqual(['Emma Wilson', 'Liam Chen'])
    })

    it("keeps a new card's creator among its members on the second Save", async () => {
      const { user, onClose, created, saved } = await partlySavedNewCard(['Liam Chen'])

      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(created)).toEqual([[['user-2'], []]])
      expect(sentPeople(saved)).toEqual([[['user-1', 'user-2'], []]])
    })
  })

  describe('checklists', () => {
    // A checklist row, found by its name.
    const row = (name: string) => screen.getByRole('button', { name: `Edit the checklist ${name}` }).parentElement!.parentElement!

    describe('changed in the dialog, and sent only on Save', () => {
      it('adds a checklist through its dialog, shown with its items, none of them done', async () => {
        fakeCardSaves()
        const server = checklistServer([])
        const { user } = renderDialog({ ...CARD, checklists: [] })
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()

        await addChecklist(user, 'Launch', ['Write copy', 'Book the room'])

        expect(within(row('Launch')).getByText('0/2')).toBeInTheDocument()
        expect(within(row('Launch')).getByRole('checkbox', { name: 'Write copy' })).not.toBeChecked()
        expect(within(row('Launch')).getByRole('checkbox', { name: 'Book the room' })).not.toBeChecked()
        expect(screen.queryByText('No checklists yet.')).not.toBeInTheDocument()
        expect(server.created.requests).toEqual([])
      })

      it('edits a checklist through its dialog, which opens on it, leaving the others as they were', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH])
        const { user } = renderDialog({ ...CARD, checklists: [LAUNCH, checklist('checklist-2', 'Follow-up', ['Call back'])] })

        await user.click(screen.getByRole('button', { name: 'Edit the checklist Launch' }))
        const dialog = screen.getByRole('dialog', { name: 'Edit Checklist' })
        expect(within(dialog).getByRole('textbox', { name: 'Checklist name' })).toHaveValue('Launch')
        expect(within(dialog).getByRole('textbox', { name: 'Item 1' })).toHaveValue('Write copy')
        await user.clear(within(dialog).getByRole('textbox', { name: 'Checklist name' }))
        await user.type(within(dialog).getByRole('textbox', { name: 'Checklist name' }), 'Go live')
        await user.type(within(dialog).getByRole('textbox', { name: 'Add an item' }), 'Book the room{Enter}')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Checklist' })).not.toBeInTheDocument())

        expect(screen.queryByRole('button', { name: 'Edit the checklist Launch' })).not.toBeInTheDocument()
        expect(within(row('Go live')).getByText('0/2')).toBeInTheDocument()
        expect(within(row('Follow-up')).getByText('0/1')).toBeInTheDocument()
        expect(server.renamed.requests).toEqual([])
      })

      it('ticks and unticks an item, counting it at once, in its own checklist only', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH])
        const { user } = renderDialog({ ...CARD, checklists: [LAUNCH, checklist('checklist-2', 'Follow-up', ['Call back'])] })
        const item = within(row('Launch')).getByRole('checkbox', { name: 'Write copy' })

        await user.click(item)
        expect(item).toBeChecked()
        expect(within(row('Launch')).getByText('1/1')).toBeInTheDocument()
        expect(within(row('Follow-up')).getByText('0/1')).toBeInTheDocument()
        await user.click(item)
        expect(item).not.toBeChecked()
        expect(within(row('Launch')).getByText('0/1')).toBeInTheDocument()
        expect(server.itemsChanged.requests).toEqual([])
      })

      it('removes a checklist from its menu', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH])
        const { user } = renderDialog()

        await removeChecklist(user)

        expect(screen.queryByRole('button', { name: 'Edit the checklist Launch' })).not.toBeInTheDocument()
        expect(screen.getByText('No checklists yet.')).toBeInTheDocument()
        expect(server.deleted.requests).toEqual([])
      })

      it('shows no count for a checklist with no items', () => {
        fakeBackend()
        renderDialog({ ...CARD, checklists: [checklist('checklist-2', 'Ideas', [])] })
        expect(within(row('Ideas')).queryByText(/\d+\/\d+/)).not.toBeInTheDocument()
      })
    })

    describe('saved', () => {
      it('saves a new checklist, with its items, on the card', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH])
        const { user, onClose } = renderDialog()
        await addChecklist(user, 'Follow-up', ['Call back', 'Send the notes'])

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(contents(server.lists)).toEqual([
          ['Launch', [['Write copy', false]]],
          ['Follow-up', [['Call back', false], ['Send the notes', false]]],
        ])
      })

      it("saves a checklist's new name", async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH])
        const { user, onClose } = renderDialog()
        await user.click(screen.getByRole('button', { name: 'Edit the checklist Launch' }))
        await user.clear(screen.getByRole('textbox', { name: 'Checklist name' }))
        await user.type(screen.getByRole('textbox', { name: 'Checklist name' }), 'Go live')
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Checklist' })).not.toBeInTheDocument())

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(contents(server.lists)).toEqual([['Go live', [['Write copy', false]]]])
      })

      it('saves the items changed, ticked, removed and added', async () => {
        fakeCardSaves()
        const server = checklistServer([checklist('checklist-1', 'Launch', ['Write copy', 'Book the room', 'Order food'])])
        const { user, onClose } = renderDialog({ ...CARD, checklists: server.lists.map((l) => structuredClone(l)) })
        await user.click(screen.getByRole('button', { name: 'Edit the checklist Launch' }))
        const dialog = screen.getByRole('dialog', { name: 'Edit Checklist' })
        await user.clear(within(dialog).getByRole('textbox', { name: 'Item 1' }))
        await user.type(within(dialog).getByRole('textbox', { name: 'Item 1' }), 'Write the copy')
        await user.click(within(dialog).getAllByRole('button', { name: 'Remove item' })[1])
        await user.type(within(dialog).getByRole('textbox', { name: 'Add an item' }), 'Send invites{Enter}')
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Checklist' })).not.toBeInTheDocument())
        await user.click(within(row('Launch')).getByRole('checkbox', { name: 'Order food' }))

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(contents(server.lists)).toEqual([
          ['Launch', [['Write the copy', false], ['Order food', true], ['Send invites', false]]],
        ])
      })

      it('deletes a checklist removed from its menu', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH, checklist('checklist-2', 'Follow-up', ['Call back'])])
        const { user, onClose } = renderDialog({ ...CARD, checklists: server.lists.map((l) => structuredClone(l)) })
        await removeChecklist(user, 'Follow-up')

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(contents(server.lists)).toEqual([['Launch', [['Write copy', false]]]])
        expect(server.deleted.requests.map((r) => r.url.pathname)).toEqual([
          '/api/v1/boards/board-1/lists/list-2/cards/card-7/checklists/checklist-2',
        ])
      })

      it('saves the checklists of a new card on the card it created', async () => {
        const { created } = fakeCardSaves()
        const server = checklistServer([])
        const { user, onClose } = renderDialog(null)
        await typeIntoName(user, 'Launch plan')
        await addChecklist(user, 'Launch', ['Write copy'])

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(created.requests).toHaveLength(1)
        expect(server.created.requests.map((r) => r.url.pathname)).toEqual([
          '/api/v1/boards/board-1/lists/list-2/cards/card-9/checklists',
        ])
        expect(contents(server.lists)).toEqual([['Launch', [['Write copy', false]]]])
      })

      it('hands the board the checklists as the server has them once saved', async () => {
        fakeCardSaves()
        checklistServer([LAUNCH])
        const { user, onUpdated } = renderDialog()
        await addChecklist(user, 'Follow-up', ['Call back'])

        await user.click(saveButton())

        await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
        const handed = onUpdated.mock.calls[0][0] as CardRead
        expect(handed.checklists.map((l) => [l.id, l.name])).toEqual([['checklist-1', 'Launch'], ['server-1', 'Follow-up']])
      })

      it.each([
        ['refused', refused],
        ['cut off', () => HttpResponse.error()],
      ])("hands the board the card's checklists from the save when fetching them again is %s", async (_, answer) => {
        const fromSave = { ...CARD, checklists: [checklist('checklist-1', 'Launch', ['Write copy'])] }
        fakeCardSaves(fromSave)
        checklistServer([LAUNCH])
        fakeEndpoint('get', CHECKLISTS, answer)
        const { user, onUpdated, onClose } = renderDialog()

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(onUpdated.mock.calls).toEqual([[expect.objectContaining({ checklists: fromSave.checklists })]])
      })
    })

    describe('their order, and what the dialog never showed', () => {
      it('sends no order when nothing was moved', async () => {
        fakeCardSaves()
        const server = checklistServer([checklist('checklist-1', 'Launch', ['Write copy', 'Book the room'])])
        const { user, onClose } = renderDialog({ ...CARD, checklists: server.lists.map((l) => structuredClone(l)) })
        await user.click(screen.getByRole('button', { name: 'Edit the checklist Launch' }))
        await user.click(screen.getAllByRole('button', { name: 'Remove item' })[0])
        await user.type(screen.getByRole('textbox', { name: 'Add an item' }), 'Send invites{Enter}')
        await user.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Checklist' })).not.toBeInTheDocument())
        await addChecklist(user, 'Follow-up', ['Call back'])

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(server.checklistsOrdered.requests).toEqual([])
        expect(server.itemsOrdered.requests).toEqual([])
        expect(contents(server.lists)).toEqual([
          ['Launch', [['Book the room', false], ['Send invites', false]]],
          ['Follow-up', [['Call back', false]]],
        ])
      })

      it('saves in one go after a checklist is copied onto this same card, and keeps the copy', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH])
        fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [makeBoard({ id: 'board-1' })], shared: [], templates: [] }))
        fakeEndpoint('get', '/api/v1/boards/:boardId/lists', () => HttpResponse.json([makeList({ id: 'list-2', board_id: 'board-1', name: 'Doing' })]))
        fakeEndpoint('get', CARDS, () => HttpResponse.json([CARD]))
        const { user, onClose } = renderDialog()
        await user.click(screen.getByRole('button', { name: 'Menu for the checklist Launch' }))
        await user.click(screen.getByRole('menuitem', { name: 'Copy checklist to another card' }))
        const copyDialog = screen.getByRole('dialog', { name: 'Copy Checklist' })
        // The card the copy dialog proposes: this one.
        await waitFor(() => expect(within(copyDialog).getByRole('combobox', { name: 'Card' })).toHaveTextContent('Homepage layout'))
        await user.click(within(copyDialog).getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Copy Checklist' })).not.toBeInTheDocument())
        await user.click(within(row('Launch')).getByRole('checkbox', { name: 'Write copy' }))

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(contents(server.lists)).toEqual([
          ['Launch', [['Write copy', true]]],
          ['Launch', [['Write copy', false]]],
        ])
      })

      it('leaves a checklist added elsewhere alone, on a second Save too', async () => {
        fakeCardSaves()
        const followUp = checklist('checklist-2', 'Follow-up', ['Call back'])
        const server = checklistServer([LAUNCH, followUp], ['Ideas'])
        const { user, handOver, onClose } = renderDialog()
        handOver({ ...CARD, checklists: [LAUNCH, followUp] })
        await addChecklist(user, 'Ideas', [])
        await user.click(saveButton())
        expect(await screen.findByText(NOT_ALL_SAVED)).toBeInTheDocument()

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(server.deleted.requests).toEqual([])
        expect(server.lists.map((l) => l.name)).toEqual(['Launch', 'Follow-up', 'Ideas'])
      })

      it('leaves an item added elsewhere alone, on a second Save too', async () => {
        fakeCardSaves()
        const server = checklistServer([checklist('checklist-1', 'Launch', ['Write copy', 'Call the printer'])], ['Ideas'])
        const { user, onClose } = renderDialog()
        await user.click(within(row('Launch')).getByRole('checkbox', { name: 'Write copy' }))
        await addChecklist(user, 'Ideas', [])
        await user.click(saveButton())
        expect(await screen.findByText(NOT_ALL_SAVED)).toBeInTheDocument()

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(server.itemsDeleted.requests).toEqual([])
        expect(contents(server.lists)).toEqual([
          ['Launch', [['Write copy', true], ['Call the printer', false]]],
          ['Ideas', []],
        ])
      })

      it('finds on a second Save what the first made, rather than deleting it and making it again', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH], ['Ideas'])
        const { user, onClose } = renderDialog()
        await addChecklist(user, 'Follow-up', ['Call back'])
        await addChecklist(user, 'Ideas', [])
        await user.click(saveButton())
        expect(await screen.findByText(NOT_ALL_SAVED)).toBeInTheDocument()
        const madeFirst = server.lists.map((l) => l.id)

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(server.deleted.requests).toEqual([])
        expect(server.lists.map((l) => l.id).slice(0, 2)).toEqual(madeFirst)
        expect(contents(server.lists)).toEqual([
          ['Launch', [['Write copy', false]]],
          ['Follow-up', [['Call back', false]]],
          ['Ideas', []],
        ])
      })
    })

    describe('removed between two tries', () => {
      it('deletes on a second Save a checklist the first made, once you remove it', async () => {
        fakeCardSaves()
        const server = checklistServer([LAUNCH], ['Ideas'])
        const { user, onClose } = renderDialog()
        await addChecklist(user, 'Follow-up', ['Call back'])
        await addChecklist(user, 'Ideas', [])
        await user.click(saveButton())
        expect(await screen.findByText(NOT_ALL_SAVED)).toBeInTheDocument()
        await removeChecklist(user, 'Follow-up')

        await user.click(saveButton())

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
        expect(server.lists.map((l) => l.name)).toEqual(['Launch', 'Ideas'])
      })
    })

    describe('copied to another card', () => {
      it('copies a checklist as shown, unsaved changes included, and tells the board where it went', async () => {
        fakeBackend()
        fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [makeBoard({ id: 'board-1' })], shared: [], templates: [] }))
        fakeEndpoint('get', '/api/v1/boards/:boardId/lists', () => HttpResponse.json([makeList({ id: 'list-2', board_id: 'board-1', name: 'Doing' })]))
        fakeEndpoint('get', CARDS, () => HttpResponse.json([CARD]))
        const madeChecklist = fakeEndpoint('post', CHECKLISTS, () => HttpResponse.json(checklist('copy-1', 'Launch', []), { status: 201 }))
        const madeItems = fakeEndpoint('post', `${CHECKLISTS}/:checklistId/items`, () => HttpResponse.json({}, { status: 201 }))
        const { user, onChecklistCopied } = renderDialog()
        await user.click(within(row('Launch')).getByRole('checkbox', { name: 'Write copy' }))

        await user.click(screen.getByRole('button', { name: 'Menu for the checklist Launch' }))
        await user.click(screen.getByRole('menuitem', { name: 'Copy checklist to another card' }))
        const dialog = screen.getByRole('dialog', { name: 'Copy Checklist' })
        expect(within(dialog).getByRole('textbox', { name: 'Checklist name' })).toHaveValue('Launch')
        await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Card' })).toHaveTextContent('Homepage layout'))
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(onChecklistCopied.mock.calls).toEqual([['board-1', 'list-2']]))
        expect(madeChecklist.requests.map((r) => [r.url.pathname, r.body])).toEqual([
          ['/api/v1/boards/board-1/lists/list-2/cards/card-7/checklists', { name: 'Launch' }],
        ])
        // The tick, not saved yet, goes with the copy.
        expect(madeItems.requests.map((r) => r.body)).toEqual([{ text: 'Write copy', is_done: true }])
      })
    })

    describe('an item made into a card of its own', () => {
      it('names the new card after the card, as typed, and the item, and hands it to the board', async () => {
        fakeBackend()
        fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [makeBoard({ id: 'board-1' })], shared: [], templates: [] }))
        fakeEndpoint('get', '/api/v1/boards/:boardId/lists', () => HttpResponse.json([makeList({ id: 'list-2', board_id: 'board-1', name: 'Doing' })]))
        const extracted = makeCard({ id: 'card-11', list_id: 'list-2', name: 'Homepage layout v2 - Write copy' })
        const copied = fakeEndpoint('post', `${CARD_URL}/copy`, () => HttpResponse.json(extracted, { status: 201 }))
        fakeEndpoint('get', `${CARD_URL}/color`, () => HttpResponse.json({ color: '#4CAF50' }))
        const { user, onCopied } = renderDialog()
        await typeIntoName(user, ' v2')

        await user.click(screen.getByRole('button', { name: 'Extract "Write copy" to a new card' }))
        const dialog = screen.getByRole('dialog', { name: 'Extract to New Card' })
        expect(within(dialog).getByRole('textbox', { name: /^Card name/ })).toHaveValue('Homepage layout v2 - Write copy')
        await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'List' })).toHaveTextContent('Doing'))
        await user.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(onCopied.mock.calls).toEqual([['list-2', extracted, '#4CAF50']]))
        expect(copied.requests.map((r) => [r.url.pathname, r.body])).toEqual([
          ['/api/v1/boards/board-1/lists/list-2/cards/card-7/copy', {
            name: 'Homepage layout v2 - Write copy',
            target_board_id: 'board-1',
            target_list_id: 'list-2',
            include_description: false,
            include_checklists: false,
          }],
        ])
      })

      it('is not offered on a card not created yet', async () => {
        fakeCardSaves()
        checklistServer([])
        const { user } = renderDialog(null)
        await addChecklist(user, 'Launch', ['Write copy'])
        expect(screen.queryByRole('button', { name: /^Extract/ })).not.toBeInTheDocument()
      })

      it("is not offered where the board takes no copies", () => {
        fakeBackend()
        renderDialog(CARD, null, false)
        expect(screen.queryByRole('button', { name: /^Extract/ })).not.toBeInTheDocument()
      })
    })
  })

  describe('people', () => {
    it("shows the creator, who can't be changed here", () => {
      fakeBackend()
      renderDialog({ ...CARD, creator: NOAH })
      expect(screen.getByRole('img', { name: 'Noah Garcia' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Noah Garcia/ })).not.toBeInTheDocument()
    })

    it("shows the card's members and assignees, each in their place", () => {
      fakeBackend()
      renderDialog({ ...CARD, members: [EMMA, NOAH], assignees: [LIAM] })
      expect(shownPeople('members')).toEqual(['Emma Wilson', 'Noah Garcia'])
      expect(shownPeople('assignees')).toEqual(['Liam Chen'])
    })

    it("adds a member through the picker, which starts on the card's members", async () => {
      const { saved } = fakeBackend()
      boardPeople()
      const { user, onClose } = renderDialog(WITH_PEOPLE)

      await user.click(screen.getByRole('button', { name: 'Add members' }))
      expect(await within(picker('Select Members')).findByRole('checkbox', { name: 'Emma Wilson' })).toBeChecked()
      expect(within(picker('Select Members')).getByRole('checkbox', { name: 'Liam Chen' })).not.toBeChecked()
      await user.click(within(picker('Select Members')).getByRole('checkbox', { name: 'Noah Garcia' }))
      await user.click(pickerSave('Select Members'))
      await pickerGone('Select Members')

      expect(shownPeople('members')).toEqual(['Emma Wilson', 'Noah Garcia'])
      expect(shownPeople('assignees')).toEqual(['Liam Chen'])
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(saved)).toEqual([[['user-1', 'user-3'], ['user-2']]])
    })

    it('takes a member off through the picker, opened from their avatar', async () => {
      const { saved } = fakeBackend()
      boardPeople()
      const { user, onClose } = renderDialog(WITH_PEOPLE)

      await pickPeople(user, screen.getByRole('button', { name: 'Change the members: Emma Wilson' }), 'Select Members', ['Emma Wilson'])

      expect(shownPeople('members')).toEqual([])
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(saved)).toEqual([[[], ['user-2']]])
    })

    it("adds an assignee through its picker, which starts on the card's assignees", async () => {
      const { saved } = fakeBackend()
      boardPeople()
      const { user, onClose } = renderDialog(WITH_PEOPLE)

      await user.click(screen.getByRole('button', { name: 'Add assignees' }))
      expect(await within(picker('Select Assignees')).findByRole('checkbox', { name: 'Liam Chen' })).toBeChecked()
      expect(within(picker('Select Assignees')).getByRole('checkbox', { name: 'Emma Wilson' })).not.toBeChecked()
      await user.click(within(picker('Select Assignees')).getByRole('checkbox', { name: 'Noah Garcia' }))
      await user.click(pickerSave('Select Assignees'))
      await pickerGone('Select Assignees')

      expect(shownPeople('assignees')).toEqual(['Liam Chen', 'Noah Garcia'])
      expect(shownPeople('members')).toEqual(['Emma Wilson'])
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(saved)).toEqual([[['user-1'], ['user-2', 'user-3']]])
    })

    it('takes an assignee off through the picker, opened from their avatar', async () => {
      const { saved } = fakeBackend()
      boardPeople()
      const { user, onClose } = renderDialog(WITH_PEOPLE)

      await pickPeople(user, screen.getByRole('button', { name: 'Change the assignees: Liam Chen' }), 'Select Assignees', ['Liam Chen'])

      expect(shownPeople('assignees')).toEqual([])
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(saved)).toEqual([[['user-1'], []]])
    })

    it('keeps them as they were when a picker is cancelled', async () => {
      const { saved } = fakeBackend()
      boardPeople()
      const { user, onClose } = renderDialog(WITH_PEOPLE)
      await user.click(screen.getByRole('button', { name: 'Add members' }))
      await user.click(await within(picker('Select Members')).findByRole('checkbox', { name: 'Noah Garcia' }))

      await cancelPicker(user, 'Select Members')

      expect(shownPeople('members')).toEqual(['Emma Wilson'])
      await user.click(saveButton())
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(saved)).toEqual([[['user-1'], ['user-2']]])
    })

    it('gives a new card its members and assignees, with no creator shown yet', async () => {
      const { created } = fakeCardSaves()
      boardPeople()
      fakeEndpoint('get', CHECKLISTS, () => HttpResponse.json([]))
      const { user, onClose } = renderDialog(null)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      await typeIntoName(user, 'Launch plan')

      await pickPeople(user, screen.getByRole('button', { name: 'Add members' }), 'Select Members', ['Emma Wilson', 'Noah Garcia'])
      await pickPeople(user, screen.getByRole('button', { name: 'Add assignees' }), 'Select Assignees', ['Liam Chen'])
      await user.click(saveButton())

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
      expect(sentPeople(created)).toEqual([[['user-1', 'user-3'], ['user-2']]])
    })

    it("opens a card with its own people again, whatever was changed before", async () => {
      fakeBackend()
      boardPeople()
      const { user, reopen } = renderDialog(WITH_PEOPLE)
      await pickPeople(user, screen.getByRole('button', { name: 'Add members' }), 'Select Members', ['Noah Garcia'])
      await pickPeople(user, screen.getByRole('button', { name: 'Add assignees' }), 'Select Assignees', ['Liam Chen'])

      reopen()

      expect(shownPeople('members')).toEqual(['Emma Wilson'])
      expect(shownPeople('assignees')).toEqual(['Liam Chen'])
    })
  })

  describe("the board's people, to choose members and assignees from", () => {
    const PEOPLE_FAILED = "The board's people couldn't be loaded. Please close this and try again."

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
