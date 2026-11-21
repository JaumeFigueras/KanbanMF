import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { blockSiteData } from '../test/blockSiteData'
import { ThemeToggleProvider } from './ThemeToggleContext'
import { useThemeToggle } from './useThemeToggle'

// Shows the theme the context says, with a button to toggle it.
function ThemeSwitch() {
  const { dark, toggleDark } = useThemeToggle()
  return <button onClick={toggleDark}>{dark ? 'dark' : 'light'}</button>
}

function renderSwitch() {
  render(
    <ThemeToggleProvider>
      <ThemeSwitch />
    </ThemeToggleProvider>,
  )
  return screen.getByRole('button')
}

// setup.ts empties localStorage after each test.
describe('ThemeToggleProvider', () => {
  it('starts light by default', () => {
    expect(renderSwitch()).toHaveTextContent('light')
  })

  it('starts dark when the browser saved dark', () => {
    localStorage.setItem('theme', 'dark')
    expect(renderSwitch()).toHaveTextContent('dark')
  })

  it('switches and saves the choice, in both directions', async () => {
    const user = userEvent.setup()
    const button = renderSwitch()

    await user.click(button)
    expect(button).toHaveTextContent('dark')
    expect(localStorage.getItem('theme')).toBe('dark')

    await user.click(button)
    expect(button).toHaveTextContent('light')
    expect(localStorage.getItem('theme')).toBe('light')
  })

  // Every page sits inside this provider: a throw here was a blank page.
  it('starts light and still switches when the browser blocks site data (6I)', async () => {
    blockSiteData()
    const user = userEvent.setup()
    const button = renderSwitch()
    expect(button).toHaveTextContent('light')

    await user.click(button)

    expect(button).toHaveTextContent('dark')
  })
})

describe('useThemeToggle outside its provider', () => {
  it('says light, and its toggle does nothing', async () => {
    const user = userEvent.setup()
    render(<ThemeSwitch />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('light')
    expect(localStorage.getItem('theme')).toBeNull()
  })
})
