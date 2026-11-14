import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server'
import type { fetchAppConfig as FetchAppConfig } from './config'

// config.ts keeps its answer for the whole page load, so every test loads a
// fresh copy of it: a new page.
let fetchAppConfig: typeof FetchAppConfig

beforeEach(async () => {
  vi.resetModules()
  fetchAppConfig = (await import('./config')).fetchAppConfig
})

// GET /api/v1/config, answering with each response in turn and counting
// the requests.
function fakeConfig(...answers: (() => Response)[]) {
  const calls = { count: 0 }
  server.use(
    http.get('/api/v1/config', () => {
      const answer = answers[Math.min(calls.count, answers.length - 1)]
      calls.count += 1
      return answer()
    }),
  )
  return calls
}

const EMAIL_ON = () => HttpResponse.json({ email_enabled: true })

describe('fetchAppConfig', () => {
  it("gives the server's answer", async () => {
    fakeConfig(EMAIL_ON)
    expect(await fetchAppConfig()).toEqual({ email_enabled: true })
  })

  it('asks the server once per page load', async () => {
    const calls = fakeConfig(EMAIL_ON)
    const [first, second] = await Promise.all([fetchAppConfig(), fetchAppConfig()])
    const third = await fetchAppConfig()
    expect([first, second, third]).toEqual([{ email_enabled: true }, { email_enabled: true }, { email_enabled: true }])
    expect(calls.count).toBe(1)
  })

  it('falls back to e-mail off on a server error, and asks again next time', async () => {
    // A 503, say, while the backend restarts during a deploy.
    const calls = fakeConfig(() => new HttpResponse(null, { status: 503 }), EMAIL_ON)
    expect(await fetchAppConfig()).toEqual({ email_enabled: false })
    expect(await fetchAppConfig()).toEqual({ email_enabled: true })
    expect(calls.count).toBe(2)
  })

  it('falls back to e-mail off on a network failure, and asks again next time', async () => {
    const calls = fakeConfig(() => HttpResponse.error(), EMAIL_ON)
    expect(await fetchAppConfig()).toEqual({ email_enabled: false })
    expect(await fetchAppConfig()).toEqual({ email_enabled: true })
    expect(calls.count).toBe(2)
  })
})
