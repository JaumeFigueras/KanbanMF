Core services
=============

``src.core`` is everything that isn't a route:

:mod:`~src.core.config`
   ``Settings``, read from the environment and ``backend/.env``.

:mod:`~src.core.database`
   The async engine and ``AsyncSessionLocal``, the session factory used by
   requests (through ``get_db``) and by the scheduled jobs.

:mod:`~src.core.security`
   bcrypt for passwords and refresh tokens, JWT access tokens, random
   refresh tokens.

:mod:`~src.core.email`
   The verification, reminder and invitation e-mails, in English and
   Catalan, and ``email_enabled()``.

:mod:`~src.core.access`
   The access checks every route makes: a board the user owns or is shared
   with, a list or card that belongs to it, no cards on templates.

:mod:`~src.core.cards`, :mod:`~src.core.lists` and :mod:`~src.core.checklists`
   The board operations — create, update, move, archive and order cards, add
   lists, add and tick checklist items — each with its access checks and
   WebSocket notifications. The routes are thin wrappers around them.

:mod:`~src.core.card_groups`, :mod:`~src.core.search` and :mod:`~src.core.people`
   Cards from several boards grouped by board and list, the overdue cards,
   card search, and the name/initials/avatar summary of a person.

:mod:`~src.core.ws_manager` and :mod:`~src.core.ws_notify`
   The open WebSockets per user, and the notify-and-refetch messages.

:mod:`~src.core.scheduler`
   The APScheduler instance and its jobs, started with the app:

   - :mod:`~src.core.notifications` — the hourly due-date reminders;
   - :mod:`~src.core.invitations` — turning invitations into shares when an
     address is verified, and the hourly clean-up of expired ones;
   - :mod:`~src.core.time_tracker_ranking` — the nightly rebuild of the time
     tracker's usage ranking.

How they work together is in :doc:`../stack`.

.. rubric:: Reference

.. autosummary::
   :toctree: generated
   :template: autosummary/module.rst
   :recursive:

   src.core
