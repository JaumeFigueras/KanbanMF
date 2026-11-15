import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { CardRead, ChecklistRead } from '../types/board'
import { fakeEndpoint } from '../test/endpoints'
import { makeCard, makeLabel } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CardDialog from './CardDialog'

const MEMBERS = '/api/v1/boards/:boardId/members'
const CARD_URL = '/api/v1/boards/:boardId/lists/:listId/cards/:cardId'
const CHECKLISTS = `${CARD_URL}/checklists`

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

function renderDialog(card: CardRead = CARD) {
  const onClose = vi.fn()
  const onUpdated = vi.fn()
  const dialog = (open: boolean, shown: CardRead) => (
    <CardDialog open={open} onClose={onClose} listId="list-2" boardId="board-1" numberLocale="en_GB" card={shown}
      onUpdated={onUpdated} />
  )
  const result = renderWithProviders(dialog(true, card))
  let current = card
  return {
    ...result,
    onClose,
    onUpdated,
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

// The same content, as a new object with its keys in another order.
function copyOf(card: CardRead): CardRead {
  return Object.fromEntries(Object.entries(structuredClone(card)).reverse()) as unknown as CardRead
}

async function typeIntoName(user: ReturnType<typeof renderDialog>['user'], text: string) {
  await user.click(nameField())
  await user.paste(text)
}

const CHANGED_ELSEWHERE = 'This card was changed elsewhere while you were editing it. Saving replaces those changes; Cancel to see them.'

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
})
