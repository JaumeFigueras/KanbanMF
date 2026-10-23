Utilities, theme and i18n
=========================

``src/utils/``
--------------

Small pure helpers, with no React in them:

``cardSort.ts``
   The four sort modes, ``sortCards()``, and the rule that limits manual
   reordering under the due-date sort to undated cards.

``colorPalette.ts``
   The fixed palette every colour picker offers: ten hues, seven shades each.

``colorTint.ts``
   Blends a colour into a background as an opaque colour, so tints can nest
   (a card on a coloured list) without bleeding into each other.

``dueDateColor.ts``
   The due-date colour scale, green to dark red, with readable text on top.

``duration.ts``
   Durations as ``H:MM``, as ``H:MM:SS`` for the running task, and as
   decimal hours for the CSV.

``labelColor.ts``
   Black or white text for a label's colour.

``locale.ts``
   The date and number locales (``en``, ``en_GB``, ``ca_ES``) with their
   ``Intl`` and dayjs equivalents, date formatting, and the browser's time
   zone.

``overlap.ts``
   Which time entries overlap, compared to the minute — the resolution the
   table shows.

``src/theme/``
--------------

``lightTheme`` and ``darkTheme``, the two MUI themes. The dark one uses
purple as its primary colour.

``src/i18n/``
-------------

``index.ts`` sets up i18next with English (the default and fallback) and
Catalan, and exports ``LANGUAGES``. The texts are in ``locales/en.ts`` and
``locales/ca.ts``, one nested object per area of the app (``boards``,
``board``, ``timeTracker``…); every key must exist in both.
