#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""The WebSocket endpoint behind the notify-and-refetch pattern."""

import asyncio
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from src.core.database import AsyncSessionLocal
from src.core.security import decode_access_token
from src.core.ws_manager import manager
from src.model.user import User

router = APIRouter()

# How long a new connection has to send its token before it is closed.
AUTH_TIMEOUT_SECONDS = 10


async def _authenticate(websocket: WebSocket) -> uuid.UUID | None:
    """Read the first message, ``{"type": "auth", "token": "<access token>"}``,
    and return the id of the active, verified user it belongs to — the same
    people as ``get_current_user`` — or None."""
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), AUTH_TIMEOUT_SECONDS)
        message = json.loads(raw)
    except (TimeoutError, ValueError):
        return None
    if not isinstance(message, dict) or message.get("type") != "auth" or not isinstance(message.get("token"), str):
        return None
    user_id = decode_access_token(message["token"])
    if user_id is None:
        return None
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User.id).where(
                User.id == uuid.UUID(user_id), User.is_active.is_(True), User.is_verified.is_(True)
            )
        )
        return result.scalar_one_or_none()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Authenticated notification channel: only events travel here, the
    frontend is responsible for refetching whatever the notification names.

    The browser's WebSocket API can't set an Authorization header, so the
    access token (the same JWT as for REST calls) is the first message the
    client sends, and is checked once. It used to travel in the URL
    (``?token=``), which put it in Apache's access log and in anything else
    that records addresses. Until that message arrives the connection is
    open but registered nowhere, so it receives nothing.
    """
    await websocket.accept()
    try:
        uid = await _authenticate(websocket)
    except WebSocketDisconnect:
        return
    if uid is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    manager.connect(uid, websocket)
    try:
        while True:
            # Clients send nothing after the token; this just blocks until
            # the socket closes so we can clean up the connection registry.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(uid, websocket)
