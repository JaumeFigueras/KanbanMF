Stack and how it works
======================

The stack
---------

React 19 and TypeScript
   Function components and hooks throughout; the TypeScript build
   (``tsc -b``) is part of ``npm run build``, so a type error stops a build.

Vite
   The development server, with hot reloading and the ``/api`` proxy, and
   the production build into ``frontend/dist``.

Material UI (MUI)
   Every component on screen, the light and dark themes, and the date and
   time pickers (``@mui/x-date-pickers``).

react-router
   The routes, in ``src/App.tsx``.

react-i18next
   The English and Catalan interface.

dnd-kit
   Dragging boards, lists, cards, labels and checklists into order.

dayjs
   Dates: parsing, arithmetic, and formatting in the user's locale.

The application shell
---------------------

``src/main.tsx`` mounts ``App`` inside ``ThemeToggleProvider``.
``src/App.tsx`` applies the light or dark MUI theme, sets up the router and
wraps every route in ``AuthProvider``. The routes are:

.. list-table::
   :header-rows: 1
   :widths: 30 25 45

   * - Path
     - Page
     - Guard
   * - ``/boards``
     - ``Boards``
     - ``ProtectedRoute``
   * - ``/boards/:boardId``
     - ``Board``
     - ``ProtectedRoute``
   * - ``/time-tracker``
     - ``TimeTracker``
     - ``ProtectedRoute``
   * - ``/overdue``
     - ``OverdueTasks``
     - ``ProtectedRoute``
   * - ``/search``
     - ``SearchResults``
     - ``ProtectedRoute``
   * - ``/oauth/consent``
     - ``OAuthConsent``
     - ``ProtectedRoute``
   * - ``/signin``, ``/signup``
     - ``SignIn``, ``SignUp``
     - ``PublicRoute``
   * - ``/verify-email``
     - ``VerifyEmail``
     - none — it must work signed in or out
   * - anything else
     - redirect
     - to ``/boards`` if signed in, ``/signin`` if not

``ProtectedRoute`` shows a spinner while ``AuthProvider`` checks the session,
then either the page or a redirect to ``/signin``; ``PublicRoute`` sends a
signed-in user to ``/boards``.

A page that sends the user to sign in is where they come back to afterwards:
``ProtectedRoute`` keeps its path in ``sessionStorage`` (``utils/returnTo.ts``),
and ``SignIn``, ``PublicRoute`` and the ``/`` redirect go there instead of
``/boards``; the next protected page shown clears it. It lives in
``sessionStorage`` rather than in router state because Google sign-in leaves
the app and comes back to ``/`` through the backend. This is what takes Claude's
connection request through sign-in to the consent page, and it also brings an
expired session back to the board it was on.

Signing in and staying signed in
--------------------------------

``AuthProvider`` (``src/context/AuthContext.tsx``) owns the session. On start
it has no access token: it asks for one with the refresh cookie (below) and,
if there is a session, calls ``/api/v1/users/me``, which also sets the
interface language from the user's preferences. No session, and the user is
signed out.

The tokens themselves are explained in :doc:`../backend/stack`: a 15-minute
access token the frontend keeps, and a 30-day refresh token in an
``HTTP-only`` cookie it never sees. The access token is kept **only in
memory**, in ``src/api/client.ts`` — never in ``localStorage``, where any
script running in the page could read it at any time and where it stayed on
disk after the browser closed. The price is one refresh per page load and per
tab.

Each refresh rotates the cookie, which every tab shares: two tabs refreshing
at the same moment would send the same cookie, and the one that lost the race
would be signed out. ``refreshAccessToken()`` therefore takes a Web Lock
(``navigator.locks``) around the request, so the tabs take turns and the
second one sends the cookie the first one just received. Within a tab,
concurrent callers share one refresh.

Talking to the API
------------------

Every authenticated call goes through ``apiFetch()`` in
``src/api/client.ts``. It adds the ``Authorization`` header and the tab's
``X-Client-Id``, and when an answer is ``401`` it refreshes the access token
once through the cookie and repeats the request. Callers never deal with
expiry. Concurrent ``401``\s share a single refresh instead of each starting
their own, which matters because a refresh token works only once.

Relative URLs only
~~~~~~~~~~~~~~~~~~

Every call uses a **relative** URL — ``/api/v1/...`` — and the WebSocket URL
is built from ``window.location``. The page and the API therefore always
share an origin:

- in development, Vite serves the page on port 5173 and proxies ``/api``,
  WebSocket upgrades included, to ``http://localhost:8000``
  (``frontend/vite.config.ts``), and ``/mcp`` and ``/.well-known/oauth-*``
  too, so the MCP server can be tried at ``http://localhost:5173/mcp``;
- in production, Apache serves the built page and proxies ``/api`` (and
  ``/mcp`` and the OAuth discovery documents) to the backend
  (:doc:`../setup/production`).

In production the page is served with a Content-Security-Policy
(``deploy/apache-kanbanmf.conf``): scripts only from this site — no inline
``<script>``, no ``onclick=``, no ``eval`` — styles from this site or inline
(Emotion writes them at run time), images from this site or ``blob:``, and
requests only to this site. The development server sends no such header, so
something that breaks it only shows in production: a font or script from a
CDN, an image from another host, or a ``data:`` URL needs the policy changed
first.

No CORS, no host or port to configure, and the cookie just works. A hardcoded
``http://localhost:8000`` would seem to work in development and break in
production, where the browser can't reach port 8000 at all. New code should
use ``apiFetch`` with a relative path.

Real-time updates
-----------------

``src/api/ws.ts`` keeps one WebSocket per tab, opened when the user signs in,
closed when they sign out, and reopened three seconds after it drops. Its
first message is ``{"type": "auth", "token": ...}`` with the access token:
the token isn't in the address, which the web server logs. If the backend
refuses it (close code 1008 — usually a token that expired while the computer
slept), the client refreshes the token three seconds later, which reconnects
it, or signs the user out if the session is gone. Messages say what changed — ``card_moved`` on such board and
list — and are handed to every subscriber.

Pages subscribe with ``subscribeToNotifications()`` and react by refetching:
the board page reloads its lists on a ``list_*`` event for its board, and one
list's cards on a ``card_*`` event naming that list. It never tries to apply
the change to its state by itself, so what it shows is always exactly what the
server returns, per-user colours and order included. A message tagged with
the tab's own client id (``isOwnNotification()``) is ignored: that tab made
the change and already shows it.

.. graphviz::
   :caption: One change, every other tab.
   :alt: A user action calls the REST API; the backend notifies all tabs; the
         other tabs refetch over REST.

   digraph flow {
     rankdir=LR;
     node [shape=box, style="rounded,filled", fillcolor="#E3F2FD", color="#1976D2"];
     edge [color="#555555"];
     action [label="User action\nin tab A", fillcolor="#FFF3E0", color="#F57C00"];
     rest   [label="apiFetch\nPATCH /api/v1/…"];
     api    [label="Backend"];
     ws     [label="ws.ts\nin every tab"];
     refetch[label="Tab B: apiFetch GET\n→ new state", fillcolor="#E8F5E9", color="#388E3C"];
     ignore [label="Tab A: own change,\nignored", fillcolor="#F5F5F5", color="#9E9E9E"];
     action -> rest -> api -> ws;
     ws -> refetch;
     ws -> ignore [style=dashed];
   }

The tab id is a random UUID in ``sessionStorage`` — not ``localStorage`` — so
two tabs of the same browser count as two clients.

Drag and drop
-------------

dnd-kit drives every reorder. On a board, lists and cards share one
``DndContext``, because a card can move from one list's column to another's;
a custom collision rule makes a dragged list only look at other lists. While
dragging, the page moves the item in its own state so the drop feels
immediate, then saves:

- a list's new position as the board's full list order;
- a card moved to another list with a ``PATCH`` of its ``list_id``;
- a card's new position, in the *custom* sort order, as the list's full card
  order.

Under the *due date* sort, only cards without a due date can be reordered by
hand, and under the alphabetical sorts positions aren't saved at all; see
``src/utils/cardSort.ts``. The boards page orders board tiles the same way,
per section, and dialogs reorder labels, checklists and checklist items.

Theming and colours
-------------------

``src/theme/index.ts`` holds the light and dark MUI themes;
``ThemeToggleContext`` switches between them and remembers the choice in
``localStorage``, per browser. Board, list and card colours come from the
API — they are per user — and are applied as tints, blended into an opaque
colour where tints nest (a card on a coloured list) so they don't bleed into
each other (``src/utils/colorTint.ts``). Pickers offer the fixed palette in
``src/utils/colorPalette.ts``.

What the browser keeps
----------------------

``localStorage``: the access token, the theme, each board's card sort mode,
and which sections of the boards page are folded. ``sessionStorage``: the
tab's client id. Everything else comes from the server on every load.

Internationalisation
--------------------

``src/i18n/index.ts`` sets up i18next with two languages, English and
Catalan, from ``locales/en.ts`` and ``locales/ca.ts``. English is the default
and the fallback for any missing key. Signed out, the language box on the
sign-in page decides; signed in, the user's preference does, applied when the
session is checked and whenever the user changes it.

Dates are formatted separately from the language: the user's *dates & times
format* (``en``, ``en_GB`` or ``ca_ES``) picks the ``Intl`` and dayjs locale
(``src/utils/locale.ts``), so the interface can be in English with European
dates.

A new text means a new key in **both** ``en.ts`` and ``ca.ts``.

Conventions for new UI
----------------------

- One component per file in ``src/components/``; one file per route in
  ``src/pages/``.
- API calls through ``apiFetch`` with relative URLs.
- Every visible text through ``t('…')``, with its key in both locale files.
- Subscribe to WebSocket events and refetch, rather than patching state
  from a notification.
