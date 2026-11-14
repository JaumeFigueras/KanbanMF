// Optional server features (GET /api/v1/config), so the UI can disable what
// the server can't do. Public endpoint, fetched once per page load — once it
// has answered: after a failure, the next caller asks again.
export interface AppConfig {
  email_enabled: boolean
}

const FALLBACK: AppConfig = { email_enabled: false }

let configPromise: Promise<AppConfig> | null = null

export function fetchAppConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = fetch('/api/v1/config')
      .then((r) => {
        if (!r.ok) throw new Error(`GET /api/v1/config: ${r.status}`)
        return r.json() as Promise<AppConfig>
      })
      .catch(() => {
        // Keep only a real answer: after a network failure or an error
        // status (a 503 while the backend restarts, say), let the next
        // caller retry.
        configPromise = null
        return FALLBACK
      })
  }
  return configPromise
}
