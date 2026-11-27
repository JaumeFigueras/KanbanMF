Workflow
========

This page is the day-to-day loop once :doc:`development` is done: changing
the code, checking it, and keeping the schema, the translations and these
docs in step with it.

Running the tests
-----------------

There are three test suites. Each one runs from the repository root with
``make`` (no virtualenv activation needed), and none of them needs the
development servers or your database:

.. list-table::
   :header-rows: 1
   :widths: 16 26 58

   * - Suite
     - Command
     - What it runs
   * - Backend
     - ``make test``
     - pytest, calling the FastAPI app, on throw-away PostgreSQL databases
   * - Frontend
     - ``make test-frontend``
     - Vitest: the components, pages and helpers in jsdom, with the backend
       faked
   * - End to end
     - ``make test-e2e``
     - pytest and Playwright: the production build in Chromium, against a
       backend and a database that each run starts and throws away

The backend
~~~~~~~~~~~

.. code-block:: bash

   make test                        # the whole suite
   make test TEST_ARGS="-x -k oauth"   # extra pytest arguments: stop at the first failure, only matching tests
   make test-cov                    # the same, with a coverage report

or, from ``backend/`` with the virtualenv active, ``python3 -m pytest ./test``
with whatever options you like.

The tests run against a **real PostgreSQL**, not a mock. ``pytest-postgresql``
starts a throw-away server for the test session and gives every test a fresh
database, so tests can't leak into each other or into your development data.
That needs the PostgreSQL server binaries (``pg_ctl``) installed on the
machine, which :doc:`development` already does.

``make test-cov`` prints the files that aren't fully covered and writes a
browsable report to ``backend/test/coverage-reports/index.html``; the
directory is gitignored.

The tests are organised like the code: ``test/model/`` for model-level
behaviour, ``test/schemas/`` for validation, and ``test/api/`` for the
routes, called through the FastAPI app as a client would.

The MCP server is tested the same way, over HTTP: ``test/api/test_mcp.py``
sends JSON-RPC requests to a fresh server app with real access tokens, and
``test/api/test_oauth.py`` walks the OAuth flow. The MCP SDK's session
manager has to be left by the task that started it, and pytest-asyncio tears
fixtures down in another task, so the ``mcp`` fixture runs it in a task of
its own — copy that fixture rather than wrapping the manager in ``async
with`` inside a fixture.

The frontend
~~~~~~~~~~~~

.. code-block:: bash

   make test-frontend                                     # the whole suite
   make test-frontend TEST_ARGS="src/utils -t sortCards"  # extra Vitest arguments: only these files, only tests whose names match
   make test-frontend-cov                                 # the same, with a coverage report

or, from ``frontend/``:

.. code-block:: bash

   npm test             # the whole suite, once
   npm run test:watch   # keeps running, and reruns the tests a saved change affects
   npm run test:cov     # with a coverage report

The tests run in Node, with jsdom standing in for the browser and MSW
answering the API's requests, so nothing else has to be running. Each test
file sits next to the file it tests, as ``<name>.test.ts`` or
``<name>.test.tsx``; the shared set-up and helpers are in ``src/test/``.
Every test runs in the ``Europe/Madrid`` time zone, whatever the machine's,
because due dates and the time tracker depend on it.

``make test-frontend-cov`` prints the files that aren't fully covered and
writes a browsable report to ``frontend/coverage-reports/index.html``; the
directory is gitignored.

End to end
~~~~~~~~~~

.. code-block:: bash

   make test-e2e                          # the whole suite, in Chromium, out of sight
   make test-e2e TEST_ARGS="-x -k sign"   # extra pytest arguments
   make test-e2e HEADED=1                 # shows the browser, slowed down to follow
   make test-e2e-cov                      # the same, then the lines of frontend/src the browser ran

These tests use the real application, in Chromium. Each run starts
everything it needs, from this working copy and on free ports, and throws it
all away at the end:

- a throw-away PostgreSQL, with the schema built by ``alembic upgrade head``;
- the backend, with e-mail and Google sign-in off, whatever ``backend/.env``
  says;
- the frontend, built as for production and served by ``vite preview`` with
  production's Content-Security-Policy.

So nothing has to be running first, and the development servers and
database are never touched. A whole run takes about three minutes. It
needs, once per machine, the Chromium that Playwright drives (see
:doc:`development`), besides what the other two suites already need: the
PostgreSQL server binaries and the frontend's ``npm install``.

The tests are in ``e2e/``, one file per area: signing in, dragging (on the
board, on the boards page, labels, checklists), two people on a board at
once, and Claude's connection. Every test makes its own users and boards.
Besides what it checks, a test fails on any error in the browser's console
(a CSP violation is one) and on any exception the page doesn't catch.

When a test fails, ``e2e/test-results/`` (emptied at the start of each run,
and gitignored) holds what you need to see why:

- ``<test name>.zip``, a Playwright trace of the test: every step, with a
  screenshot, the page's DOM, its console and its network requests. Open it
  with ``.venv/bin/playwright show-trace e2e/test-results/<test name>.zip``.
  A test with a second browser leaves that one's trace as
  ``<test name>-2.zip``.
- ``backend.log`` and ``frontend.log``, the two servers' output.

``make test-e2e-cov`` builds the frontend with source maps and unminified,
has Chromium record the code each page runs, and maps that back to
``frontend/src``. It prints each file below 100 % with the lines no test
reached, then the total; the merged data, in Istanbul's format, stays in
``e2e/test-results/coverage/coverage-final.json``. It counts only what the
end-to-end tests reach in the browser, not the frontend suite's coverage:
it shows what they leave untried.

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
   npm test         # the frontend's tests (see Running the tests, above)

All three must pass before a change goes in; ``npm run build`` is also what
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

Publishing on Read the Docs
~~~~~~~~~~~~~~~~~~~~~~~~~~~

``.readthedocs.yaml`` describes the build: Python 3.13, the backend's
requirements (autodoc imports the backend), Graphviz from apt for the
diagrams, warnings as errors, and an HTML zip and a PDF besides the site.

Each language is a **separate Read the Docs project** built from the same
repository and the same ``.readthedocs.yaml``; Read the Docs builds a project
with ``-D language=<its language>``. To set it up, in the Read the Docs
dashboard:

1. Import the repository as the main project (for example ``kanbanmf``), with
   its language set to **English**.
2. Import the same repository again as a second project (for example
   ``kanbanmf-ca``), with its language set to **Catalan**.
3. In the main project, under *Settings → Translations*, add ``kanbanmf-ca``.

The Catalan project is then served under the main project's domain, at
``/ca/latest/`` next to ``/en/latest/``, and Read the Docs' own menu offers
both languages on every page. The local switcher in
``_templates/layout.html`` is only drawn by ``make docs``, so it never doubles
up with that menu.

Check that a push rebuilds both projects. If the Catalan one doesn't, connect
it to the repository the same way as the main one (its *Integrations*
settings), or it will only rebuild when triggered by hand.

Publishing on GitHub Pages
~~~~~~~~~~~~~~~~~~~~~~~~~~

``.github/workflows/docs.yml`` builds the same site as ``make docs`` (both
languages side by side, with the local switcher) and publishes it on GitHub
Pages, at ``https://<owner>.github.io/KanbanMF/``. It runs on every push to
``main`` that changes something the build reads (``docs/``, ``backend/``,
``deploy/``, the included Markdown files, the ``Makefile`` or the workflow
itself), and can be started by hand from the *Actions* tab. A warning fails
the build, and the published site stays as it was.

It needs one setting, once: in the repository's *Settings → Pages*, set
*Source* to **GitHub Actions**. GitHub Pages has no PDF; that is Read the
Docs' only.

The PDF
~~~~~~~

Read the Docs builds each language's PDF with ``pdflatex``. ``conf.py`` sets
A4 paper and maps the ☰ menu icon, which ``pdflatex`` can't typeset, to ≡. To
build a PDF locally you need TeX, which isn't otherwise part of the setup:

.. code-block:: bash

   sudo apt install latexmk texlive-latex-recommended texlive-latex-extra \
                    texlive-fonts-recommended texlive-lang-european
   cd docs
   make latexpdf SPHINXBUILD=../.venv/bin/sphinx-build                    # English
   make latexpdf SPHINXBUILD=../.venv/bin/sphinx-build O="-D language=ca" # Catalan

The PDF is ``docs/build/latex/kanbanmf.pdf``.

Screenshots
~~~~~~~~~~~

``make screenshots`` needs both dev servers running. For each language it runs
``docs/screenshots/seed.py``, which rebuilds that language's demo users
(``*@example.com``, password ``demo-password``) and their boards on your
**development** database — nothing else in it is touched — and then
``docs/screenshots/capture.py``, which drives the real frontend with
Playwright and writes ``docs/source/manual/img/<name>.png`` (English) and
``<name>.ca.png`` (Catalan).

The seed also connects "Claude" to the first user's main board, so the
Connected apps dialog has something to show; the ``oauth_consent`` shot
starts a real authorization request and leaves it unanswered (it expires,
and the hourly clean-up removes it and its client).

Each screenshot is one ``@shot`` function in ``capture.py``, finding buttons
by their translated labels; ``--only <name>`` retakes a few. The first time
on a machine, install the browser: ``.venv/bin/playwright install chromium``.

Committing
----------

Work happens on ``main``. A feature that touches the whole stack usually
lands as a sequence of commits — the data model and its migration, then the
backend, then the frontend — each one leaving the application working, with
``PENDING.md`` updated as items are done.
