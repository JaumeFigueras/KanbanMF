Schemas
=======

The Pydantic models in ``src.schemas`` are the API's contract: what a request
body may contain and what a response looks like. There is one module per
resource, and most follow the same pattern:

``…Create``
   The body of a ``POST``. Required fields are required; validators reject
   what the database would otherwise accept — a blank name, a colour that
   isn't ``#RRGGBB``, a start date after the end date — and normalise what
   they keep (names are stripped, colours upper-cased).

``…Update``
   The body of a ``PATCH``: every field optional, and a field left out is
   left alone. Where a value can be cleared — a card's dates, a time entry's
   comment — the route checks which fields the client actually sent
   (``model_fields_set``), so sending ``null`` clears it.

``…Read``
   A response, built from the ORM object (``from_attributes``) or assembled
   by the route when it combines several tables — a card with its labels,
   people and checklists, or a board with the caller's star and owner.

``…OrderUpdate`` / ``…OrderRead``
   The full ordered list of ids for a reorder: the client always sends the
   whole order, never a single move.

``PersonRead`` (:mod:`src.schemas.person`) is the one summary of a user —
name, initials, whether they have an avatar — used wherever a person appears.

.. rubric:: Reference

.. autosummary::
   :toctree: generated
   :template: autosummary/module.rst
   :recursive:

   src.schemas
