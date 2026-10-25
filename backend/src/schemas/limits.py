#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Longest text each request body may carry, in characters.

The ``String(n)`` columns already cap their values, but only in the database:
a longer value got there and failed as a 500. The ``Text`` columns (a card's
description, a time entry's note) had no cap at all, so one request could
store megabytes that every board load then sent to everyone on the board.
The schemas check these limits first, and answer 422.
"""

# Boards, templates, lists, cards, checklists: String(255).
NAME_MAX_LENGTH = 255
# Checklist items: String(500).
CHECKLIST_ITEM_MAX_LENGTH = 500
# Labels and display names: String(100).
LABEL_NAME_MAX_LENGTH = 100
DISPLAY_NAME_MAX_LENGTH = 100
# Language and number locales: String(10).
LOCALE_MAX_LENGTH = 10
# Text columns, capped here only: a long description is still a few pages.
DESCRIPTION_MAX_LENGTH = 20_000
COMMENT_MAX_LENGTH = 2_000
