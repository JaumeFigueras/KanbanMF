import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import i18n from '../i18n'
import { renderWithProviders } from '../test/render'
import FailureMessage, { FAILURE_MESSAGE_MS } from './FailureMessage'

const MESSAGE = 'The card "Homepage layout" couldn\'t be archived. Please try again.'

function renderMessage(message: string | null = MESSAGE) {
  const onClose = vi.fn()
  const result = renderWithProviders(<FailureMessage message={message} onClose={onClose} />)
  return { ...result, onClose }
}

describe('FailureMessage', () => {
  it('shows nothing without a message', () => {
    renderMessage(null)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the message as an alert, which screen readers read out', () => {
    renderMessage()
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE)
  })

  it('asks to close when its close button is clicked', async () => {
    const { user, onClose } = renderMessage()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('names its close button in the language chosen', async () => {
    await i18n.changeLanguage('ca')
    renderMessage()
    expect(screen.getByRole('button', { name: 'Tanca' })).toBeInTheDocument()
  })

  it('asks to close with Escape', async () => {
    const { user, onClose } = renderMessage()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays up when the page is clicked elsewhere, so it can be read while carrying on', async () => {
    const { user, onClose } = renderMessage()

    await user.click(document.body)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('asks to close by itself once it has been up for a while', () => {
    vi.useFakeTimers()
    try {
      const { onClose } = renderMessage()

      act(() => vi.advanceTimersByTime(FAILURE_MESSAGE_MS - 1))
      expect(onClose).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps its text while it slides away once closed, then goes', async () => {
    const { rerender } = renderMessage()

    rerender(<FailureMessage message={null} onClose={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('shows a new message in place of the one up', () => {
    const { rerender } = renderMessage()

    rerender(<FailureMessage message="The move couldn't be saved, and has been undone. Please try again." onClose={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent("The move couldn't be saved, and has been undone. Please try again.")
  })
})
