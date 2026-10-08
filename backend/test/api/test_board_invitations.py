#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for board invitations: the owner's routes, the public sign-up preview,
registering from an invitation link, and turning invitations into shares."""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.api.v1 import invitations as invitations_api
from src.api.v1.auth import local as local_auth
from src.core import invitations as invitations_core
from src.core.config import settings
from src.core.security import create_access_token
from src.model.board import Board
from src.model.board_invitation import BoardInvitation
from src.model.board_share import BoardShare
from src.model.user import User
from src.model.user_identity import UserIdentity

PAST = datetime.now(timezone.utc) - timedelta(days=1)


@pytest_asyncio.fixture
async def other_user(db_session_async) -> User:
    """A second, already registered user."""
    user = User(email="other@example.com", display_name="Other User")
    db_session_async.add(user)
    await db_session_async.commit()
    await db_session_async.refresh(user)
    return user


@pytest_asyncio.fixture
async def board(db_session_async, test_user: User) -> Board:
    """A normal board owned by test_user."""
    board = Board(owner_id=test_user.id, name="Roadmap")
    db_session_async.add(board)
    await db_session_async.commit()
    await db_session_async.refresh(board)
    return board


@pytest.fixture
def sent(monkeypatch) -> list[dict]:
    """Turn SMTP on and capture invitation e-mails instead of sending them."""
    calls: list[dict] = []

    async def _fake_send(**kwargs) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(invitations_api, "send_board_invitation_email", _fake_send)
    return calls


async def _invitations(db: AsyncSession) -> list[BoardInvitation]:
    result = await db.execute(select(BoardInvitation).execution_options(populate_existing=True))
    return list(result.scalars().all())


async def _shares(db: AsyncSession) -> list[tuple]:
    rows = await db.execute(select(BoardShare.board_id, BoardShare.user_id))
    return [tuple(r) for r in rows.all()]


@pytest.mark.asyncio
async def test_board_invitations_01(client, monkeypatch) -> None:
    """
    Verify GET /config reports e-mail as enabled exactly when an SMTP host is set,
    without requiring a login.

    Raises
    ------
    AssertionError
        If email_enabled doesn't follow the SMTP host setting.
    """
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    r = await client.get("/api/v1/config")
    assert r.status_code == 200
    assert r.json() == {"email_enabled": True}

    monkeypatch.setattr(settings, "smtp_host", "  ")
    r = await client.get("/api/v1/config")
    assert r.json() == {"email_enabled": False}


@pytest.mark.asyncio
async def test_board_invitations_02(
    client, db_session_async, test_user: User, auth_headers, board: Board, sent
) -> None:
    """
    Verify the owner can invite an unknown address: it's stored lowercase with
    a 30-day expiry, the e-mail goes out with the token, board, inviter and
    chosen language, and the invitation shows up in the board's list.

    Raises
    ------
    AssertionError
        If the invitation, the e-mail or the listing differ from what was asked.
    """
    r = await client.post(
        f"/api/v1/boards/{board.id}/invitations",
        json={"email": "New.Person@Example.com", "language": "ca"},
        headers=auth_headers,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "new.person@example.com"
    assert body["language"] == "ca"

    [invitation] = await _invitations(db_session_async)
    assert invitation.invited_by_id == test_user.id
    assert timedelta(days=29) < invitation.expires_at - datetime.now(timezone.utc) <= timedelta(days=30)

    assert sent == [{
        "email": "new.person@example.com",
        "inviter_name": "Test User",
        "board_name": "Roadmap",
        "token": invitation.token,
        "expires_in_days": 30,
        "language": "ca",
    }]

    r = await client.get(f"/api/v1/boards/{board.id}/invitations", headers=auth_headers)
    assert r.status_code == 200
    assert [i["email"] for i in r.json()] == ["new.person@example.com"]
    assert "token" not in r.json()[0]


@pytest.mark.asyncio
async def test_board_invitations_03(
    client, db_session_async, other_user: User, board: Board, sent
) -> None:
    """
    Verify only the owner can list, create or cancel invitations: a member the
    board is shared with gets 403, and so does a user with no access at all.

    Raises
    ------
    AssertionError
        If a non-owner can use any of the invitation routes.
    """
    invitation = BoardInvitation(board_id=board.id, email="x@example.com", invited_by_id=board.owner_id, language="en")
    db_session_async.add(invitation)
    await db_session_async.commit()
    headers = {"Authorization": f"Bearer {create_access_token(other_user.id)}"}
    base = f"/api/v1/boards/{board.id}/invitations"

    for shared in (False, True):
        if shared:
            db_session_async.add(BoardShare(board_id=board.id, user_id=other_user.id))
            await db_session_async.commit()
        assert (await client.get(base, headers=headers)).status_code == 403
        assert (await client.post(base, json={"email": "y@example.com"}, headers=headers)).status_code == 403
        assert (await client.delete(f"{base}/{invitation.id}", headers=headers)).status_code == 403

    assert sent == []
    assert len(await _invitations(db_session_async)) == 1


@pytest.mark.asyncio
async def test_board_invitations_04(
    client, db_session_async, test_user: User, auth_headers, sent
) -> None:
    """
    Verify a template can't be shared by invitation.

    Raises
    ------
    AssertionError
        If the invitation to a template is accepted or an e-mail is sent.
    """
    template = Board(owner_id=test_user.id, name="Template", is_template=True)
    db_session_async.add(template)
    await db_session_async.commit()

    r = await client.post(
        f"/api/v1/boards/{template.id}/invitations", json={"email": "x@example.com"}, headers=auth_headers
    )
    assert r.status_code == 400
    assert sent == []
    assert await _invitations(db_session_async) == []


@pytest.mark.asyncio
async def test_board_invitations_05(
    client, db_session_async, auth_headers, other_user: User, board: Board, sent
) -> None:
    """
    Verify inviting an address that already has an account (in any letter
    case) returns 409 user_exists with that person, and says whether the
    board is already shared with them, instead of creating an invitation.

    Raises
    ------
    AssertionError
        If an invitation is created or the conflict detail is wrong.
    """
    url = f"/api/v1/boards/{board.id}/invitations"

    r = await client.post(url, json={"email": "OTHER@example.com"}, headers=auth_headers)
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "user_exists"
    assert detail["person"]["id"] == str(other_user.id)
    assert detail["person"]["display_name"] == "Other User"
    assert detail["person"]["initials"] == "OU"
    assert detail["already_shared"] is False

    db_session_async.add(BoardShare(board_id=board.id, user_id=other_user.id))
    await db_session_async.commit()
    r = await client.post(url, json={"email": "other@example.com"}, headers=auth_headers)
    assert r.status_code == 409
    assert r.json()["detail"]["already_shared"] is True

    assert sent == []
    assert await _invitations(db_session_async) == []


@pytest.mark.asyncio
async def test_board_invitations_06(client, auth_headers, board: Board, sent) -> None:
    """
    Verify the owner can't invite their own address.

    Raises
    ------
    AssertionError
        If the request isn't rejected with 422.
    """
    r = await client.post(
        f"/api/v1/boards/{board.id}/invitations", json={"email": "User@Example.com"}, headers=auth_headers
    )
    assert r.status_code == 422
    assert sent == []


@pytest.mark.asyncio
async def test_board_invitations_07(
    client, db_session_async, auth_headers, board: Board, sent
) -> None:
    """
    Verify a second invitation to the same address (in any case) is a 409
    already_invited, but an expired one is replaced by a new invitation.

    Raises
    ------
    AssertionError
        If a duplicate is allowed, or the expired invitation blocks a new one.
    """
    url = f"/api/v1/boards/{board.id}/invitations"
    assert (await client.post(url, json={"email": "x@example.com"}, headers=auth_headers)).status_code == 201

    r = await client.post(url, json={"email": "X@example.com"}, headers=auth_headers)
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "already_invited"}

    [old] = await _invitations(db_session_async)
    old.expires_at = PAST
    await db_session_async.commit()

    assert (await client.post(url, json={"email": "x@example.com"}, headers=auth_headers)).status_code == 201
    [new] = await _invitations(db_session_async)
    assert new.id != old.id
    assert new.expires_at > datetime.now(timezone.utc)
    assert len(sent) == 2


@pytest.mark.asyncio
async def test_board_invitations_08(
    client, db_session_async, auth_headers, board: Board, sent, monkeypatch
) -> None:
    """
    Verify inviting with SMTP not configured returns 503 and stores nothing.

    Raises
    ------
    AssertionError
        If an invitation is stored or an e-mail is attempted.
    """
    monkeypatch.setattr(settings, "smtp_host", "")
    r = await client.post(
        f"/api/v1/boards/{board.id}/invitations", json={"email": "x@example.com"}, headers=auth_headers
    )
    assert r.status_code == 503
    assert sent == []
    assert await _invitations(db_session_async) == []


@pytest.mark.asyncio
async def test_board_invitations_09(
    client, db_session_async, auth_headers, board: Board, monkeypatch
) -> None:
    """
    Verify a failed e-mail send returns 502 and leaves no invitation behind.

    Raises
    ------
    AssertionError
        If the invitation is kept although its e-mail was never sent.
    """
    async def _failing_send(**kwargs) -> None:
        raise ConnectionError("SMTP down")

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(invitations_api, "send_board_invitation_email", _failing_send)

    r = await client.post(
        f"/api/v1/boards/{board.id}/invitations", json={"email": "x@example.com"}, headers=auth_headers
    )
    assert r.status_code == 502
    assert await _invitations(db_session_async) == []


@pytest.mark.asyncio
async def test_board_invitations_10(
    client, db_session_async, test_user: User, auth_headers, board: Board
) -> None:
    """
    Verify the owner can cancel an invitation, that an invitation of another
    board can't be cancelled through this one, and that expired invitations
    are left out of the list.

    Raises
    ------
    AssertionError
        If cancelling, the cross-board check or the expiry filter misbehave.
    """
    other_board = Board(owner_id=test_user.id, name="Other")
    db_session_async.add(other_board)
    await db_session_async.flush()
    kept = BoardInvitation(board_id=board.id, email="kept@example.com", invited_by_id=test_user.id, language="en")
    expired = BoardInvitation(
        board_id=board.id, email="old@example.com", invited_by_id=test_user.id, language="en", expires_at=PAST
    )
    elsewhere = BoardInvitation(
        board_id=other_board.id, email="kept@example.com", invited_by_id=test_user.id, language="en"
    )
    db_session_async.add_all([kept, expired, elsewhere])
    await db_session_async.commit()
    url = f"/api/v1/boards/{board.id}/invitations"

    r = await client.get(url, headers=auth_headers)
    assert [i["email"] for i in r.json()] == ["kept@example.com"]

    assert (await client.delete(f"{url}/{elsewhere.id}", headers=auth_headers)).status_code == 404
    assert (await client.delete(f"{url}/{kept.id}", headers=auth_headers)).status_code == 204
    assert (await client.get(url, headers=auth_headers)).json() == []
    assert {i.id for i in await _invitations(db_session_async)} == {expired.id, elsewhere.id}


@pytest.mark.asyncio
async def test_board_invitations_11(client, db_session_async, test_user: User, board: Board) -> None:
    """
    Verify the public preview describes a valid invitation without a login,
    and gives the same 404 for an unknown token, an expired invitation and an
    invitation to a deleted board.

    Raises
    ------
    AssertionError
        If the preview is wrong or an unusable invitation is described.
    """
    valid = BoardInvitation(board_id=board.id, email="a@example.com", invited_by_id=test_user.id, language="en")
    expired = BoardInvitation(
        board_id=board.id, email="b@example.com", invited_by_id=test_user.id, language="en", expires_at=PAST
    )
    deleted_board = Board(owner_id=test_user.id, name="Gone", is_deleted=True)
    db_session_async.add(deleted_board)
    await db_session_async.flush()
    on_deleted = BoardInvitation(
        board_id=deleted_board.id, email="c@example.com", invited_by_id=test_user.id, language="en"
    )
    db_session_async.add_all([valid, expired, on_deleted])
    await db_session_async.commit()

    r = await client.get(f"/api/v1/invitations/{valid.token}")
    assert r.status_code == 200
    assert r.json() == {"email": "a@example.com", "board_name": "Roadmap", "inviter_name": "Test User"}

    for token in ("not-a-token", expired.token, on_deleted.token):
        assert (await client.get(f"/api/v1/invitations/{token}")).status_code == 404


@pytest.mark.asyncio
async def test_board_invitations_12(
    client, db_session_async, test_user: User, board: Board, monkeypatch
) -> None:
    """
    Verify registering from an invitation link: an unknown token is a 400, a
    different address is a 422, and the invited address (in any case) can
    register. The board is not shared until the address is verified; then
    the share exists and the invitation is gone.

    Raises
    ------
    AssertionError
        If the token checks fail, access is granted before verification, or
        verification doesn't turn the invitation into a share.
    """
    async def _fake_verification(**kwargs) -> None:
        pass

    monkeypatch.setattr(local_auth, "send_verification_email", _fake_verification)
    invitation = BoardInvitation(
        board_id=board.id, email="guest@example.com", invited_by_id=test_user.id, language="en"
    )
    db_session_async.add(invitation)
    await db_session_async.commit()
    payload = {"display_name": "Guest", "password": "secret123", "email": "Guest@Example.com"}

    r = await client.post("/api/v1/auth/local/register", json={**payload, "invitation_token": "nope"})
    assert r.status_code == 400
    r = await client.post(
        "/api/v1/auth/local/register",
        json={**payload, "email": "someone@example.com", "invitation_token": invitation.token},
    )
    assert r.status_code == 422

    r = await client.post("/api/v1/auth/local/register", json={**payload, "invitation_token": invitation.token})
    assert r.status_code == 201
    assert await _shares(db_session_async) == []
    assert len(await _invitations(db_session_async)) == 1

    guest = (await db_session_async.execute(select(User).where(User.email.ilike("guest@example.com")))).scalar_one()
    identity = (
        await db_session_async.execute(select(UserIdentity).where(UserIdentity.user_id == guest.id))
    ).scalar_one()
    r = await client.post("/api/v1/auth/local/verify-email", json={"token": identity.verification_token})
    assert r.status_code == 204

    assert await _shares(db_session_async) == [(board.id, guest.id)]
    assert await _invitations(db_session_async) == []


@pytest.mark.asyncio
async def test_board_invitations_13(client, db_session_async, test_user: User, board: Board, monkeypatch) -> None:
    """
    Verify an account registered without the link still gets the board once
    verified: the address match is what grants access, not the token.

    Raises
    ------
    AssertionError
        If the board isn't shared after verification.
    """
    async def _fake_verification(**kwargs) -> None:
        pass

    monkeypatch.setattr(local_auth, "send_verification_email", _fake_verification)
    db_session_async.add(
        BoardInvitation(board_id=board.id, email="guest@example.com", invited_by_id=test_user.id, language="en")
    )
    await db_session_async.commit()

    r = await client.post(
        "/api/v1/auth/local/register",
        json={"display_name": "Guest", "password": "secret123", "email": "guest@example.com"},
    )
    assert r.status_code == 201
    identity = (await db_session_async.execute(select(UserIdentity))).scalar_one()
    await client.post("/api/v1/auth/local/verify-email", json={"token": identity.verification_token})

    assert await _shares(db_session_async) == [(board.id, identity.user_id)]


@pytest.mark.asyncio
async def test_board_invitations_14(db_session_async, test_user: User, board: Board, other_user: User) -> None:
    """
    Verify accept_pending_invitations (also the Google sign-in path) matches
    the address case-insensitively, doesn't duplicate an existing share, drops
    invitations to deleted boards without sharing them, and leaves expired
    invitations alone.

    Raises
    ------
    AssertionError
        If the wrong boards are shared or the wrong invitations are removed.
    """
    already = Board(owner_id=test_user.id, name="Already shared")
    deleted = Board(owner_id=test_user.id, name="Deleted", is_deleted=True)
    expired_board = Board(owner_id=test_user.id, name="Expired")
    db_session_async.add_all([already, deleted, expired_board])
    await db_session_async.flush()
    db_session_async.add(BoardShare(board_id=already.id, user_id=other_user.id))
    for b in (board, already, deleted):
        db_session_async.add(
            BoardInvitation(board_id=b.id, email="other@example.com", invited_by_id=test_user.id, language="en")
        )
    expired = BoardInvitation(
        board_id=expired_board.id, email="other@example.com", invited_by_id=test_user.id,
        language="en", expires_at=PAST,
    )
    db_session_async.add(expired)
    await db_session_async.commit()

    other_user.email = "Other@Example.COM"
    await db_session_async.commit()

    accepted = await invitations_core.accept_pending_invitations(db_session_async, other_user)

    assert set(accepted) == {board.id, already.id}
    assert set(await _shares(db_session_async)) == {(board.id, other_user.id), (already.id, other_user.id)}
    assert [i.id for i in await _invitations(db_session_async)] == [expired.id]


@pytest.mark.asyncio
async def test_board_invitations_15(db_session_async, test_user: User, board: Board, monkeypatch) -> None:
    """
    Verify the hourly cleanup deletes expired invitations and keeps the rest.

    Raises
    ------
    AssertionError
        If a pending invitation is deleted or an expired one survives.
    """
    kept = BoardInvitation(board_id=board.id, email="a@example.com", invited_by_id=test_user.id, language="en")
    gone = BoardInvitation(
        board_id=board.id, email="b@example.com", invited_by_id=test_user.id, language="en", expires_at=PAST
    )
    db_session_async.add_all([kept, gone])
    await db_session_async.commit()
    monkeypatch.setattr(
        invitations_core,
        "AsyncSessionLocal",
        async_sessionmaker(db_session_async.bind, class_=AsyncSession, expire_on_commit=False),
    )

    await invitations_core.delete_expired_invitations()

    assert [i.id for i in await _invitations(db_session_async)] == [kept.id]
