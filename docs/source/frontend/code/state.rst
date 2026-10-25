State and data access
=====================

There is no global store: each page fetches what it shows and keeps it in
component state. What is shared lives in two contexts and two API modules.

``src/context/``
----------------

``AuthContext.tsx`` and ``useAuth.ts``
   ``AuthProvider`` checks the session on load, exposes ``accessToken``,
   ``loading``, ``login()`` and ``logout()``, hands the token to the
   WebSocket client, and applies the user's language. ``useAuth()`` reads it.

``ThemeToggleContext.tsx`` and ``useThemeToggle.ts``
   Light or dark, remembered in ``localStorage``, per browser.

``src/api/``
------------

``client.ts``
   ``apiFetch()``, the fetch wrapper every authenticated call uses: adds the
   ``Authorization`` and ``X-Client-Id`` headers, and on a ``401`` refreshes
   the token once and retries. Also ``refreshAccessToken()`` (one refresh at
   a time, shared by concurrent callers), the access token itself with
   ``setAccessToken()`` and ``onAccessTokenChange()``, and ``getClientId()``,
   the tab's id from ``sessionStorage``. ``API_BASE`` is empty on purpose:
   every URL is relative.

``ws.ts``
   The notification WebSocket: ``setWebSocketToken()`` opens or closes it as
   the user signs in and out, it reconnects after three seconds when it
   drops, ``subscribeToNotifications()`` registers a listener, and
   ``isOwnNotification()`` tells a tab's own changes apart. The
   ``BoardNotificationType`` union lists every event the backend sends.

``config.ts``
   ``fetchAppConfig()``: the public server configuration (whether e-mail
   sending is available), fetched once per page load.
