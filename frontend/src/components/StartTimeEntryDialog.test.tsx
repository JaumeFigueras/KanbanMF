import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { fakeCardChoices } from '../test/cardChoices'
import { fakeEndpoint, heldAnswer } from '../test/endpoints'
import { makeTimeEntry } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import StartTimeEntryDialog from './StartTimeEntryDialog'

const START = '/api/v1/time-entries/start'
const RUNNING = makeTimeEntry({ id: 'entry-5', ended_at: null, card_name: 'Homepage layout' })

function renderDialog() {
  const onClose = vi.fn()
  const onStarted = vi.fn()
  const dialog = (open: boolean) => <StartTimeEntryDialog open={open} onClose={onClose} onStarted={onStarted} />
  const result = renderWithProviders(dialog(true))
  // Closes the dialog and opens it again, as the time tracker page does.
  function reopen() {
    result.rerender(dialog(false))
    result.rerender(dialog(true))
  }
  return { ...result, onClose, onStarted, reopen }
}

function commentField() {
  return screen.getByRole('textbox', { name: 'Comment' })
}

function select(name: 'Board' | 'List' | 'Card') {
  return screen.getByRole('combobox', { name })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

async function choose(user: ReturnType<typeof renderDialog>['user'], from: 'Board' | 'List' | 'Card', option: string) {
  await user.click(select(from))
  await user.click(screen.getByRole('option', { name: option }))
}

// The picker starts on the most used board's most used list's first card.
async function loaded() {
  await waitFor(() => expect(select('Card')).toHaveTextContent('Homepage layout'))
}

describe('StartTimeEntryDialog', () => {
  it('opens on the card used most, with an empty comment', async () => {
    fakeCardChoices()
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Start Tracking' })).toBeInTheDocument()
    await loaded()
    expect(commentField()).toHaveValue('')
    expect(commentField()).toHaveAttribute('maxlength', '2000')
  })

  it('starts tracking the chosen card, with the comment, then hands over the entry and closes', async () => {
    fakeCardChoices()
    const started = fakeEndpoint('post', START, () => HttpResponse.json(RUNNING, { status: 201 }))
    const { user, onStarted, onClose } = renderDialog()
    await loaded()

    await choose(user, 'List', 'To do')
    await waitFor(() => expect(select('Card')).toHaveTextContent('Contact form'))
    await user.type(commentField(), 'Client call')
    await user.click(button('Start'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(started.requests.map((r) => r.body)).toEqual([
      { board_id: 'board-1', list_id: 'list-1', card_id: 'card-3', comment: 'Client call' },
    ])
    expect(onStarted).toHaveBeenCalledWith(RUNNING)
  })

  it('asks for a card first when the list has none, sending nothing', async () => {
    fakeCardChoices()
    const started = fakeEndpoint('post', START)
    const { user } = renderDialog()
    await loaded()
    await choose(user, 'Board', 'Marketing')
    await waitFor(() => expect(select('List')).toHaveTextContent('Ideas'))
    await choose(user, 'List', 'Done')
    await screen.findByText('No cards in this list.')

    await user.click(button('Start'))

    expect(screen.getByRole('alert')).toHaveTextContent('Choose a card first.')
    expect(started.requests).toEqual([])
  })

  it('says when another task is already being tracked', async () => {
    fakeCardChoices()
    fakeEndpoint('post', START, () => HttpResponse.json({ detail: 'Another time entry is already running.' }, { status: 409 }))
    const { user, onStarted, onClose } = renderDialog()
    await loaded()
    await user.click(button('Start'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another task is already being tracked. End it first.')
    expect(onStarted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says so, and stays open, when starting fails', async () => {
    // The card was deleted meanwhile. FastAPI's error has a JSON body, which
    // mustn't be taken for the new entry.
    fakeCardChoices()
    fakeEndpoint('post', START, () => HttpResponse.json({ detail: 'Card not found' }, { status: 404 }))
    const { user, onStarted, onClose } = renderDialog()
    await loaded()
    await user.click(button('Start'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(onStarted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes nothing while starting', async () => {
    fakeCardChoices()
    const held = heldAnswer(() => HttpResponse.json(RUNNING, { status: 201 }))
    fakeEndpoint('post', START, held.answer)
    const { user, onClose } = renderDialog()
    await loaded()

    await user.click(button('Start'))
    for (const name of ['Board', 'List', 'Card'] as const) expect(select(name)).toHaveAttribute('aria-disabled', 'true')
    expect(commentField()).toBeDisabled()
    expect(button('Start')).toBeDisabled()
    expect(button('Cancel')).toBeDisabled()

    held.release()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('forgets the comment and the last error once closed', async () => {
    fakeCardChoices()
    fakeEndpoint('post', START, () => HttpResponse.json({ detail: 'Another time entry is already running.' }, { status: 409 }))
    const { user, onClose, reopen } = renderDialog()
    await loaded()
    await user.type(commentField(), 'Client call')
    await user.click(button('Start'))
    await screen.findByRole('alert')

    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    reopen()

    expect(commentField()).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('forgets them when closed with Escape too', async () => {
    fakeCardChoices()
    const { user, onClose, reopen } = renderDialog()
    await loaded()
    await user.type(commentField(), 'Client call')

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    reopen()

    expect(commentField()).toHaveValue('')
  })

  it('closes on Cancel without starting anything', async () => {
    fakeCardChoices()
    const started = fakeEndpoint('post', START)
    const { user, onClose } = renderDialog()
    await loaded()
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(started.requests).toEqual([])
  })
})
