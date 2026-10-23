State and data access
=====================

.. todo::

   Reference for ``src/context/`` and ``src/api/``:

   - ``AuthContext`` — tokens, current user, and the refresh flow; the
     ``useAuth`` hook.
   - ``ThemeToggleContext`` and the ``useThemeToggle`` hook; the choice is kept
     in ``localStorage``, not in the user's preferences.
   - ``client.ts`` — the fetch wrapper, ``API_BASE``, and the transparent
     token-refresh retry.
   - ``config.ts`` — the public server configuration (whether e-mail sending
     is available).
   - ``ws.ts`` — connecting, reconnecting, the message shape, and dispatching
     refetches.
