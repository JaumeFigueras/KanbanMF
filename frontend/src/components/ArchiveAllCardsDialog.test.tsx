import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/render'
import ArchiveAllCardsDialog from './ArchiveAllCardsDialog'

function renderDialog(count: number) {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  const rendered = renderWithProviders(
    <ArchiveAllCardsDialog open listName="Doing" count={count} onClose={onClose} onConfirm={onConfirm} />,
  )
  return { ...rendered, onClose, onConfirm }
}

describe('ArchiveAllCardsDialog', () => {
  it('asks with the count and the list, and says how the cards come back', () => {
    renderDialog(12)

    expect(screen.getByRole('dialog', { name: 'Archive all cards?' })).toHaveTextContent(
      'Archive the 12 cards in "Doing"? To get them back, you restore them one by one from the board\'s archive.',
    )
  })

  it('archives only when told to', async () => {
    const { user, onClose, onConfirm } = renderDialog(12)

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes without archiving on Cancel', async () => {
    const { user, onClose, onConfirm } = renderDialog(12)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
