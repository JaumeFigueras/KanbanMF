import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Alert, Autocomplete, TextField, useTheme } from '@mui/material'
import i18n from '../i18n'
import AppThemeProvider from './AppThemeProvider'

// A drop-down, an alert with its close button, and the theme's mode.
function Probe() {
  const theme = useTheme()
  return (
    <>
      <p>{theme.palette.mode}</p>
      <Autocomplete options={['Barcelona']} renderInput={(params) => <TextField {...params} label="City" />} />
      <Alert onClose={() => {}}>Saved</Alert>
    </>
  )
}

describe('AppThemeProvider', () => {
  it('is light or dark, as it is told', () => {
    const { rerender } = render(<AppThemeProvider dark={false}><Probe /></AppThemeProvider>)
    expect(screen.getByText('light')).toBeInTheDocument()
    rerender(<AppThemeProvider dark><Probe /></AppThemeProvider>)
    expect(screen.getByText('dark')).toBeInTheDocument()
  })

  it("gives MUI's texts the language of the moment, following a change while shown", async () => {
    render(<AppThemeProvider dark={false}><Probe /></AppThemeProvider>)
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    await act(() => i18n.changeLanguage('ca'))

    expect(screen.getByRole('button', { name: 'Obre' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tanca' })).toBeInTheDocument()

    await act(() => i18n.changeLanguage('en'))

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
  })
})
