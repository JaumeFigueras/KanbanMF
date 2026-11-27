#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Two people at once, each in a browser of their own: what one changes on a
shared board reaches the other's page without a reload, and the page that
made the change doesn't fetch it again; an open card changed by the other
says so and keeps what was typed (5A); a board that comes or goes while
you're on the boards page or on the board; a card dragged while the other
changes its lists (7B); and what changed while the connection was down (7C)."""

import re
from urllib.parse import urlparse

import pytest
from playwright.sync_api import expect

from board_page import card, column, drag_card, expect_cards, expect_lists, move_patch, open_board, order_put
from dragging import drag, let_go
from live_updates import listening, notifications, unchanged_list_order, wait_until

CHANGED_ELSEWHERE = ("This card was changed elsewhere while you were editing it. Saving replaces those changes; "
                     "Cancel to see them.")


def fetches(page) -> list[str]:
    """Every path the page fetches, from now on."""
    fetched = []
    page.on("request", lambda r: fetched.append(urlparse(r.url).path) if r.method == "GET" else None)
    return fetched


def share_board(make_user, make_board, api, lists):
    """A board of Emma's, with its lists and cards, shared with Oliver: the
    board, a client signed in as Emma, and the two of them."""
    emma, oliver = make_user("Emma Wilson"), make_user("Oliver Brown")
    board = make_board(emma, lists)
    client = api(emma)
    client.post(f"/boards/{board.id}/shares", json={"user_id": oliver.id}).raise_for_status()
    return board, client, emma, oliver


def card_path(board, list_name, card_name):
    return f"/boards/{board.id}/lists/{board.lists[list_name]}/cards/{board.cards[card_name]}"


def card_dialog(page):
    return page.get_by_role("dialog", name="Edit Card")


def open_card(page, name):
    page.get_by_text(name, exact=True).click()
    expect(card_dialog(page)).to_be_visible()


# What Emma changes on her page reaches Oliver's.

class Shared:
    """Emma's board, shared with Oliver, open on both their pages: Emma's is
    the test's own, Oliver's in a browser of his own. setup(client, board)
    adds to the board before they open it."""

    def __init__(self, page, another_browser, make_user, sign_in, make_board, api, lists, setup=None):
        self.board, self.api, emma, oliver = share_board(make_user, make_board, api, lists)
        if setup:
            setup(self.api, self.board)
        sign_in(emma)
        self.mine, self.theirs = page, another_browser(oliver)
        self.told_me, told_them = notifications(self.mine), notifications(self.theirs)
        for p in (self.mine, self.theirs):
            open_board(p, self.board)
        listening(page, unchanged_list_order(self.api, self.board), self.told_me, told_them)
        self.told_me.clear()
        self.fetched = fetches(self.mine)

    def not_fetched_again(self, kind):
        """Emma's page, which made the change, is told of it too, as
        everyone is, and fetches nothing again for it: neither the lists nor
        any list's cards. What it shows is already up to date."""
        lists = f"/api/v1/boards/{self.board.id}/lists"
        again = {lists, f"{lists}/order"} | {f"{lists}/{list_id}/cards{end}"
                                               for list_id in self.board.lists.values() for end in ("", "/order")}
        assert wait_until(self.mine, lambda: kind in self.told_me)
        # Time for a fetch to go out, which would be counted.
        self.mine.wait_for_timeout(500)
        assert [path for path in self.fetched if path in again] == []


@pytest.fixture
def shared(page, another_browser, make_user, sign_in, make_board, api):
    return lambda lists, setup=None: Shared(page, another_browser, make_user, sign_in, make_board, api, lists, setup)


def test_a_card_created_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout"]})

    s.mine.get_by_role("button", name="Add a card to To do").click()
    dialog = s.mine.get_by_role("dialog", name="Create Card")
    dialog.get_by_label("Card name").fill("Contact form")
    dialog.get_by_role("button", name="Save").click()
    expect_cards(s.mine, "To do", ["Contact form", "Homepage layout"])

    expect_cards(s.theirs, "To do", ["Contact form", "Homepage layout"])
    s.not_fetched_again("card_created")


def test_a_card_renamed_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout"]})

    open_card(s.mine, "Homepage layout")
    card_dialog(s.mine).get_by_label("Card name").fill("Landing page")
    card_dialog(s.mine).get_by_role("button", name="Save").click()
    expect_cards(s.mine, "To do", ["Landing page"])

    expect_cards(s.theirs, "To do", ["Landing page"])
    s.not_fetched_again("card_updated")


def test_a_card_moved_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout", "Contact form"], "Doing": ["Logo", "Colour palette"]})

    drag_card(s.mine, "Contact form", card(s.mine, "Colour palette"))
    let_go(s.mine, move_patch(s.board, "To do", "Contact form"), order_put(s.board, "Doing"),
           order_put(s.board, "To do"))

    expect_cards(s.theirs, "Doing", ["Logo", "Contact form", "Colour palette"])
    expect_cards(s.theirs, "To do", ["Homepage layout"])
    s.not_fetched_again("card_order_changed")


def test_a_card_archived_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout", "Contact form"]})

    s.mine.get_by_role("button", name="Menu for Contact form").click()
    s.mine.get_by_role("menuitem", name="Archive card").click()
    expect_cards(s.mine, "To do", ["Homepage layout"])

    expect_cards(s.theirs, "To do", ["Homepage layout"])
    s.not_fetched_again("card_archived")


def test_a_checklist_item_ticked_reaches_the_other_page(shared):
    def launch_checklist(client, board):
        path = card_path(board, "To do", "Homepage layout")
        checklist = client.post(f"{path}/checklists", json={"name": "Launch"}).raise_for_status().json()["id"]
        for text in ("Logo", "Fonts"):
            client.post(f"{path}/checklists/{checklist}/items", json={"text": text}).raise_for_status()
    s = shared({"To do": ["Homepage layout"]}, setup=launch_checklist)
    expect(card(s.theirs, "Homepage layout")).to_contain_text("0/2 (0%)")

    open_card(s.mine, "Homepage layout")
    card_dialog(s.mine).get_by_role("checkbox", name="Logo").check()
    card_dialog(s.mine).get_by_role("button", name="Save").click()
    expect(card(s.mine, "Homepage layout")).to_contain_text("1/2 (50%)")

    expect(card(s.theirs, "Homepage layout")).to_contain_text("1/2 (50%)")
    s.not_fetched_again("card_updated")


def test_a_list_added_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout"]})

    s.mine.get_by_role("button", name="Add List").click()
    dialog = s.mine.get_by_role("dialog", name="Create a new List")
    dialog.get_by_label("List name").fill("Done")
    dialog.get_by_role("button", name="Save").click()
    expect_lists(s.mine, ["To do", "Done"])

    expect_lists(s.theirs, ["To do", "Done"])
    s.not_fetched_again("list_created")


def test_a_list_renamed_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout"], "Doing": []})

    s.mine.get_by_role("button", name="Menu for the list Doing").click()
    s.mine.get_by_role("menuitem", name="Rename List").click()
    dialog = s.mine.get_by_role("dialog", name="Rename List")
    dialog.get_by_label("List name").fill("In progress")
    dialog.get_by_role("button", name="Save").click()
    expect_lists(s.mine, ["To do", "In progress"])

    expect_lists(s.theirs, ["To do", "In progress"])
    s.not_fetched_again("list_renamed")


def test_a_list_moved_reaches_the_other_page(shared):
    s = shared({"To do": ["Homepage layout"], "Doing": ["Logo"]})

    handle = s.mine.get_by_role("button", name="Move the list To do", exact=True)
    drag(s.mine, handle, column(s.mine, "To do"), card(s.mine, "Logo"))
    let_go(s.mine, f"PUT /api/v1/boards/{s.board.id}/lists/order")
    expect_lists(s.mine, ["Doing", "To do"])

    expect_lists(s.theirs, ["Doing", "To do"])
    s.not_fetched_again("list_reordered")


def test_a_label_renamed_reaches_the_cards_on_the_other_page(shared):
    # 6A: every card shows its labels.
    def urgent_card(client, board):
        label = client.post(f"/boards/{board.id}/labels",
                            json={"name": "Urgent", "color": "#1976d2"}).raise_for_status().json()["id"]
        client.post(f"/boards/{board.id}/lists/{board.lists['To do']}/cards",
                    json={"name": "Homepage layout", "label_ids": [label]}).raise_for_status()
    s = shared({"To do": []}, setup=urgent_card)
    chips = card(s.theirs, "Homepage layout").locator(".MuiChip-label")
    expect(chips).to_have_text(["Urgent"])

    s.mine.get_by_role("button", name="Labels", exact=True).click()
    labels = s.mine.get_by_role("dialog", name="Labels")
    labels.get_by_role("button", name="Edit the label Urgent").click()
    dialog = s.mine.get_by_role("dialog", name="Edit label")
    dialog.get_by_label("Label name").fill("Blocker")
    dialog.get_by_role("button", name="Save").click()
    expect(labels.get_by_role("button", name="Edit the label Blocker")).to_be_visible()

    expect(chips).to_have_text(["Blocker"])


# What Oliver's page, the test's own now, shows of what Emma changes
# elsewhere.

def open_as_oliver(page, sign_in, board, client, oliver) -> list[str]:
    """Oliver's page on the board, once it's told of what changes; what it's
    told."""
    told = notifications(page)
    sign_in(oliver)
    open_board(page, board)
    listening(page, unchanged_list_order(client, board), told)
    return told


def open_boards_page_as_oliver(page, sign_in, api, oliver):
    """Oliver's boards page, with none shared with him yet, once it's told of
    what changes."""
    told = notifications(page)
    sign_in(oliver)
    page.goto("/boards")
    expect(page.get_by_text("Shared with me (0)")).to_be_visible()
    listening(page, lambda: api(oliver).put("/boards/order", json={}).raise_for_status(), told)


def test_an_open_card_changed_by_the_other_says_so_and_keeps_what_was_typed(page, make_user, sign_in, make_board,
                                                                            api):
    # 5A
    board, emma, _, oliver = share_board(make_user, make_board, api, {"To do": ["Homepage layout"]})
    open_as_oliver(page, sign_in, board, emma, oliver)
    open_card(page, "Homepage layout")
    card_dialog(page).get_by_label("Description").fill("Hero image first")

    emma.patch(card_path(board, "To do", "Homepage layout"), json={"name": "Landing page"}).raise_for_status()

    expect(card_dialog(page).get_by_text(CHANGED_ELSEWHERE)).to_be_visible()
    expect(card_dialog(page).get_by_label("Card name")).to_have_value("Homepage layout")
    expect(card_dialog(page).get_by_label("Description")).to_have_value("Hero image first")


def test_a_board_shared_with_you_appears_on_the_boards_page(page, make_user, sign_in, make_board, api):
    emma, oliver = make_user("Emma Wilson"), make_user("Oliver Brown")
    board = make_board(emma, {"To do": []})
    open_boards_page_as_oliver(page, sign_in, api, oliver)

    api(emma).post(f"/boards/{board.id}/shares", json={"user_id": oliver.id}).raise_for_status()

    expect(page.get_by_text("Shared with me (1)")).to_be_visible()
    expect(page.get_by_role("link", name="Website redesign")).to_be_visible()


@pytest.mark.parametrize("taken_away", ["archived", "unshared"])
def test_a_board_taken_away_while_you_are_on_it_is_closed_to_you(taken_away, page, make_user, sign_in, make_board,
                                                                  api):
    board, emma, _, oliver = share_board(make_user, make_board, api, {"To do": ["Homepage layout"]})
    open_as_oliver(page, sign_in, board, emma, oliver)

    if taken_away == "archived":
        emma.patch(f"/boards/{board.id}", json={"is_archived": True}).raise_for_status()
    else:
        emma.delete(f"/boards/{board.id}/shares/{oliver.id}").raise_for_status()

    expect(page.get_by_text("You don't have access to this board.")).to_be_visible()
    expect(column(page, "To do")).to_have_count(0)


def test_a_card_dragged_while_the_other_changes_both_lists_is_moved_once(page, make_user, sign_in, make_board, api):
    # 7B: no list's cards are fetched until the drop is saved, so the card
    # can't vanish from the list it's over, or show twice in the one it left.
    board, emma, _, oliver = share_board(make_user, make_board, api, {"To do": ["Homepage layout", "Contact form"],
                                                                      "Doing": ["Logo", "Colour palette"]})
    told = open_as_oliver(page, sign_in, board, emma, oliver)
    drag_card(page, "Contact form", card(page, "Colour palette"))
    fetched = fetches(page)
    told.clear()

    emma.patch(card_path(board, "Doing", "Logo"), json={"name": "Logo v2"}).raise_for_status()
    emma.patch(card_path(board, "To do", "Homepage layout"), json={"name": "Homepage"}).raise_for_status()
    assert wait_until(page, lambda: told.count("card_updated") == 2)
    page.wait_for_timeout(500)
    assert [path for path in fetched if path.endswith("/cards")] == []

    let_go(page, move_patch(board, "To do", "Contact form"), order_put(board, "Doing"), order_put(board, "To do"))
    expect_cards(page, "Doing", ["Logo v2", "Contact form", "Colour palette"])
    expect_cards(page, "To do", ["Homepage"])
    page.reload()
    expect_cards(page, "Doing", ["Logo v2", "Contact form", "Colour palette"])
    expect_cards(page, "To do", ["Homepage"])


# 7C: the notifications sent while a page's connection is down never reach
# it, so once it's back the page fetches again what it shows. Chromium's
# offline mode leaves an open WebSocket open, so the test goes between the
# page and the backend, and drops the connection itself.

class Connection:
    def __init__(self, page):
        self.open = []
        page.route_web_socket(re.compile(r"/api/v1/ws$"), lambda ws: self.open.append((ws, ws.connect_to_server())))

    def drop(self):
        """Drops the page's connection, as a Wi-Fi gone or a backend
        restarted would. The page tries again 3 seconds later."""
        ws, server = self.open.pop()
        server.close()
        ws.close()


def test_what_changed_on_the_board_while_the_connection_was_down_shows_once_it_is_back(page, make_user, sign_in,
                                                                                      make_board, api):
    board, emma, _, oliver = share_board(make_user, make_board, api, {"To do": ["Homepage layout"]})
    connection = Connection(page)
    open_as_oliver(page, sign_in, board, emma, oliver)

    connection.drop()
    emma.post(f"/boards/{board.id}/lists/{board.lists['To do']}/cards", json={"name": "Contact form"}).raise_for_status()
    page.wait_for_timeout(1000)
    expect_cards(page, "To do", ["Homepage layout"])

    expect_cards(page, "To do", ["Contact form", "Homepage layout"])
    assert len(connection.open) == 1


def test_a_board_shared_while_the_connection_was_down_shows_once_it_is_back(page, make_user, sign_in, make_board,
                                                                           api):
    emma, oliver = make_user("Emma Wilson"), make_user("Oliver Brown")
    board = make_board(emma, {"To do": []})
    connection = Connection(page)
    open_boards_page_as_oliver(page, sign_in, api, oliver)

    connection.drop()
    api(emma).post(f"/boards/{board.id}/shares", json={"user_id": oliver.id}).raise_for_status()
    page.wait_for_timeout(1000)
    expect(page.get_by_text("Shared with me (0)")).to_be_visible()

    expect(page.get_by_text("Shared with me (1)")).to_be_visible()
    expect(page.get_by_role("link", name="Website redesign")).to_be_visible()
    assert len(connection.open) == 1
