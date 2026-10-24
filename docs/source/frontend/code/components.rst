Components
==========

``src/components/`` holds one component per file. Grouped by where they
appear:

Application shell
   ``MainAppBar`` (the top bar on signed-in pages: home link, the search box
   when the page passes a ``search`` scope, time tracker, user menu and its
   dialogs, sign out), ``AuthControls`` (the language and
   theme controls on the sign-in pages), ``LanguageSelector``,
   ``GoogleButton``.

Routing guards
   ``ProtectedRoute`` and ``PublicRoute``.

Boards overview
   ``BoardCard`` (a board or template tile, with its menu and drag handle),
   ``ArchivedBoardCard``, ``CreateBoardDialog`` (empty, from a template, or a
   new template), ``DuplicateTemplateDialog``, ``ArchiveBoardDialog``,
   ``DeleteBoardDialog``, ``ChangeBoardNameDialog``,
   ``ChangeBoardColorDialog``.

The board
   ``BoardListColumn`` (a list: header, menu and its cards),
   ``CreateListDialog``, ``RenameListDialog``, ``ChangeListColorDialog``,
   ``CardItem`` (a draggable card with its menu) around ``CardFace`` (what
   a card shows, reused on the overdue and search pages), ``CardDialog`` (create and edit,
   with labels, dates, people and checklists), ``CardDateField``,
   ``ChangeCardColorDialog``, ``CopyCardDialog`` (also used to extract a
   checklist item into a card), ``ArchivedListsView`` (the archive, which can
   outline one card: where a search of the archive leads), and
   ``CardListColumn``, the read-only column of the overdue and search pages.

Labels, checklists and people
   ``ManageLabelsDialog`` and ``EditLabelDialog`` (the board's labels),
   ``CardLabelPickerDialog`` (a card's labels), ``ChecklistDialog``,
   ``CopyChecklistDialog``, ``SelectUserDialog`` (members and assignees),
   ``PersonAvatar``.

Sharing and notifications
   ``ShareBoardDialog`` (shares, user search, invitations),
   ``EmailNotificationDialog`` (a user's reminders for a board; saves on
   every change).

Time tracker
   ``StartTimeEntryDialog``, ``TimeEntryDialog`` (add and edit),
   ``DeleteTimeEntryDialog``, and ``CardPicker``, the board → list → card
   chooser both entry dialogs use, which offers the most-used boards and
   lists first.

Account
   ``ChangeDisplayNameDialog``, ``ChangePasswordDialog``,
   ``UploadAvatarDialog``, ``LanguageLocalizationDialog``,
   ``ConnectedAppsDialog`` (the apps allowed to reach the user's boards, from
   ``/oauth/grants``: change a connection's boards or read-only flag, revoke
   it; also shows the ``/mcp`` address to give Claude).

Shared pieces
   ``ColorPicker`` (the fixed palette behind every colour dialog).
