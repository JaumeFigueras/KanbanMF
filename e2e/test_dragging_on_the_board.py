#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dragging lists and cards on a board with the mouse, as jsdom can't: what
is saved, what each sort mode keeps, a move cancelled, and a move that
can't be saved."""

import time
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from playwright.sync_api import expect

MOVE_FAILED = "The move couldn't be saved, and has been undone. Please try again."
CARDS_FAILED = "This list's cards couldn't be loaded."

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


def eventually(read, expected, timeout=5):
    deadline = time.monotonic() + timeout
    while (got := read()) != expected and time.monotonic() < deadline:
        time.sleep(0.1)
    assert got == expected


def names(handles, prefix: str, axis: str | None = None) -> list[str]:
    """The names on the handles, in the page's order, or along the axis as
    they're seen: during a drag, the two differ."""
    # Read in one go, as the page may change them meanwhile.
    found = handles.evaluate_all("(handles, axis) => handles.map(h => "
                                 "[axis ? h.getBoundingClientRect()[axis] : 0, h.getAttribute('aria-label')])", axis)
    return [label.removeprefix(prefix) for _, label in sorted(found, key=lambda f: f[0])]


def expect_cards(page, list_name, cards):
    """The list's cards, once nothing is being dragged."""
    eventually(lambda: names(column(page, list_name).locator(CARD_HANDLES), "Move "), cards)


def expect_shown(page, list_name, cards):
    """The list's cards as they're seen during a drag, where the one dragged
    would land."""
    eventually(lambda: names(column(page, list_name).locator(CARD_HANDLES), "Move ", "y"), cards)


def expect_lists(page, lists):
    eventually(lambda: names(page.locator(LIST_HANDLES), "Move the list "), lists)


def centre(locator):
    box = locator.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def drag(page, handle, dragged, onto):
    """Picks the handle up and moves it until the middle of what's dragged
    is over the middle of `onto` (or over the point `onto`), without
    letting go. Where it would land follows from the dragged thing's
    middle, not the pointer's."""
    # Measured first: once it's picked up, a floating copy follows the
    # pointer, and its place is kept by a hidden one.
    dx, dy = centre(dragged)
    tx, ty = onto if isinstance(onto, tuple) else centre(onto)
    x, y = centre(handle)
    page.mouse.move(x, y)
    page.mouse.down()
    # Past the few pixels that start a drag.
    page.mouse.move(x + 6, y + 6, steps=3)
    page.mouse.move(x + tx - dx, y + ty - dy, steps=20)
    # The list makes room with an animation, which moves what's beneath.
    page.wait_for_timeout(400)


def drag_card(page, name, onto):
    drag(page, page.get_by_role("button", name=f"Move {name}", exact=True), card(page, name), onto)


def changes(page) -> list[str]:
    """Every change the page sends, as "METHOD /path", as it sends it."""
    sent = []
    page.on("request", lambda r: sent.append(f"{r.method} {urlparse(r.url).path}") if r.method != "GET" else None)
    return sent


def let_go(page, *saves):
    """Lets go, and waits until each of the changes the drop should send
    ("METHOD /path") has been saved, and the floating copy is gone."""
    with ExitStack() as stack:
        answers = [stack.enter_context(page.expect_response(
            lambda r, save=save: f"{r.request.method} {urlparse(r.url).path}" == save)) for save in saves]
        page.mouse.up()
    for answer in answers:
        assert answer.value.ok, f"{answer.value.request.method} {answer.value.url}: {answer.value.status}"
    # Until then, what's dragged has two handles.
    page.wait_for_function("""() => {
        const labels = [...document.querySelectorAll("button[aria-label^='Move ']")].map(b => b.ariaLabel)
        return new Set(labels).size === labels.length
    }""")


def nothing_sent(page, sent):
    # Time for a change to go out, which would be counted.
    page.wait_for_timeout(500)
    assert sent == []


def order_put(board, list_name):
    return f"PUT /api/v1/boards/{board.id}/lists/{board.lists[list_name]}/cards/order"


def move_patch(board, list_name, card_name):
    return f"PATCH /api/v1/boards/{board.id}/lists/{board.lists[list_name]}/cards/{board.cards[card_name]}"


def open_board(page, board):
    page.goto(f"/boards/{board.id}")
    for list_name in board.lists:
        expect(column(page, list_name)).to_be_visible()


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
    # the page hasn't heard yet.
    page.route(f"**/api/v1/boards/{board.id}/lists/order",
               lambda route: route.fulfill(status=422, json={"detail": "List does not belong to this board"})
               if route.request.method == "PUT" else route.fallback())

    drag(page, page.get_by_role("button", name="Move the list To do"), column(page, "To do"),
         column(page, "Doing"))
    let_go(page)

    expect(page.get_by_text(MOVE_FAILED)).to_be_visible()
    expect_lists(page, ["To do", "Doing", "Done"])


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
