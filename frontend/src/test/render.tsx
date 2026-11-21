import type { ReactElement, ReactNode } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, type RenderResult } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { AuthProvider } from '../context/AuthContext'
import { darkTheme, lightTheme } from '../theme'
import { makeUser, type TestUser } from './fixtures'
import { server } from './server'

export const TEST_ACCESS_TOKEN = 'test-access-token'

export interface RenderOptions {
  // The address the router starts at.
  route?: string
  // A route pattern such as '/boards/:boardId', so the component can read
  // its params; without one the component is rendered whatever the address.
  path?: string
  theme?: 'light' | 'dark'
  // Sign in as a test user: wraps the tree in AuthProvider and makes the
  // fake backend answer the start-up refresh and /users/me. Pass a user (or
  // part of one) to change who is signed in.
  auth?: boolean | Partial<TestUser>
  // Wrap the whole tree in StrictMode, as main.tsx does, so effects run
  // twice on mount the way they do in development. A <StrictMode> inside
  // the rendered element isn't enough: React only does that for one at the
  // root, above the providers.
  strictMode?: boolean
}

export type RenderWithProvidersResult = RenderResult & { user: UserEvent }

// Renders a component the way the app does (MUI theme, router, optionally a
// signed-in session; i18n is set up by setup.ts) and returns React Testing
// Library's result plus a user-event instance for clicking and typing.
//
// The providers are a wrapper, so rerender() keeps them: rerender(<Dialog
// open={false} />) and then rerender(<Dialog open />) closes and reopens a
// dialog the way its parent page would.
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path, theme = 'light', auth = false, strictMode = false }: RenderOptions = {},
): RenderWithProvidersResult {
  if (auth) {
    const user = makeUser(auth === true ? {} : auth)
    server.use(
      http.post('/api/v1/auth/local/refresh', () => HttpResponse.json({ access_token: TEST_ACCESS_TOKEN })),
      http.get('/api/v1/users/me', () => HttpResponse.json(user)),
    )
  }

  function Providers({ children }: { children: ReactNode }) {
    const routed = path ? (
      <Routes>
        <Route path={path} element={children} />
      </Routes>
    ) : children
    return (
      <ThemeProvider theme={theme === 'dark' ? darkTheme : lightTheme}>
        <CssBaseline />
        <MemoryRouter initialEntries={[route]}>
          {auth ? <AuthProvider>{routed}</AuthProvider> : routed}
        </MemoryRouter>
      </ThemeProvider>
    )
  }

  const result = render(ui, { wrapper: Providers, reactStrictMode: strictMode })
  return { ...result, user: userEvent.setup() }
}
