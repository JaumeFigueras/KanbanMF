#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.api.deps import get_db
from src.core.security import create_access_token
from src.main import app
from src.model.user import User


@pytest_asyncio.fixture
async def db_session_async(db_session, postgresql_kanbanmf):
    """Async SQLAlchemy session against the same ephemeral Postgres already
    bootstrapped by the `db_session` fixture (backend/test/conftest.py) —
    reuses its schema setup instead of re-running the SQL files here."""
    conn_info = postgresql_kanbanmf.info
    url = f"postgresql+psycopg://{conn_info.user}:@{conn_info.host}:{conn_info.port}/{conn_info.dbname}"

    async_engine = create_async_engine(url, echo=False, poolclass=NullPool)
    session_maker = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

    async with session_maker() as session:
        yield session

    await async_engine.dispose()


@pytest_asyncio.fixture
async def client(db_session_async):
    """Async HTTP client wired to the FastAPI app, with get_db overridden to
    use the test database instead of the real one."""
    async def _override_get_db():
        yield db_session_async

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db_session_async) -> User:
    """A plain, persisted User row with no preferences/identities/avatar."""
    user = User(email="user@example.com", display_name="Test User")
    db_session_async.add(user)
    await db_session_async.commit()
    await db_session_async.refresh(user)
    return user


@pytest_asyncio.fixture
async def auth_headers(test_user: User) -> dict[str, str]:
    """A valid Authorization header for test_user."""
    return {"Authorization": f"Bearer {create_access_token(test_user.id)}"}
