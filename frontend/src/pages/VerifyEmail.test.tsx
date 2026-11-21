import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import VerifyEmail from './VerifyEmail'

const VERIFY = '/api/v1/auth/local/verify-email'

const VERIFIED: Answer = () => new HttpResponse(null, { status: 204 })

function renderVerify(route = '/verify-email?token=link-token') {
  return renderWithProviders(<VerifyEmail />, { route })
}

describe('VerifyEmail', () => {
  describe('no answer is not a wrong answer (6E)', () => {
    it.each<[string, Answer, string]>([
      ['a server error', SERVER_ERROR, 'Something went wrong. Please try again.'],
      ['a dropped connection', DROPPED, "KanbanMF couldn't be reached. Check your connection and try again."],
    ])("doesn't call the link invalid after %s, and checks it again with Try again", async (_case, answer, message) => {
      let down = true
      const checks = fakeEndpoint('post', VERIFY, (request) => (down ? answer(request) : VERIFIED(request)))
      const { user } = renderVerify()

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.queryByText(/invalid/)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Back to sign up' })).not.toBeInTheDocument()
      down = false
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText('Email verified!')).toBeInTheDocument()
      expect(checks.requests.map((r) => r.body)).toEqual([{ token: 'link-token' }, { token: 'link-token' }])
    })

    it('shows the check running again while Try again waits', async () => {
      let answer: Answer = DROPPED
      fakeEndpoint('post', VERIFY, (request) => answer(request))
      const { user } = renderVerify()
      await screen.findByRole('alert')
      const held = heldAnswer(VERIFIED)
      answer = held.answer

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.getByText('Verifying your email…')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByText('Email verified!')).toBeInTheDocument()
    })

    it.each<[string, Answer, string]>([
      ['an expired link', () => HttpResponse.json({ detail: 'Verification token has expired' }, { status: 400 }), 'This verification link has expired. Please sign up again to get a new one.'],
      ['an unknown or used link', () => HttpResponse.json({ detail: 'Invalid verification token' }, { status: 400 }), 'This verification link is invalid or has already been used.'],
    ])('still says when the backend refuses %s, with the way back to sign up', async (_case, answer, message) => {
      fakeEndpoint('post', VERIFY, answer)
      renderVerify()

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('link', { name: 'Back to sign up' })).toHaveAttribute('href', '/signup')
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('says a link without a token is invalid, without asking', () => {
      const checks = fakeEndpoint('post', VERIFY, VERIFIED)
      renderVerify('/verify-email')

      expect(screen.getByRole('alert')).toHaveTextContent('This verification link is invalid or has already been used.')
      expect(checks.requests).toEqual([])
    })

    it('verifies a good link', async () => {
      fakeEndpoint('post', VERIFY, VERIFIED)
      renderVerify()

      expect(await screen.findByText('Email verified!')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
    })
  })
})
