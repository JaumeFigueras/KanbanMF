// Checks the test harness itself (setup.ts, server.ts, render.tsx), so a
// broken helper shows up here rather than as puzzling failures elsewhere.
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { useTheme } from '@mui/material'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { http, HttpResponse } from 'msw'
import i18n from '../i18n'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/useAuth'
import { FakeWebSocket } from './fakeWebSocket'
import { renderWithProviders, TEST_ACCESS_TOKEN } from './render'
import { server } from './server'

// Shows a translated text, the :boardId route param and the theme mode.
function WhereAmI() {
  const { t } = useTranslation()
  const { boardId } = useParams()
  const theme = useTheme()
  return <p>{`${t('timeTracker.start')} / ${boardId ?? '-'} / ${theme.palette.mode}`}</p>
}

// Once signed in, fetches /api/v1/ping through apiFetch and shows the reply.
function Ping() {
  const { accessToken, loading } = useAuth()
  const [reply, setReply] = useState<string | null>(null)
  useEffect(() => {
    if (loading || !accessToken) return
    apiFetch('/api/v1/ping')
      .then((r) => r.json())
      .then((data: { reply: string }) => setReply(data.reply))
  }, [loading, accessToken])
  return <p>{reply ?? 'waiting'}</p>
}

describe('renderWithProviders', () => {
  it('renders in English, at the given route, with its params', () => {
    renderWithProviders(<WhereAmI />, { route: '/boards/b-42', path: '/boards/:boardId' })
    expect(screen.getByText('Start / b-42 / light')).toBeInTheDocument()
  })

  it('applies the dark theme on request', () => {
    renderWithProviders(<WhereAmI />, { theme: 'dark' })
    expect(screen.getByText('Start / - / dark')).toBeInTheDocument()
  })

  it('signs in: apiFetch reaches the fake backend with the token and client id', async () => {
    let headers: Headers | undefined
    server.use(
      http.get('/api/v1/ping', ({ request }) => {
        headers = request.headers
        return HttpResponse.json({ reply: 'pong' })
      }),
    )
    renderWithProviders(<Ping />, { auth: true })

    expect(await screen.findByText('pong')).toBeInTheDocument()
    expect(headers?.get('Authorization')).toBe(`Bearer ${TEST_ACCESS_TOKEN}`)
    expect(headers?.get('X-Client-Id')).toMatch(/^[0-9a-f-]{36}$/)
    // Signing in opens the notification socket — the fake one.
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("applies the signed-in user's language", async () => {
    server.use(http.get('/api/v1/ping', () => HttpResponse.json({ reply: 'pong' })))
    renderWithProviders(<Ping />, { auth: { language_locale: 'ca_ES' } })
    await screen.findByText('pong')
    expect(i18n.language).toBe('ca')
  })

  // Relies on running right after the test above (tests in a file run in
  // order): setup.ts must have switched back to English in between.
  it('starts the next test in English again', () => {
    renderWithProviders(<WhereAmI />)
    expect(i18n.language).toBe('en')
    expect(screen.getByText(/^Start/)).toBeInTheDocument()
  })
})

describe('the fake backend', () => {
  it('fails a request that no test declared', async () => {
    await expect(fetch('/api/v1/nobody-declared-this')).rejects.toThrow()
  })
})
