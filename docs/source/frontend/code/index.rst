Code
====

There is no autodoc for TypeScript here: these pages are written by hand.
They stay at the level of *what each file is for* and how the files relate,
not every prop and type — the source, with its comments, is the reference for
those, and :doc:`../stack` explains the design.

Everything is under ``frontend/src/``:

:doc:`pages`
   ``pages/`` — one component per route.

:doc:`components`
   ``components/`` — the dialogs, widgets and board pieces the pages are
   built from.

:doc:`state`
   ``context/`` and ``api/`` — the session, the theme, and the REST and
   WebSocket clients.

:doc:`utils`
   ``utils/``, ``theme/`` and ``i18n/`` — small pure helpers, the themes and
   the translations.

When a new area appears in the frontend, describe it on the page whose
folder it lives in; a new top-level folder gets a page of its own here.

.. toctree::
   :maxdepth: 2

   pages
   components
   state
   utils
