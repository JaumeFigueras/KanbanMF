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
- Search
- User manual
  - Explain how colours work for boards, lists and cards: per user, what each one tints, list colour inherited
    by new cards, board/list colours copied from a template, reset to default

## Functionality

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

## Bugs

- ✓ Upload avatar does not change the initials on the board page
- ✓ When changed to light theme the colors of the list and cards are not kept
- ✓ When copying a card the Title is not used as starting point 
- Removing a user from a shared board leaves them as member/assignee of its cards, and the hourly reminder job
  doesn't check access, so they keep getting due-date e-mails about a board they can no longer open. Skip
  recipients who are neither owner nor shared in `core/notifications.py`, and/or drop them from the board's
  cards when the share is deleted.
- Google sign-in sends no OAuth `state` parameter (`api/v1/auth/google.py`), so it's open to login CSRF: a victim
  can be signed in to an attacker's account. Generate a random state, keep it in a short-lived cookie, and check
  it in the callback.
- `/auth/local/refresh` runs bcrypt against every active session of every user to find the matching one, so each
  refresh gets slower as sessions accumulate. Store a lookup key (e.g. a session id in the cookie, or a SHA-256 of
  the token) and bcrypt-check only that row.
- A due-date reminder that fails to send is never retried: the comment in `core/notifications.py` says the next
  hourly tick retries it, but the job only processes a setting when the local hour equals `notify_hour`.
- `frontend/package.json` lists `@anthropic-ai/claude-code` under `dependencies`, so every `npm install`,
  production included, downloads it. Remove it (or move it to `devDependencies`).
- `make deploy` doesn't run `pip install -r backend/requirements.txt` or `npm install`, so an update that adds a
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