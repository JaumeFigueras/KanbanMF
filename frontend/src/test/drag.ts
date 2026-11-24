import { screen, waitFor } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

// What dnd-kit's live region now tells a screen reader. Found by its role,
// so a region an open dialog hides from screen readers doesn't count.
export async function heard(text: string) {
  await waitFor(() => expect(screen.getAllByRole('status').map((region) => region.textContent).join(' | ')).toContain(text))
}

// Picks a handle up with the keyboard, as its instructions say.
export async function pickUp(user: UserEvent, handle: HTMLElement, name: string) {
  handle.focus()
  await user.keyboard('[Space]')
  await heard(`Picked up ${name}.`)
}
