// Where to go after signing in, when a protected page sent the user to the
// sign-in page — e.g. the OAuth consent page opened by Claude, or a board
// whose link was opened with an expired session. Kept in sessionStorage, not
// in router state, because Google sign-in leaves the app and comes back to
// "/" through the backend.

const KEY = 'kanbanmf.return_to'

// Only paths of this app: "/x", never "//host" or a full URL, so a stored
// value can't send anyone to another site.
function isLocalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')
}

export function rememberReturnTo(path: string) {
  if (isLocalPath(path) && path !== '/signin') sessionStorage.setItem(KEY, path)
}

export function peekReturnTo(): string | null {
  const path = sessionStorage.getItem(KEY)
  return path && isLocalPath(path) ? path : null
}

// Called once a protected page is shown, so the next sign-in starts fresh.
export function clearReturnTo() {
  sessionStorage.removeItem(KEY)
}
