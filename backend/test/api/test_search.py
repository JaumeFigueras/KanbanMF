#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for GET /api/v1/search: what is searched, how words match, and the
four scopes (every board, one board, one board's archive, archived boards)."""

from types import SimpleNamespace

import pytest
import pytest_asyncio

from src.core import search as search_module
from src.core.security import create_access_token
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.label import Label
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User


@pytest_asyncio.fixture
async def data(db_session_async, test_user: User) -> SimpleNamespace:
    """test_user owns "Website" (shared with nobody) with a live list holding
    cards that match in each field, an archived card and an archived list.
    Ann owns "Ann's board", shared with test_user, and "Private", which isn't.
    test_user also has an archived board and a template."""
    ann = User(email="ann@example.com", display_name="Ann", is_verified=True)
    db_session_async.add(ann)
    await db_session_async.flush()

    website = Board(owner_id=test_user.id, name="Website")
    shared = Board(owner_id=ann.id, name="Ann's board")
    private = Board(owner_id=ann.id, name="Private")
    old = Board(owner_id=test_user.id, name="Old website", is_archived=True)
    template = Board(owner_id=test_user.id, name="Website template", is_template=True)
    db_session_async.add_all([website, shared, private, old, template])
    await db_session_async.flush()
    db_session_async.add(BoardShare(board_id=shared.id, user_id=test_user.id))

    live = BoardList(board_id=website.id, name="Live")
    gone = BoardList(board_id=website.id, name="Gone", is_archived=True)
    shared_list = BoardList(board_id=shared.id, name="Shared list")
    private_list = BoardList(board_id=private.id, name="Private list")
    old_list = BoardList(board_id=old.id, name="Old list")
    label = Label(board_id=website.id, name="Urgent", color="#f00", position=0)
    db_session_async.add_all([live, gone, shared_list, private_list, old_list, label])
    await db_session_async.flush()

    by_name = Card(list_id=live.id, name="Cafè menu")
    by_description = Card(list_id=live.id, name="Second", description="Talk to the cafe owner")
    by_checklist = Card(list_id=live.id, name="Third")
    by_item = Card(list_id=live.id, name="Fourth")
    by_label = Card(list_id=live.id, name="Fifth", labels=[label])
    wildcard = Card(list_id=live.id, name="100% done_now")
    archived_card = Card(list_id=live.id, name="Archived cafe", is_archived=True)
    deleted_card = Card(list_id=live.id, name="Deleted cafe", is_deleted=True)
    in_gone = Card(list_id=gone.id, name="Cafe in archived list")
    shared_card = Card(list_id=shared_list.id, name="Shared cafe")
    private_card = Card(list_id=private_list.id, name="Private cafe")
    old_card = Card(list_id=old_list.id, name="Old cafe")
    old_archived = Card(list_id=old_list.id, name="Old archived cafe", is_archived=True)
    db_session_async.add_all([
        by_name, by_description, by_checklist, by_item, by_label, wildcard, archived_card,
        deleted_card, in_gone, shared_card, private_card, old_card, old_archived,
    ])
    await db_session_async.flush()

    db_session_async.add(Checklist(card_id=by_checklist.id, name="Cafe tasks", position=0))
    item_list = Checklist(card_id=by_item.id, name="Steps", position=0)
    db_session_async.add(item_list)
    await db_session_async.flush()
    db_session_async.add(ChecklistItem(checklist_id=item_list.id, text="Call the café", position=0))
    # A custom order that differs from creation order.
    db_session_async.add(UIListCardOrder(list_id=live.id, card_ids=[by_item.id, by_name.id]))
    await db_session_async.commit()
    return SimpleNamespace(
        ann=ann, website=website, shared=shared, private=private, old=old, template=template,
        by_name=by_name, by_description=by_description, by_checklist=by_checklist,
        by_item=by_item, by_label=by_label,
    )


async def _search(client, headers, **params) -> dict:
    response = await client.get("/api/v1/search", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _card_names(result: dict) -> set[str]:
    return {card["name"] for b in result["boards"] for lst in b["lists"] for card in lst["cards"]}


@pytest.mark.asyncio
async def test_search_01(client, auth_headers: dict[str, str], data) -> None:
    """
    Verify a search finds a word in each searched field — name, description,
    checklist name, checklist item and label — ignoring case and accents,
    says where it matched, and covers only live cards of live boards the user
    can see.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.

    Raises
    ------
    AssertionError
        If a field isn't searched, an out-of-scope card shows up, or
        matched_in is wrong.
    """
    result = await _search(client, auth_headers, q="CAFE")
    assert _card_names(result) == {
        "Cafè menu", "Second", "Third", "Fourth", "Shared cafe",
    }
    website = next(b for b in result["boards"] if b["board_id"] == str(data.website.id))
    assert website["match_count"] == 4
    assert website["matched_in"] == {
        str(data.by_name.id): ["name"],
        str(data.by_description.id): ["description"],
        str(data.by_checklist.id): ["checklist"],
        str(data.by_item.id): ["checklist"],
    }
    # Most matches first.
    assert [b["board_name"] for b in result["boards"]] == ["Website", "Ann's board"]

    result = await _search(client, auth_headers, q="urgent")
    assert _card_names(result) == {"Fifth"}
    assert result["boards"][0]["matched_in"] == {str(data.by_label.id): ["label"]}


@pytest.mark.asyncio
async def test_search_02(client, auth_headers: dict[str, str], data) -> None:
    """
    Verify every word must match, each in any field, and that LIKE's
    wildcards in the search match themselves.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.

    Raises
    ------
    AssertionError
        If a card matching only some of the words is found, or a wildcard
        matches anything.
    """
    assert _card_names(await _search(client, auth_headers, q="second owner")) == {"Second"}
    assert _card_names(await _search(client, auth_headers, q="second menu")) == set()
    assert _card_names(await _search(client, auth_headers, q="0% done_")) == {"100% done_now"}
    assert _card_names(await _search(client, auth_headers, q="o_e")) == set()  # "one" if _ were a wildcard
    assert _card_names(await _search(client, auth_headers, q="e%n")) == set()  # "e_n" if % were a wildcard


@pytest.mark.asyncio
async def test_search_03(client, auth_headers: dict[str, str], data) -> None:
    """
    Verify the cards in a list come back in the list's custom order, with
    the cards missing from it after.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.

    Raises
    ------
    AssertionError
        If the order differs.
    """
    result = await _search(client, auth_headers, q="cafe", board_id=str(data.website.id))
    cards = result["boards"][0]["lists"][0]["cards"]
    assert [c["name"] for c in cards][:2] == ["Fourth", "Cafè menu"]
    assert {c["name"] for c in cards[2:]} == {"Second", "Third"}


@pytest.mark.asyncio
async def test_search_04(client, auth_headers: dict[str, str], data) -> None:
    """
    Verify a search within one board only covers its live cards and returns
    no matching boards, and that a board the user can't see is refused.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.

    Raises
    ------
    AssertionError
        If cards of another board show up, or the private board is searched.
    """
    result = await _search(client, auth_headers, q="cafe", board_id=str(data.shared.id))
    assert _card_names(result) == {"Shared cafe"}
    assert result["matching_boards"] == []

    private = await client.get(
        "/api/v1/search",
        params={"q": "cafe", "board_id": str(data.private.id)},
        headers=auth_headers,
    )
    assert private.status_code == 403

    ann_private = await _search(client, {"Authorization": f"Bearer {create_access_token(data.ann.id)}"}, q="cafe")
    assert "Private cafe" in _card_names(ann_private)


@pytest.mark.asyncio
async def test_search_05(client, auth_headers: dict[str, str], data) -> None:
    """
    Verify the two archive searches: a board's archive covers its archived
    cards and the cards of its archived lists; the archived-boards search
    covers every card of the user's own archived boards, archived or not.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.

    Raises
    ------
    AssertionError
        If a live card, a deleted card or a card outside the scope shows up.
    """
    result = await _search(client, auth_headers, q="cafe", board_id=str(data.website.id), archived="true")
    assert _card_names(result) == {"Archived cafe", "Cafe in archived list"}

    result = await _search(client, auth_headers, q="cafe", archived="true")
    assert _card_names(result) == {"Old cafe", "Old archived cafe"}


@pytest.mark.asyncio
async def test_search_06(client, auth_headers: dict[str, str], data) -> None:
    """
    Verify matching_boards lists the boards whose name holds every word —
    templates included — live ones in the normal search and the user's
    archived ones in the archived search.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.

    Raises
    ------
    AssertionError
        If a board is missing, or one outside the scope is listed.
    """
    result = await _search(client, auth_headers, q="website")
    assert [b["board_name"] for b in result["matching_boards"]] == ["Website", "Website template"]

    result = await _search(client, auth_headers, q="website", archived="true")
    assert [b["board_name"] for b in result["matching_boards"]] == ["Old website"]

    result = await _search(client, auth_headers, q="website template")
    assert [b["board_name"] for b in result["matching_boards"]] == ["Website template"]


@pytest.mark.asyncio
async def test_search_07(client, auth_headers: dict[str, str], data, monkeypatch) -> None:
    """
    Verify a search returns at most SEARCH_LIMIT cards and says when more
    matched, and that a search shorter than two characters is refused.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.
    data : SimpleNamespace
        The boards, lists and cards.
    monkeypatch : pytest.MonkeyPatch
        Lowers the limit.

    Raises
    ------
    AssertionError
        If the limit or the flag is wrong, or a one-letter search is accepted.
    """
    monkeypatch.setattr(search_module, "SEARCH_LIMIT", 2)
    result = await _search(client, auth_headers, q="cafe")
    assert len(_card_names(result)) == 2
    assert result["truncated"] is True

    monkeypatch.setattr(search_module, "SEARCH_LIMIT", 5)
    assert (await _search(client, auth_headers, q="cafe"))["truncated"] is False

    response = await client.get("/api/v1/search", params={"q": "c"}, headers=auth_headers)
    assert response.status_code == 422
