import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { DROPPED, SERVER_ERROR, fakeEndpoint, heldAnswer } from '../test/endpoints'
import type { Answer } from '../test/endpoints'
import { makeUser } from '../test/fixtures'
import { renderWithProviders } from '../test/render'
import { peekReturnTo } from '../utils/returnTo'
import SignIn from '../pages/SignIn'
import MainAppBar from './MainAppBar'
import ProtectedRoute from './ProtectedRoute'
import PublicRoute from './PublicRoute'

const PROFILE = '/api/v1/users/me'
const PAGE = '/boards/board-1?card=card-7'
const PROFILE_FAILED = /Your profile couldn't be loaded\./

// The address the router is at, to see the bar doesn't move the page.
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}

// The profile answers `answer` (the user, unless told otherwise); the
// avatar is never there.
function profileServer(answer: Answer = () => HttpResponse.json(makeUser())) {
  let current = answer
  const loads = fakeEndpoint('get', PROFILE, (request) => current(request))
  fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
  return {
    loads: () => loads.requests.length,
    answer: (next: Answer) => { current = next },
  }
}

function renderBar() {
  return renderWithProviders(<><MainAppBar /><Address /></>, { route: PAGE })
}

// The profile button, named by its tooltip.
const profileButton = () => screen.getByRole('button', { name: 'User profile' })

async function openProfileMenu(user: ReturnType<typeof renderBar>['user']) {
  await user.click(profileButton())
  return screen.findByRole('menu')
}

const entry = (name: string | RegExp) => screen.getByRole('menuitem', { name })
const NEEDS_PROFILE = ['Change display name and initials', 'Language and Localization']

describe('MainAppBar', () => {
  describe('a profile that fails to load (6G)', () => {
    it.each<[string, Answer]>([
      ['a server error', SERVER_ERROR],
      ['a dropped connection', DROPPED],
    ])('keeps the page after %s, and waits for the profile before the name and language dialogs', async (_case, answer) => {
      const server = profileServer(answer)
      const { user } = renderBar()

      await openProfileMenu(user)

      expect(await screen.findByRole('menuitem', { name: PROFILE_FAILED })).toHaveTextContent('Try again')
      expect(screen.getByTestId('address')).toHaveTextContent(PAGE)
      expect(screen.queryByText('Emma Wilson')).not.toBeInTheDocument()
      for (const name of NEEDS_PROFILE) expect(entry(name)).toHaveAttribute('aria-disabled', 'true')
      for (const name of ['Upload avatar', 'Connected apps', 'Change to Dark Theme', 'Sign out']) {
        expect(entry(name)).not.toHaveAttribute('aria-disabled')
      }
      expect(server.loads()).toBe(1)
    })

    it('loads the profile with Try again, keeping the menu open', async () => {
      const server = profileServer(SERVER_ERROR)
      const { user } = renderBar()
      await openProfileMenu(user)
      server.answer(() => HttpResponse.json(makeUser()))

      await user.click(await screen.findByRole('menuitem', { name: PROFILE_FAILED }))

      expect(await screen.findByText('Emma Wilson')).toBeInTheDocument()
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: PROFILE_FAILED })).not.toBeInTheDocument()
      for (const name of NEEDS_PROFILE) expect(entry(name)).not.toHaveAttribute('aria-disabled')
      expect(screen.getByTestId('address')).toHaveTextContent(PAGE)
      expect(server.loads()).toBe(2)
    })

    it('takes Try again away while it loads, and brings it back if it fails again', async () => {
      const server = profileServer(DROPPED)
      const { user } = renderBar()
      await openProfileMenu(user)
      const held = heldAnswer(SERVER_ERROR)
      server.answer(held.answer)

      await user.click(await screen.findByRole('menuitem', { name: PROFILE_FAILED }))

      expect(screen.queryByRole('menuitem', { name: PROFILE_FAILED })).not.toBeInTheDocument()
      for (const name of NEEDS_PROFILE) expect(entry(name)).toHaveAttribute('aria-disabled', 'true')
      held.release()
      expect(await screen.findByRole('menuitem', { name: PROFILE_FAILED })).toBeInTheDocument()
    })

    it('keeps the name and language dialogs waiting while the profile is still loading', async () => {
      const held = heldAnswer(() => HttpResponse.json(makeUser()))
      profileServer(held.answer)
      const { user } = renderBar()

      await openProfileMenu(user)

      for (const name of NEEDS_PROFILE) expect(entry(name)).toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByRole('menuitem', { name: PROFILE_FAILED })).not.toBeInTheDocument()
      held.release()
      expect(await screen.findByText('Emma Wilson')).toBeInTheDocument()
      for (const name of NEEDS_PROFILE) expect(entry(name)).not.toHaveAttribute('aria-disabled')
    })

    // The page's guard, not the bar, signs an expired session out.
    it('still ends on the sign-in page, remembering the page, when the session has expired', async () => {
      let refreshes = 0
      fakeEndpoint('post', '/api/v1/auth/local/refresh', () => (++refreshes === 1
        ? HttpResponse.json({ access_token: 'token' })
        : HttpResponse.json({ detail: 'Invalid or expired refresh token' }, { status: 401 })))
      // The first load is AuthProvider's, at start-up; the second is the bar's.
      let profiles = 0
      fakeEndpoint('get', PROFILE, () => (++profiles === 1
        ? HttpResponse.json(makeUser())
        : HttpResponse.json({ detail: 'Could not validate credentials' }, { status: 401 })))
      fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))

      renderWithProviders(
        <AuthProvider>
          <Routes>
            <Route path="/boards/:boardId" element={<ProtectedRoute><MainAppBar /></ProtectedRoute>} />
            <Route path="/signin" element={<p>The sign-in page</p>} />
          </Routes>
        </AuthProvider>,
        { route: PAGE },
      )

      expect(await screen.findByText('The sign-in page')).toBeInTheDocument()
      expect(peekReturnTo()).toBe(PAGE)
      expect(profiles).toBe(2)
    })
  })

  describe('signing out (6H)', () => {
    const UNCONFIRMED = "You're signed out on this page, but KanbanMF couldn't end your session, so this device may still be signed in: reloading would sign you back in. Check your connection, then reload and sign out again."

    // Signed in on a board, as the app has it: the bar behind ProtectedRoute,
    // and the real sign-in page behind PublicRoute.
    function renderSignedIn(logout: Answer) {
      fakeEndpoint('post', '/api/v1/auth/local/refresh', () => HttpResponse.json({ access_token: 'token' }))
      profileServer()
      const signedOut = fakeEndpoint('post', '/api/v1/auth/local/logout', logout)
      const result = renderWithProviders(
        <AuthProvider>
          <Routes>
            <Route path="/boards/:boardId" element={<ProtectedRoute><MainAppBar /></ProtectedRoute>} />
            <Route path="/signin" element={<PublicRoute><SignIn /></PublicRoute>} />
          </Routes>
        </AuthProvider>,
        { route: PAGE },
      )
      return { ...result, signedOut }
    }

    it.each<[string, Answer]>([
      ['a dropped connection', DROPPED],
      ['a server error', SERVER_ERROR],
    ])('goes to the sign-in page after %s, and says this device may still be signed in', async (_case, answer) => {
      const { user, signedOut } = renderSignedIn(answer)
      await screen.findByText('Emma Wilson')

      await user.click(screen.getByRole('button', { name: 'Sign out' }))

      expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent(UNCONFIRMED)
      expect(signedOut.requests).toHaveLength(1)
      expect(peekReturnTo()).toBeNull()
    })

    it('goes to the sign-in page with no warning once the session has ended', async () => {
      const { user, signedOut } = renderSignedIn(() => new HttpResponse(null, { status: 204 }))
      await screen.findByText('Emma Wilson')

      await user.click(screen.getByRole('button', { name: 'Sign out' }))

      expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(signedOut.requests).toHaveLength(1)
      expect(peekReturnTo()).toBeNull()
    })
  })

  describe('with the keyboard (6J)', () => {
    // The bar from its first stop: the KanbanMF link, the time tracker, the
    // profile and Sign out.
    async function tabToProfile(user: ReturnType<typeof renderBar>['user']) {
      await screen.findByText('Emma Wilson')
      await user.tab()
      expect(screen.getByRole('link', { name: 'KanbanMF' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Time Tracker' })).toHaveFocus()
      await user.tab()
      expect(profileButton()).toHaveFocus()
    }

    it('goes to the boards from the KanbanMF link, which can also open them in a new tab', async () => {
      profileServer()
      const { user } = renderBar()
      await screen.findByText('Emma Wilson')
      await user.tab()
      const link = screen.getByRole('link', { name: 'KanbanMF' })
      expect(link).toHaveFocus()
      expect(link).toHaveAttribute('href', '/boards')

      await user.keyboard('{Enter}')

      expect(screen.getByTestId('address')).toHaveTextContent(/^\/boards$/)
    })

    it.each(['{Enter}', ' '])('reaches the profile with Tab and opens its menu with %j', async (key) => {
      profileServer()
      const { user } = renderBar()
      await tabToProfile(user)
      // Held from here: while the menu is open, the rest of the page is
      // hidden from screen readers.
      const button = profileButton()
      expect(button).toHaveAttribute('aria-haspopup', 'menu')
      expect(button).toHaveAttribute('aria-expanded', 'false')

      await user.keyboard(key)

      const menu = await screen.findByRole('menu')
      expect(menu).toHaveAccessibleName('User profile')
      expect(button).toHaveAttribute('aria-expanded', 'true')
      expect(document.getElementById(button.getAttribute('aria-controls')!)).toContainElement(menu)
      expect(entry('Change display name and initials')).toHaveFocus()
    })

    it('goes through the menu with the arrow keys and opens an entry with Enter', async () => {
      profileServer()
      const { user } = renderBar()
      await tabToProfile(user)
      await user.keyboard('{Enter}')
      await screen.findByRole('menu')

      await user.keyboard('{ArrowDown}')
      expect(entry('Change password')).toHaveFocus()
      await user.keyboard('{Enter}')

      expect(await screen.findByRole('dialog', { name: 'Change password' })).toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes the menu with Escape and gives the focus back to the profile', async () => {
      profileServer()
      const { user } = renderBar()
      await tabToProfile(user)
      await user.keyboard('{Enter}')
      await screen.findByRole('menu')

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      expect(profileButton()).toHaveFocus()
      expect(profileButton()).toHaveAttribute('aria-expanded', 'false')
    })
  })
})
