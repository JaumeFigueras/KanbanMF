#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dragging lists and cards on a board with the mouse, and moving them with
the keyboard, as jsdom can't: what is saved, what each sort mode keeps, a
move cancelled, a move that can't be saved, and what a screen reader is
told."""

from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from playwright.sync_api import expect

from board_page import (CARD_HANDLES, card, column, drag_card, expect_cards, expect_lists, move_patch, open_board,
                        order_put)
from dragging import (MOVE_FAILED, centre, changes, drag, eventually, heard, let_go, names, nothing_sent, pick_up,
                      press)

CARDS_FAILED = "This list's cards couldn't be loaded."


def expect_shown(page, list_name, cards):
    """The list's cards as they're seen during a drag, where the one dragged
    would land."""
    eventually(lambda: names(column(page, list_name).locator(CARD_HANDLES), "Move ", "y"), cards)


def sort_by(page, mode):
    page.get_by_role("button", name="Sort cards").click()
    page.get_by_role("menuitem", name=mode).click()
    # Until the menu has faded out, its (invisible) backdrop takes the
    # mouse: a press there starts no drag.
    expect(page.locator(".MuiMenu-root")).to_have_count(0)


def due_in(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


# Moves, in the custom order (a board's sort mode until one is chosen).

def test_a_list_moved_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"], "Doing": ["Logo", "Colour palette", "Fonts", "Icons"],
                              "Done": []})
    sign_in(user)
    open_board(page, board)
    sent = changes(page)

    # Over the first card of the next list: only lists count, or it would be
    # over that card, and go nowhere.
    drag(page, page.get_by_role("button", name="Move the list To do"), column(page, "To do"), card(page, "Logo"))
    let_go(page, f"PUT /api/v1/boards/{board.id}/lists/order")

    expect_lists(page, ["Doing", "To do", "Done"])
    assert sent == [f"PUT /api/v1/boards/{board.id}/lists/order"]
    page.reload()
    expect_lists(page, ["Doing", "To do", "Done"])
    # Its cards went with it.
    expect_cards(page, "To do", ["Homepage layout"])


def test_a_card_moved_within_its_list_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form", "Footer links"]})
    sign_in(user)
    open_board(page, board)
    sent = changes(page)

    drag_card(page, "Footer links", card(page, "Homepage layout"))
    # Shown, while it's dragged, where it will land.
    expect_shown(page, "To do", ["Footer links", "Homepage layout", "Contact form"])
    let_go(page, order_put(board, "To do"))

    expect_cards(page, "To do", ["Footer links", "Homepage layout", "Contact form"])
    assert sent == [order_put(board, "To do")]
    page.reload()
    expect_cards(page, "To do", ["Footer links", "Homepage layout", "Contact form"])


def test_a_card_moved_between_two_cards_of_another_list_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo", "Colour palette"]})
    sign_in(user)
    open_board(page, board)
    sent = changes(page)

    drag_card(page, "Contact form", card(page, "Colour palette"))
    expect_shown(page, "Doing", ["Logo", "Contact form", "Colour palette"])
    expect_shown(page, "To do", ["Homepage layout"])
    # The move first; then both lists' orders, which the server refuses to
    # name a card it doesn't have in the list yet.
    let_go(page, move_patch(board, "To do", "Contact form"), order_put(board, "Doing"), order_put(board, "To do"))

    expect_cards(page, "Doing", ["Logo", "Contact form", "Colour palette"])
    assert sent[0] == move_patch(board, "To do", "Contact form")
    assert sorted(sent[1:]) == sorted([order_put(board, "Doing"), order_put(board, "To do")])
    page.reload()
    expect_cards(page, "Doing", ["Logo", "Contact form", "Colour palette"])
    expect_cards(page, "To do", ["Homepage layout"])


def test_a_card_moved_to_the_end_of_another_list_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo", "Colour palette"]})
    sign_in(user)
    open_board(page, board)

    # Below the last card.
    x, y = centre(card(page, "Colour palette"))
    drag_card(page, "Homepage layout", (x, y + card(page, "Colour palette").bounding_box()["height"]))
    expect_shown(page, "Doing", ["Logo", "Colour palette", "Homepage layout"])
    let_go(page, move_patch(board, "To do", "Homepage layout"), order_put(board, "Doing"), order_put(board, "To do"))

    page.reload()
    expect_cards(page, "Doing", ["Logo", "Colour palette", "Homepage layout"])
    expect_cards(page, "To do", ["Contact form"])


def test_a_card_moved_to_an_empty_list_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Done": []})
    sign_in(user)
    open_board(page, board)

    drag_card(page, "Contact form", column(page, "Done"))
    expect_shown(page, "Done", ["Contact form"])
    let_go(page, move_patch(board, "To do", "Contact form"), order_put(board, "Done"), order_put(board, "To do"))

    page.reload()
    expect_cards(page, "Done", ["Contact form"])
    expect_cards(page, "To do", ["Homepage layout"])


def test_a_click_on_a_cards_move_button_opens_nothing(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    sign_in(user)
    open_board(page, board)
    sent = changes(page)

    # A click anywhere else on the card opens it.
    page.get_by_role("button", name="Move Homepage layout", exact=True).click()
    nothing_sent(page, sent)
    expect(page.get_by_role("dialog")).to_have_count(0)


# The other sort modes.

def test_by_due_date_the_undated_cards_at_the_top_can_be_rearranged(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Write copy", "Review copy", {"name": "Launch", "due_at": due_in(3)},
                                        {"name": "Publish", "due_at": due_in(1)}]})
    sign_in(user)
    open_board(page, board)
    sort_by(page, "Due date")
    expect_cards(page, "To do", ["Write copy", "Review copy", "Publish", "Launch"])

    drag_card(page, "Review copy", card(page, "Write copy"))
    let_go(page, order_put(board, "To do"))
    expect_cards(page, "To do", ["Review copy", "Write copy", "Publish", "Launch"])

    # Let go among the dated cards, it lands at the end of the undated ones.
    drag_card(page, "Review copy", card(page, "Launch"))
    let_go(page, order_put(board, "To do"))
    expect_cards(page, "To do", ["Write copy", "Review copy", "Publish", "Launch"])

    page.reload()
    # The sort mode is kept too, in the browser.
    expect_cards(page, "To do", ["Write copy", "Review copy", "Publish", "Launch"])


def test_by_due_date_a_dated_card_goes_back_to_its_place(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Write copy", {"name": "Launch", "due_at": due_in(3)},
                                        {"name": "Publish", "due_at": due_in(1)}]})
    sign_in(user)
    open_board(page, board)
    sort_by(page, "Due date")
    expect_cards(page, "To do", ["Write copy", "Publish", "Launch"])
    sent = changes(page)

    drag_card(page, "Launch", card(page, "Write copy"))
    expect_shown(page, "To do", ["Launch", "Write copy", "Publish"])
    let_go(page)

    expect_cards(page, "To do", ["Write copy", "Publish", "Launch"])
    nothing_sent(page, sent)


def test_by_due_date_a_card_moved_to_another_list_stays_there(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Write copy", "Review copy", {"name": "Launch", "due_at": due_in(3)}],
                              "Doing": ["Logo", {"name": "Publish", "due_at": due_in(1)}]})
    sign_in(user)
    open_board(page, board)
    sort_by(page, "Due date")

    drag_card(page, "Write copy", card(page, "Logo"))
    # The order of the list it left goes without it, or the server would
    # refuse it.
    let_go(page, move_patch(board, "To do", "Write copy"), order_put(board, "Doing"), order_put(board, "To do"))

    expect_cards(page, "Doing", ["Write copy", "Logo", "Publish"])
    page.reload()
    expect_cards(page, "Doing", ["Write copy", "Logo", "Publish"])
    expect_cards(page, "To do", ["Review copy", "Launch"])
    order = api(user).get(f"/boards/{board.id}/lists/{board.lists['To do']}/cards/order").json()["card_ids"]
    assert order == [board.cards["Review copy"], board.cards["Launch"]]


def test_alphabetically_a_card_goes_back_to_its_place_in_its_list(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Banana", "Apple", "Cherry"]})
    sign_in(user)
    open_board(page, board)
    sort_by(page, "Alphabetically (A-Z)")
    expect_cards(page, "To do", ["Apple", "Banana", "Cherry"])
    sent = changes(page)

    drag_card(page, "Cherry", card(page, "Apple"))
    expect_shown(page, "To do", ["Cherry", "Apple", "Banana"])
    let_go(page)

    expect_cards(page, "To do", ["Apple", "Banana", "Cherry"])
    nothing_sent(page, sent)


def test_alphabetically_a_card_moved_to_another_list_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Banana", "Apple", "Cherry"], "Doing": ["Date"]})
    sign_in(user)
    open_board(page, board)
    sort_by(page, "Alphabetically (A-Z)")
    sent = changes(page)

    drag_card(page, "Banana", card(page, "Date"))
    let_go(page, move_patch(board, "To do", "Banana"))

    expect_cards(page, "Doing", ["Banana", "Date"])
    # No order: this mode has its own.
    assert sent == [move_patch(board, "To do", "Banana")]
    page.reload()
    expect_cards(page, "Doing", ["Banana", "Date"])
    expect_cards(page, "To do", ["Apple", "Cherry"])


# A move cancelled.

def test_escape_puts_the_card_back_and_sends_nothing(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo"]})
    sign_in(user)
    open_board(page, board)
    sent = changes(page)

    drag_card(page, "Homepage layout", card(page, "Logo"))
    expect_shown(page, "Doing", ["Homepage layout", "Logo"])
    page.keyboard.press("Escape")
    let_go(page)

    expect_cards(page, "To do", ["Homepage layout", "Contact form"])
    expect_cards(page, "Doing", ["Logo"])
    nothing_sent(page, sent)


def test_a_card_let_go_away_from_every_list_lands_in_the_nearest(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo"]})
    sign_in(user)
    open_board(page, board)

    # Far to the right of the last list, on the board's empty background:
    # the nearest list takes it, and shows it before it's let go.
    drag_card(page, "Contact form", (1400, 600))
    expect_shown(page, "Doing", ["Logo", "Contact form"])
    let_go(page, move_patch(board, "To do", "Contact form"), order_put(board, "Doing"), order_put(board, "To do"))

    page.reload()
    expect_cards(page, "Doing", ["Logo", "Contact form"])
    expect_cards(page, "To do", ["Homepage layout"])


# A move that can't be saved (6B): it goes back, and the page says so.

def test_a_card_moved_meanwhile_by_someone_else_is_not_moved_again(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo"], "Done": []})
    sign_in(user)
    open_board(page, board)

    drag_card(page, "Contact form", card(page, "Logo"))
    # Someone else puts it in Done meanwhile: the page hears of it, but
    # leaves the lists alone until the drop is over.
    api(user).patch(f"/boards/{board.id}/lists/{board.lists['To do']}/cards/{board.cards['Contact form']}",
                    json={"list_id": board.lists["Done"]}).raise_for_status()
    page.wait_for_timeout(500)
    expect_shown(page, "Doing", ["Contact form", "Logo"])
    expect_shown(page, "Done", [])
    let_go(page)

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    # Then shows where it is.
    expect_cards(page, "Done", ["Contact form"])
    expect_cards(page, "To do", ["Homepage layout"])
    expect_cards(page, "Doing", ["Logo"])


def test_an_order_refused_puts_the_cards_back(page, make_user, sign_in, make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form", "Footer links"], "Doing": ["Logo"]})
    sign_in(user)
    open_board(page, board)

    drag_card(page, "Footer links", card(page, "Homepage layout"))
    # Someone else takes Contact form to Doing meanwhile, so the order the
    # drop sends names a card the list no longer has.
    api(user).patch(f"/boards/{board.id}/lists/{board.lists['To do']}/cards/{board.cards['Contact form']}",
                    json={"list_id": board.lists["Doing"]}).raise_for_status()
    page.wait_for_timeout(500)
    with page.expect_response(lambda r: urlparse(r.url).path == order_put(board, "To do").split(" ")[1]) as answer:
        page.mouse.up()
    assert answer.value.status == 422

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    expect_cards(page, "To do", ["Homepage layout", "Footer links"])
    expect_cards(page, "Doing", ["Contact form", "Logo"])


def test_a_move_without_a_connection_goes_back(page, context, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo"], "Done": ["Footer"]})
    sign_in(user)
    open_board(page, board)

    drag_card(page, "Contact form", card(page, "Logo"))
    context.set_offline(True)
    let_go(page)

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    # Fetched again to show what's saved, which can't be done: both lists
    # say so, rather than show what may be out of date.
    expect(column(page, "To do").get_by_text(CARDS_FAILED)).to_be_visible()
    expect(column(page, "Doing").get_by_text(CARDS_FAILED)).to_be_visible()
    expect_cards(page, "Done", ["Footer"])

    context.set_offline(False)
    for list_name in ("To do", "Doing"):
        column(page, list_name).get_by_role("button", name="Try again").click()
    # Nothing was saved.
    expect_cards(page, "To do", ["Homepage layout", "Contact form"])
    expect_cards(page, "Doing", ["Logo"])


def test_a_list_move_refused_goes_back(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": [], "Doing": [], "Done": []})
    sign_in(user)
    open_board(page, board)
    # As the server answers when a list was added or deleted elsewhere and
    # the page hasn't heard yet. The order saved, which the page then
    # fetches again, doesn't come until the test lets it.
    held = []
    order = f"**/api/v1/boards/{board.id}/lists/order"
    page.route(order, lambda route: route.fulfill(status=422, json={"detail": "List does not belong to this board"})
               if route.request.method == "PUT" else held.append(route))

    drag(page, page.get_by_role("button", name="Move the list To do"), column(page, "To do"),
         column(page, "Doing"))
    let_go(page)

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    # Back at once, not only once what's saved has come.
    expect_lists(page, ["To do", "Doing", "Done"])
    for route in held:
        route.continue_()
    page.unroute(order)
    expect_lists(page, ["To do", "Doing", "Done"])


def test_a_card_moved_into_a_list_still_loading_goes_back_if_refused(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo"]})
    sign_in(user)
    # Doing's cards don't come until the test lets them.
    held = []
    doing_cards = f"**/api/v1/boards/{board.id}/lists/{board.lists['Doing']}/cards"
    page.route(doing_cards, lambda route: held.append(route))
    # As the server answers when the card was archived elsewhere meanwhile.
    page.route(f"**{move_patch(board, 'To do', 'Contact form').split(' ')[1]}",
               lambda route: route.fulfill(status=404, json={"detail": "Card not found"}))
    open_board(page, board)
    expect_cards(page, "To do", ["Homepage layout", "Contact form"])

    drag_card(page, "Contact form", column(page, "Doing"))
    expect_shown(page, "Doing", ["Contact form"])
    let_go(page)

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    expect_cards(page, "To do", ["Homepage layout", "Contact form"])
    # Not what it showed before the drag, which it hadn't yet: loaded afresh.
    expect_cards(page, "Doing", [])
    for route in held:
        route.continue_()
    page.unroute(doing_cards)
    expect_cards(page, "Doing", ["Logo"])


# A list whose cards couldn't be loaded (6C).

def test_a_list_whose_cards_could_not_be_loaded_takes_no_card(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo"]})
    sign_in(user)
    page.route(f"**/api/v1/boards/{board.id}/lists/{board.lists['Doing']}/cards",
               lambda route: route.fulfill(status=500, body="Internal Server Error"))
    open_board(page, board)
    expect(column(page, "Doing").get_by_text(CARDS_FAILED)).to_be_visible()
    sent = changes(page)

    drag_card(page, "Contact form", column(page, "Doing"))
    # Not shown there: the order it would send would leave out the cards
    # not shown.
    expect_shown(page, "Doing", [])
    let_go(page)

    expect_cards(page, "To do", ["Homepage layout", "Contact form"])
    nothing_sent(page, sent)
    page.unroute(f"**/api/v1/boards/{board.id}/lists/{board.lists['Doing']}/cards")
    column(page, "Doing").get_by_role("button", name="Try again").click()
    expect_cards(page, "Doing", ["Logo"])


# With the keyboard (7A): the board's own rule for the arrow keys, and what a
# screen reader is told, in the user's language.

def handle(page, name):
    return page.get_by_role("button", name=f"Move {name}", exact=True)


def stays(page, key, said):
    """Presses a key that should move nothing: a screen reader is still told
    `said`, once a move would have been told."""
    page.keyboard.press(key)
    page.wait_for_timeout(300)
    heard(page, said)


def test_a_card_moved_down_its_list_with_the_keyboard_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form", "Footer links"]})
    sign_in(user)
    open_board(page, board)

    pick_up(page, handle(page, "Homepage layout"), "Picked up Homepage layout.")
    press(page, "ArrowDown", "Moving Homepage layout, over Contact form, in the list To do.")
    press(page, "ArrowDown", "Moving Homepage layout, over Footer links, in the list To do.")
    let_go(page, order_put(board, "To do"), key="Space")
    heard(page, "Dropped Homepage layout over Footer links, in the list To do.")

    expect_cards(page, "To do", ["Contact form", "Footer links", "Homepage layout"])
    page.reload()
    expect_cards(page, "To do", ["Contact form", "Footer links", "Homepage layout"])


def test_the_arrows_take_a_card_to_a_card_of_the_next_list_then_into_an_empty_one(page, make_user, sign_in,
                                                                                   make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"],
                              "Doing": ["Logo", "Colour palette", "Fonts"], "Done": []})
    sign_in(user)
    open_board(page, board)

    pick_up(page, handle(page, "Contact form"), "Picked up Contact form.")
    # The last of its list, it goes no further down: not to a lower card of
    # the list next door.
    stays(page, "ArrowDown", "Picked up Contact form.")
    # Beside where it was, not into the list's drop area or down to the next
    # card. That's its place there, as yet changed with no other card.
    press(page, "ArrowRight", "Moving Contact form, over the list Doing.")
    expect_shown(page, "Doing", ["Logo", "Contact form", "Colour palette", "Fonts"])
    press(page, "ArrowRight", "Moving Contact form, over the list Done.")
    let_go(page, move_patch(board, "To do", "Contact form"), order_put(board, "Done"), order_put(board, "To do"),
           key="Space")

    page.reload()
    expect_cards(page, "Done", ["Contact form"])
    expect_cards(page, "Doing", ["Logo", "Colour palette", "Fonts"])
    expect_cards(page, "To do", ["Homepage layout"])


def test_in_a_list_it_has_just_moved_into_a_card_is_over_the_card_it_changes_places_with(page, make_user, sign_in,
                                                                                         make_board):
    # As in its own list (7F): "over Logo" means it takes Logo's place.
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo", "Colour palette"]})
    sign_in(user)
    open_board(page, board)

    pick_up(page, handle(page, "Contact form"), "Picked up Contact form.")
    press(page, "ArrowRight", "Moving Contact form, over the list Doing.")
    expect_shown(page, "Doing", ["Logo", "Contact form", "Colour palette"])
    press(page, "ArrowDown", "Moving Contact form, over Colour palette, in the list Doing.")
    expect_shown(page, "Doing", ["Logo", "Colour palette", "Contact form"])
    press(page, "ArrowUp", "Moving Contact form, over the list Doing.")
    press(page, "ArrowUp", "Moving Contact form, over Logo, in the list Doing.")
    expect_shown(page, "Doing", ["Contact form", "Logo", "Colour palette"])
    let_go(page, move_patch(board, "To do", "Contact form"), order_put(board, "Doing"), order_put(board, "To do"),
           key="Space")
    heard(page, "Dropped Contact form over Logo, in the list Doing.")

    expect_cards(page, "Doing", ["Contact form", "Logo", "Colour palette"])
    page.reload()
    expect_cards(page, "Doing", ["Contact form", "Logo", "Colour palette"])


def test_a_list_moved_with_the_keyboard_stays_there(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"], "Doing": ["Logo"], "Done": []})
    sign_in(user)
    open_board(page, board)

    pick_up(page, handle(page, "the list To do"), "Picked up the list To do.")
    # A list moves only among the lists. Down onto its own cards, it would
    # still be over its own place, so nothing would be said, but Right would
    # then find no list.
    stays(page, "ArrowDown", "Picked up the list To do.")
    press(page, "ArrowRight", "Moving the list To do, over the list Doing.")
    let_go(page, f"PUT /api/v1/boards/{board.id}/lists/order", key="Space")
    heard(page, "Dropped the list To do over the list Doing.")

    expect_lists(page, ["Doing", "To do", "Done"])
    page.reload()
    expect_lists(page, ["Doing", "To do", "Done"])


def test_escape_puts_a_card_moved_with_the_keyboard_back(page, make_user, sign_in, make_board):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo", "Colour palette"]})
    sign_in(user)
    open_board(page, board)
    sent = changes(page)

    pick_up(page, handle(page, "Contact form"), "Picked up Contact form.")
    press(page, "ArrowRight", "Moving Contact form, over the list Doing.")
    expect_shown(page, "Doing", ["Logo", "Contact form", "Colour palette"])
    let_go(page, key="Escape")
    heard(page, "Move cancelled: Contact form is back in its place.")

    expect_cards(page, "To do", ["Homepage layout", "Contact form"])
    expect_cards(page, "Doing", ["Logo", "Colour palette"])
    nothing_sent(page, sent)


def test_a_screen_reader_is_told_in_catalan_to_a_user_who_reads_catalan(page, make_user, sign_in, make_board, api):
    user = make_user()
    api(user).put("/users/me/preferences", json={"language_locale": "ca_ES"}).raise_for_status()
    board = make_board(user, {"To do": ["Homepage layout", "Contact form"]})
    sign_in(user)
    page.goto(f"/boards/{board.id}")

    pick_up(page, page.get_by_role("button", name="Mou Homepage layout", exact=True), "Has agafat Homepage layout.")
    press(page, "ArrowDown", "Movent Homepage layout, sobre Contact form, a la llista To do.")
    let_go(page, order_put(board, "To do"), key="Space")
    heard(page, "Has deixat Homepage layout sobre Contact form, a la llista To do.")

    pick_up(page, page.get_by_role("button", name="Mou la llista To do", exact=True), "Has agafat la llista To do.")
    let_go(page, key="Escape")
    heard(page, "Moviment cancel·lat: la llista To do torna a ser al seu lloc.")
