Stack and how it works
======================

.. todo::

   **The narrative half of the backend documentation** — the part that autodoc
   cannot produce. Planned contents:

   - The stack and why each piece is there: FastAPI, SQLAlchemy 2.0 in async
     mode, PostgreSQL, Alembic, APScheduler, WebSockets.
   - The layer cake: ``model`` → ``schemas`` → ``api`` → ``core``, and what is
     allowed to import what.
   - Request lifecycle: routing under ``/api/v1``, the shared dependencies
     (``get_db``, ``get_current_user``, ``get_client_id``), and how errors are
     returned.
   - Authentication: short-lived JWT access tokens plus 30-day refresh tokens,
     rotation on every use, why only a bcrypt hash of the refresh token is
     stored, the HTTP-only cookie, and multiple concurrent sessions per user.
     The two providers, local and Google, and how one person maps to one
     ``User`` with several ``UserIdentity`` rows.
   - The data model as a picture, not a class list: boards → lists → cards →
     checklists, the association tables, the per-user personalization tables
     that keep one user's colours and ordering out of another's way, and the
     time entries that deliberately reference nothing but their owner.
   - Real-time updates: the in-memory ``ConnectionManager``, the
     notify-and-refetch contract (the server says *what changed*, never the new
     data), and ``origin_client_id`` letting the originating tab ignore its own
     change. Note the single-process assumption this carries.
   - Due-date reminders: per-user/per-board opt-in, day offsets, the overdue
     repeat and the allowed weekdays, and the dedupe record that stops a
     reminder being sent twice.
   - The scheduler: APScheduler inside the FastAPI process rather than a
     separate cron job, and its jobs — the reminders (every hour, on the
     hour), expired invitation cleanup (every hour, at half past) and the
     time tracker ranking rebuild (02:00, plus once at startup when empty).
   - Templates: a board flag, what creating a board from one copies, and why
     templates can't be shared by invitation.
   - Invitations: the pending share, its token and 30-day expiry, and the
     point at which it becomes a ``BoardShare`` (local verification or Google
     sign-in).
   - The time tracker: entries that copy the board/card names and labels
     instead of referencing them, the one-running-entry partial unique index,
     the five-minute start snap, and the usage ranking as derived data.
   - Configuration and settings loading.

   A diagram or two would earn their place here — the layer cake and the
   notify-and-refetch round trip.
