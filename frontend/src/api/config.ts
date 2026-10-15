// Optional server features (GET /api/v1/config), so the UI can disable what
// the server can't do. Public endpoint, fetched once per page load.
export interface AppConfig {
  email_enabled: boolean
}

const FALLBACK: AppConfig = { email_enabled: false }

let configPromise: Promise<AppConfig> | null = null

export function fetchAppConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = fetch('/api/v1/config')
      .then((r) => (r.ok ? (r.json() as Promise<AppConfig>) : FALLBACK))
      .catch(() => {
        // Don't cache a network failure: let the next caller retry.
        configPromise = null
        return FALLBACK
      })
  }
  return configPromise
}
