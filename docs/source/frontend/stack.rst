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
signed-in user to ``/boards``. When the check gets no answer at all (see
`Signing in and staying signed in`_), ``ProtectedRoute`` shows
``UnreachablePage`` instead — *KanbanMF couldn't be reached*, with
:guilabel:`Try again` — and the ``/`` redirect goes to the boards to show it.

A page that sends the user to sign in is where they come back to afterwards:
``ProtectedRoute`` keeps its path in ``sessionStorage`` (``utils/returnTo.ts``),
and ``SignIn``, ``PublicRoute`` and the ``/`` redirect go there instead of
``/boards``; the next protected page shown clears it. It lives in
``sessionStorage`` rather than in router state because Google sign-in leaves
the app and comes back to ``/`` through the backend. This is what takes Claude's
connection request through sign-in to the consent page, and it also brings an
expired session back to the board it was on.

Signing out is not an expired session: the next sign-in on that tab, perhaps
someone else's, starts at ``/boards``. ``logout()`` sets the context's
``loggedOut`` flag, and ``ProtectedRoute`` remembers nothing while it is set
(the next ``login()`` clears it). The flag is needed because the order of
events can't be relied on: React Router applies the navigation to ``/signin``
as a transition, after the render in which the token is already gone, so
``ProtectedRoute`` first sees the page it is on with no session.

``logout()`` never rejects. When the server can't confirm the sign-out (no
answer, or a server error) it still signs the page out, but the refresh cookie
may still be good, and opening the app again would sign back in; it then also
sets ``signOutUnconfirmed`` (until the next ``login()``), and the sign-in page
shows a warning. That flag is in the context too, not in the router state of
the navigation to ``/signin``, for the same reason: ``ProtectedRoute``'s own
redirect to ``/signin`` can land after it and replace it.

Whatever can be clicked can also be reached with the keyboard, and is
announced by screen readers for what it is: a link when it leads to another
page, a button when it acts on this one. A ``Box`` or ``Typography`` with an
``onClick`` is neither, and :kbd:`Tab` skips it. That is how the top bar's
profile, its KanbanMF title and the cards on the overdue and search pages
used to be. The profile is now a ``ButtonBase`` that says it opens a menu
(``aria-haspopup``, ``aria-expanded``, ``aria-controls``). The title is a
``Link`` to ``/boards``, and each card a ``CardActionArea`` rendered as a
router link, so both also open in a new tab. So were the buttons that led
to another page by calling ``navigate()``: the board tiles,
:guilabel:`Show Overdue Tasks`, the time tracker's button, the back buttons
and the search page's matching boards. Each is now the same MUI component
rendered as a router link (``component={RouterLink}``), so it looks as it
did. A tile is dragged by its handle only, so its body can be a link. The
cards on a board are the one exception: the card itself only takes a click,
but its menu button has :guilabel:`Edit card`.

Every button has a name, in the page's language. The buttons that every
board, list or card repeats are named after it — "Menu for Website
redesign", "Add a card to To do", "Move the list Doing" — or a screen
reader's list of buttons would show the same name over and over. A tooltip
names the button it wraps, but a name the button gives itself wins, so a
tile's star shows "Star" and is called "Star Website redesign". So are the
buttons each item repeats in the checklist dialog, after the item's number,
as its field is: "Remove item 2" beside "Item 2". The signed-out pages'
controls (language, theme, show password) are translated like everything
else. Where a form has more than one password, each show-password button
says which: "Show the repeated password" on the sign-up page, "Show the
current password" and "Show the new password" in the change-password
dialog. :kbd:`Tab` reaches each, after its field.

Signing in and staying signed in
--------------------------------

``AuthProvider`` (``src/context/AuthContext.tsx``) owns the session. On start
it has no access token: it asks for one with the refresh cookie (below) and,
if there is a session, calls ``/api/v1/users/me``, which also sets the
interface language from the user's preferences. No session, and the user is
signed out.

Only a refusal ends a session: the refresh answering ``401`` or ``403``
(no session, or not any more), or ``/users/me`` doing so. No answer, or a
server error — the proxy's ``502`` while the backend restarts, a laptop
waking up before its network — says nothing about the session, which may
well still be good, so nothing is decided on it:

- ``/users/me`` failing that way leaves the user signed in; the top bar says
  it couldn't load the profile (below), and loads it again on every page.
- The start-up refresh failing that way sets ``unreachable``, and
  ``ProtectedRoute`` says so with :guilabel:`Try again`, which runs the check
  again (``retryStartUp()``). The signed-out pages are shown as usual: they
  report a failed request themselves.
- In the middle of work, ``refreshAccessToken()`` rejects with
  ``RefreshUnanswered`` and keeps the token as it is. The request that needed
  it fails like a dropped connection, so its page says it couldn't load or
  save, and the next ``401`` tries the refresh again.

All three used to sign the tab out: the user landed on the sign-in page with
a session that was still good, and only a reload, once the server answered,
signed them back in.

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

When a load fails
~~~~~~~~~~~~~~~~~

A page that reads ``r.ok ? r.json() : []`` turns a server error into "no
boards" or "no overdue tasks", which reads as an answer. Loads go through
``loadJson()`` instead, which rejects anything but an ``ok`` answer just as a
dropped connection, and the page keeps where its load stands in a
``LoadState`` — ``'loading'``, ``'failed'`` or ``'loaded'``. Its "nothing
here" text shows only once ``'loaded'``; ``'failed'`` shows a ``LoadFailure``
with :guilabel:`Try again` in its place, and the boards page, the archive,
the overdue tasks and the time tracker show nothing at all while
``'loading'``. Try again goes back to ``'loading'`` first, so a second failure
shows as a new answer rather than as nothing happening. The search page shows
:guilabel:`Searching…` until its answer, and keeps a failure with the query it
belongs to, as it keeps its results.

A fetch made again later — on a notification, or after a change that
failed — replaces what was there when it fails too: the page can no longer
tell whether what it shows is still true. On the board, a list whose cards
couldn't be loaded says so in its column and loses the cards it showed; the
board doesn't ask for them again on its own (Try again does), and a card
dropped on it goes back, since the order the drop saves would leave out the
cards not shown. The board itself, or its lists, failing replaces the whole
page.

The boards page and the board page also ask ``/users/me`` who the user is,
and that answer is part of their load. On the boards page it tells which
templates are the user's own (the Templates section mixes theirs with shared
ones); on the board page it tells whether the user owns the board, which
shows :guilabel:`Delete` in the archive. Without it, a template of the user's
would look like someone else's and Delete would be missing, without a word.
So the boards page shows its sections once both the boards and that answer
are in, and its failure shows the same ``LoadFailure`` as the boards'; on the
board page it fails the page as the board does. Try again asks again for
whichever failed.

A board's lists refused (``403`` or ``404``) most likely mean the board was
taken away — unshared, archived for someone it was shared with, deleted —
and the board's own answer then shows the Forbidden page. The lists usually
answer first, though, so saying they couldn't be loaded would flash on the
way to Forbidden. A refused list asks for the board again instead, and waits
for that answer: Forbidden, or, if the board still opens, the lists' failure.
``loadJson()`` rejects with an ``HttpError`` carrying the status, which is
how the page tells a refusal from a server error; any other failure of the
lists says so at once. A notification that fetches the lists after the user
lost the board thus also ends on Forbidden.

The top bar loads the user's profile on every signed-in page. A failure leaves
the page where it is, and puts :guilabel:`Try again` at the top of the user
menu. The name and the language dialogs start from that profile, and save
every field they show, so their menu entries wait for it rather than open on
defaults. (The bar used to go to ``/signin``, which sends a signed-in user on
to the boards, whose bar failed the same way: the board or search the user was
on was lost, and while the failure lasted the page bounced between the two.)
An expired session needs nothing from the bar: the refused refresh clears the
token, and ``ProtectedRoute`` goes to ``/signin``, remembering the page.

The signed-out pages keep the same line between no answer and a refusal.
Signing in, signing up and the verification link say *KanbanMF couldn't be
reached* when the request gets no answer, and *Something went wrong* when the
server fails; only the backend's own refusal says the password is wrong, the
link invalid or expired, or the invitation no longer valid — told by the
status, and by ``detail`` where one status covers several things (a 400 from
``/register`` is an expired invitation only with that ``detail``, and a 422
is the address only when its ``loc`` names it). The invitation preview is a
load like the others, with a ``LoadFailure``, and :guilabel:`Create account`
waits for it, since it decides which address is locked.

Real-time updates
-----------------

``src/api/ws.ts`` keeps one WebSocket per tab, opened when the user signs in,
closed when they sign out, and reopened three seconds after it drops. Its
first message is ``{"type": "auth", "token": ...}`` with the access token:
the token isn't in the address, which the web server logs. If the backend
refuses it (close code 1008 — usually a token that expired while the computer
slept), the client refreshes the token three seconds later, which reconnects
it, or signs the user out if the session is gone. A refresh that gets no
answer is tried again every three seconds, until one is answered, the user
signs out, or a token got by a page's request has reconnected the socket. Messages say what changed — ``card_moved`` on such board and
list — and are handed to every subscriber.

Pages subscribe with ``subscribeToNotifications()`` and react by refetching:
the board page reloads its lists on a ``list_*`` event for its board, and one
list's cards on a ``card_*`` event naming that list. It never tries to apply
the change to its state by itself, so what it shows is always exactly what the
server returns, per-user colours and order included. A message tagged with
the tab's own client id (``isOwnNotification()``) is ignored: that tab made
the change and already shows it.

Several changes in a row send several messages, and so several requests for
the same thing, whose answers can come back in any order: an older one
arriving last would put back what the newer one replaced. Every page that
fetches the same thing again sends those requests through a ``latestOnly()``
tracker (``src/utils/latest.ts``), keyed by what they fetch, which drops any
answer a newer request with the same key has replaced: the board's lists,
each list's cards and the colours; the boards page's boards and archived
boards; the overdue tasks; and the time tracker's entries, for a month
changed quickly. The search page uses one key for every search, whatever its
query: it keeps its answer with the query it belongs to, so an answer for an
older query never showed, but arriving after the new query's it replaced
those results, and the page said *Searching…* over results it had received.

The board loads the cards of each list it hasn't shown yet in one effect,
which runs again whenever another list's cards arrive; it skips the lists
whose cards are already on their way, or each answer would ask again for
every list still waiting.

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

The tab id is a random UUID kept in memory, new on every page load, so two
tabs of the same browser count as two clients — even a duplicated tab, which
gets a copy of the other one's ``sessionStorage``.

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

The card's order waits for its move, since the backend refuses an order that
names a card it still has in another list. If either is refused, or isn't
sent at all, the board puts the lists the drag touched back as they were when
it started (it keeps a copy of every list's cards and order at the start),
fetches them again, and says so in a ``FailureMessage`` at the foot of the
page. With a connection, the fetch shows whatever the server has; without
one, it fails too, and those lists say their cards couldn't be loaded (see
`When a load fails`_). A list reorder,
and a tile on the boards page, go back the same way. The other changes made
on these pages without a dialog — archiving a card or a list from its menu,
*Archive All Cards*, a star, restoring a board, list or card — leave the page
as it was when they fail (a star goes back) and say so the same way; the
archives and restores also fetch again what they touched, in case it changed
elsewhere meanwhile. The time tracker says the same when the task being
tracked can't be ended; a refused end fetches the month again, as the task
may have been ended or deleted in another tab, which no notification would
tell it (time entries are private, so they send none). Both its
:guilabel:`End` buttons are disabled while an end is on its way.

Theming and colours
-------------------

``appTheme(dark, language)`` (``src/theme/index.ts``) builds the MUI theme:
light or dark, with MUI's own texts in the given language (see
:ref:`below <frontend-mui-texts>`). ``AppThemeProvider`` builds it again when
either changes: ``ThemeToggleContext`` switches light and dark and remembers
the choice in ``localStorage``, per browser, and the language comes from
i18next. Board, list and card colours come from the
API — they are per user — and are applied as tints, blended into an opaque
colour where tints nest (a card on a coloured list) so they don't bleed into
each other (``src/utils/colorTint.ts``). On the board page, the viewer's
colour for every list and card is in one map, fetched with the lists. Columns
and cards draw from it and keep no colour of their own, and a colour saved
from a menu goes back into the map. That way the floating copy of a dragged
list or card, and a card drawn afresh in the list it's dropped in, all show
it. Pickers offer the fixed palette in ``src/utils/colorPalette.ts``.

What the browser keeps
----------------------

``localStorage``: the theme, each board's card sort mode, and which sections
of the boards page are folded. ``sessionStorage``: the page to come back to
after signing in. The access token and the tab's client id stay in memory
only, so every page load starts without them. Everything else comes from the
server on every load.

All of it goes through ``src/utils/storage.ts`` (``readStored``,
``writeStored``, ``removeStored``), and ``eslint.config.js`` refuses any other
use of ``localStorage`` or ``sessionStorage`` in the app's code. A browser that
blocks site data throws as soon as either is read — a ``SecurityError`` from
the property itself, not only from its methods — and a full storage throws on
writing. Read straight, that was a blank page, since the theme is read before
anything is drawn; through these functions the app works and only forgets. What
is read back is checked too: a sort mode that isn't one is the custom order,
and only true or false is taken for a folded section. The tests block the
storage with ``blockSiteData()`` (``src/test/blockSiteData.ts``).

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

.. _frontend-mui-texts:

MUI writes some texts of its own: a drop-down's arrow and clear buttons and
its "No options" and "Loading…", an alert's close button, and everything in
the date pickers (the dialog's title, its tabs and buttons, the clock's
columns, the empty field's ``DD/MM/YYYY``). The theme gives MUI these from
the app's translations, most of them in a ``mui`` section of the locale
files, so a language switch reaches them too. English uses MUI's own words,
so it reads as MUI ships it. MUI's own Catalan sits underneath, for what the
app never shows (the week numbers, the range pickers); it isn't used for the
rest because it gets some wrong (*Obert*, the adjective, for the drop-down's
Open; *Tancat* for an alert's Close; the date and time tabs swapped) and puts
the others in the infinitive, where KanbanMF uses the imperative. In Catalan
the empty field reads ``DD/MM/AAAA``.

The theme also writes the calendar's weekdays in two letters, where MUI
writes one: one letter repeats (T and S in English), and in Catalan every
weekday is a D. Those names, like the months, come from the dayjs locale, so
they follow the dates & times format, not the language.

Conventions for new UI
----------------------

- One component per file in ``src/components/``; one file per route in
  ``src/pages/``.
- API calls through ``apiFetch`` with relative URLs.
- Every visible text through ``t('…')``, with its key in both locale files.
- Subscribe to WebSocket events and refetch, rather than patching state
  from a notification.
