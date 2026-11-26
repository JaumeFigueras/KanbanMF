#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dragging the board tiles on the boards page with the mouse, and moving
them with the keyboard: each section keeps its own order, each person theirs,
and a move that can't be saved goes back."""

import re

import pytest
from playwright.sync_api import expect

from dragging import MOVE_FAILED, changes, drag, eventually, heard, let_go, names, pick_up, press

ORDER_PUT = "PUT /api/v1/boards/order"


def section(page, title):
    """One of the page's sections, by its title ("My Boards (3)")."""
    return page.locator(".MuiAccordion-root").filter(
        has=page.locator(".MuiAccordionSummary-root").filter(has_text=re.compile(rf"^{re.escape(title)} \(\d+\)$")))


def tile(page, section_title, name):
    return section(page, section_title).locator(".MuiCard-root").filter(
        has=page.locator(f"button[aria-label='Move {name}']"))


def expect_tiles(page, section_title, boards):
    """The section's boards, once nothing is being dragged."""
    eventually(lambda: names(section(page, section_title).locator("button[aria-label^='Move ']"), "Move "), boards)


def drag_tile(page, section_title, name, onto):
    drag(page, tile(page, section_title, name).get_by_role("button", name=f"Move {name}"),
         tile(page, section_title, name), tile(page, section_title, onto))


def make_boards(api, make_user, user, section_title, names_in_order) -> None:
    """Gives the user boards in a section, in that order."""
    if section_title == "Shared with me":
        owner = api(make_user("Liam Brown"))
        ids = []
        for name in names_in_order:
            ids.append(owner.post("/boards", json={"name": name}).raise_for_status().json()["id"])
            owner.post(f"/boards/{ids[-1]}/shares", json={"user_id": user.id}).raise_for_status()
        # Sharing doesn't place a board in the order: it goes after those
        # placed, newest first.
        api(user).put("/boards/order", json={"shared_ids": ids}).raise_for_status()
        return
    fields = {"Starred": {"is_starred": True}, "My Boards": {}, "Templates": {"is_template": True}}[section_title]
    for name in names_in_order:
        api(user).post("/boards", json={"name": name, **fields}).raise_for_status()


@pytest.mark.parametrize("section_title", ["Starred", "My Boards", "Shared with me", "Templates"])
def test_a_board_tile_moved_stays_there(section_title, page, make_user, sign_in, api):
    user = make_user()
    make_boards(api, make_user, user, section_title, ["Website redesign", "Product launch", "Hiring"])
    sign_in(user)
    page.goto("/boards")
    expect_tiles(page, section_title, ["Website redesign", "Product launch", "Hiring"])
    sent = changes(page)

    drag_tile(page, section_title, "Hiring", "Website redesign")
    let_go(page, ORDER_PUT, floating=section(page, section_title))

    expect_tiles(page, section_title, ["Hiring", "Website redesign", "Product launch"])
    assert sent == [ORDER_PUT]
    page.reload()
    expect_tiles(page, section_title, ["Hiring", "Website redesign", "Product launch"])
    if section_title == "Starred":
        # Starred boards are in My Boards too, whose order is its own.
        expect_tiles(page, "My Boards", ["Website redesign", "Product launch", "Hiring"])


def test_each_person_orders_a_shared_board_their_own_way(page, make_user, sign_in, api):
    owner = make_user("Emma Wilson")
    other = make_user("Liam Brown")
    ids = [api(owner).post("/boards", json={"name": name}).raise_for_status().json()["id"]
           for name in ("Website redesign", "Product launch", "Hiring")]
    for board_id in ids:
        api(owner).post(f"/boards/{board_id}/shares", json={"user_id": other.id}).raise_for_status()
    api(other).put("/boards/order", json={"shared_ids": ids}).raise_for_status()
    sign_in(other)
    page.goto("/boards")

    drag_tile(page, "Shared with me", "Hiring", "Website redesign")
    let_go(page, ORDER_PUT)
    page.reload()
    expect_tiles(page, "Shared with me", ["Hiring", "Website redesign", "Product launch"])

    # The owner, signed in in the same browser, sees them as they left them.
    sign_in(owner)
    page.reload()
    expect_tiles(page, "My Boards", ["Website redesign", "Product launch", "Hiring"])


@pytest.mark.parametrize("failure", ["refused", "not sent"])
def test_a_board_tile_move_that_fails_goes_back(failure, page, context, make_user, sign_in, api):
    user = make_user()
    make_boards(api, make_user, user, "My Boards", ["Website redesign", "Product launch", "Hiring"])
    sign_in(user)
    if failure == "refused":
        page.route("**/api/v1/boards/order",
                   lambda route: route.fulfill(status=500, body="Internal Server Error")
                   if route.request.method == "PUT" else route.fallback())
    page.goto("/boards")
    expect_tiles(page, "My Boards", ["Website redesign", "Product launch", "Hiring"])

    drag_tile(page, "My Boards", "Hiring", "Website redesign")
    if failure == "not sent":
        context.set_offline(True)
    let_go(page)

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    expect_tiles(page, "My Boards", ["Website redesign", "Product launch", "Hiring"])
    context.set_offline(False)
    page.unroute("**/api/v1/boards/order")
    page.reload()
    expect_tiles(page, "My Boards", ["Website redesign", "Product launch", "Hiring"])


def test_a_board_tile_moved_with_the_keyboard_stays_there(page, make_user, sign_in, api):
    user = make_user()
    make_boards(api, make_user, user, "My Boards", ["Website redesign", "Product launch", "Hiring"])
    sign_in(user)
    page.goto("/boards")
    expect_tiles(page, "My Boards", ["Website redesign", "Product launch", "Hiring"])

    pick_up(page, tile(page, "My Boards", "Hiring").get_by_role("button", name="Move Hiring"), "Picked up Hiring.")
    press(page, "ArrowLeft", "Moving Hiring, over Product launch.")
    press(page, "ArrowLeft", "Moving Hiring, over Website redesign.")
    let_go(page, ORDER_PUT, key="Space")
    heard(page, "Dropped Hiring over Website redesign.")

    expect_tiles(page, "My Boards", ["Hiring", "Website redesign", "Product launch"])
    page.reload()
    expect_tiles(page, "My Boards", ["Hiring", "Website redesign", "Product launch"])
