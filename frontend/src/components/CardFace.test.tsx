import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { makeCard } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import CardFace from './CardFace'

describe('CardFace', () => {
  it('says a finished card is done in words, not only with a tick', () => {
    renderWithProviders(
      <CardFace card={makeCard({ end_at: '2026-03-04T12:00:00Z' })} numberLocale="en_GB" dateFormat="numeric" />,
    )
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument()
  })

  it('shows no tick on a card not finished', () => {
    renderWithProviders(<CardFace card={makeCard()} numberLocale="en_GB" dateFormat="numeric" />)
    expect(screen.queryByRole('img', { name: 'Done' })).not.toBeInTheDocument()
  })
})
