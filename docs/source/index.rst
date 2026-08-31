Kanban MF documentation
=======================

.. todo::

   **Landing page — what the project is.** Planned contents:

   - What KanbanMF is and who it is for; what "Minimalist and Fast" means in
     practice and which trade-offs follow from it.
   - The feature set at a glance: boards, lists, cards, checklists, labels,
     sharing, per-user colour/order preferences, due-date e-mail reminders,
     real-time updates.
   - Where to go next: :doc:`setup/index` to run it, :doc:`manual/index` to use
     it, :doc:`backend/index` / :doc:`frontend/index` to work on it.
   - Licence and repository pointers.

   Source material: ``README.md`` at the repository root.

The stack
---------

.. todo::

   **Landing page — the stack, in one screen.** Planned contents:

   - Backend: Python / FastAPI / SQLAlchemy 2.0 async / PostgreSQL / Alembic /
     APScheduler / WebSockets.
   - Frontend: React 19 / TypeScript / Vite / Material UI / react-router /
     react-i18next / dnd-kit / dayjs.
   - Deployment shape: single origin behind Apache, systemd units, PostgreSQL
     cluster.
   - How the two halves talk to each other (REST + the notify-and-refetch
     WebSocket channel), and why there is no separate worker process.

   Keep this to an overview — the detail belongs in :doc:`backend/stack` and
   :doc:`frontend/stack`.

.. toctree::
   :maxdepth: 2
   :caption: Contents

   setup/index
   manual/index
   backend/index
   frontend/index

Indices and tables
------------------

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
