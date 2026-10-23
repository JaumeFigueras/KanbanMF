Backend
=======

The backend is the FastAPI application in ``backend/``. It owns the data and
every rule about it: who can see and change what, the database schema and
its migrations, sign-in, e-mail, the scheduled jobs, and the WebSocket
notifications that keep open browsers up to date. The frontend never talks
to the database; it only calls this API.

For the big picture — how the backend, the frontend and the deployment fit
together — see :doc:`../architecture`. Then read :doc:`stack`, for how the
backend's own pieces fit together and why; :doc:`code/index` is the
reference, generated from the source, for what each module contains.

.. toctree::
   :maxdepth: 2

   stack
   code/index
