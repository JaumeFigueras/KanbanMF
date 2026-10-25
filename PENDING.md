## High priority

- ✓ Add original card title to extract checklist item
- ✓ Add pending tasks overview (global)
- ✓ Months appear in Catalan (os/ff config?) instead of preferred language in the app
- ✓ Add time entry has to get the last end time and get it if less than hour
- ✓ Add comment to Time tracker data model
- ✓ Time Overlap with same minutes
- ✓ Copy checklist to another card
- ✓ Order for cards with no due date when selected order is due date
- ✓ Archive all cards of a list
- ✓ Time tracker
- ✓ Invite to a board
- ✓ Disable mails in weekends
- ✓ Search
- ✓ User manual
  - ✓ Explain how colours work for boards.

## Functionality

- ✓ MCP server, so Claude can read and organise your boards (only boards you own and choose, optionally read-only)
  - ✓ Board operations moved to `src/core` (shared by the routes and the MCP tools)
  - ✓ OAuth 2.1 authorization server: discovery, DCR + Client ID Metadata Documents, consent API, tokens with
    rotation, grants API
  - ✓ `/mcp` endpoint (Streamable HTTP, official `mcp` SDK) with read tools; Vite proxy for `/mcp` and `/.well-known`
  - ✓ Consent page (`/oauth/consent`) and Connected apps dialog in the frontend (en + ca)
  - ✓ Write tools (create/update/move/archive cards, lists, checklist items)
  - ✓ Apache `ProxyPass` for `/mcp` and `/.well-known/oauth-*`, `SETUP.md`, manual page "Connecting Claude"

- ✓ Copy checklist to another card
- Captcha
- ✓ DnD of Labels
- ✓ Add boards in e-mail
- ✓ Archive all cards of a list

## UI

- ✓ Order for cards with no due date when selected order is due date
- Optimize Mobile view
- Add logo, favicon and application name (instead of frontend)
- Add change color to board menu
- DnD checklist and checklist item with new position preview
- Unify "tarja" / "targeta" in the Catalan translation (ca.ts) on "targeta", then retake the screenshots
- Reword the daily overdue reminder label: "Envia correus diaris passada la [N] dies la data de venciment" isn't
  grammatical (e.g. "Envia correus cada dia quan faci més de [N] dies que ha vençut"); the English "Send e-mails
  daily past [N] days the due date" is awkward too

## Frontend tests

Plan of 2026-10-25 (details in PROMPTS.md). Vitest + React Testing Library + jsdom + MSW; one behaviour per test;
run and fix each phase before the next.

- 0. Set-up: Vitest in `vite.config.ts`, `src/test/` (setup, MSW server, `renderWithProviders`), `npm test`,
  `make test-frontend`, coverage to `frontend/coverage-reports/` (gitignored); first test: en/ca translation keys match
- 1. `src/utils/` (pure functions)
- 2. `src/api/` (`apiFetch` refresh-and-retry, `ws.ts`)
- 3. `src/context/` and the route guards (incl. `returnTo`)
- 4. Small dialogs, one file each
- 5. Card pieces (`CardFace`, `CardItem`, `CardDialog`)
- 6. Pages (`SignIn`, `SignUp`, `VerifyEmail`, `OAuthConsent`, `Boards`, `Board`, `OverdueTasks`, `SearchResults`,
  `TimeTracker`)
- 7. End-to-end with Playwright against the dev servers (drag and drop, two-tab real time, OAuth consent)
- 8. Docs (`setup/workflow.rst`, CLAUDE.md)

## Security

From the review of 2026-10-25 (details in PROMPTS.md), most severe first.

- ✓ 1. Google sign-in could join an unverified account and keep the password its creator chose (account takeover);
  `email_verified` wasn't checked
- ✓ 2. `/auth/local/refresh` bcrypt-checks every session of every user, blocking the only process (DoS); expired
  sessions are never deleted
- ✓ 3. `/auth/local/register` returns an access token before the address is verified; `get_current_user` doesn't
  require verified users
- ✓ 4. No rate limits (login, verification and invitation e-mails, OAuth client registration); no minimum password
  length
- ✓ 5. No security headers in the Apache vhost (consent page can be framed; no HSTS, CSP, nosniff)
- ✓ 6. User search matches substrings of every account's e-mail
- ✓ 7. `PUT /users/me` changes the e-mail with no verification and no password check (now refused; a real
  change-e-mail flow — confirm the new address, ask for the password — is a feature to add)
- ✓ 8. No request-size limits (Apache, avatar read whole, unlimited text fields)
- ✓ 9. Access token in `localStorage`; WebSocket token in the URL (logged by Apache)
- ✓ 10. Passwords over 72 bytes give a 500 (bcrypt 5)
- ✓ 11. `python-jose`/`ecdsa` unmaintained with unfixed advisories: move to PyJWT
- ✓ 12. Login timing and register/invite replies reveal which e-mails have accounts
- 13. Google tokens and verification/invitation tokens stored in plain text; `kanbanmf_remoteuser` reads every table
- 14. Archived boards still reachable through the API by shared users
- 15. Changing the password doesn't end other sessions
- 16. Nothing refuses the example `SECRET_KEY`
- 17. `react-router` advisory (RSC mode only, not used here): `npm audit fix`
- 18. New `pip-audit` advisories (2026-10-25, after the review): `urllib3` 2.7.0 (fixed in 2.8.0) and `certifi`
  2026.7.22 (fixed in 2026.10.19), both indirect (`requests`, `httpx`): `pip install -U urllib3 certifi`

## Bugs

- ✓ Upload avatar does not change the initials on the board page
- ✓ When changed to light theme the colors of the list and cards are not kept
- ✓ When copying a card the Title is not used as starting point 
- ✓ Removing a user from a shared board leaves them as member/assignee of its cards, and the hourly reminder job
  doesn't check access, so they keep getting due-date e-mails about a board they can no longer open. Their cards
  are now archived and replaced by copies with the remover in their place (`core/card_replacement.py`), and the
  job skips archived lists/boards and recipients without access.
- ✓ Google sign-in sends no OAuth `state` parameter (`api/v1/auth/google.py`), so it's open to login CSRF: a victim
  can be signed in to an attacker's account. Generate a random state, keep it in a short-lived cookie, and check
  it in the callback.
- ✓ Checklist changes (add/rename/delete/reorder a checklist or an item, tick an item — `api/v1/checklists.py`,
  `core/checklists.py`) send no WebSocket notification, so other tabs and other people on the board keep showing
  the old checklist and progress until they reload. Notify `card_updated` with the card's `list_id`, as card edits
  do. Needed before the MCP server can add checklist items.
- ✓ `/auth/local/refresh` runs bcrypt against every active session of every user to find the matching one, so each
  refresh gets slower as sessions accumulate. Store a lookup key (e.g. a session id in the cookie, or a SHA-256 of
  the token) and bcrypt-check only that row.
- A due-date reminder that fails to send is never retried: the comment in `core/notifications.py` says the next
  hourly tick retries it, but the job only processes a setting when the local hour equals `notify_hour`.
- `frontend/package.json` lists `@anthropic-ai/claude-code` under `dependencies`, so every `npm install`,
  production included, downloads it. Remove it (or move it to `devDependencies`).
- ✓ `make deploy` doesn't run `pip install -r backend/requirements.txt` or `npm install`, so an update that adds a
  dependency breaks the deploy.
- The database comment on `user_preferences.user_id` says "Deleting the user also deletes the avatar" (copied from
  `UserAvatar`). Fix the model's `comment`, add a migration and regenerate `src/model/sql/`.

## FUTURE

- ✓ Extract card from checklist item
- E-mail digest
- ✓ Board Templates
- Card Templates
- Recurring tasks
- ✓ Usage order in Time Tracker
- Delete account