import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import i18n from '../i18n'
import { ThemeToggleProvider } from '../context/ThemeToggleContext'
import { renderWithProviders } from '../test/render'
import AuthControls from './AuthControls'

// The language and theme controls of the signed-out pages. A computer
// shows the language field, and a phone a button instead. jsdom lays the
// page out as a computer, whatever the width, so the phone's button is
// hidden, and a hidden element has no accessible name: it is found by its
// label attribute.
function renderControls() {
  return renderWithProviders(<ThemeToggleProvider><AuthControls /></ThemeToggleProvider>)
}

const phoneButton = (name: string) => screen.getByLabelText(name, { selector: 'button' })

describe('AuthControls', () => {
  describe("named in the page's language (6K)", () => {
    it('names the language field and button, and names the theme button for what it does', async () => {
      const { user } = renderControls()

      expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
      expect(phoneButton('Language')).toHaveAttribute('aria-haspopup', 'menu')
      await user.click(screen.getByRole('button', { name: 'Change to Dark Theme' }))
      expect(screen.getByRole('button', { name: 'Change to Light Theme' })).toBeInTheDocument()
    })

    it('names them in Catalan once Català is chosen in the field', async () => {
      const { user } = renderControls()

      await user.click(screen.getByRole('combobox', { name: 'Language' }))
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
      await user.click(await screen.findByRole('option', { name: 'Català' }))

      expect(screen.getByRole('combobox', { name: 'Idioma' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Obre' })).toBeInTheDocument()
      await user.click(screen.getByRole('combobox', { name: 'Idioma' }))
      expect(screen.getByRole('button', { name: 'Tanca' })).toBeInTheDocument()
      expect(phoneButton('Idioma')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Canvia al tema fosc' })).toBeInTheDocument()
    })

    it("names them in Catalan once Català is chosen from the phone's menu", async () => {
      const { user } = renderControls()
      const button = phoneButton('Language')

      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Català' }))

      expect(await screen.findByLabelText('Idioma', { selector: 'button' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('combobox', { name: 'Idioma' })).toBeInTheDocument()
    })
  })

  describe("the phone's language menu", () => {
    it('marks the language in use', async () => {
      const { user } = renderControls()

      await user.click(phoneButton('Language'))

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByRole('menuitem', { name: 'English' })).toHaveClass('Mui-selected')
      expect(within(menu).getByRole('menuitem', { name: 'Català' })).not.toHaveClass('Mui-selected')
    })

    it('closes with Escape, leaving the language as it was', async () => {
      const { user } = renderControls()
      const button = phoneButton('Language')
      await user.click(button)
      await screen.findByRole('menu')

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(i18n.language).toBe('en')
      expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument()
    })
  })
})
