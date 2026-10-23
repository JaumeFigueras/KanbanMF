Workflow
========

This page is the day-to-day loop once :doc:`development` is done: changing
the code, checking it, and keeping the schema, the translations and these
docs in step with it.

Running the tests
-----------------

From ``backend/``, with the virtualenv active:

.. code-block:: bash

   python3 -m pytest -x -v --cov-report=html:./test/coverage_reports --cov=./src ./test -s -vv

The tests run against a **real PostgreSQL**, not a mock. ``pytest-postgresql``
starts a throw-away server for the test session and gives every test a fresh
database, so tests can't leak into each other or into your development data.
That needs the PostgreSQL server binaries (``pg_ctl``) installed on the
machine, which :doc:`development` already does.

The coverage report lands in ``backend/test/coverage_reports/index.html``.

The tests are organised like the code: ``test/model/`` for model-level
behaviour, ``test/schemas/`` for validation, and ``test/api/`` for the
routes, called through the FastAPI app as a client would.

Changing the data model
-----------------------

The schema exists in two forms, and both have to follow a model change:

- **Alembic migrations** (``backend/alembic/versions/``) build every real
  database — development, staging, production.
- **Raw SQL files** (``backend/src/model/sql/``) build the test databases.
  The test fixture runs ``test/database_init.sql`` and then
  ``src/model/sql/all.sql``; it never runs the migrations.

So, after changing a model in ``src/model/``:

1. **Generate the migration** and read it before trusting it:

   .. code-block:: bash

      cd backend
      alembic revision --autogenerate -m "add whatever column"

   Autogenerate compares the models with the database and writes the
   difference. It misses things — a renamed column looks like a drop and an
   add, which loses the data — so check the script in ``alembic/versions/``
   and fix it by hand when needed.

2. **Apply it** to your database: ``alembic upgrade head``. Check it can be
   undone too: ``alembic downgrade -1``, then ``upgrade head`` again.

3. **Regenerate the SQL files.** ``src/apps/helper/get_sql.py`` writes one
   ``.sql`` file per table, from the models, and joins them into ``all.sql``.
   Run it from ``backend/`` against any PostgreSQL database (it only uses the
   connection to compile the SQL; it writes nothing to the database):

   .. code-block:: bash

      python3 -m src.apps.helper.get_sql -H localhost -p 5434 \
              -d kanbanmf_db -u kanbanmf_user -w <password>

   A new model also has to be added to the script's ``models`` list, in an
   order that respects foreign keys, and to ``src/model/__init__.py``.

4. **Run the tests.** They are what catches a migration and the SQL files
   disagreeing with the models.

Frontend checks
---------------

From ``frontend/``:

.. code-block:: bash

   npm run build    # type-checks (tsc -b), then builds
   npm run lint     # ESLint

Both must pass before a change goes in; ``npm run build`` is also what
production runs, so a type error there would stop a deploy.

New UI follows the existing layout: one component per file in
``src/components/``, pages in ``src/pages/``, and API calls through
``apiFetch`` with relative URLs (see :doc:`../frontend/stack`).

Interface translations
----------------------

The interface is in English and Catalan. Every text on screen is a key in
``frontend/src/i18n/locales/en.ts`` **and** ``ca.ts``: add new keys to both
files in the same change. A key missing from ``ca.ts`` silently falls back to
English, so nothing breaks — it just shows up untranslated.

Backend texts that reach users — the e-mails — are in
``src/core/email.py``, in both languages, chosen from the recipient's
preferences.

The documentation
-----------------

From the repository root:

.. code-block:: bash

   make docs           # English and Catalan, in docs/build/site/<lang>/
   make docs-po        # refresh docs/locale/ after changing a translated page
   make screenshots    # reseed the demo data and retake the manual's images

``make -C docs html`` is a quicker English-only build into
``docs/build/html``.

Keep the build **free of warnings**: a broken reference or a malformed
docstring shows up as one, and the build is currently clean. Docstrings are
reStructuredText, so a list needs a blank line before it.

What goes where:

- The **API reference** is generated from the backend's docstrings: a new
  module appears on its own on the next build. Explain *what* something does
  in its docstring, and *why* the design is what it is in the
  ``stack.rst`` pages.
- The **user manual** describes behaviour checked against the code. When a
  feature changes, update the manual page, run ``make docs-po`` and translate
  what it marks new or ``fuzzy`` in ``docs/locale/ca/``, and retake the
  screenshots the change shows.
- ``README.md`` and ``SETUP.md`` are included into these pages rather than
  copied; edit them in place.

Screenshots
~~~~~~~~~~~

``make screenshots`` needs both dev servers running. For each language it runs
``docs/screenshots/seed.py``, which rebuilds that language's demo users
(``*@example.com``, password ``demo-password``) and their boards on your
**development** database — nothing else in it is touched — and then
``docs/screenshots/capture.py``, which drives the real frontend with
Playwright and writes ``docs/source/manual/img/<name>.png`` (English) and
``<name>.ca.png`` (Catalan).

Each screenshot is one ``@shot`` function in ``capture.py``, finding buttons
by their translated labels; ``--only <name>`` retakes a few. The first time
on a machine, install the browser: ``.venv/bin/playwright install chromium``.

Committing
----------

Work happens on ``main``. A feature that touches the whole stack usually
lands as a sequence of commits — the data model and its migration, then the
backend, then the frontend — each one leaving the application working, with
``PENDING.md`` updated as items are done.
