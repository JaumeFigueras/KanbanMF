import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Active, Over, UniqueIdentifier } from '@dnd-kit/core'
import i18n from '../i18n'
import { cancelDragOnEscape, dragAccessibility } from './dragAccessibility'

const NAMES: Record<string, string> = { a: 'Contact form', b: 'Search page' }
const nameOf = (id: UniqueIdentifier) => NAMES[id]
// Only the id is read.
const item = (id: string) => ({ id }) as Active & Over

describe('dragAccessibility', () => {
  it('gives the instructions every drag handle points to', () => {
    expect(dragAccessibility(i18n.t, nameOf).screenReaderInstructions.draggable)
      .toBe('Press Space or Enter to pick it up, the arrow keys to move it, and Space or Enter again to drop it, or Escape to cancel.')
  })

  it('names what moves and what it is over, from picking it up to dropping it', () => {
    const { announcements } = dragAccessibility(i18n.t, nameOf)
    expect(announcements.onDragStart({ active: item('a') })).toBe('Picked up Contact form.')
    expect(announcements.onDragOver({ active: item('a'), over: item('b') })).toBe('Moving Contact form, over Search page.')
    expect(announcements.onDragOver({ active: item('a'), over: null })).toBe('Moving Contact form, not over anywhere it can be dropped.')
    expect(announcements.onDragOver({ active: item('a'), over: item('a') })).toBe('Moving Contact form, over its own place.')
    expect(announcements.onDragEnd({ active: item('a'), over: item('b') })).toBe('Dropped Contact form over Search page.')
  })

  it("leaves unsaid that an item just picked up is over its own place, which would talk over “Picked up”", () => {
    const { announcements } = dragAccessibility(i18n.t, nameOf)
    announcements.onDragStart({ active: item('a') })
    expect(announcements.onDragOver({ active: item('a'), over: item('a') })).toBeUndefined()
    // Coming back to it later is said.
    expect(announcements.onDragOver({ active: item('a'), over: item('b') })).toBe('Moving Contact form, over Search page.')
    expect(announcements.onDragOver({ active: item('a'), over: item('a') })).toBe('Moving Contact form, over its own place.')
  })

  it('says so when it is dropped nowhere, or the move is cancelled', () => {
    const { announcements } = dragAccessibility(i18n.t, nameOf)
    expect(announcements.onDragEnd({ active: item('a'), over: null }))
      .toBe("Dropped Contact form where it can't go, so it is back in its place.")
    expect(announcements.onDragCancel({ active: item('a'), over: item('b') }))
      .toBe('Move cancelled: Contact form is back in its place.')
  })

  it('names what it is over as the page says, when the page says', () => {
    const targetOf = vi.fn(() => 'the list Doing')
    const { announcements } = dragAccessibility(i18n.t, nameOf, targetOf)
    expect(announcements.onDragEnd({ active: item('a'), over: item('b') })).toBe('Dropped Contact form over the list Doing.')
    expect(targetOf).toHaveBeenCalledWith(item('b'), item('a'))
  })

  it('is in Catalan for a user who reads Catalan', async () => {
    await i18n.changeLanguage('ca')
    const { screenReaderInstructions, announcements } = dragAccessibility(i18n.t, nameOf)
    expect(screenReaderInstructions.draggable).toMatch(/^Prem la barra d'espai/)
    expect(announcements.onDragStart({ active: item('a') })).toBe('Has agafat Contact form.')
    expect(announcements.onDragEnd({ active: item('a'), over: item('a') })).toBe('Has deixat Contact form sobre el seu lloc.')
    expect(announcements.onDragCancel({ active: item('a'), over: null }))
      .toBe('Moviment cancel·lat: Contact form torna a ser al seu lloc.')
  })
})

describe('cancelDragOnEscape', () => {
  function pressOn(handle: HTMLElement, key: string) {
    const stopPropagation = vi.fn()
    const toDocument = vi.fn()
    document.addEventListener('keydown', toDocument)
    cancelDragOnEscape({ key, target: handle, stopPropagation } as unknown as ReactKeyboardEvent)
    document.removeEventListener('keydown', toDocument)
    return { stopPropagation, handedOn: toDocument.mock.calls.map(([e]) => (e as KeyboardEvent).code) }
  }

  it('hands Escape to the document, and keeps it from the dialog, while a handle is being moved', () => {
    const handle = document.createElement('button')
    handle.setAttribute('aria-pressed', 'true')
    const { stopPropagation, handedOn } = pressOn(handle, 'Escape')
    expect(handedOn).toEqual(['Escape'])
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('leaves Escape to the dialog when nothing is being moved, and every other key alone', () => {
    const idle = document.createElement('button')
    const moving = document.createElement('button')
    moving.setAttribute('aria-pressed', 'true')
    for (const { stopPropagation, handedOn } of [pressOn(idle, 'Escape'), pressOn(moving, 'ArrowDown')]) {
      expect(handedOn).toEqual([])
      expect(stopPropagation).not.toHaveBeenCalled()
    }
  })
})
