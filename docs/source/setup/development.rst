Development and staging environment
===================================

This page takes a machine with nothing installed to a running KanbanMF: a
PostgreSQL cluster, the Python environment, the backend, and the frontend. The
commands are for Debian (and Debian-derived distributions), which is what the
project is developed and deployed on.

The end state is three processes on three ports:

.. list-table::
   :header-rows: 1
   :widths: 20 15 65

   * - Component
     - Port
     - Started by
   * - PostgreSQL
     - 5434
     - systemd, at boot (a dedicated cluster — see below)
   * - Backend API
     - 8000
     - ``make run backend``
   * - Frontend
     - 5173
     - ``make run frontend``

Prerequisites
-------------

- **Python 3.11 or newer**, with the ``venv`` module.
- **Node.js 20 or newer** and npm — installed with nvm rather than apt, see
  :ref:`dev-nodejs` below.
- **PostgreSQL 17** — both the server and ``postgresql-common``, which provides
  the ``pg_createcluster`` family of commands used below.
- **git**, and a C toolchain for any package that needs to build a wheel.

System packages
~~~~~~~~~~~~~~~

.. code-block:: bash

   sudo apt install python3 python3-venv python3-dev build-essential git wget \
                    postgresql-17 postgresql-common libpq-dev

.. note::

   ``pg_createcluster``, ``pg_lsclusters`` and ``pg_ctlcluster`` are Debian's
   cluster-management wrappers, not part of upstream PostgreSQL. On a
   distribution that doesn't ship them you would use ``initdb`` and run the
   server yourself; everything after the cluster section applies unchanged.

.. _dev-nodejs:

Node.js, with nvm
~~~~~~~~~~~~~~~~~

Node is deliberately **not** in the apt line above. Install it with `nvm
<https://github.com/nvm-sh/nvm>`_ instead, for two reasons:

- Debian's ``nodejs`` package is frozen at whatever version the release shipped
  with and only moves at Debian's pace. nvm tracks the current LTS and lets you
  hold different projects on different versions.
- nvm installs into your home directory, so **nothing here needs root** — which
  in turn means ``npm install -g`` never needs ``sudo``, and you never end up
  with root-owned files in a user-owned cache. That is the usual source of npm
  permission trouble on a shared machine.

.. code-block:: bash

   wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc
   nvm --version

The installer appends its startup lines to your shell profile — ``~/.bashrc``
for bash, ``~/.zshrc`` for zsh — so ``source`` the one you actually use, or just
open a new terminal. Check the `nvm releases page
<https://github.com/nvm-sh/nvm/releases>`_ for the current installer tag rather
than assuming ``v0.40.3`` is still it.

Then install the current LTS and bring npm up to date:

.. code-block:: bash

   nvm install --lts
   npm install -g npm@latest

   node --version    # expect v20 or newer
   npm --version

``nvm install --lts`` also makes that version the default for new shells. A few
commands worth knowing:

.. code-block:: bash

   nvm ls                  # versions installed, and which is active
   nvm use --lts           # switch this shell to the LTS
   nvm alias default 22    # change what new shells get

.. important::

   nvm is a shell function, not a binary on ``PATH``. It only exists in shells
   that have sourced your profile, so ``sudo npm ...``, cron jobs and anything
   run non-interactively will not find the Node it manages. In development this
   never comes up: ``make run frontend`` inherits your interactive shell. It
   only matters if you ever automate the production ``npm run build`` — and
   since nothing serves the frontend at runtime, that build is the only thing a
   production host needs Node for at all.

Get the source
--------------

.. code-block:: bash

   git clone https://github.com/JaumeFigueras/KanbanMF.git
   cd KanbanMF

Every path in the rest of this page is relative to that directory.

PostgreSQL: use a dedicated cluster
-----------------------------------

**Always give the project its own cluster rather than adding a database to the
default ``17/main`` one.** A cluster is a complete, independent PostgreSQL
instance: its own port, data directory, configuration, log and systemd unit. The
cost is one command; what it buys is worth it:

- **Isolation.** Starting, stopping, restarting or reconfiguring KanbanMF's
  database never touches any other project on the machine.
- **A tuning and configuration surface of your own.** ``shared_buffers``,
  ``log_statement``, extensions, authentication rules — set them for this
  project without arguing with anything else.
- **Clean disposal.** ``pg_dropcluster`` removes the instance, its data and its
  unit in one step. No orphaned roles or databases left behind in a shared
  cluster.
- **Version freedom.** A different project can sit on a different PostgreSQL
  major version on the same machine.
- **It matches production.** The production deployment does exactly this (see
  :doc:`production`), so development is not a different shape from the thing you
  eventually deploy.

Create the cluster
~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   sudo pg_createcluster -d /home/postgresql-17/kanbanmf \
                         -l /home/postgresql-17/kanbanmf/kanbanmf.log \
                         -p 5434 --start --start-conf auto \
                         17 kanbanmf

Reading the arguments:

``-d``
   Data directory. Put it wherever suits your disk layout; it is created for
   you. If the parent doesn't exist yet, ``sudo mkdir -p /home/postgresql-17``
   first.

``-l``
   Log file, here kept alongside the data.

``-p 5434``
   The port. It must not collide with the default cluster on 5432 or with any
   other cluster on the machine — ``pg_lsclusters`` shows what is already taken.
   Whatever you pick has to match ``DATABASE_URL`` later.

``--start --start-conf auto``
   Start it now, and start it automatically at boot.

``17 kanbanmf``
   PostgreSQL major version, then the cluster name. Adjust the version to the
   one you installed.

Create the role and the database
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Both commands have to run as the ``postgres`` operating-system user, because a
brand-new cluster only trusts that user:

.. code-block:: bash

   sudo su postgres
   createuser -p 5434 -P kanbanmf_user
   createdb -p 5434 -E UTF8 -O kanbanmf_user kanbanmf_db
   exit

``-P`` makes ``createuser`` prompt for a password — that is the password that
goes into ``DATABASE_URL`` in the next section, so keep it to hand. ``-O`` makes
``kanbanmf_user`` the owner of the database, which it needs to be for Alembic to
create the schema.

Check it works
~~~~~~~~~~~~~~

.. code-block:: bash

   psql -h localhost -p 5434 -U kanbanmf_user -d kanbanmf_db -c '\conninfo'

.. important::

   Pass ``-h localhost``. Without it ``psql`` connects over the Unix socket,
   which uses *peer* authentication — it insists your operating-system user name
   matches the PostgreSQL role name, and fails with
   ``Peer authentication failed for user "kanbanmf_user"``. The backend connects
   over TCP, so ``-h localhost`` is also the closer test of what the application
   will actually do.

Managing the cluster
~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   pg_lsclusters                            # every cluster, its port and status
   sudo pg_ctlcluster 17 kanbanmf start     # ...stop, restart, reload
   sudo systemctl status postgresql@17-kanbanmf
   sudo pg_dropcluster --stop 17 kanbanmf   # destroys the cluster and its data

The Python environment
----------------------

The virtualenv lives at ``.venv/`` in the **repository root**, not inside
``backend/``. Several things assume that path — the root ``Makefile``, the
documentation build, and the ``SETUP.md`` deployment instructions.

.. code-block:: bash

   python3 -m venv .venv
   source .venv/bin/activate
   pip3 install --upgrade pip
   pip3 install -r backend/requirements.txt

Upgrade ``pip`` before installing anything: the version bundled with a fresh
virtualenv is often old enough to miss wheels that the current one would find,
which turns a download into a from-source build.

``backend/requirements.txt`` is the single requirements file for the project. It
covers the application, the test suite and the documentation toolchain, so there
is nothing else to install for those.

Configure the backend
---------------------

.. code-block:: bash

   cd backend
   cp .env.example .env
   $EDITOR .env

Two settings must be changed before anything will start:

``DATABASE_URL``
   Point it at the cluster you just created, with the password you chose:

   .. code-block:: ini

      DATABASE_URL = postgresql+psycopg://kanbanmf_user:yourpassword@localhost:5434/kanbanmf_db

   The ``postgresql+psycopg://`` scheme is required — that is psycopg 3, which
   serves both the application's async engine and Alembic's synchronous one. A
   bare ``postgresql://`` selects a different driver and fails.

   .. warning::

      ``.env.example`` ships with port **5445**, which is the port the
      production example uses. Change it to your cluster's port or the backend
      will fail to connect.

``SECRET_KEY``
   The signing key for JWT access tokens. Generate a real one:

   .. code-block:: bash

      openssl rand -hex 32

Everything else has a usable default. Google OAuth and SMTP are both optional:
leave ``GOOGLE_CLIENT_ID`` / ``GOOGLE_CLIENT_SECRET`` blank to disable Google
sign-in, and ``SMTP_HOST`` blank to disable e-mail — see
:ref:`dev-first-user` for what that means in practice.

The frontend has no ``.env`` of its own. It reaches the API through relative
URLs, so there is no host or port to configure anywhere.

Create the schema
-----------------

From ``backend/``, with the virtualenv active:

.. code-block:: bash

   alembic upgrade head

Alembic reads the database URL from ``src.core.config.settings`` — that is, from
the ``backend/.env`` you just edited — and not from ``alembic.ini``.

The Node environment
--------------------

.. code-block:: bash

   cd frontend
   npm install

That is the whole frontend setup. In development the Vite dev server proxies
everything under ``/api`` — WebSocket upgrades included — to
``http://localhost:8000``, which is what lets the client use relative URLs in
both development and production. The proxy is configured in
``frontend/vite.config.ts``.

Run it
------

Two terminals, from the repository root:

.. code-block:: bash

   make run backend     # http://localhost:8000  (API docs at /docs)
   make run frontend    # http://localhost:5173

Both targets use ``.venv/`` directly, so neither needs the virtualenv activated
first. The equivalent raw commands are:

.. code-block:: bash

   cd backend && ../.venv/bin/uvicorn src.main:app --reload
   cd frontend && npm run dev

Open http://localhost:5173. Use the frontend's port, not the backend's — going
straight to 8000 gets you the API, not the application.

.. _dev-first-user:

Creating the first user
-----------------------

A local account signs up with an e-mail address and a password, and cannot log
in until the address is verified. The verification link arrives by e-mail, which
means a development environment with no SMTP server configured cannot complete
the flow on its own.

If ``SMTP_HOST`` is blank, ``POST /api/v1/auth/local/signup`` **creates the
account and then fails with a 500** while trying to send the message: the user
row is committed before the e-mail is sent. The account exists, unverified, and
login refuses it. Mark it verified directly:

.. code-block:: bash

   psql -h localhost -p 5434 -U kanbanmf_user -d kanbanmf_db \
        -c "UPDATE users SET is_verified = true WHERE email = 'you@example.com';"

The alternatives are to point ``SMTP_*`` at a real mailbox, or at a local catcher
such as MailHog or ``python3 -m aiosmtpd``.

Staging
-------

A staging environment is this same setup with production's inputs, so that the
things development stubs out are actually exercised before they reach
production. What changes:

- **Real SMTP credentials**, so signup verification and the due-date reminders
  send for real. This is the only way to test the notification path end to end.
- **Real Google OAuth credentials**, with the staging host's callback URL
  registered as an authorized redirect URI. ``GOOGLE_REDIRECT_URI`` and
  ``FRONTEND_URL`` must both point at the staging host, not ``localhost``.
- **Its own database**, on its own cluster, with its own credentials. Never
  point staging at the production database.
- **A distinct** ``SECRET_KEY``. Sharing one with production would make tokens
  minted by staging valid in production.

What stays the same as development: the dev servers, the reload behaviour and
the relative-URL/proxy arrangement. Once you are running behind Apache with a
built frontend bundle and a systemd unit, you are doing what :doc:`production`
describes — do that instead of half-converting this setup.

Troubleshooting
---------------

``connection refused`` on port 5434
   The cluster isn't running. ``pg_lsclusters`` shows its status;
   ``sudo pg_ctlcluster 17 kanbanmf start`` starts it. Check the port in the
   listing matches the one in ``DATABASE_URL``.

``Peer authentication failed for user "kanbanmf_user"``
   A Unix-socket connection. Add ``-h localhost`` to the ``psql`` command; the
   application is unaffected, as it always connects over TCP.

``Could not parse SQLAlchemy URL from given URL string``
   ``DATABASE_URL`` is missing or malformed. It must be present and use the
   ``postgresql+psycopg://`` scheme.

``ValidationError`` for ``Settings`` at startup
   A required setting has no value. ``DATABASE_URL``, ``SECRET_KEY`` and
   ``SMTP_PORT`` have no defaults, and the backend refuses to start without
   them. Confirm ``backend/.env`` exists — it is loaded relative to ``backend/``,
   so a copy left in the repository root is not read.

Frontend loads but every API call fails
   The backend isn't running, or isn't on port 8000. The Vite proxy forwards
   ``/api`` to ``http://localhost:8000`` and has nothing to talk to otherwise.

Signup returns 500
   Expected with no SMTP configured — see :ref:`dev-first-user`.
