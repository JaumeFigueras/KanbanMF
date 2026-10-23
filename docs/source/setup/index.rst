Setup
=====

This section is for people who run or develop KanbanMF:

:doc:`development`
   From a machine with nothing installed to a running copy, for
   development or staging.

:doc:`production`
   A real deployment on Debian: the database cluster, the backend as a
   systemd service, Apache in front of everything, TLS, the firewall, and
   keeping it up to date.

:doc:`workflow`
   The day-to-day loop once a copy runs: tests, migrations, frontend checks,
   translations and these docs.

Every environment needs the same four things:

- **Python 3.11 or newer**, with ``venv``, for the backend.
- **Node.js 20 or newer** and npm, to build the frontend. In production it
  is only needed at build time: nothing runs on Node.
- **PostgreSQL** — 15 or newer — preferably in a cluster of its own.
- **git**, to get the source and to update it.

.. toctree::
   :maxdepth: 2

   development
   production
   workflow
