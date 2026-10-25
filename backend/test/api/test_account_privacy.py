#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests that sign-in, registration and the share dialog's search don't tell
a stranger which e-mail addresses have accounts: the same answer and the same
work either way, the details by e-mail to the address, and whole-address
lookups limited."""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from src.api.v1.auth import local as local_module
from src.core.rate_limit import USER_LOOKUP_PER_USER
from src.core.security import hash_password, hash_token, verify_password
from src.model.user import User
from src.model.user_identity import AuthProvider, UserIdentity
from src.model.user_preferences import UserPreferences

PASSWORD = "the-owners-password"
OTHER_PASSWORD = "somebody-elses-password"


class _Mail:
    """What registration did: the e-mails it sent, and the passwords it
    hashed."""

    def __init__(self) -> None:
        self.sent: list[tuple] = []
        self.hashes: list[str] = []


@pytest_asyncio.fixture
async def mail(monkeypatch) -> _Mail:
    """Record the e-mails registration sends, and count its bcrypt hashes,
    instead of sending anything."""
    record = _Mail()
    sent = record.sent

    async def verification(email, display_name, token, language="en"):
        sent.append(("verify", email, token))

    async def exists(email, pending, language="en"):
        sent.append(("pending" if pending else "exists", email))

    def counting_hash(password: str) -> str:
        record.hashes.append(password)
        return hash_password(password)

    monkeypatch.setattr(local_module, "send_verification_email", verification)
    monkeypatch.setattr(local_module, "send_account_exists_email", exists)
    monkeypatch.setattr(local_module, "hash_password", counting_hash)
    return record


async def _account(db, email: str, verified: bool, link_expires_in: timedelta | None = None) -> User:
    user = User(email=email, display_name="Owner", is_verified=verified)
    db.add(user)
    await db.flush()
    db.add(UserIdentity(
        user_id=user.id, provider=AuthProvider.LOCAL, hashed_password=hash_password(PASSWORD),
        hashed_verification_token=None if verified else hash_token("old-token"),
        verification_token_expiry=None if verified else datetime.now(timezone.utc) + link_expires_in,
    ))
    db.add(UserPreferences(user_id=user.id, language_locale="en", number_locale="en"))
    await db.commit()
    return user


async def _register(client, email: str, name: str = "Newcomer"):
    return await client.post("/api/v1/auth/local/register", json={
        "email": email, "display_name": name, "password": OTHER_PASSWORD, "language": "ca",
    })


async def _identity(db, user_id) -> UserIdentity:
    db.expire_all()
    return (await db.execute(select(UserIdentity).where(UserIdentity.user_id == user_id))).scalar_one()


@pytest.mark.asyncio
async def test_account_privacy_01(client, db_session_async, mail) -> None:
    """
    Verify registering an address that has a verified account answers
    exactly as for a new address (201, same body, one bcrypt hash each),
    leaves the account as it was, and e-mails the address that it already
    has an account instead of a verification link.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    mail : _Mail
        The e-mails sent and the passwords hashed.

    Raises
    ------
    AssertionError
        If the two answers differ, or the existing account changes.
    """
    owner_id = (await _account(db_session_async, "owner@example.com", verified=True)).id

    new = await _register(client, "fresh@example.com")
    existing = await _register(client, "owner@example.com")
    assert new.status_code == existing.status_code == 201
    assert new.json().keys() == existing.json().keys()
    assert existing.json()["email"] == "owner@example.com"
    assert len(mail.hashes) == 2

    assert [m[0] for m in mail.sent] == ["verify", "exists"]
    assert mail.sent[1][1] == "owner@example.com"
    identity = await _identity(db_session_async, owner_id)
    assert verify_password(PASSWORD, identity.hashed_password)
    owner = (await db_session_async.execute(select(User).where(User.id == owner_id))).scalar_one()
    assert owner.display_name == "Owner"


@pytest.mark.asyncio
async def test_account_privacy_02(client, db_session_async, mail) -> None:
    """
    Verify registering an address whose unverified account still has a
    working link changes nothing — so a second sign-up can't swap in its own
    password before the owner clicks — and e-mails that the account is
    waiting for verification.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    mail : _Mail
        The e-mails sent and the passwords hashed.

    Raises
    ------
    AssertionError
        If the pending account's password or link changes.
    """
    pending = await _account(db_session_async, "pending@example.com", verified=False,
                             link_expires_in=timedelta(hours=2))
    response = await _register(client, "pending@example.com")
    assert response.status_code == 201
    assert mail.sent == [("pending", "pending@example.com")]
    identity = await _identity(db_session_async, pending.id)
    assert identity.hashed_verification_token == hash_token("old-token")
    assert verify_password(PASSWORD, identity.hashed_password)


@pytest.mark.asyncio
async def test_account_privacy_03(client, db_session_async, mail) -> None:
    """
    Verify an unverified account whose link has expired is taken over by the
    next registration — new name, password, language and link — so nobody
    can keep an address from registering by signing it up first.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    mail : _Mail
        The e-mails sent and the passwords hashed.

    Raises
    ------
    AssertionError
        If the account isn't renewed, or a second user row appears.
    """
    stale = await _account(db_session_async, "stale@example.com", verified=False,
                           link_expires_in=timedelta(hours=-1))
    response = await _register(client, "stale@example.com", name="Real Owner")
    assert response.status_code == 201
    assert [m[0] for m in mail.sent] == ["verify"]

    identity = await _identity(db_session_async, stale.id)
    assert identity.hashed_verification_token == hash_token(mail.sent[0][2]) != hash_token("old-token")
    assert identity.verification_token_expiry > datetime.now(timezone.utc)
    assert verify_password(OTHER_PASSWORD, identity.hashed_password)
    users = (await db_session_async.execute(select(User).where(User.email == "stale@example.com"))).scalars().all()
    assert [u.id for u in users] == [stale.id] and users[0].display_name == "Real Owner"
    prefs = (await db_session_async.execute(
        select(UserPreferences).where(UserPreferences.user_id == stale.id))).scalars().all()
    assert [p.language_locale for p in prefs] == ["ca_ES"]

    # The new link verifies the account, with the new password.
    response = await client.post("/api/v1/auth/local/verify-email", json={"token": mail.sent[0][2]})
    assert response.status_code == 204
    response = await client.post("/api/v1/auth/local/login",
                                 json={"email": "stale@example.com", "password": OTHER_PASSWORD})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_account_privacy_04(client, db_session_async, monkeypatch) -> None:
    """
    Verify sign-in runs a bcrypt check even when the address has no account
    or no password (a Google-only account), against a dummy hash of the same
    cost, and answers 401 as for a wrong password.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session on the test database.
    monkeypatch : pytest.MonkeyPatch
        Records the hashes sign-in checks against.

    Raises
    ------
    AssertionError
        If any of them skips the bcrypt check, or answers other than 401.
    """
    google_only = User(email="google@example.com", display_name="G", is_verified=True)
    db_session_async.add(google_only)
    await _account(db_session_async, "owner@example.com", verified=True)
    checked: list[str] = []

    def spy(plain: str, hashed: str) -> bool:
        checked.append(hashed)
        return verify_password(plain, hashed)

    monkeypatch.setattr(local_module, "verify_password", spy)
    for email in ("nobody@example.com", "google@example.com", "owner@example.com"):
        response = await client.post("/api/v1/auth/local/login", json={"email": email, "password": "wrong-password"})
        assert response.status_code == 401, email
        assert response.json() == {"detail": "Invalid credentials"}
    assert checked[:2] == [local_module._DUMMY_PASSWORD_HASH] * 2
    assert len(checked) == 3 and checked[2] != local_module._DUMMY_PASSWORD_HASH
    # Same cost: the "$2b$12$" prefix holds bcrypt's rounds.
    assert local_module._DUMMY_PASSWORD_HASH[:7] == hash_password("x")[:7]


@pytest.mark.asyncio
async def test_account_privacy_05(client, auth_headers) -> None:
    """
    Verify searches that look like a whole e-mail address are limited per
    user (429 once over), while names and partial addresses don't count.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    auth_headers : dict[str, str]
        Authorization header for test_user.

    Raises
    ------
    AssertionError
        If the limit is missing, or counts searches that aren't addresses.
    """
    async def search(q: str) -> int:
        return (await client.get("/api/v1/users/search", params={"q": q}, headers=auth_headers)).status_code

    for i in range(USER_LOOKUP_PER_USER.limit):
        assert await search(f"person{i}@example.com") == 200
    assert await search("one-more@example.com") == 429
    assert await search("Smith") == 200
    assert await search("someone@example") == 200
    assert await search("@example.com") == 200
