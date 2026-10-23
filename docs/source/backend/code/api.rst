API layer
=========

:mod:`src.main` creates the FastAPI application: CORS for ``FRONTEND_URL``, a
``/healthz`` check, a lifespan that starts and stops the scheduler, and the
``/api/v1`` router from :mod:`src.api.v1.router`, which mounts every resource
router under its prefix. The prefixes follow how the data is nested:

.. list-table::
   :header-rows: 1
   :widths: 46 24 30

   * - Prefix (under ``/api/v1``)
     - Module
     - Notes
   * - ``/auth/local``
     - :mod:`~src.api.v1.auth.local`
     - register, verify, login, logout, refresh
   * - ``/auth/google``
     - :mod:`~src.api.v1.auth.google`
     - redirect to Google, callback
   * - ``/users``
     - :mod:`~src.api.v1.users`
     - ``/users/me``: profile, preferences, password, avatar; user search
   * - ``/boards``
     - :mod:`~src.api.v1.boards`
     - boards and templates, shares, stars, order, colours, overdue page
   * - ``/boards/{board_id}/lists``
     - :mod:`~src.api.v1.lists`
     - lists, their order and colours
   * - ``/boards/{board_id}/lists/{list_id}/cards``
     - :mod:`~src.api.v1.cards`
     - cards, copy, order, colours
   * - ``/boards/{board_id}/cards/archived``
     - :mod:`~src.api.v1.cards`
     - ``archived_router``: a board's archived cards
   * - ``/boards/{board_id}/lists/{list_id}/cards/{card_id}/checklists``
     - :mod:`~src.api.v1.checklists`
     - checklists, items, their order
   * - ``/boards/{board_id}/labels``
     - :mod:`~src.api.v1.labels`
     - read by everyone on the board, changed by the owner
   * - ``/boards/{board_id}/notifications``
     - :mod:`~src.api.v1.board_notifications`
     - the caller's own reminder settings
   * - ``/boards/{board_id}/invitations``
     - :mod:`~src.api.v1.invitations`
     - owner only
   * - ``/invitations/{token}``
     - :mod:`~src.api.v1.invitations`
     - public: what the sign-up page shows for a link
   * - ``/time-entries``
     - :mod:`~src.api.v1.time_entries`
     - private to the caller; no WebSocket notifications
   * - ``/config``
     - :mod:`~src.api.v1.config`
     - public: optional features (e-mail)
   * - ``/ws``
     - :mod:`~src.api.v1.ws`
     - the notification WebSocket, ``?token=<access token>``

Every route except the public ones and the sign-in flow needs a valid access
token. The shared dependencies are in :mod:`src.api.deps`: the database
session, the current user, the refresh-token cookie, the calling tab's
``X-Client-Id``, and ``reject_if_template``.

The complete list of endpoints, with their bodies and responses, is the
backend's own interactive documentation at ``/docs`` (Swagger UI) or
``/redoc`` on a running backend — for example http://localhost:8000/docs in
development.

.. rubric:: Reference

.. autosummary::
   :toctree: generated
   :template: autosummary/module.rst
   :recursive:

   src.main
   src.api
