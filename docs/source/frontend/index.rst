Frontend
========

The frontend is the single-page application in ``frontend/``: React and
TypeScript, built by Vite into static files that the browser runs. It draws
every screen, keeps the signed-in session alive, calls the backend's REST API
for all data, and listens on a WebSocket for changes made elsewhere. It holds
no business rules of its own beyond what the interface needs; the backend
decides what is allowed.

:doc:`../architecture` shows where it sits in a deployment. As with the
backend, :doc:`stack` explains how it fits together and
:doc:`code/index` describes what each part contains.

.. toctree::
   :maxdepth: 2

   stack
   code/index
