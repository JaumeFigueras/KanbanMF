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
