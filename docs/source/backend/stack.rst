Stack and how it works
======================

This page explains how the backend fits together and why it is built the way
it is. For what each module contains, see :doc:`code/index`.

The stack
---------

FastAPI
   The web framework: routing, request validation through Pydantic, the
   dependency-injection used for the database session and the current user,
   WebSockets, and the interactive API docs at ``/docs``.

SQLAlchemy 2.0, async
   The ORM, used in async mode with the psycopg 3 driver, so a request
   waiting on the database doesn't hold up the others. One engine, created in
   :mod:`src.core.database`; every request and every scheduled job opens its
   own session from it.

PostgreSQL
   The only data store. Avatars are stored in it too, as ``BYTEA``, so a
   database dump is a complete backup. Some features rely on PostgreSQL
   specifically: UUID and array columns, ``INSERT … ON CONFLICT`` and a
   partial unique index.

Alembic
   Schema migrations. ``alembic/env.py`` takes the database URL from the
   application's settings and imports ``src.model``, so a migration always
   sees every model.

APScheduler
   Runs the scheduled jobs *inside* the API process (see
   :ref:`backend-scheduler`).

Pydantic settings
   :mod:`src.core.config` reads every setting from the environment, falling
   back to ``backend/.env``.

The layers
----------

.. graphviz::
   :caption: Who imports whom. Routes sit on top; models at the bottom import
             nothing of the application's.
   :alt: main imports the API routers, which use schemas, core services and
         models; schemas and core use models.

   digraph layers {
     rankdir=TB;
     node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", color="#1976D2"];
     edge [color="#555555"];
     main    [label="src.main\napp, CORS, lifespan"];
     api     [label="src.api\nrouters + deps"];
     schemas [label="src.schemas\nPydantic bodies"];
     core    [label="src.core\nsettings, DB, security, e-mail,\nscheduler, WebSockets"];
     model   [label="src.model\nSQLAlchemy models", fillcolor="#FFF3E0", color="#F57C00"];
     main -> api;
     main -> core [label="scheduler"];
     api -> schemas;
     api -> core;
     api -> model;
     schemas -> model [style=dashed, label="from_attributes"];
     core -> model;
   }

:mod:`src.model`
   The tables. Every model inherits from ``Base``, and
   ``src/model/__init__.py`` imports them all, so ``Base.metadata`` is the
   complete schema.

:mod:`src.schemas`
   What goes over the wire: one module per resource, usually with a
   ``…Create``, an ``…Update`` (every field optional, for ``PATCH``) and a
   ``…Read`` built from the ORM object. Validation lives here — blank names,
   colour formats, a start date after an end date — so routes receive
   clean data.

:mod:`src.api`
   The routes. They check access, do the work in the database, and notify
   (see below). Shared dependencies are in :mod:`src.api.deps`. The work on
   cards, lists and checklists, and the search and overdue queries, live in
   :mod:`src.core` instead, so the routes are thin wrappers around them and
   anything else that changes a board goes through the same checks and
   notifications.

:mod:`src.core`
   Everything that isn't a route: settings, the engine, password hashing and
   tokens, e-mail, the WebSocket registry and notifications, the scheduled
   jobs, the access checks (:mod:`src.core.access`) and the board operations
   the routes call.

Handling a request
------------------

Everything is under ``/api/v1``. :mod:`src.api.v1.router` nests the routers
the way the data is nested — lists under a board, cards under a list,
checklists under a card — so a URL like
``/boards/{board_id}/lists/{list_id}/cards/{card_id}`` names the whole path.
A route loads the board first and checks that the caller owns it or that it
is shared with them; each nested id is then checked to belong to its parent,
so ids from another board are refused.

Every route takes its context through FastAPI dependencies:

``get_db``
   A session for the request, closed afterwards.

``get_current_user``
   Decodes the ``Authorization: Bearer`` access token and loads the user,
   or answers ``401``.

``get_client_id``
   The ``X-Client-Id`` header, a random id each browser tab keeps for
   itself, used to tag WebSocket notifications (see below).

Errors are plain ``HTTPException``\s: ``401`` for a missing or expired token,
``403`` when the user can see the board but may not do this (for example a
shared user managing labels), ``404`` when it doesn't exist or they can't see
it, ``400``/``409``/``422`` for invalid requests.

Authentication
--------------

A person is one ``User``, identified by their e-mail address. How they sign
in is a ``UserIdentity``: a ``local`` one with a bcrypt password hash, a
``google`` one with Google's tokens, or both — signing in with Google with the
address of an existing local account adds a Google identity to the same user.

Signing in, by either route, opens a ``UserSession`` and returns two tokens:

Access token
   A JWT signed with ``SECRET_KEY``, valid for 15 minutes. The frontend sends
   it as ``Authorization: Bearer`` on every request, and as a query parameter
   when it opens the WebSocket (browsers can't set headers on one). Being
   short-lived, a leaked one isn't useful for long.

Refresh token
   A random string valid for 30 days, sent only as an ``HTTP-only``,
   ``Secure``, ``SameSite=Lax`` cookie, so page scripts can't read it. The
   database stores only its bcrypt hash. ``POST /auth/local/refresh`` trades
   it for a new access token **and a new refresh token**: the old session is
   deleted, so each refresh token works once, and a stolen one stops working
   as soon as either party uses it.

Each browser or device has its own session; signing out deletes only that
one. Local accounts can't sign in until their address is verified;
:mod:`src.core.invitations` turns pending invitations into shares at that
moment, and on every Google sign-in, since Google has verified the address.

Google sign-in is the standard OAuth authorization-code flow, bound to the
browser that starts it by the ``state`` parameter. ``/auth/google/`` sends
Google a random state and keeps a copy in a ten-minute ``HTTP-only`` cookie,
scoped to ``/api/v1/auth/google``. The callback refuses, with ``400`` and
before contacting Google, any request whose ``state`` doesn't match that
cookie, then deletes it. Without the check, a link carrying an attacker's own
authorization code would sign whoever clicked it in to the attacker's account
(login CSRF).

The data model
--------------

.. graphviz::
   :caption: The main tables. Per-user personalisation, notification and
             time tracker tables hang off the same entities.
   :alt: Users own boards; boards contain lists, which contain cards, which
         contain checklists of items; labels belong to boards; shares,
         members and assignees link users to boards and cards.

   digraph model {
     rankdir=LR;
     node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", color="#1976D2"];
     edge [color="#555555", fontsize=9];
     User      [fillcolor="#FFF3E0", color="#F57C00"];
     Board; BoardList; Card; Checklist; ChecklistItem; Label;
     BoardShare [fillcolor="#F5F5F5", color="#9E9E9E"];
     BoardInvitation [fillcolor="#F5F5F5", color="#9E9E9E"];
     TimeEntry [fillcolor="#E8F5E9", color="#388E3C"];

     User -> Board [label="owns"];
     Board -> BoardList -> Card -> Checklist -> ChecklistItem;
     Board -> Label;
     Card -> Label [label="CardLabel", style=dashed];
     Card -> User [label="CardMember /\nCardAssignee", style=dashed];
     BoardShare -> Board; BoardShare -> User;
     BoardInvitation -> Board;
     TimeEntry -> User [label="only FK"];
   }

Users
   ``User``, ``UserIdentity`` and ``UserSession`` (above), ``UserAvatar``
   (the image, at most 100 KB, enforced by a database ``CHECK``) and
   ``UserPreferences`` (language, date and number format, time zone,
   initials).

Boards, lists, cards
   A ``Board`` belongs to its owner and is shared through ``BoardShare``
   rows. A template is a board with ``is_template`` set: it holds lists only,
   and the routes refuse cards, labels, stars and notification settings on
   it. Boards, lists and cards are *archived* and *deleted* with flags, not
   removed: archived ones can be restored, deleted ones are hidden for good.
   ``CardMember``, ``CardAssignee`` and ``CardLabel`` are plain association
   tables.

   No live card holds someone without access to its board. Removing a share
   runs :mod:`src.core.card_replacement` in the same transaction: each live
   card the person is a member or assignee of is archived untouched, as
   history, and a copy without them — the owner in their place, everyone's
   colours and the card's position copied — takes its place. The archived
   original's ``replaced_by_id`` points to the copy, and the restore route
   refuses such a card for good (``409``, code ``card_replaced``). An
   archived card holding someone who has left is refused too (code
   ``former_people``) until they are back, but can be copied, since the copy
   route only keeps people on the target board. Restoring an archived list
   replaces its cards the same way, with whoever restores it in the
   leavers' place.

Per-user personalisation
   Colours (``UIBoardColor``, ``UIListColor``, ``UICardColor``) and the order
   of the boards page (``UIBoardOrder``) are stored per user, so the owner's
   choices and a shared user's never interfere. The order of a board's lists
   (``UIBoardListOrder``) and of a list's cards (``UIListCardOrder``) is per
   board: everyone on the board shares it. Orders are stored as arrays of
   ids rather than a position column, so a reorder is a single write.

Notifications
   ``BoardNotificationSettings`` (per user and board: on or off, hour,
   weekday bitmask, overdue repeat) with its ``BoardNotificationOffset``
   rows (the reminder days), and ``CardDueNotification``, the log that stops
   a card's reminder from being sent twice on the same day.

Invitations
   ``BoardInvitation``: a share waiting for an account with that e-mail
   address, with a random token for the sign-up link and a 30-day expiry.

Time tracking
   ``TimeEntry`` **copies** the board name, card name and labels (as JSONB)
   instead of referencing them, so a record of past work survives the card
   being renamed, archived or deleted. Its only foreign key is its owner; the
   board, list and card ids it also keeps are plain values, for statistics.
   A partial unique index on ``(user_id) WHERE ended_at IS NULL`` makes
   "one running task per user" a database rule.
   ``TimeTrackerBoardUsage`` and ``TimeTrackerListUsage`` hold the
   most-used ranking, derived data rebuilt every night.

The SQL files in ``src/model/sql/`` mirror these models for the test
database; see :doc:`../setup/workflow`.

Searching
---------

:mod:`src.core.search` (called by :mod:`src.api.v1.search`) answers every
search with one query: each word of
the search must match one of the card's name, description, checklist names,
checklist items or label names, compared as
``unaccent(column) ILIKE unaccent('%word%')`` with ``%`` and ``_`` escaped.
``unaccent`` is a PostgreSQL extension that ships with the server; a
migration creates it (a *trusted* extension since PostgreSQL 13, so the
database owner may), and ``test/database_init.sql`` does the same for the
test databases. Nothing is indexed: a ``%word%`` pattern can't use a B-tree
index, so PostgreSQL reads the cards of the boards the user can see. That's
fine at this scale; ``pg_trgm`` would provide the right index if it ever
isn't.

The same route serves four scopes — every live board, one board, one
board's archive, the user's archived boards — chosen by ``board_id`` and
``archived``, and returns the overdue page's shape (grouped by
``group_cards_by_board`` in :mod:`src.core.card_groups`, which both use), plus
which fields matched per card, the boards whose name matches, and whether
the 200-card limit cut anything off.

Real-time updates
-----------------

When someone changes a board, everyone else looking at it sees the change
without reloading. The backend doesn't push the new data: it pushes a short
message saying **what changed**, and each client fetches the data again over
REST — *notify and refetch*.

.. graphviz::
   :caption: A card moved in one tab, seen in another.
   :alt: Tab A sends a PATCH; the API writes to the database and sends a
         notification over the WebSocket to every tab of every user on the
         board; tab A ignores its own, tab B refetches the list's cards.

   digraph notify {
     rankdir=LR;
     node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", color="#1976D2"];
     edge [color="#555555"];
     a   [label="Tab A\n(X-Client-Id: a)", fillcolor="#FFF3E0", color="#F57C00"];
     api [label="API"];
     db  [label="PostgreSQL", shape=cylinder];
     b   [label="Tab B\n(another user)", fillcolor="#FFF3E0", color="#F57C00"];
     a -> api [label="1. PATCH card"];
     api -> db [label="2. commit"];
     api -> a [label="3. card_moved\norigin=a → ignored", style=dashed];
     api -> b [label="3. card_moved\nboard, list", style=dashed];
     b -> api [label="4. GET the list's cards"];
   }

The pieces:

:mod:`src.core.ws_manager`
   ``ConnectionManager`` keeps, per user, the set of WebSockets they have
   open — one per tab or device. The client connects to ``/api/v1/ws`` with
   its access token; the server sends, never receives.

:mod:`src.core.ws_notify`
   ``board_notification()`` builds the message: an event type such as
   ``card_moved`` or ``list_renamed``, the board, the list for card events
   (so a client refetches one list, not the whole board), and
   ``origin_client_id``. ``board_recipients()`` is the owner plus everyone
   the board is shared with.

The routes
   After committing a change, a route sends the notification to every
   recipient. The tab that made the change receives it too, recognises its
   own ``X-Client-Id`` in ``origin_client_id`` and ignores it — it already
   shows the change.

Sending only *what* changed keeps the protocol tiny and keeps the server from
deciding what each client should see: per-user colours and orders, and access
checks, all apply as usual when the client refetches. Time entries are
private, so their routes send nothing.

.. important::

   ``ConnectionManager`` lives in memory, in one process. With several
   backend processes a user's sockets would be spread across them, and a
   change handled by one process would never reach sockets held by another.
   This, and the scheduler below, is why the backend runs as **exactly one
   process** — no ``--workers``.

.. _backend-scheduler:

Scheduled jobs
--------------

APScheduler's ``AsyncIOScheduler`` runs in the API's event loop, started and
stopped by the FastAPI lifespan in :mod:`src.main`. There is nothing else to
deploy — no cron job, no worker — and the jobs share the application's code
and settings. Each opens its own database session.

.. list-table::
   :header-rows: 1
   :widths: 30 25 45

   * - Job
     - When
     - What
   * - Due-date reminders (:mod:`src.core.notifications`)
     - every hour, on the hour
     - For every enabled setting whose hour it is in its owner's time zone,
       on an allowed weekday: e-mail them about the live cards (not
       archived, nor on an archived or deleted list or an archived board)
       of a board they can open that they are an
       assignee of, with no end date, whose due date matches a reminder day
       or the overdue repeat. ``CardDueNotification`` makes it safe to run
       twice: at most one e-mail per card, recipient and day. A send that
       fails is logged and leaves no record, but isn't retried: the next
       run is past the user's hour.
   * - Expired invitations (:mod:`src.core.invitations`)
     - every hour, at half past
     - Delete invitations past their 30 days.
   * - Time tracker ranking (:mod:`src.core.time_tracker_ranking`)
     - 02:00 server time, and once at startup if empty
     - Empty and refill the usage tables from each user's last 90 days of
       time entries.

With several processes, each would run every job — the same reminders sent
once per process. That's the other reason for a single process.

E-mail
------

:mod:`src.core.email` sends three kinds of message — account verification,
due-date reminders and board invitations — each in English or Catalan. SMTP
is optional: with no ``SMTP_HOST``, ``email_enabled()`` is false,
``GET /api/v1/config`` tells the frontend, and the share dialog stops offering
invitations. ``EMAIL_SENDER`` can set the ``From`` header independently of
the SMTP account, to keep SPF and DKIM aligned.

Configuration
-------------

Every setting is an attribute of ``Settings`` in :mod:`src.core.config`,
filled from environment variables or ``backend/.env`` — the environment wins.
``DATABASE_URL``, ``SECRET_KEY`` and ``SMTP_PORT`` are required; everything
else has a default, and Google sign-in and e-mail are off while their
settings are blank. ``backend/.env.example`` lists them all, and
:doc:`../setup/production` says which ones must change for a real
deployment.
