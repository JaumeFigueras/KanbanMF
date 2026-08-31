Data model
==========

.. todo::

   Introduce the model layer before the generated reference: the ``Base``
   declarative class, the fact that ``model/__init__.py`` is the single source
   of truth for ``Base.metadata``, the ``src/model/sql/`` DDL files that mirror
   the models for the test schema, and the grouping the reader should have in
   mind (users and identity, boards/lists/cards, per-user personalization,
   notifications).

.. rubric:: Reference

.. autosummary::
   :toctree: generated
   :template: autosummary/module.rst
   :recursive:

   src.model
