import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { ChecklistData } from '../types/board'
import i18n from '../i18n'
import { renderWithProviders } from '../test/render'
import ChecklistDialog from './ChecklistDialog'

const LAUNCH: ChecklistData = {
  id: 'checklist-1',
  name: 'Launch',
  items: [
    { id: 'item-1', text: 'Write the post', is_done: true },
    { id: 'item-2', text: 'Send the newsletter', is_done: false },
  ],
}

// The dialog only edits the checklist: the card dialog saves it, with the
// card, so nothing here talks to the backend.
function renderDialog(checklist: ChecklistData | null = LAUNCH) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  const dialog = (open: boolean, shown: ChecklistData | null) => (
    <ChecklistDialog open={open} onClose={onClose} checklist={shown} onSave={onSave} />
  )
  const result = renderWithProviders(dialog(true, checklist))
  // Closes the dialog and opens it again, as the card dialog does, with the
  // checklist as it is by then.
  let shown = checklist
  function reopen(next: ChecklistData | null) {
    result.rerender(dialog(false, shown))
    shown = next
    result.rerender(dialog(true, next))
  }
  return { ...result, onClose, onSave, reopen }
}

function nameField() {
  return screen.getByRole('textbox', { name: 'Checklist name' })
}

function item(number: number) {
  return screen.getByRole('textbox', { name: `Item ${number}` })
}

function itemTexts() {
  return screen.queryAllByRole('textbox', { name: /^Item \d+$/ }).map((field) => (field as HTMLInputElement).value)
}

function addField() {
  return screen.getByRole('textbox', { name: 'Add an item' })
}

function button(name: string) {
  return screen.getByRole('button', { name })
}

describe('ChecklistDialog', () => {
  it('opens blank to create one', () => {
    renderDialog(null)
    expect(screen.getByRole('dialog', { name: 'Create Checklist' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('')
    expect(screen.getByText('No items yet.')).toBeInTheDocument()
  })

  it("opens with a checklist's name and items to edit it", () => {
    renderDialog(LAUNCH)
    expect(screen.getByRole('dialog', { name: 'Edit Checklist' })).toBeInTheDocument()
    expect(nameField()).toHaveValue('Launch')
    expect(itemTexts()).toEqual(['Write the post', 'Send the newsletter'])
    expect(screen.queryByText('No items yet.')).not.toBeInTheDocument()
  })

  it('takes at most 255 characters for the name and 500 for an item, as the backend does', () => {
    renderDialog()
    expect(nameField()).toHaveAttribute('maxlength', '255')
    expect(item(1)).toHaveAttribute('maxlength', '500')
    expect(addField()).toHaveAttribute('maxlength', '500')
  })

  it('adds an item, trimmed, at the end, and empties the add field', async () => {
    const { user } = renderDialog()
    await user.type(addField(), '  Tell the team  ')
    await user.click(button('Add'))
    expect(itemTexts()).toEqual(['Write the post', 'Send the newsletter', 'Tell the team'])
    expect(addField()).toHaveValue('')
  })

  it('adds an item with Enter too, without saving', async () => {
    const { user, onSave } = renderDialog()
    await user.type(addField(), 'Tell the team{Enter}')
    expect(itemTexts()).toEqual(['Write the post', 'Send the newsletter', 'Tell the team'])
    expect(onSave).not.toHaveBeenCalled()
  })

  it('adds nothing for a blank item', async () => {
    const { user } = renderDialog(null)
    await user.type(addField(), '   ')
    await user.click(button('Add'))
    expect(itemTexts()).toEqual([])
    expect(screen.getByText('No items yet.')).toBeInTheDocument()
  })

  it('edits an item in place', async () => {
    const { user } = renderDialog()
    await user.type(item(2), ' today')
    expect(itemTexts()).toEqual(['Write the post', 'Send the newsletter today'])
  })

  it('removes an item', async () => {
    const { user } = renderDialog()
    await user.click(button('Remove item 1'))
    expect(itemTexts()).toEqual(['Send the newsletter'])
  })

  it("names each item's buttons after its number, as its field is", async () => {
    const { user } = renderDialog()
    expect(screen.getAllByRole('button', { name: /^(Move|Remove) item \d+$/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Move item 1', 'Remove item 1', 'Move item 2', 'Remove item 2'])

    await user.click(button('Remove item 1'))

    // The item left is now the first, and its buttons say so.
    expect(item(1)).toHaveValue('Send the newsletter')
    expect(screen.getAllByRole('button', { name: /^(Move|Remove) item \d+$/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Move item 1', 'Remove item 1'])
  })

  it("names the items' buttons in Catalan", async () => {
    await i18n.changeLanguage('ca')
    renderDialog()
    expect(screen.getByRole('textbox', { name: 'Element 2' })).toHaveValue('Send the newsletter')
    expect(button("Mou l'element 2")).toBeInTheDocument()
    expect(button("Elimina l'element 2")).toBeInTheDocument()
  })

  it('hands over the trimmed name and items, dropping blank ones and keeping ids and ticks, then closes', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.type(nameField(), ' day  ')
    await user.clear(item(1))
    await user.type(item(2), '  ')
    await user.click(button('Save'))
    expect(onSave.mock.calls).toEqual([[
      { id: 'checklist-1', name: 'Launch day', items: [{ id: 'item-2', text: 'Send the newsletter', is_done: false }] },
    ]])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('gives a new checklist, and each new item, an id of its own', async () => {
    const { user, onSave } = renderDialog(null)
    await user.type(nameField(), 'Launch')
    await user.type(addField(), 'Write the post{Enter}')
    await user.type(addField(), 'Send the newsletter{Enter}')
    await user.click(button('Save'))
    const saved: ChecklistData = onSave.mock.calls[0][0]
    expect(saved.items.map((i) => [i.text, i.is_done])).toEqual([['Write the post', false], ['Send the newsletter', false]])
    expect(new Set([saved.id, ...saved.items.map((i) => i.id)]).size).toBe(3)
  })

  it('keeps an item still typed in the add field when saving', async () => {
    const { user, onSave } = renderDialog()
    await user.type(addField(), '  Tell the team  ')
    await user.click(button('Save'))
    const saved: ChecklistData = onSave.mock.calls[0][0]
    expect(saved.items.map((i) => i.text)).toEqual(['Write the post', 'Send the newsletter', 'Tell the team'])
  })

  it('saves on Enter in the name', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.type(nameField(), '{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('refuses a blank name, and stays open', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.click(button('Save'))
    expect(screen.getByRole('alert')).toHaveTextContent('Checklist name is required.')
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reopens with the checklist of that moment, without unsaved changes or the last error', async () => {
    const { user, reopen } = renderDialog(LAUNCH)
    await user.clear(nameField())
    await user.type(addField(), 'Half typed')
    await user.click(button('Save'))
    await screen.findByRole('alert')

    reopen({ id: 'checklist-2', name: 'Design', items: [{ id: 'item-9', text: 'Sketch', is_done: false }] })

    expect(nameField()).toHaveValue('Design')
    expect(itemTexts()).toEqual(['Sketch'])
    expect(addField()).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes on Cancel without handing anything over', async () => {
    const { user, onSave, onClose } = renderDialog()
    await user.type(nameField(), ' day')
    await user.click(button('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
