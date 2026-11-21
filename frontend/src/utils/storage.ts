// The browser's storage, for things the app only remembers for convenience
// (the theme, a board's sort mode, folded sections, the page to come back
// to after signing in).
//
// A browser that blocks site data refuses it: even reading
// window.localStorage throws a SecurityError, and a full storage throws on
// writing. Read straight, that left a blank page, since the theme is read
// before anything is drawn. Here each call acts as if nothing were stored:
// the app works, it just doesn't remember. Every access goes through this
// module (eslint.config.js refuses any other).

type Area = 'local' | 'session'

function storage(area: Area): Storage {
  return area === 'local' ? window.localStorage : window.sessionStorage
}

export function readStored(area: Area, key: string): string | null {
  try {
    return storage(area).getItem(key)
  } catch {
    return null
  }
}

export function writeStored(area: Area, key: string, value: string): void {
  try {
    storage(area).setItem(key, value)
  } catch {
    // Not remembered.
  }
}

export function removeStored(area: Area, key: string): void {
  try {
    storage(area).removeItem(key)
  } catch {
    // Nothing to remove.
  }
}
