#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Signing in for real: the form, the refresh cookie across reloads and tabs,
signing out, and production's Content-Security-Policy, none of which jsdom
can do."""

import re

import httpx
from playwright.sync_api import expect

REFRESH = "**/api/v1/auth/local/refresh"


def board_tile(page, name):
    return page.get_by_role("link", name=re.compile(re.escape(name)))


def refresh_cookie(context) -> str:
    return next(c["value"] for c in context.cookies() if c["name"] == "refresh_token")


def test_the_sign_in_form_leads_to_your_boards(page, make_user, api):
    user = make_user()
    api(user).post("/boards", json={"name": "Website redesign"}).raise_for_status()

    page.goto("/signin")
    page.get_by_label("Email").fill(user.email)
    page.get_by_role("textbox", name="Password").fill(user.password)
    page.get_by_role("button", name="Sign in").click()

    expect(page).to_have_url(re.compile(r"/boards$"))
    expect(board_tile(page, "Website redesign")).to_be_visible()
    expect(page.get_by_text(user.name)).to_be_visible()


def test_a_reload_keeps_you_signed_in(page, context, make_user, sign_in, api):
    user = make_user()
    api(user).post("/boards", json={"name": "Website redesign"}).raise_for_status()
    sign_in(user)
    page.goto("/boards")
    expect(board_tile(page, "Website redesign")).to_be_visible()
    before = refresh_cookie(context)

    page.reload()

    expect(page).to_have_url(re.compile(r"/boards$"))
    expect(board_tile(page, "Website redesign")).to_be_visible()
    # Through the cookie, which each refresh replaces.
    assert refresh_cookie(context) != before


def test_two_tabs_loading_at_once_both_stay_signed_in(context, make_user, sign_in, api):
    # Each refresh replaces the cookie, so two tabs sending the same one at
    # once would sign out the slower. The tabs take turns (a Web Lock): while
    # the first tab's refresh is held here, the second sends none.
    user = make_user()
    api(user).post("/boards", json={"name": "Website redesign"}).raise_for_status()
    sign_in(user)
    sent = []

    def hold_the_first(route):
        sent.append(route)
        if len(sent) > 1:
            route.continue_()
    context.route(REFRESH, hold_the_first)
    first, second = context.new_page(), context.new_page()
    first.goto("/boards")
    second.goto("/boards")
    # Time for a second refresh, which would be counted here too.
    second.wait_for_timeout(1000)
    assert len(sent) == 1

    sent[0].continue_()

    for page in (first, second):
        expect(board_tile(page, "Website redesign")).to_be_visible()
        expect(page).to_have_url(re.compile(r"/boards$"))


def test_signing_out_ends_the_session(page, context, make_user, sign_in, backend_url):
    user = make_user()
    sign_in(user)
    page.goto("/boards")
    expect(page.get_by_text(user.name)).to_be_visible()
    cookie = refresh_cookie(context)

    page.get_by_role("button", name="Sign out").click()

    expect(page).to_have_url(re.compile(r"/signin$"))
    page.reload()
    expect(page.get_by_role("button", name="Sign in")).to_be_visible()
    expect(page).to_have_url(re.compile(r"/signin$"))
    # Ended on the server too, not just forgotten by the browser.
    refused = httpx.post(f"{backend_url}/api/v1/auth/local/refresh", cookies={"refresh_token": cookie})
    assert refused.status_code == 401


def test_production_csp_is_in_force_and_the_pages_keep_to_it(page, make_user, sign_in, api, csp, browser_errors):
    response = page.goto("/signin")
    assert response.headers["content-security-policy"] == csp
    # In force: an inline script is refused, and the harness hears of it.
    page.evaluate("""() => {
        const script = document.createElement('script')
        script.textContent = 'window.inlineScriptRan = true'
        document.head.append(script)
    }""")
    assert page.evaluate("window.inlineScriptRan") is None
    assert len(browser_errors) == 1 and "Content Security Policy" in browser_errors[0]
    browser_errors.clear()

    # Each page reached from the top bar, a board, and an open card, without
    # a violation (the harness fails the test on one).
    user = make_user()
    client = api(user)
    board = client.post("/boards", json={"name": "Website redesign"}).json()
    todo = client.post(f"/boards/{board['id']}/lists", json={"name": "To do"}).json()
    client.post(f"/boards/{board['id']}/lists/{todo['id']}/cards", json={"name": "Homepage layout"}).raise_for_status()
    sign_in(user)

    page.goto("/boards")
    board_tile(page, "Website redesign").click()
    page.get_by_text("Homepage layout").click()
    expect(page.get_by_role("dialog")).to_be_visible()
    page.keyboard.press("Escape")
    page.goto("/overdue")
    expect(page.get_by_role("heading", name=re.compile("Overdue", re.I))).to_be_visible()
    page.goto("/search?q=homepage")
    expect(page.get_by_text("Homepage layout")).to_be_visible()
    page.get_by_role("link", name="Time Tracker").click()
    expect(page).to_have_url(re.compile(r"/time-tracker$"))
    page.get_by_role("button", name="User profile").click()
    expect(page.get_by_role("menu")).to_be_visible()
