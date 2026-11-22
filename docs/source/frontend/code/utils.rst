Utilities, theme and i18n
=========================

``src/utils/``
--------------

Small pure helpers, with no React in them:

``cardSort.ts``
   The four sort modes, ``sortCards()``, and the rule that limits manual
   reordering under the due-date sort to undated cards.

``checklistOrder.ts``
   When the card dialog needs to send the order of a card's checklists, or
   of a checklist's items (only when something was moved), and the order to
   send: the dialog's, then whatever the server has that the dialog never
   showed, as the server refuses an order that doesn't name everything.

``colorPalette.ts``
   The fixed palette every colour picker offers: ten hues, seven shades each.

``colorTint.ts``
   Blends a colour into a background as an opaque colour, so tints can nest
   (a card on a coloured list) without bleeding into each other.

``contrast.ts``
   WCAG relative luminance, and whether dark or white text contrasts more
   with a colour: the one rule the due-date chips and the labels share.

``csv.ts``
   The time tracker's CSV file: every cell quoted, a cell that starts like a
   formula (``=``, ``+``, ``-``, ``@``, a tab or a carriage return) kept as
   text behind an apostrophe — card, board and label names come from shared
   boards, and a spreadsheet would run them — and a byte-order mark first, or
   Excel reads the file in the computer's legacy encoding and garbles accents.

``dueDateColor.ts``
   The due-date colour scale, green to dark red, with dark or white text on
   top, whichever contrasts more.

``duration.ts``
   Durations as ``H:MM``, as ``H:MM:SS`` for the running task, and as
   decimal hours for the CSV.

``labelColor.ts``
   Black or white text for a label's colour, whichever contrasts more.

``locale.ts``
   The date and number locales (``en``, ``en_GB``, ``ca_ES``) with their
   ``Intl`` and dayjs equivalents, date formatting, and the browser's time
   zone.

``overlap.ts``
   Which time entries overlap, compared to the minute — the resolution the
   table shows.

``returnTo.ts``
   The page to come back to after signing in, kept in ``sessionStorage``;
   only paths of this app are accepted.

``search.ts``
   A search's scope (every board, one board, a board's archive, the archived
   boards), the ``/search`` address that carries it, the backend's query for
   it and the search box's placeholder.

``storage.ts``
   ``localStorage`` and ``sessionStorage`` as a browser that blocks site data
   allows: each read, write or removal that throws acts as if nothing were
   stored. The only way the app reaches either.

``src/theme/``
--------------

``index.ts``
   ``appTheme(dark, language)``: the MUI theme, light or dark (the dark one
   uses purple as its primary colour), with MUI's own texts in the given
   language — the drop-downs', the alerts' and the date pickers' — and
   two-letter weekdays in the calendar.

``AppThemeProvider.tsx``
   Hands that theme to MUI, building it again when the light/dark choice
   or the language changes. ``App`` and the tests' ``renderWithProviders``
   both use it.

``src/i18n/``
-------------

``index.ts`` sets up i18next with English (the default and fallback) and
Catalan, and exports ``LANGUAGES``. The texts are in ``locales/en.ts`` and
``locales/ca.ts``, one nested object per area of the app (``boards``,
``board``, ``timeTracker``…); every key must exist in both.
