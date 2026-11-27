#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""The board page, for the tests that use it: its lists and cards found by
their handles' names, what they show, and what saving a card's move sends."""

from playwright.sync_api import expect

from dragging import drag, eventually, names

# Every card's drag handle is named "Move <card>", every list's "Move the
# list <list>". Found by CSS, not by role: while a card is dragged, its place
# in the list is kept by a hidden copy, which the accessibility tree leaves
# out.
CARD_HANDLES = "button[aria-label^='Move ']:not([aria-label^='Move the list '])"
LIST_HANDLES = "button[aria-label^='Move the list ']"


def column(page, list_name):
    return page.locator(".MuiPaper-root").filter(
        has=page.get_by_role("button", name=f"Move the list {list_name}", exact=True))


def card(page, name):
    return page.locator(".MuiCard-root").filter(has=page.locator(f"button[aria-label='Move {name}']"))


def expect_cards(page, list_name, cards):
    """The list's cards, once nothing is being dragged."""
    eventually(lambda: names(column(page, list_name).locator(CARD_HANDLES), "Move "), cards)


def expect_lists(page, lists):
    eventually(lambda: names(page.locator(LIST_HANDLES), "Move the list "), lists)


def drag_card(page, name, onto):
    drag(page, page.get_by_role("button", name=f"Move {name}", exact=True), card(page, name), onto)


def order_put(board, list_name):
    return f"PUT /api/v1/boards/{board.id}/lists/{board.lists[list_name]}/cards/order"


def move_patch(board, list_name, card_name):
    return f"PATCH /api/v1/boards/{board.id}/lists/{board.lists[list_name]}/cards/{board.cards[card_name]}"


def open_board(page, board):
    page.goto(f"/boards/{board.id}")
    for list_name in board.lists:
        expect(column(page, list_name)).to_be_visible()
