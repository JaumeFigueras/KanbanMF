#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from src.core.database import AsyncSessionLocal
from src.core.security import decode_access_token
from src.core.ws_manager import manager
from src.model.user import User

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None) -> None:
    """Authenticated notification channel: only events travel here, the
    frontend is responsible for refetching whatever the notification names.

    The browser's native WebSocket API can't set an Authorization header, so
    the access token is passed as a query param instead and validated once at
    connect time (same JWT used for REST calls).
    """
    user_id = decode_access_token(token) if token else None
    if user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id).where(User.id == uuid.UUID(user_id)))
        if result.scalar_one_or_none() is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    uid = uuid.UUID(user_id)
    await manager.connect(uid, websocket)
    try:
        while True:
            # Clients never send anything meaningful; this just blocks until
            # the socket closes so we can clean up the connection registry.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(uid, websocket)
