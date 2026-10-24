How KanbanMF is built
=====================

This page is the big picture for people who run or develop KanbanMF. The
details are in :doc:`setup/index`, :doc:`backend/index` and
:doc:`frontend/index`.

.. graphviz::
   :caption: The pieces of a deployment, and what talks to what.
   :alt: The browser and Claude talk to Apache, which serves the built
         frontend and proxies /api, /mcp and the OAuth discovery documents to
         the FastAPI backend; the backend uses PostgreSQL, an SMTP server,
         Google, and fetches Claude Code's client document from claude.ai.

   digraph stack {
     rankdir=LR;
     node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", color="#1976D2"];
     edge [color="#555555"];

     browser [label="Browser\nReact app", fillcolor="#FFF3E0", color="#F57C00"];
     claude  [label="Claude\nMCP client", fillcolor="#FFF3E0", color="#F57C00"];
     apache  [label="Apache\nTLS, one origin"];
     dist    [label="frontend/dist\nstatic files", shape=folder];
     api     [label="FastAPI backend\n+ scheduler + WebSockets\n+ MCP server + OAuth"];
     db      [label="PostgreSQL", shape=cylinder];
     smtp    [label="SMTP server", fillcolor="#F5F5F5", color="#9E9E9E"];
     google  [label="Google OAuth", fillcolor="#F5F5F5", color="#9E9E9E"];
     claudeai [label="claude.ai\nclient metadata", fillcolor="#F5F5F5", color="#9E9E9E"];

     browser -> apache [label="HTTPS + WSS"];
     claude -> apache [label="HTTPS"];
     apache -> dist [label="/"];
     apache -> api [label="/api, /mcp,\n/.well-known/oauth-*"];
     api -> db;
     api -> smtp [style=dashed, label="optional"];
     api -> google [style=dashed, label="optional"];
     api -> claudeai [style=dashed, label="Claude Code\nsign-in"];
   }

Backend
   Python, FastAPI, SQLAlchemy 2.0 in async mode on PostgreSQL, Alembic for
   migrations, APScheduler for the scheduled jobs, WebSockets for
   real-time updates, and the official MCP SDK for the MCP server Claude
   connects to, with its own OAuth 2.1 authorization server. See
   :doc:`backend/stack`.

Frontend
   A single-page application in React 19 and TypeScript, built with Vite:
   Material UI for the interface, react-router for navigation,
   react-i18next for English and Catalan, dnd-kit for drag and drop and
   dayjs for dates. See :doc:`frontend/stack`.

Deployment
   Apache serves the built frontend as static files and proxies everything
   under ``/api`` — WebSockets included — to the backend, so the browser
   only ever sees one origin. It also proxies ``/mcp`` and the two OAuth
   discovery documents under ``/.well-known``, for Claude. The backend runs as one systemd service and
   the database in its own PostgreSQL cluster. See :doc:`setup/production`.

How the two halves talk
-----------------------

Every read and every change is a REST call under ``/api/v1``. On top of
that, each browser tab keeps a WebSocket open; after a change, the backend
uses it to tell everyone else looking at the same board *what* changed —
never the new data — and their tabs fetch it again over REST.

Claude and the MCP server
-------------------------

Claude — on the web, the desktop and mobile apps, or Claude Code — connects to
``/mcp``, the backend's MCP server, and calls tools such as ``get_board`` or
``create_card``. It signs in through a standard OAuth 2.1 flow served by the
backend itself: the user approves the connection on the frontend's consent
page, choosing which of their own boards it may reach and whether it may
change them. The tools call the same code as the REST routes, so the rules
are the same and changes reach open tabs over the WebSocket. See
:doc:`backend/stack` for the details and :doc:`manual/claude` for the user's
side.

Why a single process
--------------------

There is no separate worker or cron job: the hourly reminders, the clean-up
of expired invitations and OAuth rows, and the nightly time tracker job run
on a scheduler inside the API process. That, and the in-memory list of open WebSockets, is
why the backend runs as exactly one process.
