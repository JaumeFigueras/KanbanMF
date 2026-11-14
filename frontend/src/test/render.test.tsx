// Checks the test harness itself (setup.ts, server.ts, render.tsx), so a
// broken helper shows up here rather than as puzzling failures elsewhere.
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
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

describe('the clock', () => {
  it('can be fixed by a test', () => {
    vi.setSystemTime('2000-01-01T12:00:00Z')
    expect(new Date().getFullYear()).toBe(2000)
  })

  // Relies on running right after the test above (tests in a file run in
  // order): setup.ts must have put the real clock back in between.
  it('is real again in the next test', () => {
    expect(new Date().getFullYear()).toBeGreaterThan(2000)
  })
})

describe('the fake WebSocket', () => {
  it('closes like a browser: closing at once, the close event a moment later', async () => {
    const socket = new FakeWebSocket('ws://localhost:5173/api/v1/ws')
    const codes: number[] = []
    socket.onclose = (event) => codes.push(event.code)
    socket.close()
    expect(socket.readyState).toBe(FakeWebSocket.CLOSING)
    expect(codes).toEqual([])
    await Promise.resolve()
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(codes).toEqual([1005])
  })

  it('can be closed by the server, with a dropped connection by default', () => {
    const dropped = new FakeWebSocket('ws://localhost:5173/api/v1/ws')
    const refused = new FakeWebSocket('ws://localhost:5173/api/v1/ws')
    const codes: number[] = []
    dropped.onclose = (event) => codes.push(event.code)
    refused.onclose = (event) => codes.push(event.code)
    dropped.serverClose()
    refused.serverClose(1008)
    expect(codes).toEqual([1006, 1008])
  })
})

describe('the fake backend', () => {
  it('fails a request that no test declared', async () => {
    await expect(fetch('/api/v1/nobody-declared-this')).rejects.toThrow()
  })
})
