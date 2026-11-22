import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { screen } from '@testing-library/react'
import i18n from '../i18n'
import { renderWithProviders } from '../test/render'
import GoogleButton from './GoogleButton'

// The page the button sends the browser to. jsdom can't leave the page, and
// its own location can't be watched, so the window gets a stand-in for the
// test, and the real one back after it.
function watchLocation() {
  const real = window.location
  const standIn = { href: real.href }
  vi.stubGlobal('location', standIn)
  onTestFinished(() => { vi.stubGlobal('location', real) })
  return standIn
}

describe('GoogleButton', () => {
  it("sends the browser to the backend's Google sign-in, leaving the page rather than fetching", async () => {
    const location = watchLocation()
    const sent = vi.spyOn(globalThis, 'fetch')
    onTestFinished(() => sent.mockRestore())
    const { user } = renderWithProviders(<GoogleButton />)

    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))

    expect(location.href).toBe('/api/v1/auth/google/')
    expect(sent).not.toHaveBeenCalled()
  })

  it("is named in the page's language", async () => {
    await i18n.changeLanguage('ca')
    renderWithProviders(<GoogleButton />)

    expect(screen.getByRole('button', { name: 'Continua amb Google' })).toBeInTheDocument()
  })
})
