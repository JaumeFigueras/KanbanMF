import { describe, expect, it } from 'vitest'
import { latestOnly } from './latest'

// A request answered (or failed) when the test says.
function pending<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Lets every answer given so far run its callbacks.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('latestOnly', () => {
  it('passes on the answer of the only request', async () => {
    const track = latestOnly()
    await expect(track('lists', Promise.resolve('fresh'))).resolves.toBe('fresh')
  })

  it("drops an older answer that comes after the newer one's", async () => {
    const track = latestOnly()
    const older = pending<string>()
    const newer = pending<string>()
    const seen: string[] = []
    track('lists', older.promise).then((v) => seen.push(v))
    track('lists', newer.promise).then((v) => seen.push(v))

    newer.resolve('new')
    await flush()
    older.resolve('old')
    await flush()

    expect(seen).toEqual(['new'])
  })

  it('drops an older answer that comes first, too', async () => {
    const track = latestOnly()
    const older = pending<string>()
    const newer = pending<string>()
    const seen: string[] = []
    track('lists', older.promise).then((v) => seen.push(v))
    track('lists', newer.promise).then((v) => seen.push(v))

    older.resolve('old')
    await flush()
    expect(seen).toEqual([])
    newer.resolve('new')
    await flush()

    expect(seen).toEqual(['new'])
  })

  it("drops an older failure, and passes on the latest one's", async () => {
    const track = latestOnly()
    const older = pending<string>()
    const newer = pending<string>()
    const failures: unknown[] = []
    track('lists', older.promise).catch((e) => failures.push(e))
    track('lists', newer.promise).catch((e) => failures.push(e))

    older.reject(new Error('old'))
    await flush()
    newer.reject(new Error('new'))
    await flush()

    expect(failures.map((e) => (e as Error).message)).toEqual(['new'])
  })

  it('drops an older answer when the newer request fails', async () => {
    const track = latestOnly()
    const older = pending<string>()
    const newer = pending<string>()
    const seen: string[] = []
    track('lists', older.promise).then((v) => seen.push(v), () => seen.push('failed'))
    track('lists', newer.promise).then((v) => seen.push(v), () => seen.push('failed'))

    newer.reject(new Error('down'))
    await flush()
    older.resolve('old')
    await flush()

    expect(seen).toEqual(['failed'])
  })

  it('keeps each key apart', async () => {
    const track = latestOnly()
    const first = pending<string>()
    const second = pending<string>()
    const seen: string[] = []
    track('cards:list-1', first.promise).then((v) => seen.push(v))
    track('cards:list-2', second.promise).then((v) => seen.push(v))

    second.resolve('list-2')
    first.resolve('list-1')
    await flush()

    expect(seen.sort()).toEqual(['list-1', 'list-2'])
  })

  it('keeps each tracker apart', async () => {
    const one = latestOnly()
    const other = latestOnly()
    const first = pending<string>()
    const seen: string[] = []
    one('lists', first.promise).then((v) => seen.push(v))
    other('lists', Promise.resolve('other page'))

    first.resolve('this page')
    await flush()

    expect(seen).toEqual(['this page'])
  })
})
