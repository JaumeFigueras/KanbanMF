Components
==========

.. todo::

   Reference for ``src/components/``. Group them rather than listing them
   alphabetically:

   - Application shell: ``MainAppBar``, ``AuthControls``, ``GoogleButton``,
     ``LanguageSelector``.
   - Boards overview: ``BoardCard``, ``ArchivedBoardCard``,
     ``CreateBoardDialog`` (empty or from a template),
     ``DuplicateTemplateDialog``, ``ArchiveBoardDialog``, ``DeleteBoardDialog``.
   - Board rendering: ``BoardListColumn``, ``CardItem``, ``CardFace``,
     ``CardDialog``, ``CardDateField``, ``ArchivedListsView``, and
     ``OverdueListColumn`` for the overdue tasks page.
   - Dialogs: colour and rename dialogs for boards, lists and cards
     (``ColorPicker`` underneath); labels (``ManageLabelsDialog``,
     ``EditLabelDialog``, ``CardLabelPickerDialog``); ``ChecklistDialog``;
     ``CopyCardDialog`` and ``CopyChecklistDialog``; ``CreateListDialog``;
     ``ShareBoardDialog`` (shares and invitations); ``SelectUserDialog``.
   - Time tracker: ``StartTimeEntryDialog``, ``TimeEntryDialog``,
     ``DeleteTimeEntryDialog``, and ``CardPicker``, which both entry dialogs
     use and which orders boards and lists by recent use.
   - Account and settings widgets: ``ChangeDisplayNameDialog``,
     ``ChangePasswordDialog``, ``UploadAvatarDialog``, ``PersonAvatar``,
     ``LanguageLocalizationDialog``, ``EmailNotificationDialog``.
   - Routing guards: ``ProtectedRoute``, ``PublicRoute``.
