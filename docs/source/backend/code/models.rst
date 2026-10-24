Data model
==========

Every model inherits from ``Base`` (:mod:`src.model.base`), one module per
table. ``src/model/__init__.py`` imports and re-exports all of them, which
makes it the single source of truth for ``Base.metadata``: Alembic compares
the database with it to generate migrations, so a model that isn't imported
there is invisible to Alembic.

The SQL files in ``src/model/sql/`` hold the same schema as plain DDL, one
file per table plus ``all.sql``. The test suite builds its databases from
them, not from the migrations; :doc:`../../setup/workflow` explains how to
keep them in step.

The models fall into groups; :doc:`../stack` describes each:

- **Users and sign-in:** :mod:`~src.model.user`, :mod:`~src.model.user_identity`,
  :mod:`~src.model.user_session`, :mod:`~src.model.user_avatar`,
  :mod:`~src.model.user_preferences`.
- **Boards, lists and cards:** :mod:`~src.model.board`,
  :mod:`~src.model.board_share`, :mod:`~src.model.user_board_star`,
  :mod:`~src.model.board_list`, :mod:`~src.model.card`,
  :mod:`~src.model.checklist`, :mod:`~src.model.checklist_item`,
  :mod:`~src.model.label` and the association tables
  :mod:`~src.model.card_member`, :mod:`~src.model.card_assignee`,
  :mod:`~src.model.card_label`.
- **Personalisation and order:** :mod:`~src.model.ui_board_color`,
  :mod:`~src.model.ui_list_color`, :mod:`~src.model.ui_card_color`,
  :mod:`~src.model.ui_board_order` (per user), and
  :mod:`~src.model.ui_board_list_order`, :mod:`~src.model.ui_list_card_order`
  (per board).
- **Notifications:** :mod:`~src.model.board_notification_settings`,
  :mod:`~src.model.board_notification_offset`,
  :mod:`~src.model.card_due_notification`.
- **Invitations:** :mod:`~src.model.board_invitation`.
- **Time tracking:** :mod:`~src.model.time_entry`,
  :mod:`~src.model.time_tracker_board_usage`,
  :mod:`~src.model.time_tracker_list_usage`.
- **Connected apps (OAuth for the MCP server):** :mod:`~src.model.oauth_client`,
  :mod:`~src.model.mcp_grant`, :mod:`~src.model.mcp_grant_board`,
  :mod:`~src.model.oauth_authorization_request`,
  :mod:`~src.model.oauth_authorization_code`, :mod:`~src.model.oauth_token`.

Most columns carry a ``comment``, which ends up in the database too and is
shown in the reference below.

.. rubric:: Reference

.. autosummary::
   :toctree: generated
   :template: autosummary/module.rst
   :recursive:

   src.model
