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

- ✓ MCP server for Claude (OAuth 2.1, consent page, read and write tools)
- MCP server: allow renaming a checklist (a write tool such as `update_checklist`; today only items can be
  changed)
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

- ✓ 1. Google sign-in could take over an unverified account
- ✓ 2. Refresh bcrypt-checked every session (DoS); expired sessions kept
- ✓ 3. Unverified accounts could use the API
- ✓ 4. No rate limits; no minimum password length
- ✓ 5. No security headers in the Apache vhost
- ✓ 6. User search leaked every account's e-mail
- ✓ 7. E-mail change without verification (now refused; a proper flow is still to add)
- ✓ 8. No request-size limits
- ✓ 9. Access token in `localStorage`; WebSocket token in the URL
- ✓ 10. Passwords over 72 bytes give a 500 (bcrypt 5)
- ✓ 11. `python-jose` replaced by PyJWT
- ✓ 12. Sign-in and register replies revealed which e-mails have accounts
- ✓ 13. Tokens stored in plain text; remote DB user read every table
- ✓ 14. Archived boards reachable by shared users
- ✓ 15. Changing the password doesn't end other sessions
- ✓ 16. Nothing refuses the example `SECRET_KEY`
- ✓ 17. npm advisories fixed (`npm audit fix`)
- ✓ 18. pip advisories fixed (`urllib3`, `certifi`)

## Bugs

- ✓ Upload avatar does not change the initials on the board page
- ✓ When changed to light theme the colors of the list and cards are not kept
- ✓ When copying a card the Title is not used as starting point 
- ✓ Removed users kept getting reminders from cards of the board
- ✓ Google sign-in had no OAuth `state` (login CSRF)
- ✓ Checklist changes sent no WebSocket notification
- ✓ Refresh got slower with every session (now looked up by hash)
- A due-date reminder that fails to send is never retried: the comment in `core/notifications.py` says the next
  hourly tick retries it, but the job only processes a setting when the local hour equals `notify_hour`.
- `frontend/package.json` lists `@anthropic-ai/claude-code` under `dependencies`, so every `npm install`,
  production included, downloads it. Remove it (or move it to `devDependencies`).
- ✓ `make deploy` didn't install new dependencies
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