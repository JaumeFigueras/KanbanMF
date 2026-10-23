Code
====

These pages are generated from the backend's source on every build: each
module gets a page with its docstrings, and a ``[source]`` link next to every
object. A new module appears here by itself. They say *what* things are; the
reasons behind the design are in :doc:`../stack`.

The code is in four layers, each with its own page:

:doc:`models`
   ``src.model`` — the SQLAlchemy models, one module per table.

:doc:`schemas`
   ``src.schemas`` — the Pydantic bodies the API accepts and returns.

:doc:`api`
   ``src.main`` and ``src.api`` — the application and its routes.

:doc:`core`
   ``src.core`` — everything that isn't a route: settings, database,
   security, e-mail, WebSockets and the scheduled jobs.

The backend is imported as the top-level package ``src`` (``from
src.model.board import Board``), with ``backend/`` as the working directory.

.. toctree::
   :maxdepth: 2

   models
   schemas
   api
   core
