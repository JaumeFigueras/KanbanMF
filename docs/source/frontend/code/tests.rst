Tests
=====

The frontend's tests are in two places. The Vitest tests are in
``frontend/src``, each next to the file it tests (``Board.test.tsx`` beside
``Board.tsx``), with their shared set-up and helpers in ``src/test/``. The
end-to-end tests are in ``e2e/``, at the root of the repository, as they run
the backend too. How to run them is in :doc:`../../setup/workflow`; why they
work the way they do is in :ref:`frontend-testing`.

Among the Vitest tests, ``src/i18n/locales.test.ts`` checks that the English
and Catalan locale files have the same keys, and the same ``{{placeholders}}``
in each text, so a text added to only one of them fails that test.

``src/test/``
-------------

``setup.ts``
   Runs before every test file (``setupFiles`` in ``vite.config.ts``). Before
   any test, it adds jest-dom's matchers (``toBeInTheDocument()`` and the
   like), lets ``waitFor`` and ``findBy…`` wait up to 10 seconds, swaps in
   Node's ``File`` and ``FormData`` for jsdom's (Node's ``fetch``, and so
   MSW, can't send jsdom's), makes ``scrollIntoView`` do nothing (jsdom has
   no layout, and dnd-kit calls it), and starts the fake backend and then the
   fake WebSocket. Before each test it switches to English; after each, it
   unmounts what the test drew, drops the endpoints the test declared,
   brings back the real clock, and clears the access token, the socket and
   the storage; last, it fails the test if a request reached no endpoint.

``server.ts``
   The MSW server every test talks to: the fake backend. It starts with no
   endpoints. A request none answers fails, without reaching the network,
   and MSW prints an error naming it; it's also kept, as ``GET /path``, until
   ``takeUnansweredRequests()``, which ``setup.ts`` calls after each test.

``endpoints.ts``
   ``fakeEndpoint(method, path, answer)`` makes the fake backend answer a
   request (204 unless told otherwise) and records each it gets: the address,
   with its query, and the body as the backend would read it (JSON as an
   object, a form as ``FormData``, nothing as ``null``). ``heldAnswer()``
   holds an answer back until the test releases it, to look at the page
   while its request runs; it's released when the test ends, if not before.
   ``SERVER_ERROR`` and ``DROPPED`` are the two ways a load fails: an error
   status, or the connection dropping before any answer.

``render.tsx``
   ``renderWithProviders(ui, options)``: draws a component inside what the
   app gives it — the MUI theme, light or dark, and a router at the address
   given, with a route pattern if the component reads its params. With
   ``auth``, it also signs in as a test user, answering the start-up refresh
   and ``/users/me``; with ``strictMode``, it runs effects twice on mount, as
   development does. It returns Testing Library's result plus ``user``, a
   ``user-event`` instance for clicking and typing. The providers are a
   wrapper, so ``rerender()`` keeps them.

``fixtures.ts``
   ``makeUser()``, ``makeBoard()``, ``makeList()``, ``makeLabel()``,
   ``makeCard()``, ``makePerson()`` and ``makeTimeEntry()``: complete, valid
   API objects with plain defaults, given only what the test is about, and
   with readable ids (``card-3``), so a failing assertion says which object.

``fakeWebSocket.ts``
   ``FakeWebSocket``, which stands in for the browser's WebSocket in every
   test: it keeps every socket opened since the last test (``instances``) and
   what the app sent on each (``sent``). A test plays the server with
   ``open()``, ``receive()`` (a notification) and ``serverClose()`` (1006, a
   dropped connection, or 1008, the token refused). The app's ``close()``
   works as in a browser: the socket is closing at once, and the close event
   comes afterwards.

``reconnect.ts``
   ``dropAndReconnect(socket)``: drops the connection and opens the next
   socket at once (``ws.ts`` waits three seconds; its own tests check that),
   and returns the new socket, open. For the pages that fetch again after a
   reconnect.

``drag.ts``
   ``pickUp()`` picks a drag handle up with the keyboard, as its
   instructions say, and ``heard()`` waits until dnd-kit's live region tells
   a screen reader a text. The region is found by its role, so one that an
   open dialog hides from screen readers doesn't count.

``blockSiteData.ts``
   ``blockSiteData()`` makes the browser refuse its storage, as one that
   blocks site data does: even reading ``window.localStorage`` or
   ``window.sessionStorage`` throws. ``setup.ts`` gives it back after each
   test (``restoreSiteData()``).

``cardChoices.ts``
   What the time tracker's card picker chooses from — boards and lists,
   most used first, and each list's cards — and ``fakeCardChoices()``, which
   answers its three loads with them; any of the three can be swapped for
   another answer, such as a failure or a held one. Used by the tests of
   ``CardPicker``, the two time entry dialogs and the time tracker.

``node-buffer.d.ts``
   Declares the one part of Node's API that ``setup.ts`` uses
   (``node:buffer``'s ``File``), instead of adding all of Node's types to
   the app's ``tsconfig``, where they would change the types of browser
   globals such as ``setTimeout``.

``endpoints.test.ts`` and ``render.test.tsx`` test these helpers
themselves, so a broken helper shows up there rather than as puzzling
failures elsewhere.

``e2e/``
--------

``conftest.py``
   The harness, as pytest fixtures. For the whole run, each started once,
   on free ports: a throwaway PostgreSQL with the schema built by Alembic
   (``database_url``), the backend on it with e-mail and Google sign-in off
   (``backend_url``), production's Content-Security-Policy, read from
   ``deploy/apache-kanbanmf.conf`` (``csp``), the production build served
   by ``vite preview`` with that policy (``frontend``), and Chromium
   (``browser``, shown with ``HEADED=1``). For each test:

   - ``context`` and ``page``: a browser context of the test's own (cookies,
     storage) in British English and the ``Europe/Madrid`` time zone, and a
     page in it. Any error in its console, or any exception the page doesn't
     catch, fails the test (``browser_errors``), and a failed test leaves its
     trace in ``e2e/test-results/``.
   - ``make_user``: a verified user, made in the database, with an address no
     other test uses.
   - ``sign_in``: signs the test's browser in as a user: a session in the
     database, and its refresh cookie in the browser.
   - ``another_browser``: a page in a second browser context, signed in as
     someone else; its errors fail the test too.
   - ``api``: a REST client signed in as a user, straight to the backend, to
     build what a test needs and check what the page saved. It sends no
     client id, so its changes reach every open page, as another person's
     would.
   - ``make_board``: a board made through the API, with its lists and their
     cards, in that order.

   With ``E2E_COVERAGE`` set (``make test-e2e-cov``) the build has source
   maps, and each page's V8 coverage goes to ``test-results/coverage/``.

``dragging.py``
   Dragging with the mouse and moving with the keyboard, for every drag
   area: ``drag()`` moves a handle until the middle of what it drags is
   over a target, without letting go; ``let_go()`` lets go, or presses a key,
   and waits until each change the drop should send is saved; ``pick_up()``,
   ``press()`` and ``heard()`` move with the keyboard and check what a screen
   reader is told; ``changes()`` and ``nothing_sent()`` check what the page
   sends; ``names()`` reads the handles' names in the page's order or as
   they're seen on screen, which differ during a drag; ``eventually()``
   reads something again until it's what the test expects.

``board_page.py``
   The board page: a list's column and a card, found by their handles'
   names (by CSS, as while a card is dragged its place is kept by a hidden
   copy that the accessibility tree leaves out); ``expect_cards()`` and
   ``expect_lists()``; ``drag_card()``; ``open_board()``; and
   ``order_put()`` and ``move_patch()``, the changes a card's move sends.

``live_updates.py``
   What a page is told over its WebSocket: ``notifications()`` records each
   notification's type as the page gets it; ``listening()`` waits until
   every page is told of changes, by making one that changes nothing
   (``unchanged_list_order()``) until each has been told of it;
   ``wait_until()`` waits for a condition while letting Playwright report
   what happens on the page.

``coverage.mjs``
   Run by ``make test-e2e-cov`` after the tests: maps the V8 coverage the
   pages left back to ``frontend/src`` through the build's source maps,
   prints each file below 100 % with the lines never run, then the total,
   and writes the merged data to ``test-results/coverage/coverage-final.json``.

The test files
~~~~~~~~~~~~~~

``test_signing_in.py``
   The sign-in form; a reload keeping you signed in; two tabs loading at
   once both staying signed in, as they take turns at the refresh; signing
   out ending the session; production's CSP in force, with the pages
   keeping to it.

``test_dragging_on_the_board.py``
   Lists and cards, with the mouse and the keyboard: what each move saves
   and keeps after a reload, under each sort mode; Escape putting a card
   back; moves that can't be saved going back (refused, without a
   connection, a card moved meanwhile by someone else, a list still loading
   or that couldn't be loaded); the board's own rule for the arrow keys;
   what a screen reader is told, in Catalan too.

``test_dragging_board_tiles.py``
   The boards page's tiles, in each of its four sections: each person's
   order their own, a move that can't be saved going back, and moving with
   the keyboard.

``test_dragging_labels.py``
   The Labels dialog: a new order kept, and shown on the cards; an order
   refused going back, and trying again working; moving with the keyboard,
   with Escape cancelling the move and leaving the dialog open.

``test_dragging_checklists.py``
   A card's checklists in the card dialog, and a checklist's items in its
   dialog, with the mouse and the keyboard: nothing sent until Save, and the
   order sent then naming what was added elsewhere after the rest; a
   checklist made in the dialog moved before the others.

``test_two_people_at_once.py``
   Two people on a shared board, each in a browser of their own: cards,
   lists, labels and checklist items changed by one reaching the other's
   page, with nothing fetched again by the page that made the change; an
   open card changed by the other; a board shared with you appearing on the
   boards page, and one archived or unshared while you're on it closing to
   you; a card dragged while the other changes both its lists; what changed
   while the connection was down, shown once it's back.

``test_claude_connection.py``
   The test plays Claude: connecting through the sign-in page when signed
   out; a read-only connection to one board, which reaches nothing else and
   changes nothing; a card Claude makes showing on the open board as
   ``TBR: …``; Deny sending ``access_denied`` back; an app revoked in
   Connected apps having its tokens refused.
