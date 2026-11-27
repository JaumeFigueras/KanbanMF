#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Claude's connection, end to end. The test plays Claude: it finds the
authorization server from the MCP server's refusal, registers, and sends
the person's browser to the consent page (through the sign-in page when
they're signed out). With the code the browser brings back it gets a token
for the boards chosen there, read-only or not, and the MCP tools then reach
those boards only. Deny sends access_denied back, and an app revoked in
Connected apps has its tokens refused."""

import base64
import hashlib
import json
import re
import secrets
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from playwright.sync_api import expect

from board_page import expect_cards, open_board
from live_updates import listening, notifications, unchanged_list_order

# Where Claude is told the answer. A .example address is never a real host,
# and the browser's request for it is answered by the test (see `claude`), so
# nothing leaves this computer.
CALLBACK = "https://claude.example/api/mcp/auth_callback"
MCP_ACCEPT = {"Accept": "application/json, text/event-stream"}


class Claude:
    """An MCP client, as Claude is one, reaching the app at its own address
    (the MCP server and the OAuth endpoints are behind the same proxy as
    the API, as in production)."""

    def __init__(self, frontend):
        self.http = httpx.Client(base_url=frontend, timeout=30)
        # Refused, the MCP server says where to read how to get a token.
        refused = self.http.post("/mcp", headers=MCP_ACCEPT, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert refused.status_code == 401
        metadata = re.search(r'resource_metadata="([^"]+)"', refused.headers["www-authenticate"]).group(1)
        resource = self.http.get(metadata).raise_for_status().json()
        self.resource = resource["resource"]
        self.server = self.http.get(f"{resource['authorization_servers'][0]}/.well-known/oauth-authorization-server") \
            .raise_for_status().json()
        self.client_id = self.http.post(self.server["registration_endpoint"], json={
            "client_name": "Claude", "redirect_uris": [CALLBACK], "grant_types": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_method": "none",
        }).raise_for_status().json()["client_id"]
        self.verifier, self.state = secrets.token_urlsafe(48), secrets.token_urlsafe(16)
        self.access_token = self.refresh_token = None

    def authorize_url(self) -> str:
        challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).rstrip(b"=").decode()
        return self.server["authorization_endpoint"] + "?" + urlencode({
            "response_type": "code", "client_id": self.client_id, "redirect_uri": CALLBACK, "state": self.state,
            "code_challenge": challenge, "code_challenge_method": "S256", "resource": self.resource,
        })

    def answer(self, url) -> dict[str, str]:
        """What the browser brought back to the callback, once the state has
        been checked."""
        assert url.startswith(CALLBACK + "?")
        answer = {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}
        assert answer.pop("state") == self.state
        return answer

    def get_tokens(self, url):
        code = self.answer(url)["code"]
        tokens = self.http.post(self.server["token_endpoint"], data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": CALLBACK, "client_id": self.client_id,
            "code_verifier": self.verifier, "resource": self.resource,
        }).raise_for_status().json()
        self.access_token, self.refresh_token = tokens["access_token"], tokens["refresh_token"]

    def refresh(self) -> httpx.Response:
        return self.http.post(self.server["token_endpoint"], data={
            "grant_type": "refresh_token", "refresh_token": self.refresh_token, "client_id": self.client_id,
            "resource": self.resource,
        })

    def send(self, tool, **arguments) -> httpx.Response:
        return self.http.post("/mcp", headers={**MCP_ACCEPT, "Authorization": f"Bearer {self.access_token}"},
                              json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                    "params": {"name": tool, "arguments": arguments}})

    def call(self, tool, **arguments) -> tuple[bool, object]:
        """Calls an MCP tool: whether it refused, and its answer (the text
        of the refusal)."""
        result = self.send(tool, **arguments).raise_for_status().json()["result"]
        text = result["content"][0]["text"]
        return (True, text) if result.get("isError") else (False, json.loads(text))


@pytest.fixture
def claude(page, frontend):
    """Claude, registered with the app; its callback, opened in the browser,
    answered here."""
    page.route(re.compile(rf"^{re.escape(CALLBACK)}\?"),
               lambda route: route.fulfill(content_type="text/html", body="<p>Back in Claude.</p>"))
    return Claude(frontend)


def consent(page, boards, read_only=False):
    """On the consent page: chooses the boards Claude may reach, and whether
    it may change them, then allows it, which sends the browser back to
    Claude with a code."""
    expect(page.get_by_text("Connect Claude to KanbanMF")).to_be_visible()
    for name in boards:
        page.get_by_role("checkbox", name=name).check()
    if read_only:
        page.get_by_label("Read-only").check()
    page.get_by_role("button", name="Allow").click()
    page.wait_for_url(re.compile(rf"^{re.escape(CALLBACK)}\?"))


def connect(page, claude, boards, read_only=False):
    page.goto(claude.authorize_url())
    consent(page, boards, read_only)
    claude.get_tokens(page.url)


def board_names(answer) -> list[str]:
    return [board["name"] for board in answer["boards"]]


def test_claude_connects_through_the_sign_in_page_when_you_are_signed_out(page, claude, make_user, make_board):
    user = make_user()
    make_board(user, {"To do": ["Homepage layout"]})

    page.goto(claude.authorize_url())
    expect(page).to_have_url(re.compile(r"/signin$"))
    page.get_by_label("Email").fill(user.email)
    page.get_by_role("textbox", name="Password").fill(user.password)
    page.get_by_role("button", name="Sign in").click()

    expect(page).to_have_url(re.compile(r"/oauth/consent\?request="))
    expect(page.get_by_text(f"Signed in as Emma Wilson ({user.email}).")).to_be_visible()
    expect(page.get_by_text("Your answer will be sent to claude.example.")).to_be_visible()
    consent(page, ["Website redesign"])
    claude.get_tokens(page.url)

    refused, answer = claude.call("list_boards")
    assert not refused
    assert (answer["user"], answer["read_only"], board_names(answer)) == ("Emma Wilson", False, ["Website redesign"])


def test_a_read_only_connection_reaches_only_its_board_and_changes_nothing(page, claude, make_user, sign_in,
                                                                          make_board, api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    other = make_board(user, {"Ideas": ["Teaser video"]}, name="Product launch")
    sign_in(user)

    connect(page, claude, ["Website redesign"], read_only=True)

    refused, answer = claude.call("list_boards")
    assert (refused, answer["read_only"], board_names(answer)) == (False, True, ["Website redesign"])
    refused, answer = claude.call("get_board", board_id=board.id)
    assert not refused
    assert [(lst["name"], [c["name"] for c in lst["cards"]]) for lst in answer["lists"]] == \
        [("To do", ["Homepage layout"])]
    assert claude.call("get_board", board_id=other.id) == \
        (True, "Error executing tool get_board: Not found, or not shared with this connection.")
    refused, answer = claude.call("create_card", board_id=board.id, list_id=board.lists["To do"], name="Contact form")
    assert refused and answer.startswith(
        "Error executing tool create_card: This connection is read-only, so it can't change anything.")
    cards = api(user).get(f"/boards/{board.id}/lists/{board.lists['To do']}/cards").raise_for_status().json()
    assert [c["name"] for c in cards] == ["Homepage layout"]


def test_a_card_claude_makes_shows_on_the_open_board_to_be_reviewed(page, claude, make_user, sign_in, make_board,
                                                                    api):
    user = make_user()
    board = make_board(user, {"To do": ["Homepage layout"]})
    sign_in(user)
    connect(page, claude, ["Website redesign"])
    told = notifications(page)
    open_board(page, board)
    listening(page, unchanged_list_order(api(user), board), told)

    refused, _ = claude.call("create_card", board_id=board.id, list_id=board.lists["To do"], name="Contact form")

    assert not refused
    expect_cards(page, "To do", ["TBR: Contact form", "Homepage layout"])


def test_deny_sends_access_denied_back_to_claude(page, claude, make_user, sign_in, make_board, api):
    user = make_user()
    make_board(user, {"To do": []})
    sign_in(user)

    page.goto(claude.authorize_url())
    expect(page.get_by_text("Connect Claude to KanbanMF")).to_be_visible()
    page.get_by_role("button", name="Deny").click()
    page.wait_for_url(re.compile(rf"^{re.escape(CALLBACK)}\?"))

    answer = claude.answer(page.url)
    assert (answer["error"], answer["iss"]) == ("access_denied", claude.server["issuer"])
    assert "code" not in answer
    assert api(user).get("/oauth/grants").raise_for_status().json() == []


def test_an_app_revoked_in_connected_apps_has_its_tokens_refused(page, claude, make_user, sign_in, make_board):
    user = make_user()
    make_board(user, {"To do": []})
    sign_in(user)
    connect(page, claude, ["Website redesign"])
    assert claude.call("list_boards")[0] is False

    page.goto("/boards")
    page.get_by_role("button", name="User profile").click()
    page.get_by_role("menuitem", name="Connected apps").click()
    dialog = page.get_by_role("dialog", name="Connected apps")
    expect(dialog.get_by_text("Claude", exact=True)).to_be_visible()
    expect(dialog.get_by_text("Can make changes")).to_be_visible()
    dialog.get_by_role("button", name="Revoke").click()
    expect(dialog.get_by_text("Claude will lose access to your boards at once.")).to_be_visible()
    dialog.get_by_role("button", name="Revoke").click()
    expect(dialog.get_by_text("No apps are connected.")).to_be_visible()

    assert claude.send("list_boards").status_code == 401
    refreshed = claude.refresh()
    assert (refreshed.status_code, refreshed.json()["error"]) == (400, "invalid_grant")
