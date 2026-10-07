#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for board templates: boards flagged is_template that hold only lists."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core import notifications
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_notification_settings import BoardNotificationSettings
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.card_assignee import CardAssignee
from src.model.ui_board_color import UIBoardColor
from src.model.ui_board_list_order import UIBoardListOrder
from src.model.ui_list_color import UIListColor
from src.model.user import User


@pytest.mark.asyncio
async def test_board_templates_01(
    client, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify a board created the usual way is not a template, and that the
    is_template flag is part of the board payload.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If is_template is missing from the response or is not False.
    """
    response = await client.post(
        "/api/v1/boards", json={"name": "Plain board"}, headers=auth_headers
    )

    assert response.status_code == 201
    assert response.json()["is_template"] is False


@pytest.mark.asyncio
async def test_board_templates_02(
    client, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET/PUT /boards/order carry a template_ids section: it starts empty,
    a PUT stores it in the given order, and a PUT that omits it leaves it
    unchanged.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If template_ids is missing, loses its order, or is overwritten by a PUT
        that did not include it.
    """
    response = await client.get("/api/v1/boards/order", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["template_ids"] == []

    ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    response = await client.put(
        "/api/v1/boards/order", json={"template_ids": ids}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["template_ids"] == ids

    response = await client.put(
        "/api/v1/boards/order", json={"owned_ids": []}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["template_ids"] == ids

    response = await client.get("/api/v1/boards/order", headers=auth_headers)
    assert response.json()["template_ids"] == ids


@pytest_asyncio.fixture
async def other_user(db_session_async) -> User:
    """A second user, who owns templates shared with (or hidden from) test_user."""
    user = User(email="other@example.com", display_name="Other User")
    db_session_async.add(user)
    await db_session_async.commit()
    await db_session_async.refresh(user)
    return user


@pytest.mark.asyncio
async def test_board_templates_03(
    client, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify POST /boards with is_template creates a template that is listed in
    the templates section (not in owned) and appended to template_ids (not to
    owned_ids), and that a template cannot be created starred.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the template lands in the wrong section or order array, or a starred
        template is accepted.
    """
    response = await client.post(
        "/api/v1/boards", json={"name": "Sprint", "is_template": True}, headers=auth_headers
    )
    assert response.status_code == 201
    template = response.json()
    assert template["is_template"] is True
    assert template["is_starred"] is False

    board = (await client.post(
        "/api/v1/boards", json={"name": "Normal"}, headers=auth_headers
    )).json()

    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert [b["id"] for b in body["templates"]] == [template["id"]]
    assert [b["id"] for b in body["owned"]] == [board["id"]]
    assert body["shared"] == []

    order = (await client.get("/api/v1/boards/order", headers=auth_headers)).json()
    assert order["template_ids"] == [template["id"]]
    assert order["owned_ids"] == [board["id"]]

    response = await client.post(
        "/api/v1/boards",
        json={"name": "Starred", "is_template": True, "is_starred": True},
        headers=auth_headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_board_templates_04(
    client,
    db_session_async,
    test_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    """
    Verify the templates section holds owned and shared templates together,
    and leaves out archived and deleted templates, templates the user has no
    access to, and shared normal boards.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the request is authenticated as.
    other_user : User
        Owner of the shared template and of the template test_user cannot see.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the templates section is missing a visible template or includes one
        that should be hidden, or a shared template leaks into shared.
    """
    own = Board(owner_id=test_user.id, name="Own", is_template=True)
    shared = Board(owner_id=other_user.id, name="Shared", is_template=True)
    hidden = Board(owner_id=other_user.id, name="Hidden", is_template=True)
    archived = Board(owner_id=test_user.id, name="Archived", is_template=True, is_archived=True)
    deleted = Board(owner_id=test_user.id, name="Deleted", is_template=True, is_deleted=True)
    shared_board = Board(owner_id=other_user.id, name="Shared board")
    db_session_async.add_all([own, shared, hidden, archived, deleted, shared_board])
    await db_session_async.flush()
    db_session_async.add_all([
        BoardShare(board_id=shared.id, user_id=test_user.id),
        BoardShare(board_id=shared_board.id, user_id=test_user.id),
    ])
    await db_session_async.commit()

    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()

    assert {b["name"] for b in body["templates"]} == {"Own", "Shared"}
    shared_read = next(b for b in body["templates"] if b["name"] == "Shared")
    assert shared_read["owner_id"] == str(other_user.id)
    assert shared_read["owner_display_name"] == "Other User"
    assert [b["name"] for b in body["shared"]] == ["Shared board"]
    assert body["owned"] == []


@pytest.mark.asyncio
async def test_board_templates_05(
    client, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify archiving a template removes it from template_ids and lists it in
    /boards/archived, restoring puts it back in template_ids (not owned_ids),
    and deleting removes it from template_ids again.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If template_ids or the archived list is out of step with the template's
        state after any of the three operations.
    """
    template = (await client.post(
        "/api/v1/boards", json={"name": "Sprint", "is_template": True}, headers=auth_headers
    )).json()
    tid = template["id"]

    response = await client.patch(
        f"/api/v1/boards/{tid}", json={"is_archived": True}, headers=auth_headers
    )
    assert response.status_code == 200
    order = (await client.get("/api/v1/boards/order", headers=auth_headers)).json()
    assert order["template_ids"] == []
    archived = (await client.get("/api/v1/boards/archived", headers=auth_headers)).json()
    assert [(b["id"], b["is_template"]) for b in archived] == [(tid, True)]
    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert body["templates"] == []

    response = await client.patch(
        f"/api/v1/boards/{tid}", json={"is_archived": False}, headers=auth_headers
    )
    assert response.status_code == 200
    order = (await client.get("/api/v1/boards/order", headers=auth_headers)).json()
    assert order["template_ids"] == [tid]
    assert order["owned_ids"] == []

    response = await client.delete(f"/api/v1/boards/{tid}", headers=auth_headers)
    assert response.status_code == 204
    order = (await client.get("/api/v1/boards/order", headers=auth_headers)).json()
    assert order["template_ids"] == []
    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert body["templates"] == []


@pytest.mark.asyncio
async def test_board_templates_06(
    client, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify starring and unstarring a template are rejected with 400 and leave
    it unstarred and out of starred_ids, while a normal board can still be
    starred.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If a template can be starred or unstarred, or the normal-board star
        no longer works.
    """
    template = (await client.post(
        "/api/v1/boards", json={"name": "Sprint", "is_template": True}, headers=auth_headers
    )).json()
    board = (await client.post(
        "/api/v1/boards", json={"name": "Normal"}, headers=auth_headers
    )).json()

    response = await client.post(f"/api/v1/boards/{template['id']}/star", headers=auth_headers)
    assert response.status_code == 400
    response = await client.delete(f"/api/v1/boards/{template['id']}/star", headers=auth_headers)
    assert response.status_code == 400

    response = await client.post(f"/api/v1/boards/{board['id']}/star", headers=auth_headers)
    assert response.status_code == 204

    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert body["templates"][0]["is_starred"] is False
    assert body["owned"][0]["is_starred"] is True

    order = (await client.get("/api/v1/boards/order", headers=auth_headers)).json()
    assert order["starred_ids"] == [board["id"]]


@pytest.mark.asyncio
async def test_board_templates_07(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify a template holds lists but no cards: creating a card in a template
    list and copying a card into one are both rejected with 400, nothing is
    written, and the same copy into a normal board still works.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If a card can be created or copied into a template, or the guard also
        blocks copies into a normal board.
    """
    template = Board(owner_id=test_user.id, name="Template", is_template=True)
    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add_all([template, board])
    await db_session_async.flush()
    template_list = BoardList(board_id=template.id, name="To do")
    board_list = BoardList(board_id=board.id, name="Doing")
    db_session_async.add_all([template_list, board_list])
    await db_session_async.flush()
    source = Card(list_id=board_list.id, name="Source")
    db_session_async.add(source)
    await db_session_async.commit()

    response = await client.post(
        f"/api/v1/boards/{template.id}/lists/{template_list.id}/cards",
        json={"name": "Nope"},
        headers=auth_headers,
    )
    assert response.status_code == 400

    copy_url = f"/api/v1/boards/{board.id}/lists/{board_list.id}/cards/{source.id}/copy"
    response = await client.post(
        copy_url,
        json={"name": "Copy", "target_board_id": str(template.id), "target_list_id": str(template_list.id)},
        headers=auth_headers,
    )
    assert response.status_code == 400

    count = await db_session_async.scalar(
        select(func.count()).select_from(Card).where(Card.list_id == template_list.id)
    )
    assert count == 0

    response = await client.post(
        copy_url,
        json={"name": "Copy", "target_board_id": str(board.id), "target_list_id": str(board_list.id)},
        headers=auth_headers,
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_board_templates_08(
    client, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify a template holds no labels and no notification settings: label
    creation and both notification-settings routes return 400 on a template,
    while lists can still be added to it.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If a label or notification settings can be stored on a template, or
        the template can no longer get lists.
    """
    template = (await client.post(
        "/api/v1/boards", json={"name": "Sprint", "is_template": True}, headers=auth_headers
    )).json()
    base = f"/api/v1/boards/{template['id']}"

    response = await client.post(
        f"{base}/labels", json={"name": "Bug", "color": "#ff0000"}, headers=auth_headers
    )
    assert response.status_code == 400
    labels = (await client.get(f"{base}/labels", headers=auth_headers)).json()
    assert labels == []

    response = await client.get(f"{base}/notifications", headers=auth_headers)
    assert response.status_code == 400
    response = await client.put(
        f"{base}/notifications",
        json={"is_enabled": True, "notify_hour": 9, "offset_days": [1], "overdue_repeat_after_days": None},
        headers=auth_headers,
    )
    assert response.status_code == 400

    response = await client.post(f"{base}/lists", json={"name": "To do"}, headers=auth_headers)
    assert response.status_code == 201


async def _board_with_overdue_card(db, owner: User, name: str, **flags) -> Card:
    """Create a board with one list holding one overdue card assigned to owner.

    Goes straight to the DB, so it can put a card on a template — something
    the API refuses — to prove the views below filter templates themselves.
    """
    board = Board(owner_id=owner.id, name=name, **flags)
    db.add(board)
    await db.flush()
    board_list = BoardList(board_id=board.id, name=f"{name} list")
    db.add(board_list)
    await db.flush()
    card = Card(
        list_id=board_list.id,
        name=f"{name} card",
        due_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db.add(card)
    await db.flush()
    db.add(CardAssignee(card_id=card.id, user_id=owner.id))
    return card


@pytest.mark.asyncio
async def test_board_templates_09(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify GET /boards/overdue leaves out templates, even one that somehow
    holds an overdue card, while still listing the normal board.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the template shows up on the overdue page or the normal board
        does not.
    """
    await _board_with_overdue_card(db_session_async, test_user, "Template", is_template=True)
    await _board_with_overdue_card(db_session_async, test_user, "Board")
    await db_session_async.commit()

    response = await client.get("/api/v1/boards/overdue", headers=auth_headers)

    assert response.status_code == 200
    assert [b["board_name"] for b in response.json()] == ["Board"]


@pytest.mark.asyncio
async def test_board_templates_10(
    db_session_async, test_user: User, monkeypatch
) -> None:
    """
    Verify the hourly due-date job never e-mails about a template: with
    enabled settings and an overdue assigned card on both a template and a
    normal board, only the normal board's card is sent.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session against the test database. Its engine also backs the session
        factory the job is given in place of the real AsyncSessionLocal.
    test_user : User
        Owner of both boards, assignee of both cards and the only recipient.
    monkeypatch : pytest.MonkeyPatch
        Swaps the job's session factory and e-mail sender for test doubles.

    Raises
    ------
    AssertionError
        If a reminder goes out for the template's card, or the normal board's
        reminder is missing.
    """
    template_card = await _board_with_overdue_card(
        db_session_async, test_user, "Template", is_template=True
    )
    board_card = await _board_with_overdue_card(db_session_async, test_user, "Board")
    # No preferences row, so the job reads the hour in UTC.
    hour = datetime.now(timezone.utc).hour
    for card in (template_card, board_card):
        board_id = (await db_session_async.get(BoardList, card.list_id)).board_id
        db_session_async.add(BoardNotificationSettings(
            board_id=board_id,
            user_id=test_user.id,
            is_enabled=True,
            notify_hour=hour,
            overdue_repeat_after_days=0,
        ))
    await db_session_async.commit()

    sent: list[str] = []

    async def _fake_send(**kwargs) -> None:
        sent.append(kwargs["card_name"])

    monkeypatch.setattr(notifications, "send_due_date_reminder_email", _fake_send)
    monkeypatch.setattr(
        notifications,
        "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )

    await notifications.send_due_date_notifications()

    assert sent == ["Board card"]


async def _template_with_lists(db, owner: User, names: list[str], order: list[str]) -> tuple[Board, dict[str, BoardList]]:
    """Create a template with one list per name and store `order` as its list order."""
    template = Board(owner_id=owner.id, name="Template", is_template=True)
    db.add(template)
    await db.flush()
    lists = {name: BoardList(board_id=template.id, name=name) for name in names}
    db.add_all(lists.values())
    await db.flush()
    db.add(UIBoardListOrder(board_id=template.id, list_ids=[lists[n].id for n in order]))
    return template, lists


@pytest.mark.asyncio
async def test_board_templates_11(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify POST /boards with template_id copies the template's live lists into
    a new normal board in the template's own list order, leaving archived and
    deleted lists behind and the template itself untouched.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the template up.
    test_user : User
        Owner of the template, and the user the request is authenticated as.
    auth_headers : dict[str, str]
        Authorization header for that user.

    Raises
    ------
    AssertionError
        If the new board is missing a list, holds an archived/deleted one, has
        them in the wrong order, reuses the template's list ids, or the
        template lost its lists.
    """
    # "Done" is stored first so the result can't pass by falling back to
    # creation order; "Later" is missing from the stored order and must
    # come after the ordered ones.
    template, lists = await _template_with_lists(
        db_session_async, test_user,
        ["To do", "Doing", "Done", "Archived", "Deleted"],
        ["Done", "To do", "Archived", "Deleted", "Doing"],
    )
    lists["Archived"].is_archived = True
    lists["Deleted"].is_deleted = True
    later = BoardList(board_id=template.id, name="Later")
    db_session_async.add(later)
    await db_session_async.commit()

    response = await client.post(
        "/api/v1/boards",
        json={"name": "Sprint 12", "template_id": str(template.id)},
        headers=auth_headers,
    )
    assert response.status_code == 201
    board = response.json()
    assert board["is_template"] is False

    new_lists = (await client.get(f"/api/v1/boards/{board['id']}/lists", headers=auth_headers)).json()
    order = (await client.get(f"/api/v1/boards/{board['id']}/lists/order", headers=auth_headers)).json()
    by_id = {lst["id"]: lst["name"] for lst in new_lists}
    assert [by_id[lid] for lid in order["list_ids"]] == ["Done", "To do", "Doing", "Later"]
    assert set(by_id) == set(order["list_ids"])
    assert not set(by_id) & {str(lst.id) for lst in lists.values()}

    template_lists = (await client.get(f"/api/v1/boards/{template.id}/lists", headers=auth_headers)).json()
    assert {lst["name"] for lst in template_lists} == {"To do", "Doing", "Done", "Later"}

    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert [b["name"] for b in body["owned"]] == ["Sprint 12"]
    assert [b["name"] for b in body["templates"]] == ["Template"]


@pytest.mark.asyncio
async def test_board_templates_12(
    client,
    db_session_async,
    test_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    """
    Verify only the creating user's own colors are inherited: test_user, using
    a template other_user owns and shared, gets their own board and list
    colors on the new board, while other_user's colors on the same template
    are not copied — not even to other_user.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the template up.
    test_user : User
        The user creating the board from the shared template.
    other_user : User
        Owner of the template, who has colored it differently.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If a color is missing for test_user, carries the wrong value, lands on
        the wrong list, or any color is created for other_user.
    """
    template, lists = await _template_with_lists(
        db_session_async, other_user, ["To do", "Done"], ["To do", "Done"]
    )
    db_session_async.add(BoardShare(board_id=template.id, user_id=test_user.id))
    db_session_async.add_all([
        UIBoardColor(user_id=test_user.id, board_id=template.id, color="#112233"),
        UIListColor(user_id=test_user.id, list_id=lists["Done"].id, color="#445566"),
        UIBoardColor(user_id=other_user.id, board_id=template.id, color="#aaaaaa"),
        UIListColor(user_id=other_user.id, list_id=lists["To do"].id, color="#bbbbbb"),
        UIListColor(user_id=other_user.id, list_id=lists["Done"].id, color="#cccccc"),
    ])
    await db_session_async.commit()

    response = await client.post(
        "/api/v1/boards",
        json={"name": "Mine", "template_id": str(template.id)},
        headers=auth_headers,
    )
    assert response.status_code == 201
    board_id = uuid.UUID(response.json()["id"])

    board_colors = (await db_session_async.execute(
        select(UIBoardColor.user_id, UIBoardColor.color).where(UIBoardColor.board_id == board_id)
    )).all()
    assert board_colors == [(test_user.id, "#112233")]

    list_colors = (await db_session_async.execute(
        select(BoardList.name, UIListColor.user_id, UIListColor.color)
        .join(UIListColor, UIListColor.list_id == BoardList.id)
        .where(BoardList.board_id == board_id)
    )).all()
    assert list_colors == [("Done", test_user.id, "#445566")]


@pytest.mark.asyncio
async def test_board_templates_13(
    client,
    db_session_async,
    test_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    """
    Verify which templates can be used: a shared one works; one not shared
    with the user gives 403; a normal board as template_id, an archived
    template and a deleted one are refused; and template_id together with
    is_template gives 422. A refused request creates no board.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the requests are authenticated as.
    other_user : User
        Owner of the shared and the unshared template.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If any request gets the wrong status, or a refused one still creates
        a board.
    """
    shared, _ = await _template_with_lists(db_session_async, other_user, ["A"], ["A"])
    hidden, _ = await _template_with_lists(db_session_async, other_user, ["B"], ["B"])
    db_session_async.add(BoardShare(board_id=shared.id, user_id=test_user.id))
    normal = Board(owner_id=test_user.id, name="Normal")
    archived = Board(owner_id=test_user.id, name="Archived", is_template=True, is_archived=True)
    deleted = Board(owner_id=test_user.id, name="Deleted", is_template=True, is_deleted=True)
    db_session_async.add_all([normal, archived, deleted])
    await db_session_async.commit()

    async def create(template_id, **extra):
        return await client.post(
            "/api/v1/boards",
            json={"name": "New", "template_id": str(template_id), **extra},
            headers=auth_headers,
        )

    assert (await create(shared.id)).status_code == 201
    assert (await create(hidden.id)).status_code == 403
    assert (await create(normal.id)).status_code == 400
    assert (await create(archived.id)).status_code == 400
    assert (await create(deleted.id)).status_code == 404
    assert (await create(shared.id, is_template=True)).status_code == 422

    count = await db_session_async.scalar(
        select(func.count()).select_from(Board).where(Board.name == "New")
    )
    assert count == 1


@pytest.mark.asyncio
async def test_board_templates_14(
    client,
    db_session_async,
    test_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    """
    Verify a user a template is shared with can duplicate it: the copy is a
    new template owned by that user, appended to their template_ids, with the
    template's lists in order and their own colors, and without the
    original's shares. The original is left as it was.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the template up.
    test_user : User
        The user the template is shared with, who duplicates it.
    other_user : User
        Owner of the original template.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the copy has the wrong owner, flag, lists, order or colors, carries
        the original's shares, or the original changed.
    """
    template, lists = await _template_with_lists(
        db_session_async, other_user, ["To do", "Doing", "Done"], ["Done", "To do", "Doing"]
    )
    db_session_async.add_all([
        BoardShare(board_id=template.id, user_id=test_user.id),
        UIBoardColor(user_id=test_user.id, board_id=template.id, color="#112233"),
        UIListColor(user_id=test_user.id, list_id=lists["Doing"].id, color="#445566"),
        UIBoardColor(user_id=other_user.id, board_id=template.id, color="#aaaaaa"),
    ])
    await db_session_async.commit()

    response = await client.post(
        f"/api/v1/boards/{template.id}/duplicate",
        json={"name": "  My copy  "},
        headers=auth_headers,
    )
    assert response.status_code == 201
    copy = response.json()
    assert copy["name"] == "My copy"
    assert copy["is_template"] is True
    assert copy["owner_id"] == str(test_user.id)
    assert copy["owner_display_name"] == "Test User"
    copy_id = uuid.UUID(copy["id"])

    order = (await client.get(f"/api/v1/boards/{copy_id}/lists/order", headers=auth_headers)).json()
    new_lists = (await client.get(f"/api/v1/boards/{copy_id}/lists", headers=auth_headers)).json()
    by_id = {lst["id"]: lst["name"] for lst in new_lists}
    assert [by_id[lid] for lid in order["list_ids"]] == ["Done", "To do", "Doing"]

    board_colors = (await db_session_async.execute(
        select(UIBoardColor.user_id, UIBoardColor.color).where(UIBoardColor.board_id == copy_id)
    )).all()
    assert board_colors == [(test_user.id, "#112233")]
    list_colors = (await db_session_async.execute(
        select(BoardList.name, UIListColor.color)
        .join(UIListColor, UIListColor.list_id == BoardList.id)
        .where(BoardList.board_id == copy_id)
    )).all()
    assert list_colors == [("Doing", "#445566")]

    shares = await db_session_async.scalar(
        select(func.count()).select_from(BoardShare).where(BoardShare.board_id == copy_id)
    )
    assert shares == 0

    user_order = (await client.get("/api/v1/boards/order", headers=auth_headers)).json()
    assert user_order["template_ids"] == [str(copy_id)]
    body = (await client.get("/api/v1/boards", headers=auth_headers)).json()
    assert {b["name"] for b in body["templates"]} == {"Template", "My copy"}

    original = (await client.get(f"/api/v1/boards/{template.id}/lists", headers=auth_headers)).json()
    assert {lst["name"] for lst in original} == {"To do", "Doing", "Done"}


@pytest.mark.asyncio
async def test_board_templates_15(
    client,
    db_session_async,
    test_user: User,
    other_user: User,
    auth_headers: dict[str, str],
) -> None:
    """
    Verify what cannot be duplicated: a normal board and an archived template
    give 400, a template not shared with the user gives 403, a deleted one
    404, and a blank name 422. None of them creates a board.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to set the boards up.
    test_user : User
        The user the requests are authenticated as.
    other_user : User
        Owner of the template test_user cannot see.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If any request gets the wrong status, or a refused one still creates
        a board.
    """
    own, _ = await _template_with_lists(db_session_async, test_user, ["A"], ["A"])
    hidden, _ = await _template_with_lists(db_session_async, other_user, ["B"], ["B"])
    normal = Board(owner_id=test_user.id, name="Normal")
    archived = Board(owner_id=test_user.id, name="Archived", is_template=True, is_archived=True)
    deleted = Board(owner_id=test_user.id, name="Deleted", is_template=True, is_deleted=True)
    db_session_async.add_all([normal, archived, deleted])
    await db_session_async.commit()

    async def duplicate(board_id, name="Copy"):
        return await client.post(
            f"/api/v1/boards/{board_id}/duplicate", json={"name": name}, headers=auth_headers
        )

    assert (await duplicate(normal.id)).status_code == 400
    assert (await duplicate(archived.id)).status_code == 400
    assert (await duplicate(hidden.id)).status_code == 403
    assert (await duplicate(deleted.id)).status_code == 404
    assert (await duplicate(own.id, name="   ")).status_code == 422

    count = await db_session_async.scalar(
        select(func.count()).select_from(Board).where(Board.name.in_(["Copy", "   ", ""]))
    )
    assert count == 0
