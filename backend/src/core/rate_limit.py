#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Rate limits for the requests worth abusing: guessing passwords, and making
the server send e-mails or store rows on a stranger's behalf.

An in-memory sliding window per key — an IP address or an account. The
backend runs as one process (see the scheduler and the WebSocket registry),
so memory is the whole picture; a restart forgets the counts, which only
ever errs towards letting someone in.

The client's IP is ``request.client.host``. Behind Apache that is the real
client, not 127.0.0.1: uvicorn trusts ``X-Forwarded-For`` from 127.0.0.1 by
default and takes the last address in it that isn't the proxy's — the one
Apache added — so a client can't choose its own by sending the header.
"""

import math
import time
from collections import deque

from fastapi import HTTPException, Request, status


class RateLimit:
    """At most ``limit`` events per key within ``window`` seconds.

    :meth:`hit` records an event and raises ``429`` (with ``Retry-After``)
    when the key is over its limit; the refused event isn't counted, so a
    client that waits gets in on time.
    """

    # Above this many keys, forget the ones whose window has passed, so that
    # addresses seen once don't pile up in memory.
    _PRUNE_ABOVE = 10_000

    def __init__(self, name: str, limit: int, window: float) -> None:
        self.name = name
        self.limit = limit
        self.window = window
        self._events: dict[str, deque[float]] = {}
        LIMITS.append(self)

    def hit(self, key: str) -> None:
        now = time.monotonic()
        events = self._events.setdefault(key, deque())
        while events and events[0] <= now - self.window:
            events.popleft()
        if len(events) >= self.limit:
            retry_after = max(1, math.ceil(events[0] + self.window - now))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )
        events.append(now)
        if len(self._events) > self._PRUNE_ABOVE:
            self._prune(now)

    def _prune(self, now: float) -> None:
        stale = [k for k, ev in self._events.items() if not ev or ev[-1] <= now - self.window]
        for key in stale:
            del self._events[key]

    def reset(self) -> None:
        """Forget every count (for the tests)."""
        self._events.clear()


LIMITS: list[RateLimit] = []

MINUTE = 60.0
HOUR = 60 * MINUTE

# Signing in: bcrypt is slow, but a botnet is patient. Per account, so a
# password can't be guessed from many addresses; per address, so one client
# can't try many accounts. Someone trying an account's password does slow its
# owner down for a few minutes — the price of not letting them guess.
LOGIN_PER_ACCOUNT = RateLimit("login per account", 10, 15 * MINUTE)
LOGIN_PER_IP = RateLimit("login per IP", 30, 15 * MINUTE)
# Each registration e-mails a verification link to whatever address was typed.
REGISTER_PER_IP = RateLimit("register per IP", 5, HOUR)
# Guessing the current password through the change-password form.
PASSWORD_CHANGE_PER_USER = RateLimit("password change per user", 10, 15 * MINUTE)
# Each invitation e-mails a stranger in this server's name.
INVITATION_PER_USER = RateLimit("invitation per user", 30, HOUR)
# Dynamic Client Registration is open to anyone and stores a row each time.
OAUTH_REGISTER_PER_IP = RateLimit("OAuth client registration per IP", 20, HOUR)


def client_ip(request: Request) -> str:
    """The address the request came from (see the module docstring)."""
    return request.client.host if request.client else "unknown"
