import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/render'
import LabelChips from './LabelChips'

// The chip (MUI's root element) a label's name is drawn in.
function chip(name: string) {
  return screen.getByText(name).parentElement
}

// The chips' texts, in the order they're drawn.
function chipTexts(container: HTMLElement) {
  return [...container.querySelectorAll('.MuiChip-label')].map((label) => label.textContent)
}

describe('LabelChips', () => {
  it('draws nothing without labels', () => {
    const { container } = renderWithProviders(<LabelChips labels={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws every label in the order given, without a maximum', () => {
    const { container } = renderWithProviders(
      <LabelChips labels={[{ name: 'Urgent', color: '#d32f2f' }, { name: 'Bug', color: '#fff176' }]} />,
    )
    expect(chipTexts(container)).toEqual(['Urgent', 'Bug'])
  })

  it('draws each chip in its colour, with text that reads on it', () => {
    renderWithProviders(
      <LabelChips labels={[{ name: 'Urgent', color: '#b71c1c' }, { name: 'Idea', color: '#fff176' }]} />,
    )
    expect(chip('Urgent')).toHaveStyle({ backgroundColor: '#b71c1c', color: '#ffffff' })
    expect(chip('Idea')).toHaveStyle({ backgroundColor: '#fff176', color: '#000000' })
  })

  it('takes extra styles from its caller, as one object or a list', () => {
    renderWithProviders(
      <>
        <LabelChips labels={[{ name: 'Urgent', color: '#d32f2f' }]} sx={{ mt: 2 }} />
        <LabelChips labels={[{ name: 'Bug', color: '#d32f2f' }]} sx={[{ mt: 3 }]} />
      </>,
    )
    expect(chip('Urgent')?.parentElement).toHaveStyle({ marginTop: '16px' })
    expect(chip('Bug')?.parentElement).toHaveStyle({ marginTop: '24px' })
  })

  it('with a maximum, sorts them by name and folds the rest into "+N"', () => {
    const { container } = renderWithProviders(
      <LabelChips
        max={2}
        labels={[
          { name: 'urgent', color: '#d32f2f' },
          { name: 'Client', color: '#1976d2' },
          { name: 'bug', color: '#fff176' },
          { name: 'Àrea', color: '#388e3c' },
        ]}
      />,
    )
    expect(chipTexts(container)).toEqual(['Àrea', 'bug', '+2'])
  })
})
