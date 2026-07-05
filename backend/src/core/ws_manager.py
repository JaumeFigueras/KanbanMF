#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import uuid
from typing import Iterable

from fastapi import WebSocket


class ConnectionManager:
    """Tracks live WebSocket connections per user for the notify-and-refetch pattern.

    A single user may have several concurrent connections (multiple browser
    tabs, multiple devices), so each user_id maps to a set of sockets rather
    than a single one. This is in-memory and per-process: it works as long as
    the backend runs as a single worker/instance.
    """

    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = {}

    async def connect(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        connections = self._connections.get(user_id)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(user_id, None)

    async def notify(self, user_id: uuid.UUID, message: dict) -> None:
        """Send a JSON message to every live connection for a single user."""
        for websocket in list(self._connections.get(user_id, ())):
            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(user_id, websocket)

    async def notify_many(self, user_ids: Iterable[uuid.UUID], message: dict) -> None:
        """Send a JSON message to every live connection for a set of users."""
        for user_id in set(user_ids):
            await self.notify(user_id, message)


manager = ConnectionManager()
