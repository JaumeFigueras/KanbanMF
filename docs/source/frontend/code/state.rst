State and data access
=====================

There is no global store: each page fetches what it shows and keeps it in
component state. What is shared lives in two contexts and two API modules.

``src/context/``
----------------

``AuthContext.tsx`` and ``useAuth.ts``
   ``AuthProvider`` checks the session on load, exposes ``accessToken``,
   ``loading``, ``loggedOut`` (whether this page signed out on purpose, until
   the next sign-in), ``signOutUnconfirmed`` (whether that sign-out went
   without the server's confirmation, so the session may still be alive),
   ``unreachable`` (whether the start-up check got no answer, so whether
   there's a session is unknown), ``login()``, ``logout()`` (which never
   rejects) and ``retryStartUp()``, hands the token to the WebSocket client,
   and applies the user's language. ``useAuth()`` reads it.

``ThemeToggleContext.tsx`` and ``useThemeToggle.ts``
   Light or dark, remembered in ``localStorage``, per browser.

``src/api/``
------------

``client.ts``
   ``apiFetch()``, the fetch wrapper every authenticated call uses: adds the
   ``Authorization`` and ``X-Client-Id`` headers, and on a ``401`` refreshes
   the token once and retries. ``loadJson()`` is the same for loading data:
   it gives the answer's JSON, and rejects any answer that isn't ``ok`` just
   as a dropped connection, with an ``HttpError`` that carries the status
   (so a refusal can be told from a server error). Also ``refreshAccessToken()`` (one refresh at
   a time, shared by concurrent callers; it signs out only when refused, and
   rejects with ``RefreshUnanswered``, keeping the token, when it gets no
   answer or a server error), the access token itself with
   ``setAccessToken()`` and ``onAccessTokenChange()``, and ``getClientId()``,
   the page's id, kept in memory. ``API_BASE`` is empty on purpose: every URL
   is relative.

``ws.ts``
   The notification WebSocket: ``setWebSocketToken()`` opens or closes it as
   the user signs in and out, it reconnects after three seconds when it
   drops, ``subscribeToNotifications()`` registers a listener,
   ``subscribeToReconnects()`` one told when a socket opens again, so the
   page can fetch what it missed, and ``isOwnNotification()`` tells a tab's
   own changes apart. The
   ``BoardNotificationType`` union lists every event the backend sends.

``config.ts``
   ``fetchAppConfig()``: the public server configuration (whether e-mail
   sending is available), fetched once per page load; after a failure, the
   next caller asks again.

``src/types/``
--------------

The shapes of what the API sends, as TypeScript types. They are written by
hand to match the backend's Pydantic schemas (``backend/src/schemas/``):
nothing generates them, so a change to a schema needs the same change here.

``board.ts``
   Boards, lists, cards, labels, checklists and people as the API returns
   them (the ``…Read`` types), the boards page's three sections, the overdue
   tasks and search results grouped by board, and the viewer's colours and
   orders. Also ``ChecklistData``, the card dialog's own copy of a card's
   checklists, with ids of its own for those the server hasn't seen yet.

``invitation.ts``
   A pending invitation, what the sign-up page shows for an invitation link,
   and the share dialog's two refusals of an invitation: the address has an
   account, or is invited already.

``timeTracker.ts``
   A time entry, whose board name, card name and labels are copies taken
   when it was recorded, and the time tracker's board and list choices, with
   how often each was used.
