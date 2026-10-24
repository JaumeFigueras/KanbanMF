Pages
=====

``src/pages/`` holds one component per route; the routes and their guards are
in ``src/App.tsx`` (see :doc:`../stack`). All API paths below are under
``/api/v1``.

``Boards`` — ``/boards``
   The boards overview: the Starred, My Boards, Shared with me and Templates
   sections (folding state kept in ``localStorage``), the archived boards,
   and the dialogs to create, rename, recolour, share, duplicate, archive and
   delete. Fetches ``/boards``, ``/boards/order`` and ``/boards/archived``;
   saves order, stars and colours as the user changes them.

``Board`` — ``/boards/:boardId``
   One board. Owns the lists and every list's cards (so a card can be dragged
   between lists), the drag-and-drop logic, the sort mode (per board, in
   ``localStorage``), the archive view and the card dialog. Fetches the
   board, the user's colours on it, the lists and their order, and each
   list's cards and card order; refetches on WebSocket events for this
   board. A ``?card=<id>`` query opens that card's dialog once loaded — the
   overdue and search pages link here that way. ``?archive=1`` opens the
   archive view, and ``&highlight=<id>`` outlines a card in it: where a
   search of the archive leads back to.

``OverdueTasks`` — ``/overdue``
   Every overdue card the user can see, from ``/boards/overdue``, grouped by
   board and list; clicking a card opens it on its board.

``SearchResults`` — ``/search``
   The results of a search, laid out like the overdue page, from ``/search``.
   The query and the scope live in the address (``q``, ``board``,
   ``archived``; see ``utils/search.ts``), so the page reloads and goes Back
   like any other. Its own box updates ``q`` in place as you type. Live cards
   open on their board; archived ones lead back to the archive view or to the
   boards page's Archived Boards section (``/boards?archived=1``).

``OAuthConsent`` — ``/oauth/consent``
   Where an app such as Claude asks to reach the user's boards: the backend's
   ``/oauth/authorize`` sends the browser here with ``?request=<id>``. It shows
   who asks, the account signed in, and where the answer goes (with a warning
   when that is a program on this computer), offers the user's own live boards
   (``/oauth/requests/<id>``) and a read-only switch, and sends the browser on
   to the ``redirect_to`` that ``approve`` or ``deny`` answers. With
   ``?error=<code>`` it only explains why the request was stopped.

``TimeTracker`` — ``/time-tracker``
   The running task, the year/month filter, the table of entries grouped by
   day with totals and overlap warnings, the start/add/edit/delete dialogs,
   and the CSV export, built in the browser from the rows on screen. Uses
   ``/time-entries`` and its sub-routes.

``SignIn`` — ``/signin``
   E-mail and password sign-in (``/auth/local/login``), or the Google button.

``SignUp`` — ``/signup``
   Account creation (``/auth/local/register``), in the language chosen on the
   page. With ``?invite=<token>`` it previews the invitation
   (``/invitations/<token>``) and says who invited the user to which board.

``VerifyEmail`` — ``/verify-email``
   Opened from the verification e-mail: posts the token to
   ``/auth/local/verify-email`` and reports the result. Unguarded, so it
   works whether or not the user is signed in.
