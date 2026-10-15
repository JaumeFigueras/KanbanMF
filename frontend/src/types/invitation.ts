import type { PersonSummary } from './board'

// A pending share with an e-mail address that has no account yet. It turns
// into a normal share once someone verifies an account with that address.
export interface BoardInvitationRead {
  id: string
  email: string
  language: string
  created_at: string
  expires_at: string
}

// What the sign-up page shows for a /signup?invite=<token> link.
export interface InvitationPreview {
  email: string
  board_name: string
  inviter_name: string
}

// Detail of the 409 replies to POST /boards/{id}/invitations.
export type InvitationConflict =
  | { code: 'user_exists'; person: PersonSummary; already_shared: boolean }
  | { code: 'already_invited' }
