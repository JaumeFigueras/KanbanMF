// Checks the endpoint helpers (endpoints.ts) that the component tests use.
import { describe, expect, it } from 'vitest'
import { HttpResponse } from 'msw'
import { apiFetch } from '../api/client'
import { fakeEndpoint, heldAnswer } from './endpoints'

describe('fakeEndpoint', () => {
  it('records the address, with its query, and a JSON body', async () => {
    const created = fakeEndpoint('post', '/api/v1/boards/:boardId/lists')
    await apiFetch('/api/v1/boards/board-7/lists?position=2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Done' }),
    })
    expect(created.requests.map((r) => [r.url.pathname, r.url.search, r.body])).toEqual([
      ['/api/v1/boards/board-7/lists', '?position=2', { name: 'Done' }],
    ])
  })

  it('records a form as FormData, and no body as null', async () => {
    const uploaded = fakeEndpoint('put', '/api/v1/users/me/avatar')
    const removed = fakeEndpoint('delete', '/api/v1/users/me/avatar')
    const form = new FormData()
    form.append('file', new File(['png'], 'me.png', { type: 'image/png' }))
    await apiFetch('/api/v1/users/me/avatar', { method: 'PUT', body: form })
    await apiFetch('/api/v1/users/me/avatar', { method: 'DELETE' })

    const sent = uploaded.requests[0].body as FormData
    expect((sent.get('file') as File).name).toBe('me.png')
    expect(removed.requests[0].body).toBeNull()
  })

  it('answers 204 by default, or what the test says', async () => {
    fakeEndpoint('delete', '/api/v1/boards/:boardId')
    fakeEndpoint('get', '/api/v1/boards', () => HttpResponse.json({ owned: [] }))
    expect((await apiFetch('/api/v1/boards/board-7', { method: 'DELETE' })).status).toBe(204)
    expect(await (await apiFetch('/api/v1/boards')).json()).toEqual({ owned: [] })
  })
})

describe('heldAnswer', () => {
  it('holds the answer until the test releases it', async () => {
    const held = heldAnswer(() => HttpResponse.json({ ok: true }))
    fakeEndpoint('get', '/api/v1/config', held.answer)
    let answered = false
    const request = apiFetch('/api/v1/config').then((r) => {
      answered = true
      return r.json()
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(answered).toBe(false)

    held.release()
    expect(await request).toEqual({ ok: true })
  })
})
