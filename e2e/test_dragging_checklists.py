#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dragging a card's checklists in the card dialog, and a checklist's items
in its own dialog, with the mouse, and moving them with the keyboard: nothing
is sent until the card is saved,
and then the order sent names every checklist or item the server has, those
the dialog never showed after the rest, so the server accepts it (5J)."""

import re
from contextlib import ExitStack
from urllib.parse import urlparse

from playwright.sync_api import expect

from dragging import changes, drag, eventually, heard, let_go, names, pick_up, press

CHANGED_ELSEWHERE = "This card was changed elsewhere while you were editing it."


def card_dialog(page):
    return page.get_by_role("dialog", name="Edit Card")


def checklist_dialog(page):
    return page.get_by_role("dialog", name=re.compile("^(Edit|Create) Checklist$"))


def checklist_handle(page, name):
    return card_dialog(page).get_by_role("button", name=f"Move the checklist {name}", exact=True)


def checklist_row(page, name):
    return checklist_handle(page, name).locator("xpath=../..")


def item_handle(page, number):
    return checklist_dialog(page).get_by_role("button", name=f"Move item {number}", exact=True)


def expect_checklists(page, checklists):
    eventually(lambda: names(card_dialog(page).locator("button[aria-label^='Move the checklist ']"),
                             "Move the checklist "), checklists)


def expect_items(page, items):
    eventually(lambda: checklist_dialog(page).get_by_role("textbox", name=re.compile(r"^Item \d+$"))
               .evaluate_all("fields => fields.map(f => f.value)"), items)


def drag_checklist(page, name, onto):
    # The checklists come last in the dialog, which may need scrolling.
    checklist_row(page, name).scroll_into_view_if_needed()
    checklist_row(page, onto).scroll_into_view_if_needed()
    drag(page, checklist_handle(page, name), checklist_row(page, name), checklist_row(page, onto))
    let_go(page)


def drag_item(page, number, onto):
    drag(page, item_handle(page, number), item_handle(page, number).locator("xpath=.."),
         item_handle(page, onto).locator("xpath=.."))
    let_go(page)


def card_path(board):
    return f"/boards/{board.id}/lists/{board.lists['To do']}/cards/{board.cards['Homepage layout']}"


def add_checklist(client, board, name, items):
    """Adds a checklist to the card, as someone would elsewhere; its id."""
    checklist_id = client.post(f"{card_path(board)}/checklists", json={"name": name}).raise_for_status().json()["id"]
    for text in items:
        add_item(client, board, checklist_id, text)
    return checklist_id


def add_item(client, board, checklist_id, text):
    client.post(f"{card_path(board)}/checklists/{checklist_id}/items", json={"text": text}).raise_for_status()


def saved(client, board):
    """The card's checklists as the server has them: each one's name and its
    items' texts, in order."""
    return [(c["name"], [i["text"] for i in c["items"]])
            for c in client.get(f"{card_path(board)}/checklists").raise_for_status().json()]


def checklists_order(board):
    return f"/api/v1{card_path(board)}/checklists/order"


def items_order(board, checklist_id):
    return f"/api/v1{card_path(board)}/checklists/{checklist_id}/items/order"


def open_card(page, board):
    page.goto(f"/boards/{board.id}")
    page.get_by_text("Homepage layout", exact=True).click()
    expect(card_dialog(page)).to_be_visible()


def save_card(page, client, board, *orders):
    """Saves the card, and returns what each of the orders (paths) was sent
    with, once the server took it: the checklists' names or the items'
    texts."""
    with ExitStack() as stack:
        answers = [stack.enter_context(page.expect_response(
            lambda r, path=path: r.request.method == "PUT" and urlparse(r.url).path == path)) for path in orders]
        card_dialog(page).get_by_role("button", name="Save", exact=True).click()
    # Closed once all of it is saved.
    expect(page.get_by_role("dialog")).to_have_count(0)
    checklists = client.get(f"{card_path(board)}/checklists").raise_for_status().json()
    name_of = {c["id"]: c["name"] for c in checklists} | {i["id"]: i["text"] for c in checklists for i in c["items"]}
    sent = []
    for answer in answers:
        assert answer.value.ok, f"PUT {answer.value.url}: {answer.value.status}"
        (ids,) = answer.value.request.post_data_json.values()
        sent.append([name_of[i] for i in ids])
    return sent


def test_checklist_items_moved_are_saved_in_their_new_order(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    client = api(user)
    launch = add_checklist(client, board, "Launch", ["Write copy", "Review copy", "Publish"])
    sign_in(user)
    open_card(page, board)
    card_dialog(page).get_by_role("button", name="Edit the checklist Launch").click()
    sent = changes(page)

    drag_item(page, 3, 1)
    expect_items(page, ["Publish", "Write copy", "Review copy"])
    checklist_dialog(page).get_by_role("button", name="Save", exact=True).click()
    # Nothing is sent until the card is saved.
    assert sent == []

    assert save_card(page, client, board, items_order(board, launch)) == [["Publish", "Write copy", "Review copy"]]
    # Only the items' order: the checklists didn't move.
    assert [change for change in sent if change.endswith("/order")] == [f"PUT {items_order(board, launch)}"]
    assert saved(client, board) == [("Launch", ["Publish", "Write copy", "Review copy"])]


def test_checklists_moved_are_saved_in_their_new_order(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    client = api(user)
    for name in ("Design", "Build", "Launch"):
        add_checklist(client, board, name, [])
    sign_in(user)
    open_card(page, board)
    sent = changes(page)

    drag_checklist(page, "Launch", "Design")
    expect_checklists(page, ["Launch", "Design", "Build"])
    assert sent == []

    assert save_card(page, client, board, checklists_order(board)) == [["Launch", "Design", "Build"]]
    assert [change for change in sent if change.endswith("/order")] == [f"PUT {checklists_order(board)}"]
    assert saved(client, board) == [("Launch", []), ("Design", []), ("Build", [])]


def test_an_order_names_what_was_added_elsewhere_after_the_rest(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    client = api(user)
    design = add_checklist(client, board, "Design", ["Sketch", "Mock-up"])
    add_checklist(client, board, "Build", [])
    sign_in(user)
    open_card(page, board)

    # Meanwhile, someone else adds an item and a checklist, which the dialog
    # doesn't show: it keeps what it opened with, and says so.
    add_item(client, board, design, "Review")
    add_checklist(client, board, "Launch", [])
    expect(card_dialog(page).get_by_text(CHANGED_ELSEWHERE)).to_be_visible()
    expect_checklists(page, ["Design", "Build"])

    drag_checklist(page, "Build", "Design")
    card_dialog(page).get_by_role("button", name="Edit the checklist Design").click()
    drag_item(page, 2, 1)
    expect_items(page, ["Mock-up", "Sketch"])
    checklist_dialog(page).get_by_role("button", name="Save", exact=True).click()

    assert save_card(page, client, board, checklists_order(board), items_order(board, design)) == [
        ["Build", "Design", "Launch"],
        ["Mock-up", "Sketch", "Review"],
    ]
    assert saved(client, board) == [("Build", []), ("Design", ["Mock-up", "Sketch", "Review"]), ("Launch", [])]


def test_a_checklist_made_in_the_dialog_can_be_moved_before_the_others(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    client = api(user)
    add_checklist(client, board, "Design", ["Sketch"])
    add_checklist(client, board, "Build", [])
    sign_in(user)
    open_card(page, board)

    card_dialog(page).get_by_role("button", name="Add checklist", exact=True).click()
    checklist_dialog(page).get_by_label("Checklist name").fill("Launch")
    checklist_dialog(page).get_by_role("textbox", name="Add an item").fill("Publish")
    checklist_dialog(page).get_by_role("button", name="Save", exact=True).click()
    expect_checklists(page, ["Design", "Build", "Launch"])
    drag_checklist(page, "Launch", "Design")
    expect_checklists(page, ["Launch", "Design", "Build"])

    # The order names it by the id the server gave it on the way.
    assert save_card(page, client, board, checklists_order(board)) == [["Launch", "Design", "Build"]]
    assert saved(client, board) == [("Launch", ["Publish"]), ("Design", ["Sketch"]), ("Build", [])]


def test_checklists_and_items_moved_with_the_keyboard_are_saved(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    client = api(user)
    design = add_checklist(client, board, "Design", ["Sketch", "Mock-up"])
    add_checklist(client, board, "Build", [])
    add_checklist(client, board, "Launch", [])
    sign_in(user)
    open_card(page, board)

    pick_up(page, checklist_handle(page, "Launch"), "Picked up the checklist Launch.")
    press(page, "ArrowUp", "Moving the checklist Launch, over the checklist Build.")
    press(page, "ArrowUp", "Moving the checklist Launch, over the checklist Design.")
    let_go(page, key="Space")
    heard(page, "Dropped the checklist Launch over the checklist Design.")
    expect_checklists(page, ["Launch", "Design", "Build"])

    card_dialog(page).get_by_role("button", name="Edit the checklist Design").click()
    # An item is named by its text.
    pick_up(page, item_handle(page, 2), "Picked up Mock-up.")
    press(page, "ArrowUp", "Moving Mock-up, over Sketch.")
    let_go(page, key="Space")
    expect_items(page, ["Mock-up", "Sketch"])
    checklist_dialog(page).get_by_role("button", name="Save", exact=True).click()

    assert save_card(page, client, board, checklists_order(board), items_order(board, design)) == [
        ["Launch", "Design", "Build"],
        ["Mock-up", "Sketch"],
    ]
