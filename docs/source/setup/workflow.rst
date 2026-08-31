Workflow
========

.. todo::

   **The day-to-day development loop.** Planned contents:

   - Running the test suite, and the fact that it runs against a real ephemeral
     PostgreSQL spun up per test by ``pytest-postgresql`` rather than a mock.
   - Coverage reports.
   - Changing a model: the Alembic autogenerate step, reviewing the generated
     script, and keeping ``src/model/sql/*.sql`` in sync (the test schema is
     built from raw DDL, not from the migrations).
   - Frontend checks: ``npm run build`` (type-check) and ``npm run lint``.
   - Adding a translation key to both ``en.ts`` and ``ca.ts``.
   - Building the documentation and keeping it warning-free.
   - Branching and commit conventions.

   Source material: ``CLAUDE.md``.
