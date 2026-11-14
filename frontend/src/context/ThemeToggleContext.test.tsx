import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
