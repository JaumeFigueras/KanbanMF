#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dragging a board's labels in the Labels dialog with the mouse, and moving
them with the keyboard: the new order is kept, the cards show their labels in
it, and an order the server refuses goes back (7D)."""

from playwright.sync_api import expect

from dragging import MOVE_FAILED, changes, drag, eventually, heard, let_go, names, nothing_sent, pick_up, press

def labels_dialog(page):
    return page.get_by_role("dialog", name="Labels")


def handle(page, name):
    return labels_dialog(page).get_by_role("button", name=f"Move the label {name}", exact=True)


def expect_labels(page, labels):
    eventually(lambda: names(labels_dialog(page).locator("button[aria-label^='Move the label ']"), "Move the label "),
               labels)


def expect_chips(page, card_name, labels):
    """The labels the card shows on the board, in their order."""
    card = page.locator(".MuiCard-root").filter(has=page.locator(f"button[aria-label='Move {card_name}']"))
    eventually(lambda: card.locator(".MuiChip-label").all_inner_texts(), labels)


def drag_label(page, name, onto):
    # A label's row is its handle's parent.
    drag(page, handle(page, name), handle(page, name).locator("xpath=.."), handle(page, onto).locator("xpath=.."))


def make_labelled_board(make_board, api, user):
    """A board with three labels, and a card that has them all."""
    board = make_board(user, {"To do": []})
    client = api(user)
    label_ids = [client.post(f"/boards/{board.id}/labels", json={"name": name, "color": color}).raise_for_status()
                 .json()["id"] for name, color in (("Urgent", "#d32f2f"), ("Design", "#1976d2"), ("Bug", "#388e3c"))]
    client.post(f"/boards/{board.id}/lists/{board.lists['To do']}/cards",
                json={"name": "Homepage layout", "label_ids": label_ids}).raise_for_status()
    return board


def open_labels(page):
    page.get_by_role("button", name="Labels", exact=True).click()
    expect_labels(page, ["Urgent", "Design", "Bug"])


def test_labels_moved_stay_in_their_new_order_and_the_cards_show_it(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_labelled_board(make_board, api, user)
    sign_in(user)
    page.goto(f"/boards/{board.id}")
    expect_chips(page, "Homepage layout", ["Urgent", "Design", "Bug"])
    open_labels(page)

    drag_label(page, "Bug", "Urgent")
    let_go(page, f"PUT /api/v1/boards/{board.id}/labels/order")
    expect_labels(page, ["Bug", "Urgent", "Design"])

    # Closing the dialog fetches the cards again.
    labels_dialog(page).get_by_role("button", name="Close").click()
    expect_chips(page, "Homepage layout", ["Bug", "Urgent", "Design"])
    page.reload()
    expect_chips(page, "Homepage layout", ["Bug", "Urgent", "Design"])
    page.get_by_role("button", name="Labels", exact=True).click()
    expect_labels(page, ["Bug", "Urgent", "Design"])


def test_a_label_order_refused_goes_back_and_can_be_tried_again(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_labelled_board(make_board, api, user)
    sign_in(user)
    page.goto(f"/boards/{board.id}")
    open_labels(page)
    # Added elsewhere meanwhile, so the order the dialog sends leaves it out,
    # which the server refuses.
    api(user).post(f"/boards/{board.id}/labels", json={"name": "Copy", "color": "#f57c00"}).raise_for_status()

    drag_label(page, "Bug", "Urgent")
    with page.expect_response(lambda r: r.url.endswith(f"/boards/{board.id}/labels/order")) as answer:
        page.mouse.up()
    assert answer.value.status == 422

    expect(labels_dialog(page).get_by_text(MOVE_FAILED)).to_be_visible()
    # Fetched again, so it now shows the one added.
    expect_labels(page, ["Urgent", "Design", "Bug", "Copy"])

    drag_label(page, "Bug", "Urgent")
    let_go(page, f"PUT /api/v1/boards/{board.id}/labels/order")
    expect_labels(page, ["Bug", "Urgent", "Design", "Copy"])
    expect(labels_dialog(page).get_by_text(MOVE_FAILED)).to_have_count(0)
    assert [label["name"] for label in api(user).get(f"/boards/{board.id}/labels").json()] == \
        ["Bug", "Urgent", "Design", "Copy"]


def test_a_label_moved_with_the_keyboard_stays_there_and_escape_keeps_the_dialog_open(page, make_user, sign_in,
                                                                                         make_board, api):
    user = make_user()
    board = make_labelled_board(make_board, api, user)
    sign_in(user)
    page.goto(f"/boards/{board.id}")
    open_labels(page)
    sent = changes(page)

    pick_up(page, handle(page, "Bug"), "Picked up the label Bug.")
    press(page, "ArrowUp", "Moving the label Bug, over the label Design.")
    # Escape cancels the move, rather than closing the dialog (7A).
    let_go(page, key="Escape")
    heard(page, "Move cancelled: the label Bug is back in its place.")
    expect(labels_dialog(page)).to_be_visible()
    expect_labels(page, ["Urgent", "Design", "Bug"])
    nothing_sent(page, sent)

    pick_up(page, handle(page, "Bug"), "Picked up the label Bug.")
    press(page, "ArrowUp", "Moving the label Bug, over the label Design.")
    press(page, "ArrowUp", "Moving the label Bug, over the label Urgent.")
    let_go(page, f"PUT /api/v1/boards/{board.id}/labels/order", key="Space")
    heard(page, "Dropped the label Bug over the label Urgent.")
    expect_labels(page, ["Bug", "Urgent", "Design"])
