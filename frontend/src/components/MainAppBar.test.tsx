import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'
import { ThemeToggleProvider } from '../context/ThemeToggleContext'
import i18n from '../i18n'
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

function renderBar(props: ComponentProps<typeof MainAppBar> = {}) {
  return renderWithProviders(
    <ThemeToggleProvider><MainAppBar {...props} /><Address /></ThemeToggleProvider>,
    { route: PAGE },
  )
}

const address = () => screen.getByTestId('address').textContent

// The user's avatar as the server has it from now on: a picture, or none.
// jsdom has no blob URLs, so each picture gets a made-up one.
function avatarServer(has: boolean) {
  let present = has
  let made = 0
  URL.createObjectURL = vi.fn(() => `blob:avatar-${++made}`)
  URL.revokeObjectURL = vi.fn()
  onTestFinished(() => {
    // @ts-expect-error -- jsdom doesn't have them; put it back that way.
    delete URL.createObjectURL
    // @ts-expect-error -- as above.
    delete URL.revokeObjectURL
  })
  const loads = fakeEndpoint('get', '/api/v1/users/me/avatar', () => (present
    ? new HttpResponse(new Blob(['png'], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png' } })
    : new HttpResponse(null, { status: 404 })))
  return { loads: () => loads.requests.length, remove: () => { present = false } }
}

// A phone, for MUI's useMediaQuery: jsdom has no matchMedia, which MUI takes
// for a computer. This one answers width queries for a screen 375 px wide.
function onPhone() {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query)
    const min = /min-width:\s*([\d.]+)px/.exec(query)
    const matches = (!max || 375 <= Number(max[1])) && (!min || 375 >= Number(min[1]))
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
  onTestFinished(() => { vi.stubGlobal('matchMedia', undefined) })
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

  describe('the profile', () => {
    it('shows the name and initials, and applies the language and formats it holds', async () => {
      profileServer(() => HttpResponse.json(makeUser({
        display_name: 'Marta Vidal', initials: 'MV', language_locale: 'ca_ES', number_locale: 'ca_ES', date_format: 'textual',
      })))
      const onLocaleChanged = vi.fn()
      renderBar({ onLocaleChanged })

      expect(await screen.findByText('Marta Vidal')).toBeInTheDocument()
      expect(within(screen.getByRole('button', { name: 'Perfil d\'usuari' })).getByText('MV')).toBeInTheDocument()
      expect(i18n.language).toBe('ca')
      expect(onLocaleChanged.mock.calls).toEqual([['ca_ES', 'textual']])
    })

    it('shows the avatar when there is one, and offers to change or remove it', async () => {
      profileServer()
      avatarServer(true)
      const { user } = renderBar()
      await screen.findByText('Emma Wilson')

      await waitFor(() => expect(profileButton().querySelector('img')).toHaveAttribute('src', 'blob:avatar-1'))
      await openProfileMenu(user)
      expect(entry('Change / Remove avatar')).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Upload avatar' })).not.toBeInTheDocument()
    })

    it("shows the initials when the avatar can't be loaded", async () => {
      profileServer(() => HttpResponse.json(makeUser({ initials: 'EW' })))
      fakeEndpoint('get', '/api/v1/users/me/avatar', DROPPED)
      const { user } = renderBar()
      await screen.findByText('Emma Wilson')

      expect(within(profileButton()).getByText('EW')).toBeInTheDocument()
      expect(profileButton().querySelector('img')).toBeNull()
      await openProfileMenu(user)
      expect(entry('Upload avatar')).toBeInTheDocument()
    })

    it('offers Change password only to an account that has one', async () => {
      profileServer(() => HttpResponse.json(makeUser({ auth_providers: ['google'] })))
      const { user } = renderBar()
      await screen.findByText('Emma Wilson')

      await openProfileMenu(user)

      expect(screen.queryByRole('menuitem', { name: 'Change password' })).not.toBeInTheDocument()
      expect(entry('Change display name and initials')).toBeInTheDocument()
    })
  })

  describe("the menu's dialogs, and what they hand back", () => {
    it('changes the name and initials, and shows them', async () => {
      profileServer(() => HttpResponse.json(makeUser({ initials: 'EW' })))
      const named = fakeEndpoint('put', PROFILE, () => HttpResponse.json(makeUser({ display_name: 'Emma W. Stone' })))
      const initialled = fakeEndpoint('put', '/api/v1/users/me/preferences', () => HttpResponse.json({}))
      const { user } = renderBar()
      await screen.findByText('Emma Wilson')
      await openProfileMenu(user)

      await user.click(entry('Change display name and initials'))

      const dialog = await screen.findByRole('dialog')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const name = within(dialog).getByRole('textbox', { name: /^Display name/ })
      const initials = within(dialog).getByRole('textbox', { name: /^Initials/ })
      expect(name).toHaveValue('Emma Wilson')
      expect(initials).toHaveValue('EW')
      await user.clear(name)
      await user.type(name, 'Emma W. Stone')
      await user.clear(initials)
      await user.type(initials, 'es')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Emma W. Stone')).toBeInTheDocument()
      // The page behind the dialog is hidden from screen readers until it has gone.
      await waitFor(() => expect(within(profileButton()).getByText('ES')).toBeInTheDocument())
      expect(named.requests.map((r) => r.body)).toEqual([{ display_name: 'Emma W. Stone' }])
      expect(initialled.requests.map((r) => r.body)).toEqual([{ initials: 'es' }])
    })

    it('removes the avatar, loads it again, and tells the page', async () => {
      profileServer(() => HttpResponse.json(makeUser({ initials: 'EW' })))
      const avatar = avatarServer(true)
      const removed = fakeEndpoint('delete', '/api/v1/users/me/avatar', () => {
        avatar.remove()
        return new HttpResponse(null, { status: 204 })
      })
      const onAvatarChanged = vi.fn()
      const { user } = renderBar({ onAvatarChanged })
      await waitFor(() => expect(profileButton().querySelector('img')).not.toBeNull())
      await openProfileMenu(user)

      await user.click(entry('Change / Remove avatar'))
      const dialog = await screen.findByRole('dialog', { name: 'Change / Remove avatar' })
      await user.click(within(dialog).getByRole('button', { name: 'Remove avatar' }))

      await waitFor(() => expect(profileButton().querySelector('img')).toBeNull())
      expect(within(profileButton()).getByText('EW')).toBeInTheDocument()
      expect(removed.requests).toHaveLength(1)
      expect(avatar.loads()).toBe(2)
      expect(onAvatarChanged).toHaveBeenCalledTimes(1)
      await openProfileMenu(user)
      expect(entry('Upload avatar')).toBeInTheDocument()
    })

    it('opens the language dialog on the settings held, and applies the ones saved', async () => {
      profileServer(() => HttpResponse.json(makeUser({ number_locale: 'en_GB', date_format: 'numeric', timezone: 'Europe/London' })))
      const saved = fakeEndpoint('put', '/api/v1/users/me/preferences', () => HttpResponse.json({}))
      const onLocaleChanged = vi.fn()
      const { user } = renderBar({ onLocaleChanged })
      await screen.findByText('Emma Wilson')
      await openProfileMenu(user)

      await user.click(entry('Language and Localization'))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('combobox', { name: 'Display language' })).toHaveTextContent('English')
      expect(within(dialog).getByRole('combobox', { name: 'Timezone' })).toHaveValue('Europe/London')
      await user.click(within(dialog).getByRole('combobox', { name: 'Display language' }))
      await user.click(screen.getByRole('option', { name: 'Català' }))
      await user.click(within(dialog).getByRole('combobox', { name: 'Date display on cards' }))
      await user.click(screen.getByRole('option', { name: /^Textual/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(i18n.language).toBe('ca'))
      expect(saved.requests.map((r) => r.body)).toEqual([
        { language_locale: 'ca_ES', number_locale: 'en_GB', date_format: 'textual', timezone: 'Europe/London' },
      ])
      // Once for the profile, once for what was saved.
      expect(onLocaleChanged.mock.calls).toEqual([['en_GB', 'numeric'], ['en_GB', 'textual']])
      // The menu, in Catalan now, opens the dialog on what was saved.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Perfil d\'usuari' })).toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Perfil d\'usuari' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Idioma i localització' }))
      expect(within(await screen.findByRole('dialog')).getByRole('combobox', { name: 'Idioma de la interfície' })).toHaveTextContent('Català')
    })

    it('opens the connected apps', async () => {
      profileServer()
      const grants = fakeEndpoint('get', '/api/v1/oauth/grants', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [], shared: [], templates: [] }))
      const { user } = renderBar()
      await openProfileMenu(user)

      await user.click(entry('Connected apps'))

      expect(await screen.findByRole('dialog', { name: 'Connected apps' })).toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      await waitFor(() => expect(grants.requests).toHaveLength(1))
    })

    it.each([
      ['Change password', 'Change password', 'Cancel'],
      ['Connected apps', 'Connected apps', 'Close'],
    ])('closes %s with its %s button, back to the page', async (entryName, dialogName, closeName) => {
      profileServer()
      fakeEndpoint('get', '/api/v1/oauth/grants', () => HttpResponse.json([]))
      fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [], shared: [], templates: [] }))
      const { user } = renderBar()
      await screen.findByText('Emma Wilson')
      await openProfileMenu(user)
      await user.click(entry(entryName))
      const dialog = await screen.findByRole('dialog', { name: dialogName })

      await user.click(within(dialog).getByRole('button', { name: closeName }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(address()).toBe(PAGE)
    })

    it('switches the theme, and names the entry for the switch back', async () => {
      profileServer()
      const { user } = renderBar()
      await openProfileMenu(user)

      await user.click(entry('Change to Dark Theme'))

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      expect(localStorage.getItem('theme')).toBe('dark')
      await openProfileMenu(user)
      await user.click(entry('Change to Light Theme'))
      expect(localStorage.getItem('theme')).toBe('light')
    })

    it('signs out from the menu too, and goes to the sign-in page', async () => {
      const signedOut = fakeEndpoint('post', '/api/v1/auth/local/logout', () => new HttpResponse(null, { status: 204 }))
      fakeEndpoint('get', '/api/v1/users/me/avatar', () => new HttpResponse(null, { status: 404 }))
      const { user } = renderWithProviders(<><MainAppBar /><Address /></>, { route: PAGE, auth: true })
      await screen.findByText('Emma Wilson')
      await openProfileMenu(user)

      await user.click(entry('Sign out'))

      await waitFor(() => expect(address()).toBe('/signin'))
      expect(signedOut.requests).toHaveLength(1)
    })
  })

  describe('the time tracker button', () => {
    it('opens the time tracker', async () => {
      profileServer()
      const { user } = renderBar()

      await user.click(screen.getByRole('button', { name: 'Time Tracker' }))

      expect(address()).toBe('/time-tracker')
    })
  })

  describe('the search box', () => {
    it('is left out on a page with nothing to search', async () => {
      profileServer()
      renderBar()
      await screen.findByText('Emma Wilson')

      expect(screen.queryByRole('search')).not.toBeInTheDocument()
    })

    it.each([
      ['every board', {}, 'Search all boards', '/search?q=home+page'],
      ['one board', { boardId: 'board-1' }, 'Search this board', '/search?q=home+page&board=board-1'],
      ["a board's archive", { boardId: 'board-1', archived: true }, "Search this board's archive", '/search?q=home+page&board=board-1&archived=1'],
      ['the archived boards', { archived: true }, 'Search archived boards', '/search?q=home+page&archived=1'],
    ])('searches %s on a computer, with Enter, without the spaces around', async (_case, scope, placeholder, results) => {
      profileServer()
      const { user } = renderBar({ search: scope })
      const box = within(screen.getByRole('search')).getByRole('textbox', { name: placeholder })
      expect(box).toHaveAttribute('placeholder', placeholder)

      await user.type(box, '  home page  {Enter}')

      expect(address()).toBe(results)
    })

    it('does nothing with fewer than two letters', async () => {
      profileServer()
      const { user } = renderBar({ search: {} })

      await user.type(screen.getByRole('textbox', { name: 'Search all boards' }), ' h {Enter}')

      expect(address()).toBe(PAGE)
    })

    describe('on a phone', () => {
      it('folds into a button, which opens the box in place of the title', async () => {
        onPhone()
        profileServer()
        const { user } = renderBar({ search: { boardId: 'board-1' } })
        expect(screen.queryByRole('search')).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'KanbanMF' })).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Search this board' }))

        const box = within(screen.getByRole('search')).getByRole('textbox', { name: 'Search this board' })
        expect(box).toHaveFocus()
        expect(screen.queryByRole('link', { name: 'KanbanMF' })).not.toBeInTheDocument()
        await user.type(box, 'footer{Enter}')
        expect(address()).toBe('/search?q=footer&board=board-1')
      })

      it('folds back when left empty, and stays open when left with text', async () => {
        onPhone()
        profileServer()
        const { user } = renderBar({ search: {} })
        await user.click(screen.getByRole('button', { name: 'Search all boards' }))

        await user.tab()

        expect(screen.queryByRole('search')).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'KanbanMF' })).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Search all boards' }))
        await user.type(screen.getByRole('textbox', { name: 'Search all boards' }), 'foo')
        await user.tab()
        expect(screen.getByRole('textbox', { name: 'Search all boards' })).toHaveValue('foo')
      })
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
