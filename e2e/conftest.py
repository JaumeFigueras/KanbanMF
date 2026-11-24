#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""The end-to-end tests' harness: the real frontend, in Chromium, against the
real backend and a real database. Run them with ``make test-e2e``.

Each run starts everything it needs itself, on this computer and on free
ports, and throws it all away at the end. Nothing has to be running first,
and the development servers and database are never touched:

- a throwaway PostgreSQL (pytest-postgresql, as the backend's tests use),
  with the schema built by ``alembic upgrade head``;
- the backend from this working copy, on that database, with e-mail and
  Google sign-in off whatever ``backend/.env`` says;
- the frontend from this working copy, built as for production and served by
  ``vite preview``, with production's Content-Security-Policy;
- Chromium, from the Playwright in ``.venv``.

Every test gets a browser context (cookies, storage) of its own and makes its
own users and boards, so no test depends on another. A test fails on any
error in the browser's console (a CSP violation is one) or any exception the
page doesn't catch. A failed test leaves a Playwright trace in
``e2e/test-results/``: ``.venv/bin/playwright show-trace <file>``.
"""

import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import sync_playwright
from pytest_postgresql import factories
from pytest_postgresql.janitor import DatabaseJanitor
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
RESULTS = Path(__file__).parent / "test-results"

# The backend's settings for the run. Environment variables outrank
# backend/.env, so whatever that file says, no e-mail can leave (no SMTP host;
# fastapi-mail still wants a sender address) and Google sign-in is off. This
# process signs access tokens with the same key (see `api`); the database it
# reaches through an engine of its own (see `database`), so src never
# connects to the placeholder below.
SETTINGS = {
    "SECRET_KEY": "e2e-tests-only-not-a-real-secret-0123456789abcdef",
    "SMTP_HOST": "",
    "SMTP_PORT": "465",
    "SMTP_USERNAME": "",
    "SMTP_PASSWORD": "",
    "SMTP_FROM_EMAIL": "noreply@example.com",
    "SMTP_FROM_NAME": "KanbanMF",
    "EMAIL_SENDER": "",
    "GOOGLE_CLIENT_ID": "",
    "GOOGLE_CLIENT_SECRET": "",
}
os.environ.update(SETTINGS, DATABASE_URL="postgresql+psycopg://unused@localhost/unused")

# The backend is imported as the top-level ``src`` package, from backend/.
sys.path.insert(0, str(BACKEND))

from src.core.security import create_access_token, hash_password  # noqa: E402
from src.core.sessions import open_session  # noqa: E402
from src.model import User, UserIdentity, UserPreferences  # noqa: E402
from src.model.user_identity import AuthProvider  # noqa: E402

PASSWORD = "e2e-password"

# The Unix socket goes in a short directory of its own, as in the backend's
# tests; the backend and this process connect over TCP.
_socket_dir = tempfile.TemporaryDirectory()
postgresql_proc = factories.postgresql_proc(port=None, unixsocketdir=_socket_dir.name)


def pytest_sessionstart(session):
    # Each run's traces and logs only, so an old trace can't pass for a new
    # failure.
    shutil.rmtree(RESULTS, ignore_errors=True)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(name: str, command: list[str], cwd: Path, env: dict[str, str], ready_url: str) -> subprocess.Popen:
    """Start a server, its output in test-results/<name>.log, and wait until
    ready_url answers."""
    RESULTS.mkdir(exist_ok=True)
    log = RESULTS / f"{name}.log"
    # A session of its own, so stopping it stops whatever it started too.
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log.open("w"), stderr=subprocess.STDOUT,
                               start_new_session=True)
    deadline = time.monotonic() + 60
    while True:
        if process.poll() is not None:
            raise RuntimeError(f"The {name} stopped at start-up; see {log}")
        try:
            httpx.get(ready_url, timeout=1)
            return process
        except httpx.HTTPError:
            if time.monotonic() > deadline:
                _stop(process)
                raise RuntimeError(f"The {name} didn't start within a minute; see {log}")
            time.sleep(0.2)


def _stop(process: subprocess.Popen) -> None:
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


@pytest.fixture(scope="session")
def frontend_url() -> str:
    """Where the browser finds the app. Chosen first, as the backend needs to
    know it (FRONTEND_URL: e-mail links, the MCP server's OAuth issuer)."""
    return f"http://localhost:{_free_port()}"


@pytest.fixture(scope="session")
def database_url(postgresql_proc):
    with DatabaseJanitor(user=postgresql_proc.user, host=postgresql_proc.host, port=postgresql_proc.port,
                         dbname="kanbanmf_e2e", password=postgresql_proc.password):
        yield (f"postgresql+psycopg://{postgresql_proc.user}:{postgresql_proc.password or ''}"
               f"@{postgresql_proc.host}:{postgresql_proc.port}/kanbanmf_e2e")


@pytest.fixture(scope="session")
def backend_url(database_url, frontend_url):
    """The backend's address, once the schema is built and it answers."""
    env = {**os.environ, **SETTINGS, "DATABASE_URL": database_url, "FRONTEND_URL": frontend_url}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True,
                   capture_output=True)
    url = f"http://127.0.0.1:{_free_port()}"
    process = _start("backend", [sys.executable, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1",
                                 "--port", url.rsplit(":", 1)[1]],
                     BACKEND, env, f"{url}/api/v1/config")
    yield url
    _stop(process)


@pytest.fixture(scope="session")
def csp(frontend_url) -> str:
    """Production's Content-Security-Policy, from the Apache vhost, with this
    run's address for the WebSocket in place of the vhost's own host."""
    vhost = (ROOT / "deploy" / "apache-kanbanmf.conf").read_text()
    policy = re.search(r'Header always set Content-Security-Policy "([^"]+)"', vhost).group(1)
    assert "wss://kanban.example.com" in policy, "the vhost's WebSocket host has changed: update this fixture"
    return policy.replace("wss://kanban.example.com", frontend_url.replace("http://", "ws://"))


@pytest.fixture(scope="session")
def frontend(frontend_url, backend_url, csp, tmp_path_factory) -> str:
    """The production build, served by vite preview with production's CSP
    and its proxy pointed at this run's backend."""
    vite = str(FRONTEND / "node_modules" / ".bin" / "vite")
    build = tmp_path_factory.mktemp("frontend-build")
    subprocess.run([vite, "build", "--outDir", str(build), "--emptyOutDir"], cwd=FRONTEND, check=True,
                   capture_output=True)
    env = {**os.environ, "KANBANMF_BACKEND": backend_url, "KANBANMF_CSP": csp}
    port = frontend_url.rsplit(":", 1)[1]
    process = _start("frontend", [vite, "preview", "--host", "localhost", "--port", port, "--strictPort",
                                  "--outDir", str(build)],
                     FRONTEND, env, frontend_url)
    yield frontend_url
    _stop(process)


@pytest.fixture(scope="session")
def browser():
    """Chromium, headless; HEADED=1 shows it, slowed down to follow."""
    headed = bool(os.environ.get("HEADED"))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed, slow_mo=300 if headed else 0)
        yield browser
        browser.close()


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    # Keeps each phase's report on the test, so `context` knows if it failed.
    report = yield
    setattr(item, f"report_{report.when}", report)
    return report


@pytest.fixture
def browser_errors() -> list[str]:
    """What the page logged as an error or threw without catching, as the
    test goes. The test fails if any is left at its end: one that causes an
    error on purpose takes it out. The browser's own notes of a request that
    got an error status ("Failed to load resource") aren't kept: the app
    deals with those, and the tests check what it shows."""
    return []


@pytest.fixture
def context(browser, frontend, browser_errors, request):
    """A browser context of the test's own, on the app."""
    context = browser.new_context(base_url=frontend, viewport={"width": 1600, "height": 900},
                                  locale="en-GB", timezone_id="Europe/Madrid")
    context.on("console", lambda message: browser_errors.append(message.text)
               if message.type == "error" and not message.text.startswith("Failed to load resource") else None)
    context.on("weberror", lambda error: browser_errors.append(str(error.error)))
    context.tracing.start(screenshots=True, snapshots=True)
    yield context
    call = getattr(request.node, "report_call", None)
    if (call is not None and call.failed) or browser_errors:
        RESULTS.mkdir(exist_ok=True)
        context.tracing.stop(path=RESULTS / f"{request.node.name}.zip")
    else:
        context.tracing.stop()
    context.close()
    if browser_errors:
        pytest.fail("The page logged or threw errors:\n" + "\n".join(browser_errors))


@pytest.fixture
def page(context):
    return context.new_page()


@pytest.fixture(scope="session")
def database(database_url, backend_url):
    """An engine on the run's database, once the schema is built."""
    engine = create_engine(database_url, poolclass=NullPool)
    yield engine
    engine.dispose()


@dataclass
class Person:
    id: str
    email: str
    name: str
    password: str = PASSWORD


@pytest.fixture
def make_user(database):
    """Makes a verified user, straight in the database (the API would send a
    verification e-mail), with an address no other test uses."""
    def make_user(name: str = "Emma Wilson") -> Person:
        email = f"{name.split()[0].lower()}.{uuid.uuid4().hex[:12]}@example.com"
        with Session(database) as db:
            user = User(email=email, display_name=name, is_active=True, is_verified=True)
            db.add(user)
            db.flush()
            db.add(UserIdentity(user_id=user.id, provider=AuthProvider.LOCAL, hashed_password=hash_password(PASSWORD)))
            db.add(UserPreferences(user_id=user.id, language_locale="en", number_locale="en_GB",
                                   timezone="Europe/Madrid"))
            db.commit()
            return Person(str(user.id), email, name)
    return make_user


@pytest.fixture
def sign_in(context, database, frontend):
    """Signs the test's browser in as a user, as the sign-in form would: a
    session in the database, and its refresh cookie in the browser. The form
    allows 30 sign-ins per 15 minutes from one address, and every test comes
    from this one."""
    def sign_in(user: Person) -> None:
        with Session(database) as db:
            token = open_session(uuid.UUID(user.id), db)
            db.commit()
        context.add_cookies([{"name": "refresh_token", "value": token, "url": frontend,
                              "httpOnly": True, "secure": True, "sameSite": "Lax"}])
    return sign_in


@pytest.fixture
def api(backend_url):
    """A REST client signed in as a user, straight to the backend, for
    building what a test needs and checking what the page saved. It sends no
    X-Client-Id, so its changes reach every open page, as another person's
    would."""
    clients: list[httpx.Client] = []

    def api(user: Person) -> httpx.Client:
        client = httpx.Client(base_url=f"{backend_url}/api/v1", timeout=30,
                              headers={"Authorization": f"Bearer {create_access_token(user.id)}"})
        clients.append(client)
        return client
    yield api
    for client in clients:
        client.close()
