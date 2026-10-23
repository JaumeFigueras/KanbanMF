Kanban MF documentation
=======================

KanbanMF — *Minimalist and Fast* — is a Kanban application for one person or
a small group: boards of lists of cards, shared with the people you work
with, with due-date reminders, a personal time tracker, and changes that
show up for everyone as they happen.

.. figure:: manual/img/board.png
   :class: hero
   :alt: A board in KanbanMF with four lists of cards, labels and coloured
         due dates.

   A board: lists from left to right, and cards with labels, due dates and
   the people working on them.

*Minimalist* means it does the everyday things of a Kanban board and stops
there: no workflow engine, no plug-ins, no per-board permission schemes —
a board is yours, or shared with someone, and that's all. *Fast* means a
small stack with no moving parts beyond a web server, one API process and a
database, and an interface that updates in place instead of reloading.

What you can do
---------------

.. container:: feature

   .. container:: feature-text

      .. rubric:: Boards and lists

      Organise your work in as many boards as you need, each with its lists
      side by side. Star the boards you use most, arrange them by dragging,
      give each one a colour, and archive the ones you've finished with —
      nothing is lost until you delete it.

      Lists and cards are reordered by drag and drop, and cards move from
      list to list the same way.

      :doc:`More about boards and lists <manual/boards>`

   .. container:: feature-image

      .. figure:: manual/img/boards-overview.png
         :alt: The boards overview, with starred boards, your boards,
               boards shared with you and templates.

.. container:: feature reverse

   .. container:: feature-text

      .. rubric:: Cards with everything they need

      A card can have a description, start, due and end dates, checklists,
      labels, members and assignees, and its own colour. The due date
      changes colour as it gets closer, so what's urgent stands out.

      Copy a card to any list of any board, copy a checklist to another
      card, turn a checklist item into a card of its own, or archive every
      card of a list at once.

      :doc:`More about cards <manual/cards>`

   .. container:: feature-image

      .. figure:: manual/img/card-dialog.png
         :alt: The card dialog with labels, dates, people and checklists.

.. container:: feature

   .. container:: feature-text

      .. rubric:: Templates

      A template is a board that holds only lists. Create a new board from
      one and it starts with the same lists, in the same order, with the
      colours you chose on the template. Templates can be edited like a
      board, shared, duplicated, archived and deleted.

      :doc:`More about templates <manual/templates>`

   .. container:: feature-image

      .. figure:: manual/img/create-board.png
         :alt: Creating a board from a template, with a preview of its lists.

.. container:: feature reverse

   .. container:: feature-text

      .. rubric:: Share with your team

      Share a board with the people you work with. If someone doesn't have
      an account yet, invite them by e-mail: they get a link to sign up, and
      the board is theirs to see as soon as they verify their address.
      Invitations can be cancelled, and expire after 30 days.

      Changes reach everyone who has the board open, as they happen. Colours
      and ordering stay personal: what you choose never changes what the
      others see.

      :doc:`More about sharing <manual/sharing>`

   .. container:: feature-image

      .. figure:: manual/img/share.png
         :alt: The share dialog with two people, a pending invitation and a
               field to invite by e-mail.

.. container:: feature

   .. container:: feature-text

      .. rubric:: Never miss a due date

      Ask for an e-mail before a card is due, on the day, or every day once
      it's late — at the hour you choose, in your own time zone, and only on
      the days of the week you choose. Reminders are personal: each person
      decides for themselves, board by board, and turning them on never
      subscribes anyone else.

      :doc:`More about reminders <manual/notifications>`

   .. container:: feature-image

      .. figure:: manual/img/notifications.png
         :alt: The e-mail reminder settings for a board.

.. container:: feature reverse

   .. container:: feature-text

      .. rubric:: Everything that's late, in one place

      The overdue tasks page gathers every card past its due date from every
      board you can see, grouped by board and list, so you can catch up
      without opening each board.

      :doc:`More about overdue tasks <manual/overdue>`

   .. container:: feature-image

      .. figure:: manual/img/overdue.png
         :alt: The overdue tasks page, with late cards from three boards.

.. container:: feature

   .. container:: feature-text

      .. rubric:: Find any card

      Type a few words in the search box to find the cards that hold them —
      in their names, descriptions, checklists or labels, whatever the
      capitals or accents. Search every board at once or just the one you
      have open, and each result says where it matched.

      Archived cards have searches of their own, in a board's archive and
      among your archived boards, so they never get in the way.

      :doc:`More about searching <manual/search>`

   .. container:: feature-image

      .. figure:: manual/img/search.png
         :alt: The search results, with matching cards grouped by board and
               list.

.. container:: feature reverse

   .. container:: feature-text

      .. rubric:: Track your time

      Start the clock on a card when you begin and stop it when you finish,
      or add the time afterwards, with a comment if you like. See your days
      and months at a glance, spot overlapping entries, and export it all to
      a spreadsheet. Your time entries are private: nobody else sees them.

      :doc:`More about the time tracker <manual/time_tracker>`

   .. container:: feature-image

      .. figure:: manual/img/time-tracker.png
         :alt: The time tracker with a task running and the week's entries.

.. container:: feature

   .. container:: feature-text

      .. rubric:: Your way

      Use KanbanMF in English or Catalan, with the date format and time zone
      you prefer, in a light or a dark theme. Pick your display name,
      initials and avatar, and sign in with an e-mail address and password
      or with Google.

      :doc:`More about your preferences <manual/preferences>` ·
      :doc:`More about your account <manual/accounts>`

   .. container:: feature-image

      .. figure:: manual/img/board-dark.png
         :alt: A board in the dark theme.

Where to go next
----------------

:doc:`manual/index`
   How to use KanbanMF, screen by screen.

:doc:`setup/index`
   How to run it: a development copy, a production deployment, and the
   day-to-day development loop.

:doc:`architecture`
   How it is built, in one page — then :doc:`backend/index` and
   :doc:`frontend/index` for each half and a reference for its code.

KanbanMF is free software under the GNU General Public License v3.0. The
source is at https://github.com/JaumeFigueras/KanbanMF.

.. toctree::
   :maxdepth: 2
   :hidden:
   :caption: Using KanbanMF

   manual/index

.. toctree::
   :maxdepth: 2
   :hidden:
   :caption: Running and developing it

   setup/index
   architecture
   backend/index
   frontend/index

Indices and tables
------------------

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
