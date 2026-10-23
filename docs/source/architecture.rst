How KanbanMF is built
=====================

This page is the big picture for people who run or develop KanbanMF. The
details are in :doc:`setup/index`, :doc:`backend/index` and
:doc:`frontend/index`.

.. graphviz::
   :caption: The pieces of a deployment, and what talks to what.
   :alt: The browser talks to Apache, which serves the built frontend and
         proxies /api to the FastAPI backend; the backend uses PostgreSQL,
         an SMTP server and Google.

   digraph stack {
     rankdir=LR;
     node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", color="#1976D2"];
     edge [color="#555555"];

     browser [label="Browser\nReact app", fillcolor="#FFF3E0", color="#F57C00"];
     apache  [label="Apache\nTLS, one origin"];
     dist    [label="frontend/dist\nstatic files", shape=folder];
     api     [label="FastAPI backend\n+ scheduler + WebSockets"];
     db      [label="PostgreSQL", shape=cylinder];
     smtp    [label="SMTP server", fillcolor="#F5F5F5", color="#9E9E9E"];
     google  [label="Google OAuth", fillcolor="#F5F5F5", color="#9E9E9E"];

     browser -> apache [label="HTTPS + WSS"];
     apache -> dist [label="/"];
     apache -> api [label="/api"];
     api -> db;
     api -> smtp [style=dashed, label="optional"];
     api -> google [style=dashed, label="optional"];
   }

Backend
   Python, FastAPI, SQLAlchemy 2.0 in async mode on PostgreSQL, Alembic for
   migrations, APScheduler for the scheduled jobs, and WebSockets for
   real-time updates. See :doc:`backend/stack`.

Frontend
   A single-page application in React 19 and TypeScript, built with Vite:
   Material UI for the interface, react-router for navigation,
   react-i18next for English and Catalan, dnd-kit for drag and drop and
   dayjs for dates. See :doc:`frontend/stack`.

Deployment
   Apache serves the built frontend as static files and proxies everything
   under ``/api`` — WebSockets included — to the backend, so the browser
   only ever sees one origin. The backend runs as one systemd service and
   the database in its own PostgreSQL cluster. See :doc:`setup/production`.

How the two halves talk
-----------------------

Every read and every change is a REST call under ``/api/v1``. On top of
that, each browser tab keeps a WebSocket open; after a change, the backend
uses it to tell everyone else looking at the same board *what* changed —
never the new data — and their tabs fetch it again over REST.

Why a single process
--------------------

There is no separate worker or cron job: the hourly reminders, the clean-up
of expired invitations and the nightly time tracker job run on a scheduler
inside the API process. That, and the in-memory list of open WebSockets, is
why the backend runs as exactly one process.
