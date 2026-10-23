Components
==========

``src/components/`` holds one component per file. Grouped by where they
appear:

Application shell
   ``MainAppBar`` (the top bar on signed-in pages: home link, time tracker,
   user menu and its dialogs, sign out), ``AuthControls`` (the language and
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
   a card shows, reused on the overdue page), ``CardDialog`` (create and edit,
   with labels, dates, people and checklists), ``CardDateField``,
   ``ChangeCardColorDialog``, ``CopyCardDialog`` (also used to extract a
   checklist item into a card), ``ArchivedListsView`` (the archive), and
   ``OverdueListColumn`` for the overdue page.

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
   ``UploadAvatarDialog``, ``LanguageLocalizationDialog``.

Shared pieces
   ``ColorPicker`` (the fixed palette behind every colour dialog).
