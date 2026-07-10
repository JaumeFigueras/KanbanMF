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
- **Lists & Cards**: Boards are organized into lists, each holding any number of cards. Both lists and cards can be
  reordered by drag and drop, and cards can be dragged between lists. A card can have a description, start/due/end
  dates, checklists, labels, members and assignees, and its own custom color — again, per viewing user. Changes
  make it to every other open session in real time over a WebSocket connection.
- **Due-date e-mail notifications**: Notifications are personal, per user and per board — each person with access
  to a board decides independently whether they want e-mail reminders for cards they're assigned to, and configures
  their own notification hour and which days (before/after/on the due date, plus an optional daily repeat while
  overdue) trigger a reminder. Enabling notifications for yourself never opts anyone else in.
- **Labels**: Labels are defined per board and can be attached to any card to categorize it.

## Tech stack

- **Backend**: Python, FastAPI, SQLAlchemy 2.0 (async ORM), PostgreSQL, Alembic for schema migrations,
  APScheduler for the hourly due-date notification job, WebSockets for real-time updates.
- **Frontend**: React 19, TypeScript, Vite, Material UI (MUI), react-i18next for translations, dnd-kit for
  drag-and-drop.
- **Auth**: JWT access tokens (short-lived) + rotating refresh tokens (30 days, stored hashed, sent as an
  HTTP-only cookie), supporting both local email/password and Google OAuth.

## Getting started (local development)

These are the quick steps to run the app locally against your own PostgreSQL instance. For a full
production-style deployment (systemd, nginx, a dedicated PostgreSQL cluster, etc.), see [SETUP.md](SETUP.md).

### Prerequisites

- Python 3.11+
- Node.js 20+ and npm
- A PostgreSQL database you can connect to (see `SETUP.md` for creating a dedicated cluster)

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
# From backend/, with the venv active
python3 -m pytest -x -v --cov-report=html:./test/coverage_reports --cov=./src ./test -s -vv
```

## Database migrations

Schema changes are managed with [Alembic](https://alembic.sqlalchemy.org/). Run these from `backend/`, with the
virtualenv active. `alembic/env.py` reads the connection string from `.env` (via `src/core/config.py`), so there's
nothing to configure beyond having a working `.env`.

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
            src/core (auth, email, websockets, the notification scheduler), alembic/ (migrations), test/
frontend/   React app — src/pages, src/components, src/api (fetch client + WebSocket), src/i18n
SETUP.md    Production deployment guide
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
