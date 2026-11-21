import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { Link } from 'react-router-dom'
import i18n from '../i18n'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import VerifyEmail from './VerifyEmail'

const VERIFY = '/api/v1/auth/local/verify-email'

const VERIFIED: Answer = () => new HttpResponse(null, { status: 204 })
const EXPIRED: Answer = () => HttpResponse.json({ detail: 'Verification token has expired' }, { status: 400 })
// The backend's answer to a token it doesn't know, which includes one it
// already used: it forgets a token as it verifies the address.
const INVALID: Answer = () => HttpResponse.json({ detail: 'Invalid verification token' }, { status: 400 })

const INVALID_MESSAGE = "This verification link is invalid, or it has already been used: if you've verified your address, sign in."

// The backend's way: the first check verifies, and any check after it finds
// the token gone.
function usedOnce(): Answer {
  let used = false
  return (request) => {
    const answer = used ? INVALID : VERIFIED
    used = true
    return answer(request)
  }
}

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

    it('still says when the backend refuses an expired link, with the way back to sign up', async () => {
      fakeEndpoint('post', VERIFY, EXPIRED)
      renderVerify()

      expect(await screen.findByRole('alert')).toHaveTextContent('This verification link has expired. Please sign up again to get a new one.')
      expect(screen.getByRole('heading', { name: 'Verification failed' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to sign up' })).toHaveAttribute('href', '/signup')
      expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('says a link without a token is invalid, without asking', () => {
      const checks = fakeEndpoint('post', VERIFY, VERIFIED)
      renderVerify('/verify-email')

      expect(screen.getByRole('alert')).toHaveTextContent(INVALID_MESSAGE)
      expect(checks.requests).toEqual([])
    })

    it('verifies a good link', async () => {
      fakeEndpoint('post', VERIFY, VERIFIED)
      renderVerify()

      expect(await screen.findByText('Email verified!')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
    })
  })

  describe('a link opened twice (6M)', () => {
    it('checks the link once, though React runs the effect twice in development', async () => {
      const checks = fakeEndpoint('post', VERIFY, usedOnce())
      renderWithProviders(<VerifyEmail />, { route: '/verify-email?token=link-token', strictMode: true })

      expect(await screen.findByText('Email verified!')).toBeInTheDocument()
      expect(checks.requests.map((r) => r.body)).toEqual([{ token: 'link-token' }])
      expect(screen.queryByText("This link can't be used")).not.toBeInTheDocument()
    })

    it('says a used link may have worked already, and offers signing in first', async () => {
      // A reload, or the e-mail's link clicked again: a new page, and the
      // backend has already used the token.
      fakeEndpoint('post', VERIFY, INVALID)
      renderVerify()

      expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_MESSAGE)
      expect(screen.getByRole('heading', { name: "This link can't be used" })).toBeInTheDocument()
      expect(screen.queryByText('Verification failed')).not.toBeInTheDocument()
      const links = screen.getAllByRole('link').filter((link) => link.closest('.MuiCard-root'))
      expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['Sign in', '/signin'],
        ['Back to sign up', '/signup'],
      ])
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    })

    it('says it in Catalan', async () => {
      await i18n.changeLanguage('ca')
      fakeEndpoint('post', VERIFY, INVALID)
      renderVerify()

      expect(await screen.findByRole('alert')).toHaveTextContent("Aquest enllaç de verificació no és vàlid, o ja s'ha utilitzat: si ja has verificat la teva adreça, inicia sessió.")
      expect(screen.getByRole('heading', { name: 'Aquest enllaç no es pot fer servir' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Inicia sessió' })).toHaveAttribute('href', '/signin')
      expect(screen.getByRole('link', { name: 'Torna al registre' })).toHaveAttribute('href', '/signup')
    })

    it('checks a different link opened on the same page', async () => {
      const checks = fakeEndpoint('post', VERIFY, VERIFIED)
      const { user } = renderWithProviders(
        <>
          <VerifyEmail />
          <Link to="/verify-email?token=other-token">other link</Link>
        </>,
        { route: '/verify-email?token=link-token' },
      )
      await screen.findByText('Email verified!')

      await user.click(screen.getByRole('link', { name: 'other link' }))

      await expect.poll(() => checks.requests.length).toBe(2)
      expect(checks.requests.map((r) => r.body)).toEqual([{ token: 'link-token' }, { token: 'other-token' }])
    })
  })
})
