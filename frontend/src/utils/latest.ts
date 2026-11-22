// Keeps only the latest answer per key. A page that fetches the same thing
// again (on each notification, or when a filter changes) can get the answers
// back in any order, and an older one arriving last would overwrite the
// newer. Each request goes through track(key, request): once a newer one with
// the same key has been sent, the older one's answer is dropped — its
// promise never settles, so neither its then() nor its catch() runs.
//
// One tracker per page, made once: const [track] = useState(latestOnly).
export function latestOnly() {
  const latest = new Map<string, number>()
  let sent = 0
  return function track<T>(key: string, request: Promise<T>): Promise<T> {
    sent += 1
    const id = sent
    latest.set(key, id)
    const dropped = new Promise<T>(() => {})
    return request.then(
      (value) => (latest.get(key) === id ? value : dropped),
      (error: unknown) => (latest.get(key) === id ? Promise.reject(error) : dropped),
    )
  }
}
