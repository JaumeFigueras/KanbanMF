API layer
=========

.. todo::

   Introduce the routers: how they are wired up under ``/api/v1``, the nesting
   (lists under a board, cards under a board and list, checklists under a card),
   the separate archived-cards router, the WebSocket endpoint, and the shared
   dependencies in ``deps.py``. A table of endpoints would be more useful here
   than prose.

.. rubric:: Reference

.. autosummary::
   :toctree: generated
   :template: autosummary/module.rst
   :recursive:

   src.main
   src.api
