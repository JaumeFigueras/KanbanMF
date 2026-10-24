#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for removing someone from a shared board: their cards are archived and
replaced by copies without them, archived cards that hold people who left
can't be restored, and the hourly due-date job only e-mails about live cards
on boards the recipient can open."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from src.core import notifications
from src.core.security import create_access_token
from src.model.board import Board
from src.model.board_list import BoardList
from src.model.board_notification_settings import BoardNotificationSettings, weekdays_to_mask
from src.model.board_share import BoardShare
from src.model.card import Card
from src.model.checklist import Checklist
from src.model.checklist_item import ChecklistItem
from src.model.label import Label
from src.model.ui_card_color import UICardColor
from src.model.ui_list_card_order import UIListCardOrder
from src.model.user import User


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


@pytest_asyncio.fixture
async def shared_board(db_session_async, test_user: User) -> SimpleNamespace:
    """A board owned by test_user and shared with Ann (to be removed) and Bob.

    The active list holds, in this custom order: ``other`` (Bob only),
    ``ann_card`` (Ann a member and an assignee, fully populated, coloured by
    all three) and ``ann_member`` (Ann a member only). An archived list holds
    ``in_archived_list`` and the active list an individually archived
    ``archived_card``, both with Ann on them. Ann and Bob have reminders on.
    """
    ann = User(email="ann@example.com", display_name="Ann", is_verified=True)
    bob = User(email="bob@example.com", display_name="Bob", is_verified=True)
    db_session_async.add_all([ann, bob])
    await db_session_async.flush()

    board = Board(owner_id=test_user.id, name="Board")
    db_session_async.add(board)
    await db_session_async.flush()
    db_session_async.add_all([
        BoardShare(board_id=board.id, user_id=ann.id),
        BoardShare(board_id=board.id, user_id=bob.id),
    ])

    active = BoardList(board_id=board.id, name="Active")
    archived_list = BoardList(board_id=board.id, name="Old", is_archived=True)
    label = Label(board_id=board.id, name="Label", color="#ff0000", position=0)
    db_session_async.add_all([active, archived_list, label])
    await db_session_async.flush()

    now = datetime.now(timezone.utc)
    other = Card(list_id=active.id, creator_id=bob.id, name="Other", members=[bob])
    ann_card = Card(
        list_id=active.id,
        creator_id=ann.id,
        name="Ann's card",
        description="Description",
        start_at=now,
        due_at=now + timedelta(days=1),
        labels=[label],
        members=[ann, bob],
        assignees=[ann],
    )
    ann_member = Card(list_id=active.id, creator_id=bob.id, name="Ann member", members=[ann, test_user])
    in_archived_list = Card(list_id=archived_list.id, name="In archived list", assignees=[ann])
    archived_card = Card(list_id=active.id, name="Archived", is_archived=True, members=[ann])
    db_session_async.add_all([other, ann_card, ann_member, in_archived_list, archived_card])
    await db_session_async.flush()

    checklist = Checklist(card_id=ann_card.id, name="Checklist", position=0)
    db_session_async.add(checklist)
    await db_session_async.flush()
    db_session_async.add(ChecklistItem(checklist_id=checklist.id, text="Item", is_done=True, position=0))
    db_session_async.add_all([
        UICardColor(user_id=test_user.id, card_id=ann_card.id, color="#111111"),
        UICardColor(user_id=ann.id, card_id=ann_card.id, color="#222222"),
        UICardColor(user_id=bob.id, card_id=ann_card.id, color="#333333"),
        UIListCardOrder(list_id=active.id, card_ids=[other.id, ann_card.id, ann_member.id]),
        BoardNotificationSettings(board_id=board.id, user_id=ann.id, is_enabled=True),
        BoardNotificationSettings(board_id=board.id, user_id=bob.id, is_enabled=True),
    ])
    await db_session_async.commit()
    return SimpleNamespace(
        board=board, ann=ann, bob=bob, active=active, archived_list=archived_list, label=label,
        other=other, ann_card=ann_card, ann_member=ann_member,
        in_archived_list=in_archived_list, archived_card=archived_card,
    )


async def _card(db, card_id) -> Card:
    """Reload a card, with its people, labels and checklists, bypassing the session cache."""
    result = await db.execute(
        select(Card)
        .options(
            selectinload(Card.members),
            selectinload(Card.assignees),
            selectinload(Card.labels),
            selectinload(Card.checklists).selectinload(Checklist.items),
        )
        .where(Card.id == card_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


@pytest.mark.asyncio
async def test_board_share_removal_01(
    client, db_session_async, test_user: User, auth_headers: dict[str, str], shared_board
) -> None:
    """
    Verify removing Ann archives each live card she is on and puts a copy in
    its place, with the owner instead of her, and leaves everything else as
    it was.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to read the result back.
    test_user : User
        The board's owner, who removes Ann.
    auth_headers : dict[str, str]
        Authorization header for the owner.
    shared_board : SimpleNamespace
        The board, its people, lists and cards.

    Raises
    ------
    AssertionError
        If a card is replaced that shouldn't be, or a replacement differs from
        its original in anything but its people and creator.
    """
    s = shared_board
    response = await client.delete(f"/api/v1/boards/{s.board.id}/shares/{s.ann.id}", headers=auth_headers)
    assert response.status_code == 204

    original = await _card(db_session_async, s.ann_card.id)
    assert original.is_archived and original.replaced_by_id is not None
    assert {u.id for u in original.members} == {s.ann.id, s.bob.id}  # history kept as it was

    copy = await _card(db_session_async, original.replaced_by_id)
    assert not copy.is_archived and copy.list_id == s.active.id
    assert copy.creator_id == test_user.id
    assert (copy.name, copy.description) == ("Ann's card", "Description")
    assert (copy.start_at, copy.due_at) == (original.start_at, original.due_at)
    assert [lbl.id for lbl in copy.labels] == [s.label.id]
    assert {u.id for u in copy.members} == {s.bob.id, test_user.id}
    assert [u.id for u in copy.assignees] == [test_user.id]
    assert [(cl.name, [(i.text, i.is_done) for i in cl.items]) for cl in copy.checklists] == [
        ("Checklist", [("Item", True)])
    ]

    colors = await db_session_async.execute(
        select(UICardColor.user_id, UICardColor.color).where(UICardColor.card_id == copy.id)
    )
    assert dict(colors.all()) == {test_user.id: "#111111", s.bob.id: "#333333"}

    # The owner was already a member of ann_member, so isn't added twice.
    member_original = await _card(db_session_async, s.ann_member.id)
    member_copy = await _card(db_session_async, member_original.replaced_by_id)
    assert [u.id for u in member_copy.members] == [test_user.id]
    assert member_copy.assignees == []

    order = await db_session_async.execute(
        select(UIListCardOrder.card_ids)
        .where(UIListCardOrder.list_id == s.active.id)
        .execution_options(populate_existing=True)
    )
    assert order.scalar_one() == [s.other.id, copy.id, member_copy.id]

    for untouched in (s.other, s.in_archived_list, s.archived_card):
        card = await _card(db_session_async, untouched.id)
        assert card.replaced_by_id is None
        assert card.is_archived == untouched.is_archived

    settings = await db_session_async.execute(
        select(BoardNotificationSettings.user_id).where(BoardNotificationSettings.board_id == s.board.id)
    )
    assert settings.scalars().all() == [s.bob.id]


@pytest.mark.asyncio
async def test_board_share_removal_02(
    client, test_user: User, auth_headers: dict[str, str], shared_board
) -> None:
    """
    Verify the impact endpoint counts the cards a removal would replace, and
    only answers the owner about someone the board is shared with.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    test_user : User
        The board's owner.
    auth_headers : dict[str, str]
        Authorization header for the owner.
    shared_board : SimpleNamespace
        The board, its people, lists and cards.

    Raises
    ------
    AssertionError
        If the count is wrong, or a non-owner or a non-shared user is answered.
    """
    s = shared_board
    url = f"/api/v1/boards/{s.board.id}/shares"

    response = await client.get(f"{url}/{s.ann.id}/impact", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"card_count": 2}

    response = await client.get(f"{url}/{s.bob.id}/impact", headers=auth_headers)
    assert response.json() == {"card_count": 2}

    response = await client.get(f"{url}/{s.ann.id}/impact", headers=_headers(s.bob))
    assert response.status_code == 403

    response = await client.get(f"{url}/{test_user.id}/impact", headers=auth_headers)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_board_share_removal_03(
    client, db_session_async, auth_headers: dict[str, str], shared_board
) -> None:
    """
    Verify a replaced card can't be restored, and the refusal points to the
    card that replaced it while that one is still on the board.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to archive the copy.
    auth_headers : dict[str, str]
        Authorization header for the owner.
    shared_board : SimpleNamespace
        The board, its people, lists and cards.

    Raises
    ------
    AssertionError
        If the replaced card is restored, or the refusal's details are wrong.
    """
    s = shared_board
    await client.delete(f"/api/v1/boards/{s.board.id}/shares/{s.ann.id}", headers=auth_headers)
    original = await _card(db_session_async, s.ann_card.id)
    url = f"/api/v1/boards/{s.board.id}/lists/{s.active.id}/cards/{s.ann_card.id}"

    response = await client.patch(url, json={"is_archived": False}, headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "card_replaced",
        "replaced_by_id": str(original.replaced_by_id),
        "replaced_by_list_id": str(s.active.id),
    }

    copy = await _card(db_session_async, original.replaced_by_id)
    copy.is_archived = True
    await db_session_async.commit()

    response = await client.patch(url, json={"is_archived": False}, headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "card_replaced", "replaced_by_id": None, "replaced_by_list_id": None,
    }

    response = await client.get(f"/api/v1/boards/{s.board.id}/cards/archived", headers=auth_headers)
    by_id = {c["id"]: c for c in response.json()}
    assert by_id[str(s.ann_card.id)]["replaced_by_id"] == str(original.replaced_by_id)
    assert by_id[str(s.archived_card.id)]["replaced_by_id"] is None


@pytest.mark.asyncio
async def test_board_share_removal_04(
    client, auth_headers: dict[str, str], shared_board
) -> None:
    """
    Verify an archived card holding someone who left the board can't be
    restored, can once they are back on the board, and can be copied in the
    meantime, without them.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for the owner.
    shared_board : SimpleNamespace
        The board, its people, lists and cards.

    Raises
    ------
    AssertionError
        If the card is restored while Ann is away, or not once she's back, or
        the copy keeps her.
    """
    s = shared_board
    shares = f"/api/v1/boards/{s.board.id}/shares"
    url = f"/api/v1/boards/{s.board.id}/lists/{s.active.id}/cards/{s.archived_card.id}"
    await client.delete(f"{shares}/{s.ann.id}", headers=auth_headers)

    response = await client.patch(url, json={"is_archived": False}, headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["detail"] == {"code": "former_people", "names": ["Ann"]}

    response = await client.post(
        f"{url}/copy",
        json={"target_board_id": str(s.board.id), "target_list_id": str(s.active.id), "name": "Copy"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    assert [p["display_name"] for p in response.json()["members"]] == ["Test User"]

    await client.post(shares, json={"user_id": str(s.ann.id)}, headers=auth_headers)
    response = await client.patch(url, json={"is_archived": False}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["is_archived"] is False


@pytest.mark.asyncio
async def test_board_share_removal_05(
    client, db_session_async, auth_headers: dict[str, str], shared_board
) -> None:
    """
    Verify restoring an archived list replaces its cards that hold someone
    who left the board, with the person restoring it in their place.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session against the same test database, used to read the result back.
    auth_headers : dict[str, str]
        Authorization header for the owner.
    shared_board : SimpleNamespace
        The board, its people, lists and cards.

    Raises
    ------
    AssertionError
        If the list isn't restored, or its card keeps Ann or isn't replaced.
    """
    s = shared_board
    await client.delete(f"/api/v1/boards/{s.board.id}/shares/{s.ann.id}", headers=auth_headers)

    response = await client.patch(
        f"/api/v1/boards/{s.board.id}/lists/{s.archived_list.id}",
        json={"is_archived": False},
        headers=_headers(s.bob),
    )
    assert response.status_code == 200

    original = await _card(db_session_async, s.in_archived_list.id)
    assert original.is_archived and original.replaced_by_id is not None
    copy = await _card(db_session_async, original.replaced_by_id)
    assert copy.list_id == s.archived_list.id and not copy.is_archived
    assert copy.creator_id == s.bob.id
    assert [u.id for u in copy.assignees] == [s.bob.id]


async def _run_job(db_session_async, monkeypatch) -> list[str]:
    """Run the hourly due-date job against the test database; return the cards e-mailed."""
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
    return sent


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["live", "archived_list", "deleted_list", "archived_board", "no_access"])
async def test_board_share_removal_06(
    db_session_async, test_user: User, monkeypatch, case: str
) -> None:
    """
    Verify the hourly job e-mails about an overdue card only while it is live
    — not on an archived or deleted list, nor on an archived board — and only
    to someone who can open the board.

    Parameters
    ----------
    db_session_async : AsyncSession
        Session against the test database. Its engine also backs the session
        factory the job is given in place of the real AsyncSessionLocal.
    test_user : User
        The board's owner.
    monkeypatch : pytest.MonkeyPatch
        Swaps the job's session factory and e-mail sender for test doubles.
    case : str
        What happened to the card, its list, its board or the recipient.

    Raises
    ------
    AssertionError
        If a reminder is sent in any case but ``live``, or missing in it.
    """
    now = datetime.now(timezone.utc)
    ann = User(email="ann@example.com", display_name="Ann", is_verified=True)
    db_session_async.add(ann)
    board = Board(owner_id=test_user.id, name="Board", is_archived=case == "archived_board")
    db_session_async.add(board)
    await db_session_async.flush()
    if case != "no_access":
        db_session_async.add(BoardShare(board_id=board.id, user_id=ann.id))
    board_list = BoardList(
        board_id=board.id,
        name="List",
        is_archived=case == "archived_list",
        is_deleted=case == "deleted_list",
    )
    db_session_async.add(board_list)
    await db_session_async.flush()
    db_session_async.add(Card(list_id=board_list.id, name="Card", due_at=now - timedelta(days=1), assignees=[ann]))
    db_session_async.add(BoardNotificationSettings(
        board_id=board.id,
        user_id=ann.id,
        is_enabled=True,
        notify_hour=now.hour,
        notify_weekdays=weekdays_to_mask(list(range(1, 8))),
        overdue_repeat_after_days=0,
    ))
    await db_session_async.commit()

    sent = await _run_job(db_session_async, monkeypatch)

    assert sent == (["Card"] if case == "live" else [])
