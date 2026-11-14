// The password rule, as the backend checks it (backend/src/schemas/auth.py):
// at least 8 characters, and at most 72 bytes — bcrypt's limit, counted in
// UTF-8 bytes, so accented letters count double. Returns the translation key
// of the problem, or null when the password is acceptable.
export const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_BYTES = 72

export function passwordProblem(password: string): string | null {
  // Characters counted as Python's len() counts them, by code point: .length
  // counts UTF-16 units, two for an emoji, and would let through passwords
  // the backend refuses.
  if ([...password].length < PASSWORD_MIN_LENGTH) return 'signUp.passwordTooShort'
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'signUp.passwordTooLong'
  return null
}
