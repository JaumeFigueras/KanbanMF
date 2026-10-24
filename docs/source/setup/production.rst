Production environment
======================

A production KanbanMF is three things on one Debian machine:

.. list-table::
   :header-rows: 1
   :widths: 25 35 40

   * - Component
     - Runs as
     - Reachable at
   * - PostgreSQL
     - its own cluster, started by systemd
     - localhost only
   * - Backend API
     - the ``kanbanmf-backend`` systemd service, one process
     - ``127.0.0.1:8000`` only
   * - Frontend
     - nothing — static files in ``frontend/dist``
     - served by Apache
   * - Apache
     - the system's ``apache2`` service
     - ``:443`` (and ``:80`` to redirect)

Apache is the only public entry point. It serves the built frontend and
proxies everything under ``/api`` — the WebSocket included — to the backend,
so the browser sees a single origin and the frontend needs no configuration
at all. It also proxies ``/mcp`` and the two OAuth discovery documents
(``/.well-known/oauth-protected-resource`` and
``/.well-known/oauth-authorization-server``), so Claude can connect. See :doc:`../backend/stack` for why the backend must stay a single
process.

The steps are the same as for :doc:`development` up to the point where the
dev servers would start; what differs is how things run and what is exposed.

.. note::

   The procedure below is ``SETUP.md`` at the repository root, included here
   as is, so the two can't drift apart. Edit ``SETUP.md`` to change it.

.. include:: ../../../SETUP.md
   :parser: myst_parser.sphinx_
   :start-after: ### Debian

The deploy files
----------------

Both files in ``deploy/`` are meant to be copied and adapted, not used in
place. Their comments explain every choice.

.. literalinclude:: ../../../deploy/kanbanmf-backend.service
   :language: ini
   :caption: deploy/kanbanmf-backend.service

.. literalinclude:: ../../../deploy/apache-kanbanmf.conf
   :language: apache
   :caption: deploy/apache-kanbanmf.conf

Checking that it runs
---------------------

.. code-block:: bash

   sudo systemctl status kanbanmf-backend      # running, and since when
   sudo journalctl -u kanbanmf-backend -f      # the backend's log, live
   curl http://127.0.0.1:8000/healthz          # {"status":"ok"}, from the server itself

``/healthz`` isn't under ``/api``, so Apache doesn't expose it: ask the backend
directly, from the server. A reminder that fails to send is logged to the same
journal, which is the place to look when e-mails don't arrive.

Upgrading
---------

From the production checkout, as the user that owns it:

.. code-block:: bash

   make deploy

It runs, and stops at the first step that fails:

1. ``git pull``;
2. ``pip install -r backend/requirements.txt``, into ``.venv/``;
3. ``alembic upgrade head``, from ``backend/``, to apply any new migration;
4. ``sudo systemctl restart kanbanmf-backend``;
5. ``npm ci`` and ``npm run build``, from ``frontend/``, to reinstall the
   frontend's packages exactly as ``package-lock.json`` lists them and
   rebuild ``frontend/dist``.

Because it stops at the first failure, a failed pull, install or migration
leaves the old backend running. The restart is a moment of downtime: open
tabs lose their WebSocket and reconnect on their own a few seconds later.

Backups
-------

Everything KanbanMF stores is in its database — avatars included, as they are
stored in a table — so a backup is a database dump plus a copy of
``backend/.env``:

.. code-block:: bash

   pg_dump -h localhost -p 5445 -U kanbanmf_user -Fc kanbanmf_db \
           > kanbanmf-$(date +%F).dump

``-Fc`` writes PostgreSQL's compressed custom format, which ``pg_restore`` can
restore selectively. To run it unattended — from cron or a systemd timer —
put the password in the ``~/.pgpass`` of the user that runs it
(``localhost:5445:kanbanmf_db:kanbanmf_user:<password>``, mode ``600``).

To restore into an existing, empty database:

.. code-block:: bash

   pg_restore -h localhost -p 5445 -U kanbanmf_user -d kanbanmf_db \
              --clean --if-exists kanbanmf-2026-10-23.dump

Keep ``backend/.env`` with the backups but apart from them, and as private as
the dump: it holds the database password, the JWT signing key and the SMTP
and Google secrets. Restoring the database with a different ``SECRET_KEY``
works, but signs everybody out.
