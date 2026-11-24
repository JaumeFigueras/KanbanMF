// Runs before every test file (vite.config.ts → test.setupFiles).
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { File as NodeFile } from 'node:buffer'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import i18n from '../i18n'
import { setAccessToken } from '../api/client'
import { setWebSocketToken } from '../api/ws'
import { restoreSiteData } from './blockSiteData'
import { FakeWebSocket } from './fakeWebSocket'
import { server } from './server'

// How long waitFor and findBy… wait before failing: Testing Library's default
// of 1 s is tight for the heaviest dialogs (the time entry's date fields, the
// card picker's three loads in a row) once every file runs in parallel, and
// more so with coverage. A wait that succeeds still ends as soon as it does.
// It stays below the 15 s each test gets (vite.config.ts → testTimeout).
configure({ asyncUtilTimeout: 10_000 })

// jsdom brings its own FormData and File, which Node's fetch (and so MSW)
// can't send: a file upload failed before reaching the fake backend. Node's
// own classes go back in their place (fetch checks files against the global
// File), so an upload goes through as it does in a browser. Unlike a
// browser's, Node's FormData can't be built from a <form>, which React does
// on a submit whose handler starts a transition (the search box's navigate):
// that one reads the form's text fields with jsdom's.
const JsdomFormData = FormData
const NodeFormData = (await new Response(new URLSearchParams()).formData()).constructor as typeof FormData
class FormDataFromForms extends NodeFormData {
  constructor(form?: HTMLFormElement, submitter?: HTMLElement | null) {
    super()
    if (!form) return
    for (const [name, value] of new JsdomFormData(form, submitter)) {
      if (typeof value === 'string') this.append(name, value)
    }
  }
}
vi.stubGlobal('File', NodeFile)
vi.stubGlobal('FormData', FormDataFromForms)

// jsdom has no layout, so no scrolling either: dnd-kit scrolls a handle picked
// up with the keyboard into view.
Element.prototype.scrollIntoView = () => {}

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
  // A test that blocked the storage (blockSiteData) gets it back first.
  restoreSiteData()
  localStorage.clear()
  sessionStorage.clear()
})
