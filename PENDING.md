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
- Add tags in the time tracker start/add entry dropdown
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

- ✓ 0. Set-up: Vitest in `vite.config.ts`, `src/test/` (setup, MSW server, `renderWithProviders`), `npm test`,
  `make test-frontend`, coverage to `frontend/coverage-reports/` (gitignored); first test: en/ca translation keys match
- ✓ 1. `src/utils/` (pure functions): all 13 modules at 100 %; fixed on the way: unreadable white text on
  due-date chips and mid-tone labels (one rule now, `contrast.ts`), and emoji passwords that passed the form's
  8-character check but not the backend's
- ✓ 2. `src/api/` (`apiFetch` refresh-and-retry, `ws.ts`): all 3 modules at 100 %; fixed on the way: a duplicated tab
  shared the other's client id (now one per page load, in memory), a config fetch that failed with an error status
  was kept until a reload, and a late close event after a quick sign-out and sign-in left two sockets open
- ✓ 3. `src/context/` and the route guards: both contexts, `ProtectedRoute`, `PublicRoute` and `App.tsx` (route
  table, `/` redirect) at 100 %; fixed on the way: signing out remembered the page you were on, so the next sign-in
  on that tab, perhaps someone else's, went back to it (now `AuthContext` has a `loggedOut` flag)
- ✓ 4. Small dialogs, one file each: 32 dialogs and widgets (`CardPicker`, `ColorPicker`, `LabelChips` and
  `PersonAvatar` among them), every line covered except the label and checklist-item drag handlers (phase 7); fixed
  on the way: a double Enter sent the name forms twice; a failed or slow load looked like empty data, so the next
  save overwrote the real data (a card's labels, e-mail notification settings) or the dialog said there was nothing
  (template preview, the time tracker's card picker, the share dialog's people, invitations and card count); initials
  with accents were refused; label errors were shown raw; keyboard and screen-reader gaps (unlabelled fields and
  selects, the share dialog's avatars not buttons); a label was deleted with one click, no confirmation; a checklist
  item typed but not added was lost on Save; "Copy of …" could cut an emoji in half; a pasted colour code was cut
  short; the checklist copy and the card picker kept a card from the previous board; the notification day fields
  sent numbers the server refuses; Enter in the invitation address did nothing; the manual said dates are shown in
  your time zone (they're in the device's); noted only: the colour and name dialogs can be closed while a save runs,
  and a failed save then goes unreported; the copy dialogs remember the last target list instead of the card's own;
  in the share dialog a slow earlier search can overwrite a newer one, and in the card picker two board changes
  within one round trip can let the older answer win; the e-mail notification dialog sends overlapping saves on
  quick clicks (a late one could win), and a failed save leaves the unsaved choice on screen; in the connected apps
  dialog, the other apps' buttons stay usable while one saves; for slower machines, each test now gets 15 s
  (`testTimeout`) and each `waitFor`/`findBy…` 10 s (`asyncUtilTimeout` in `src/test/setup.ts`)
- 5. Card pieces (`CardFace`, `CardItem`, `CardDialog`, and `CardDateField`, moved from phase 4); plan of 2026-11-15
  in PROMPTS.md; found in phase 4:
  `CardDialog` has the H problem — if loading the board's people fails or is slow, the members and assignees pickers
  say "No users available yet." and Save takes everyone off the card; fix it the same way; its avatars, now buttons,
  are named by the person, not by what a click does (`PersonAvatar`'s `actionLabel`)
- 6. Pages (`SignIn`, `SignUp`, `VerifyEmail`, `OAuthConsent`, `Boards`, `Board`, `OverdueTasks`, `SearchResults`,
  `TimeTracker`), with the components moved from phase 4: `BoardCard`, `ArchivedBoardCard`, `BoardListColumn`,
  `CardListColumn`, `ArchivedListsView`, `MainAppBar`, `AuthControls`, `GoogleButton`, `LanguageSelector`; found in
  phase 4: `SignIn` and `SignUp` name their show-password buttons in English only ("toggle password visibility"),
  switch them to `common.showPassword`/`common.hidePassword`; found in phase 1: `Board` takes the sort mode from
  `localStorage` unchecked, `SignUp` reads any 422 as an expired invitation; found in phase 3: a browser that blocks
  site data gets a blank page (`ThemeToggleProvider`, `returnTo`, `Board` and `Boards` read storage without a `try`),
  and signing out without a connection only signs out the page — the refresh cookie stays valid, so a reload signs
  back in, and `logout()` rejects, so `MainAppBar` never reaches `/signin`; warn the user there
- 7. End-to-end with Playwright against the dev servers (drag and drop, two-tab real time, OAuth consent),
  including reordering labels and checklist items (the drag handlers phase 4 left out); found in phase 4: none of
  the five drag areas (boards, lists and cards, checklist items, labels, a card's checklists) works from the
  keyboard — their handles can be focused but not moved
- 8. Docs (`setup/workflow.rst`, CLAUDE.md); `frontend/code/utils.rst` lacks `labelList.ts` and `password.ts`

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
- The notification day fields accept up to 32767 days, the `SmallInteger` they're stored in, but nothing checks
  it: a bigger number gets a 500 and "Something went wrong". Add the limit to the backend schema
  (`BoardNotificationSettingsUpdate`) and the same one to the form (found in phase 4 of the frontend tests).
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
- Save the display name and the initials together: `ChangeDisplayNameDialog` sends two requests (`PUT /users/me`
  and `PUT /users/me/preferences`), so when one fails half the change is kept, the dialog says it failed, and the
  page shows the old values until a reload. Needs one backend endpoint that saves both (found in phase 4 of the
  frontend tests)
- Copy a checklist in one request: `CopyChecklistDialog` creates the checklist, then each item, so when one item
  fails the target card keeps a partial copy, and a retry makes a second one (found in phase 4 of the frontend
  tests)
