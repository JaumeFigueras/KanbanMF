import type { KeyboardEvent } from 'react'
import type { Active, Announcements, Over, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core'
import type { TFunction } from 'i18next'

// dnd-kit reports an item over its own place as soon as it's picked up,
// which would talk over "Picked up …": that first report goes unsaid. Kept
// here, not per page, as a page draws itself again (with new
// announcements) when a drag starts; only one thing moves at a time.
let justPickedUp: UniqueIdentifier | null = null

// What a screen reader is told about moving things (dnd-kit's own texts are
// English only, and name items by their ids): the instructions every drag
// handle points to, and what happens as an item is picked up, moved and
// dropped. nameOf names an item; targetOf names what it's over — by default
// the item there, or its own place.
export function dragAccessibility(
  t: TFunction,
  nameOf: (id: UniqueIdentifier) => string,
  targetOf: (over: Over, active: Active) => string = (over, active) =>
    over.id === active.id ? t('drag.itsOwnPlace') : nameOf(over.id),
): { screenReaderInstructions: ScreenReaderInstructions; announcements: Announcements } {
  return {
    screenReaderInstructions: { draggable: t('drag.instructions') },
    announcements: {
      onDragStart: ({ active }) => {
        justPickedUp = active.id
        return t('drag.pickedUp', { name: nameOf(active.id) })
      },
      onDragOver: ({ active, over }) => {
        const stillInPlace = justPickedUp === active.id && over?.id === active.id
        justPickedUp = null
        if (stillInPlace) return undefined
        return over
          ? t('drag.over', { name: nameOf(active.id), target: targetOf(over, active) })
          : t('drag.notOver', { name: nameOf(active.id) })
      },
      onDragEnd: ({ active, over }) => over
        ? t('drag.dropped', { name: nameOf(active.id), target: targetOf(over, active) })
        : t('drag.droppedNowhere', { name: nameOf(active.id) }),
      onDragCancel: ({ active }) => t('drag.cancelled', { name: nameOf(active.id) }),
    },
  }
}

// In a dialog, Escape never reaches dnd-kit: MUI stops it on its way up, to
// close the dialog, before it gets to the document, where dnd-kit listens.
// So while a handle is being moved (dnd-kit marks it pressed), this hands
// Escape to the document itself, which cancels the move, and keeps it from
// the dialog, which stays open.
export function cancelDragOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (event.target as HTMLElement).getAttribute('aria-pressed') !== 'true') return
  event.stopPropagation()
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
}
