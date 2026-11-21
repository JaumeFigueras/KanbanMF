import { describe, expect, it, onTestFinished } from 'vitest'
import { screen } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { InvitationPreview } from '../types/invitation'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { renderWithProviders } from '../test/render'
import i18n from '../i18n'
import SignUp from './SignUp'

const REGISTER = '/api/v1/auth/local/register'

const INVITATION: InvitationPreview = {
  email: 'marta@example.com',
  board_name: 'Website redesign',
  inviter_name: 'Jordi Puig',
}

const CREATED: Answer = () => HttpResponse.json({ detail: 'Check your e-mail' }, { status: 201 })

function renderSignUp(route = '/signup') {
  return renderWithProviders(<SignUp />, { route })
}

type Label = 'Display name' | 'Email' | 'Password' | 'Confirm password'

// The fields are required, so MUI adds " *" to their labels, hidden from
// screen readers; password fields have no role, so all four are found by
// their label.
function field(label: Label) {
  return screen.getByLabelText(`${label} *`)
}

async function fill(user: ReturnType<typeof renderSignUp>['user'], values: Partial<Record<Label, string>>) {
  for (const [label, value] of Object.entries(values)) {
    await user.type(field(label as Label), value)
  }
}

const MARTA = {
  'Display name': 'Marta Soler',
  Email: 'marta@example.com',
  Password: 'secret password',
  'Confirm password': 'secret password',
}

function expectFields(values: Record<Label, string>) {
  for (const [label, value] of Object.entries(values)) {
    expect(field(label as Label)).toHaveValue(value)
  }
}

describe('SignUp', () => {
  describe('what was typed stays after an error (6D)', () => {
    // A submit the page doesn't stop is sent by the browser itself: a GET to
    // /signup with the password in the address, and the page reloads empty.
    it("doesn't let the browser send the form itself", async () => {
      fakeEndpoint('post', REGISTER, CREATED)
      const submits: Event[] = []
      const record = (event: Event) => submits.push(event)
      document.addEventListener('submit', record)
      onTestFinished(() => document.removeEventListener('submit', record))
      const { user } = renderSignUp()
      await fill(user, { ...MARTA, Password: 'short', 'Confirm password': 'short' })

      await user.click(screen.getByRole('button', { name: 'Create account' }))
      await user.clear(field('Password'))
      await user.clear(field('Confirm password'))
      await fill(user, { Password: 'secret password', 'Confirm password': 'secret password' })
      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText('Check your email')).toBeInTheDocument()
      expect(submits.map((event) => event.defaultPrevented)).toEqual([true, true])
    })

    it.each([
      ['too short', 'short', 'short', 'The password must be at least 8 characters long.'],
      ["that don't match", 'secret password', 'secret passwort', 'Passwords do not match'],
    ])('keeps every field after passwords %s, sends nothing, and sends the corrected form', async (_case, password, confirm, message) => {
      const registered = fakeEndpoint('post', REGISTER, CREATED)
      const { user } = renderSignUp()
      const typed = { ...MARTA, Password: password, 'Confirm password': confirm }
      await fill(user, typed)

      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(field('Confirm password')).toHaveAccessibleDescription(message)
      expectFields(typed)
      expect(registered.requests).toEqual([])
      await user.clear(field('Password'))
      await user.clear(field('Confirm password'))
      await fill(user, { Password: 'secret password', 'Confirm password': 'secret password' })
      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText('Check your email')).toBeInTheDocument()
      expect(registered.requests.map((r) => r.body)).toEqual([
        { display_name: 'Marta Soler', email: 'marta@example.com', password: 'secret password', language: 'en' },
      ])
    })

    it.each<[string, Answer, string]>([
      ['too many tries', () => HttpResponse.json({ detail: 'Too many attempts' }, { status: 429 }), 'Too many attempts. Please wait a few minutes and try again.'],
      ['a server error', SERVER_ERROR, 'Something went wrong. Please try again.'],
      ['a dropped connection', DROPPED, "KanbanMF couldn't be reached. Check your connection and try again."],
    ])('keeps every field after %s', async (_case, answer, message) => {
      fakeEndpoint('post', REGISTER, answer)
      const { user } = renderSignUp()
      await fill(user, MARTA)

      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expectFields(MARTA)
      expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    })

    it('keeps every field when the invitation expires meanwhile, and lets the address be changed', async () => {
      fakeEndpoint('get', '/api/v1/invitations/:token', () => HttpResponse.json(INVITATION))
      const registered = fakeEndpoint('post', REGISTER, () => HttpResponse.json({ detail: 'Invalid or expired invitation' }, { status: 400 }))
      const { user } = renderSignUp('/signup?invite=invite-token')
      await screen.findByText(/Jordi Puig invited you to the board "Website redesign"/)
      await fill(user, { 'Display name': 'Marta Soler', Password: 'secret password', 'Confirm password': 'secret password' })

      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText(/This invitation link is no longer valid/)).toBeInTheDocument()
      expect(screen.queryByText(/invited you to the board/)).not.toBeInTheDocument()
      expectFields(MARTA)
      expect(field('Email')).not.toHaveAttribute('readonly')
      expect(registered.requests.map((r) => r.body)).toEqual([
        { display_name: 'Marta Soler', email: 'marta@example.com', password: 'secret password', language: 'en', invitation_token: 'invite-token' },
      ])
    })
  })

  describe('no answer is not a wrong answer (6E)', () => {
    it.each<[string, Answer]>([
      ['a server error', SERVER_ERROR],
      ['a dropped connection', DROPPED],
    ])("says the invitation couldn't be loaded after %s, waits for it, and loads it with Try again", async (_case, answer) => {
      let down = true
      const previews = fakeEndpoint('get', '/api/v1/invitations/:token', (request) => (down ? answer(request) : HttpResponse.json(INVITATION)))
      const { user } = renderSignUp('/signup?invite=invite-token')

      expect(await screen.findByRole('alert')).toHaveTextContent("The invitation couldn't be loaded.")
      expect(screen.queryByText(/This invitation link is no longer valid/)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
      down = false
      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(await screen.findByText(/Jordi Puig invited you to the board "Website redesign"/)).toBeInTheDocument()
      expect(screen.queryByText("The invitation couldn't be loaded.")).not.toBeInTheDocument()
      expect(field('Email')).toHaveValue('marta@example.com')
      expect(field('Email')).toHaveAttribute('readonly')
      expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
      expect(previews.requests).toHaveLength(2)
    })

    it('takes the message away while Try again loads, and brings it back if it fails again', async () => {
      let answer: Answer = DROPPED
      fakeEndpoint('get', '/api/v1/invitations/:token', (request) => answer(request))
      const { user } = renderSignUp('/signup?invite=invite-token')
      await screen.findByRole('alert')
      const held = heldAnswer(SERVER_ERROR)
      answer = held.answer

      await user.click(screen.getByRole('button', { name: 'Try again' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
      held.release()
      expect(await screen.findByRole('alert')).toHaveTextContent("The invitation couldn't be loaded.")
    })

    it('says the link is no longer valid only when the backend says so, and then signs up without it', async () => {
      fakeEndpoint('get', '/api/v1/invitations/:token', () => HttpResponse.json({ detail: 'Invitation not found' }, { status: 404 }))
      const registered = fakeEndpoint('post', REGISTER, CREATED)
      const { user } = renderSignUp('/signup?invite=invite-token')

      expect(await screen.findByText(/This invitation link is no longer valid/)).toBeInTheDocument()
      expect(field('Email')).toHaveValue('')
      expect(field('Email')).not.toHaveAttribute('readonly')
      await fill(user, MARTA)
      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText('Check your email')).toBeInTheDocument()
      expect(registered.requests.map((r) => r.body)).toEqual([
        { display_name: 'Marta Soler', email: 'marta@example.com', password: 'secret password', language: 'en' },
      ])
    })

    it('says so under the address when the backend refuses it, and sends the corrected one', async () => {
      let refused = true
      const registered = fakeEndpoint('post', REGISTER, (request) => (refused
        ? HttpResponse.json({ detail: [{ type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address' }] }, { status: 422 })
        : CREATED(request)))
      const { user } = renderSignUp()
      await fill(user, { ...MARTA, Email: 'marta@example' })

      await user.click(screen.getByRole('button', { name: 'Create account' }))

      await expect.poll(() => field('Email')).toHaveAccessibleDescription('Please enter a valid email address.')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText(/This invitation link is no longer valid/)).not.toBeInTheDocument()
      refused = false
      await user.type(field('Email'), '.com')
      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText('Check your email')).toBeInTheDocument()
      expect(registered.requests.map((r) => (r.body as { email: string }).email)).toEqual(['marta@example', 'marta@example.com'])
    })

    it.each<[string, Answer]>([
      ['the address not matching it (422)', () => HttpResponse.json({ detail: "The e-mail doesn't match the invitation" }, { status: 422 })],
      ['another field (422)', () => HttpResponse.json({ detail: [{ type: 'value_error', loc: ['body', 'language'], msg: 'too long' }] }, { status: 422 })],
      ['another refusal (400)', () => HttpResponse.json({ detail: 'Bad request' }, { status: 400 })],
    ])("doesn't take %s for an expired invitation", async (_case, answer) => {
      fakeEndpoint('get', '/api/v1/invitations/:token', () => HttpResponse.json(INVITATION))
      fakeEndpoint('post', REGISTER, answer)
      const { user } = renderSignUp('/signup?invite=invite-token')
      await screen.findByText(/Jordi Puig invited you to the board "Website redesign"/)
      await fill(user, { 'Display name': 'Marta Soler', Password: 'secret password', 'Confirm password': 'secret password' })

      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
      expect(screen.getByText(/Jordi Puig invited you to the board "Website redesign"/)).toBeInTheDocument()
      expect(screen.queryByText(/This invitation link is no longer valid/)).not.toBeInTheDocument()
      expect(field('Email')).toHaveAttribute('readonly')
      expect(field('Email')).not.toHaveAccessibleDescription()
    })

    it("takes the last try's messages away at the next try", async () => {
      const answers: Answer[] = [
        () => HttpResponse.json({ detail: [{ type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address' }] }, { status: 422 }),
        () => HttpResponse.json({ detail: 'Too many attempts' }, { status: 429 }),
      ]
      const registered = fakeEndpoint('post', REGISTER, (request) => answers.shift()!(request))
      const { user } = renderSignUp()
      const typePassword = async (password: string) => {
        await user.clear(field('Password'))
        await user.type(field('Password'), password)
      }
      await fill(user, { ...MARTA, Email: 'marta@example' })
      await user.click(screen.getByRole('button', { name: 'Create account' }))
      await expect.poll(() => field('Email')).toHaveAccessibleDescription('Please enter a valid email address.')

      await user.type(field('Email'), '.com')
      await typePassword('short')
      await user.click(screen.getByRole('button', { name: 'Create account' }))
      expect(field('Confirm password')).toHaveAccessibleDescription('The password must be at least 8 characters long.')
      expect(field('Email')).not.toHaveAccessibleDescription()

      await typePassword('secret password')
      await user.click(screen.getByRole('button', { name: 'Create account' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.')
      expect(field('Confirm password')).not.toHaveAccessibleDescription()

      await typePassword('short')
      await user.click(screen.getByRole('button', { name: 'Create account' }))
      expect(field('Confirm password')).toHaveAccessibleDescription('The password must be at least 8 characters long.')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(registered.requests).toHaveLength(2)
    })
  })

  describe('an invitation', () => {
    it('fills in the invited address, locked, and sends the invitation with the form', async () => {
      fakeEndpoint('get', '/api/v1/invitations/:token', () => HttpResponse.json(INVITATION))
      const registered = fakeEndpoint('post', REGISTER, CREATED)
      const { user } = renderSignUp('/signup?invite=invite-token')

      await screen.findByText(/Jordi Puig invited you to the board "Website redesign"/)
      expect(field('Email')).toHaveValue('marta@example.com')
      expect(field('Email')).toHaveAttribute('readonly')
      await fill(user, { 'Display name': 'Marta Soler', Password: 'secret password', 'Confirm password': 'secret password' })
      await user.click(screen.getByRole('button', { name: 'Create account' }))

      expect(await screen.findByText(/the board you were invited to will appear under "Shared with me"/)).toBeInTheDocument()
      expect(registered.requests.map((r) => r.body)).toEqual([
        { display_name: 'Marta Soler', email: 'marta@example.com', password: 'secret password', language: 'en', invitation_token: 'invite-token' },
      ])
    })
  })

  describe('the two show-password buttons (6K)', () => {
    it('are told apart, and each shows its own field', async () => {
      const { user } = renderSignUp()

      await user.click(screen.getByRole('button', { name: 'Show the repeated password' }))

      expect(field('Confirm password')).toHaveAttribute('type', 'text')
      expect(field('Password')).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: 'Hide the repeated password' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(field('Password')).toHaveAttribute('type', 'text')
      expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
    })

    it("are named in the page's language", async () => {
      await i18n.changeLanguage('ca')
      renderSignUp()

      expect(screen.getByRole('button', { name: 'Mostra la contrasenya' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mostra la contrasenya repetida' })).toBeInTheDocument()
    })
  })
})
