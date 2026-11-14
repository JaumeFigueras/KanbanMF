// Runs before every test file (vite.config.ts → test.setupFiles).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import i18n from '../i18n'
import { setAccessToken } from '../api/client'
import { setWebSocketToken } from '../api/ws'
import { FakeWebSocket } from './fakeWebSocket'
import { server } from './server'

// A request no handler matches fails the test instead of going to the
// network (or hanging): every endpoint a test touches is one it declared.
// The WebSocket stub comes after listen(): MSW wraps the global WebSocket
// when it starts, and the app must get the fake, not MSW's wrapper.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterAll(() => server.close())

beforeEach(async () => {
  // Signing in applies the user's language; every test starts in English.
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  // A clock a test fixed (vi.setSystemTime) or fake timers it started stop
  // here, so they can't leak into the next test.
  vi.useRealTimers()
  // The access token and the socket live in module state (api/client.ts,
  // api/ws.ts), which outlives a single test.
  setAccessToken(null)
  setWebSocketToken(null)
  FakeWebSocket.reset()
  localStorage.clear()
  sessionStorage.clear()
})
