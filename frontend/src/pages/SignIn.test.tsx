import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { DROPPED, SERVER_ERROR, fakeEndpoint } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import i18n from '../i18n'
import SignIn from './SignIn'

const LOGIN = '/api/v1/auth/local/login'

function renderSignIn() {
  return renderWithProviders(<SignIn />, { route: '/signin' })
}

// The fields are required, so MUI adds " *" to their labels; the password
// field has no role, so both are found by their label.
async function signIn(user: ReturnType<typeof renderSignIn>['user']) {
  await user.type(screen.getByLabelText('Email *'), 'marta@example.com')
  await user.type(screen.getByLabelText('Password *'), 'secret password')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignIn', () => {
  describe('no answer is not a wrong answer (6E)', () => {
    it.each<[string, Answer, string]>([
      ['a wrong password or an unknown address (401)', () => HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }), 'Incorrect email or password'],
      ['something that isn\'t an address (422)', () => HttpResponse.json({ detail: [{ loc: ['body', 'email'], msg: 'not an email' }] }, { status: 422 }), 'Incorrect email or password'],
      ['an unverified address (403)', () => HttpResponse.json({ detail: 'Email not verified' }, { status: 403 }), 'Please verify your email address before signing in.'],
      ['too many tries (429)', () => HttpResponse.json({ detail: 'Too many attempts' }, { status: 429 }), 'Too many attempts. Please wait a few minutes and try again.'],
      ['a server error', SERVER_ERROR, 'Something went wrong. Please try again.'],
      ['a dropped connection', DROPPED, "KanbanMF couldn't be reached. Check your connection and try again."],
      ['an answer that can\'t be read', () => new HttpResponse('{"access_tok', { headers: { 'Content-Type': 'application/json' } }), "KanbanMF couldn't be reached. Check your connection and try again."],
    ])('answers %s with what happened', async (_case, answer, message) => {
      const tried = fakeEndpoint('post', LOGIN, answer)
      const { user } = renderSignIn()

      await signIn(user)

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      expect(tried.requests.map((r) => r.body)).toEqual([{ email: 'marta@example.com', password: 'secret password' }])
    })
  })

  describe('the show-password button (6K)', () => {
    it('is named for what it does, and shows and hides the password', async () => {
      const { user } = renderSignIn()
      const password = screen.getByLabelText('Password *')
      expect(password).toHaveAttribute('type', 'password')

      await user.click(screen.getByRole('button', { name: 'Show password' }))

      expect(password).toHaveAttribute('type', 'text')
      await user.click(screen.getByRole('button', { name: 'Hide password' }))
      expect(password).toHaveAttribute('type', 'password')
    })

    it("is named in the page's language", async () => {
      await i18n.changeLanguage('ca')
      renderSignIn()

      expect(screen.getByRole('button', { name: 'Mostra la contrasenya' })).toBeInTheDocument()
    })
  })
})
