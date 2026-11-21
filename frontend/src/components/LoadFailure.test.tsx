import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import i18n from '../i18n'
import { renderWithProviders } from '../test/render'
import LoadFailure from './LoadFailure'

describe('LoadFailure', () => {
  it('says what couldn\'t be loaded as an alert, with a button to try again', async () => {
    const onRetry = vi.fn()
    const { user } = renderWithProviders(<LoadFailure message="Your boards couldn't be loaded." onRetry={onRetry} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Your boards couldn't be loaded.")
    expect(alert).toHaveClass('MuiAlert-colorError')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("names its button in the page's language", async () => {
    await i18n.changeLanguage('ca')
    renderWithProviders(<LoadFailure message="No s'han pogut carregar els teus taulers." onRetry={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Torna-ho a intentar' })).toBeInTheDocument()
  })
})
