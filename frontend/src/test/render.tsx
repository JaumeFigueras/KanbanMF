import type { ReactElement } from 'react'
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
}

export type RenderWithProvidersResult = RenderResult & { user: UserEvent }

// Renders a component the way the app does (MUI theme, router, optionally a
// signed-in session; i18n is set up by setup.ts) and returns React Testing
// Library's result plus a user-event instance for clicking and typing.
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', path, theme = 'light', auth = false }: RenderOptions = {},
): RenderWithProvidersResult {
  let tree = path ? (
    <Routes>
      <Route path={path} element={ui} />
    </Routes>
  ) : ui

  if (auth) {
    const user = makeUser(auth === true ? {} : auth)
    server.use(
      http.post('/api/v1/auth/local/refresh', () => HttpResponse.json({ access_token: TEST_ACCESS_TOKEN })),
      http.get('/api/v1/users/me', () => HttpResponse.json(user)),
    )
    tree = <AuthProvider>{tree}</AuthProvider>
  }

  const result = render(
    <ThemeProvider theme={theme === 'dark' ? darkTheme : lightTheme}>
      <CssBaseline />
      <MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>
    </ThemeProvider>,
  )
  return { ...result, user: userEvent.setup() }
}
