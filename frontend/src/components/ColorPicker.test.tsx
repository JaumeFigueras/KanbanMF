import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { renderWithProviders } from '../test/render'
import ColorPicker from './ColorPicker'

// The picker as a dialog holds it: the chosen colour comes back as `value`.
function Picker({ initial, onChange }: { initial: string; onChange: (color: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <ColorPicker
      value={value}
      onChange={(color) => {
        setValue(color)
        onChange(color)
      }}
    />
  )
}

function renderPicker(initial = '#9C27B0') {
  const onChange = vi.fn()
  const result = renderWithProviders(<Picker initial={initial} onChange={onChange} />)
  return { ...result, onChange }
}

function hexField() {
  return screen.getByRole('textbox', { name: 'Hex color code' })
}

function swatch(hex: string) {
  return screen.getByRole('button', { name: hex })
}

function pressedSwatches() {
  return screen.getAllByRole('button', { pressed: true }).map((b) => b.getAttribute('aria-label'))
}

describe('ColorPicker', () => {
  it('shows the colour in the hex field, and marks its swatch as the chosen one', () => {
    renderPicker('#9C27B0')
    expect(hexField()).toHaveValue('#9C27B0')
    expect(pressedSwatches()).toEqual(['#9C27B0'])
  })

  it('finds the swatch whatever the case of the colour', () => {
    renderPicker('#9c27b0')
    expect(pressedSwatches()).toEqual(['#9C27B0'])
  })

  it('lays the swatches out a row per shade, lightest first, a column per hue', () => {
    renderPicker()
    const swatches = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(swatches).toHaveLength(70)
    // The first row is the lightest shade of each hue, in palette order; the
    // second row starts with the next shade of the first hue.
    expect(swatches.slice(0, 11)).toEqual([
      '#BBDEFB', '#C8E6C9', '#FFF9C4', '#FFE0B2', '#FFCDD2',
      '#E1BEE7', '#D7CCC8', '#F8BBD0', '#FFFFFF', '#757575',
      '#90CAF9',
    ])
  })

  it('takes a clicked swatch: reports it, shows it in the field and marks it', async () => {
    const { user, onChange } = renderPicker()
    await user.click(swatch('#4CAF50'))
    expect(onChange).toHaveBeenCalledWith('#4CAF50')
    expect(hexField()).toHaveValue('#4CAF50')
    expect(pressedSwatches()).toEqual(['#4CAF50'])
  })

  it('reports a typed colour once it is complete, not before', async () => {
    const { user, onChange } = renderPicker()
    await user.clear(hexField())
    await user.type(hexField(), '1a2b3')
    expect(onChange).not.toHaveBeenCalled()
    await user.type(hexField(), 'c')
    expect(onChange.mock.calls).toEqual([['#1a2b3c']])
  })

  it('marks an incomplete colour as invalid, and a complete one as valid', async () => {
    const { user } = renderPicker()
    await user.clear(hexField())
    await user.type(hexField(), '1a2')
    expect(hexField()).toBeInvalid()
    await user.type(hexField(), 'b3c')
    expect(hexField()).toBeValid()
  })

  it('puts the # in front when it is left out, and keeps only one', async () => {
    const { user, onChange } = renderPicker()
    await user.tripleClick(hexField())
    await user.paste('1a2b3c')
    expect(hexField()).toHaveValue('#1a2b3c')
    await user.tripleClick(hexField())
    await user.paste('##1a2b')
    expect(hexField()).toHaveValue('#1a2b')
    expect(onChange.mock.calls).toEqual([['#1a2b3c']])
  })

  it('takes a colour pasted with its #, after the # that clearing leaves', async () => {
    const { user, onChange } = renderPicker()
    await user.clear(hexField())
    expect(hexField()).toHaveValue('#')
    await user.paste('#1A2B3C')
    expect(hexField()).toHaveValue('#1A2B3C')
    expect(onChange).toHaveBeenCalledWith('#1A2B3C')
  })

  it('drops the spaces copied along with a colour', async () => {
    const { user, onChange } = renderPicker()
    await user.tripleClick(hexField())
    await user.paste(' #1A2B3C ')
    expect(hexField()).toHaveValue('#1A2B3C')
    expect(onChange).toHaveBeenCalledWith('#1A2B3C')
  })

  it('keeps at most six digits', async () => {
    const { user } = renderPicker('#1A2B3C')
    await user.type(hexField(), '4')
    expect(hexField()).toHaveValue('#1A2B3C')
  })
})
