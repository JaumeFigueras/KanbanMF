# KanbanMF

Simple Kanban application (Minimalist and Fast)

This kanban system is intended to cover small necessities of a single person or a small group. It has the basic
abilities to manage small and medium projects. The functionality that has been implemented is:

- **Users**: The system only asks for a valid email and a display name. Users can sign up/sign in with a local
  email + password (with e-mail verification) or with Google. Each user can change their display name and initials,
  upload an avatar (max 100 KBytes), set the language (English and Catalan at this moment), the locale used to
  display dates and numbers, and the timezone used to schedule e-mail notifications at the right local hour. Users
  can also choose between a light or dark theme.
- **Boards**: Boards can be starred, archived, deleted and shared with other users. There can be an infinite number
  of boards. Boards can be personalized with a custom color, chosen independently by each user who has access to
  them (the owner's color choice doesn't affect what a shared user sees, and vice versa).
- **Invitations**: A board can also be shared with someone who doesn't have an account yet. The owner enters their
  e-mail address in the share dialog and picks the language of the invitation (English or Catalan); the invitee
  gets a sign-up link, and the board is shared with them automatically once they verify that address (or sign in
  with Google using it) — no further action from anyone. If the address already belongs to a user, the dialog says
  so and offers to share with them directly. The share dialog lists current shares and pending invitations, which
  can be cancelled and expire after 30 days. Inviting needs outgoing e-mail configured, and templates can only be
  shared with existing users.
- **Lists & Cards**: Boards are organized into lists, each holding any number of cards. Both lists and cards can be
  reordered by drag and drop, and cards can be dragged between lists. A card can have a description, start/due/end
  dates, checklists, labels, members and assignees, and its own custom color — again, per viewing user. Cards can
  be copied to any list of any board, a checklist can be copied to another card, a checklist item can be extracted
  into a card of its own, and every card of a list can be archived at once. Changes make it to every other open
  session in real time over a WebSocket connection.
- **Due-date e-mail notifications**: Notifications are personal, per user and per board — each person with access
  to a board decides independently whether they want e-mail reminders for cards they're assigned to, and configures
  their own notification hour, which days (before/after/on the due date, plus an optional daily repeat while
  overdue) trigger a reminder, and which weekdays e-mails may be sent on (e.g. none at weekends). Enabling notifications for yourself never opts anyone else in.
- **Labels**: Labels are defined per board and can be attached to any card to categorize it.
- **Search**: A search box in the top bar finds cards by their name, description, checklists and labels,
  ignoring case and accents — across every board from the boards page, or within the open board. The board's
  archive and the archived boards have searches of their own. Results open on a page laid out like the overdue
  tasks page, and boards whose name matches are listed too.
- **Overdue tasks**: A single page, reached from the boards page, gathers every overdue card (past its due date
  and with no end date) from every board the user can see, grouped by board and list.
- **Time tracker**: A private log of the time each user spends on cards, reached from the timer icon in the top
  bar. Start and end a task with one click (only one runs at a time, and a task started within five minutes of
  the previous one ending picks up exactly where it ended), or add and edit entries by hand, each with an optional
  comment. Entries keep a copy of the board name, card name and labels, so renaming, archiving or deleting the
  card doesn't change past records. Entries can be filtered by year and month, show per-day and period totals,
  warn about overlaps, and can be exported to CSV. Boards and lists are offered most-used first.
- **Claude (MCP server)**: Claude, Anthropic's AI assistant, can connect to KanbanMF over the Model Context
  Protocol (`/mcp`, Streamable HTTP) — from claude.ai, the desktop and mobile apps, or Claude Code. Signing in uses
  OAuth 2.1 with a consent page where the user picks which of *their own* boards it may reach and whether it is
  read-only; boards shared with them are never offered. Connections can be changed or revoked from **Connected
  apps** in the user menu. Claude can list boards, read a board or a card, search cards and list overdue ones, and —
  unless the connection is read-only — create, edit, move, archive and restore cards, add lists and add or tick
  checklist items. Nothing can be deleted through it, and every change reaches open tabs live.
- **Templates**: A template is a special board that holds only lists (no cards or labels). Creating a new board
  from a template copies its lists, in order, together with the board and list colors *you* chose on the
  template — other users keep their own colors. Templates live in their own section of the boards page, and can
  be edited like a board, shared (with existing users), duplicated, archived and deleted.

## Tech stack

- **Backend**: Python, FastAPI, SQLAlchemy 2.0 (async ORM), PostgreSQL, Alembic for schema migrations,
  APScheduler (running inside the API process) for the hourly due-date reminders and invitation cleanup and the
  nightly time tracker ranking, WebSockets for real-time updates, and the official MCP Python SDK for the MCP
  server at `/mcp`, behind its own OAuth 2.1 authorization server (PKCE, Dynamic Client Registration and Client ID
  Metadata Documents, rotating refresh tokens).
- **Frontend**: React 19, TypeScript, Vite, Material UI (MUI), react-i18next for translations, dnd-kit for
  drag-and-drop.
- **Auth**: JWT access tokens (short-lived) + rotating refresh tokens (30 days, stored hashed, sent as an
  HTTP-only cookie), supporting both local email/password and Google OAuth.

## Getting started (local development)

These are the quick steps to run the app locally against your own PostgreSQL instance. For a full
production-style deployment (systemd, Apache, a dedicated PostgreSQL cluster, etc.), see [SETUP.md](SETUP.md).

### Prerequisites

- Python 3.11+
- Node.js 20+ and npm
- A PostgreSQL database you can connect to (see `SETUP.md` for creating a dedicated cluster), version 13 or
  newer, with the database owned by the user in `DATABASE_URL`. The search needs PostgreSQL's `unaccent`
  extension, which ships with PostgreSQL; `alembic upgrade head` creates it, which the database owner may do
  since version 13. Otherwise, create it once as the `postgres` user:
  `psql -p <port> -d <database> -c "CREATE EXTENSION IF NOT EXISTS unaccent;"`

### Backend

```bash
# From the repo root — the virtualenv lives here, not inside backend/
python3 -m venv .venv
source .venv/bin/activate
pip3 install -r backend/requirements.txt

cd backend
cp .env.example .env
# Edit .env: at minimum set DATABASE_URL to your PostgreSQL instance and
# generate a real SECRET_KEY (openssl rand -hex 32). Google OAuth and SMTP
# are optional — leave them blank to disable Google sign-in / e-mail sending.

# Create the schema
alembic upgrade head

# Run the dev server (auto-reloads on code changes)
uvicorn src.main:app --reload
```

The API is now served at `http://localhost:8000` (interactive docs at `http://localhost:8000/docs`).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is now served at `http://localhost:5173`.

## Running tests

```bash
# From the repo root
make test                          # the whole suite
make test TEST_ARGS="-x -k oauth"  # extra pytest arguments
make test-cov                      # with coverage: HTML report in backend/test/coverage-reports/ (gitignored)
```

## Database migrations

Schema changes are managed with [Alembic](https://alembic.sqlalchemy.org/). Run these from `backend/`, with the
virtualenv active. `alembic/env.py` reads the connection string from `backend/.env` (via `src/core/config.py`), so there's
nothing to configure beyond having a working `backend/.env`.

```bash
# After changing a model in src/model/, generate a migration from the diff
alembic revision --autogenerate -m "add whatever column"

# Autogenerate is a diffing tool, not magic — it can miss things like column
# renames (sees them as a drop + add, which loses data) or data migrations.
# Always open the generated file in alembic/versions/ and check it before applying.

# Apply every pending migration up to the latest
alembic upgrade head

# Check which revision the database is currently on
alembic current

# Roll back the most recent migration
alembic downgrade -1
```

New environments (a fresh clone, a staging/production server) just need `alembic upgrade head` run once — it
replays every migration from scratch and ends up in the same state as any other environment that's run the same
migrations.

## Project structure

```
backend/    FastAPI app — src/model (SQLAlchemy ORM), src/api/v1 (routes), src/schemas (Pydantic),
            src/core (auth, OAuth, board operations, email, websockets, the scheduler), src/api/mcp_server (the MCP
            server and its tools), alembic/ (migrations), test/
frontend/   React app — src/pages, src/components, src/api (fetch client + WebSocket), src/i18n
deploy/     Apache vhost (incl. /mcp and the OAuth discovery paths) + systemd unit, as described in SETUP.md
docs/       Sphinx documentation (build with `make docs`)
SETUP.md    Production deployment guide
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
