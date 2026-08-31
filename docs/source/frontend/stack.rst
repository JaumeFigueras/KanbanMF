Stack and how it works
======================

.. todo::

   **The narrative half of the frontend documentation.** Planned contents:

   - The stack and why each piece is there: React 19, TypeScript, Vite,
     Material UI, react-router-dom, react-i18next, dnd-kit, dayjs.
   - Application shell: ``main.tsx`` → ``App.tsx``, routing, and the
     ``ProtectedRoute`` / ``PublicRoute`` guards gated on ``AuthContext``.
   - Talking to the API: the fetch wrapper that silently refreshes an expired
     access token and retries the request once, so a call never fails just
     because the token aged out.
   - **Relative URLs only** — ``/api/v1/...`` and ``wss://<same host>``, served
     by the Vite proxy in development and by the same origin in production.
     Explain why a hardcoded ``localhost:8000`` works in development and breaks
     silently in production.
   - Real-time updates from the client side: what ``ws.ts`` listens for, why a
     notification triggers a REST refetch instead of a partial state merge, and
     how a tab ignores its own change.
   - Drag and drop: what dnd-kit is used for and how an ordering change is
     persisted.
   - Theming and per-user colours; light/dark via ``ThemeToggleContext``.
   - Internationalisation: how a locale is chosen, and the rule that a new key
     goes into both ``en.ts`` and ``ca.ts``.
   - Conventions for new UI: one component per file.

   The data-flow round trip — user action → REST call → WebSocket notification
   → refetch in every other tab — is worth a diagram.
