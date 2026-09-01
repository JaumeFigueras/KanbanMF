#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Tests for the avatar endpoints' caching behaviour."""

import pytest

from src.model.user import User
from src.model.user_avatar import UserAvatar

# Enough of a PNG header to be a distinct blob; the endpoints never decode it.
PNG = bytes.fromhex("89504e470d0a1a0a")


@pytest.mark.asyncio
async def test_avatars_01(
    client, db_session_async, test_user: User, auth_headers: dict[str, str]
) -> None:
    """
    Verify an avatar is served revalidatable rather than cacheable, and that
    replacing the image changes the ETag — the URL never changes, so without
    that a new avatar would keep rendering as the old one.

    Parameters
    ----------
    client : AsyncClient
        HTTP client wired to the FastAPI app, using the test database.
    db_session_async : AsyncSession
        Session used to seed the initial avatar row.
    test_user : User
        The avatar's owner.
    auth_headers : dict[str, str]
        Bearer token header for that user.
    """
    db_session_async.add(UserAvatar(user_id=test_user.id, data=PNG, mime_type="image/png"))
    await db_session_async.commit()

    first = await client.get(f"/api/v1/users/{test_user.id}/avatar")
    assert first.status_code == 200
    assert first.headers["cache-control"] == "no-cache"
    etag = first.headers["etag"]

    # The common case: revalidation costs a request but no image bytes.
    again = await client.get(
        f"/api/v1/users/{test_user.id}/avatar", headers={"If-None-Match": etag}
    )
    assert again.status_code == 304
    assert again.content == b""

    replaced = await client.put(
        "/api/v1/users/me/avatar",
        headers=auth_headers,
        files={"file": ("avatar.png", PNG + b"\x00" * 10, "image/png")},
    )
    assert replaced.status_code == 204

    after = await client.get(
        f"/api/v1/users/{test_user.id}/avatar", headers={"If-None-Match": etag}
    )
    assert after.status_code == 200
    assert after.headers["etag"] != etag

    # Removing it 404s, which is what puts the initials back on screen.
    deleted = await client.delete("/api/v1/users/me/avatar", headers=auth_headers)
    assert deleted.status_code == 204
    gone = await client.get(f"/api/v1/users/{test_user.id}/avatar")
    assert gone.status_code == 404
