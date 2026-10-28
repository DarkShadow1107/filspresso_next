"""Mounted UI/layout tests; every API/model response is a fixture, not live qualification.

node tests/browser/Build-PlaygroundRefinementFixture.cjs
python tests/browser/playground-refinements.py
"""
import functools
import http.server
import json
import os
import pathlib
import threading
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

directory = pathlib.Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode/filspresso-playground-refinements"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(directory)))
threading.Thread(target=server.serve_forever, daemon=True).start()
requests = []


def respond(route):
    request = route.request
    path = urlparse(request.url).path
    requests.append((request.method, path))
    if path == "/api/auth/me":
        data = {"user": {"id": 1, "email": "fixture@example.invalid", "username": "fixture", "subscription": "ultimate"}}
    elif path == "/api/spectre/access":
        data = {"hasAccess": True, "source": "tier"}
    elif path == "/api/desktop/installer":
        data = {"available": True, "canDownload": True, "productVersion": "0.3.2", "sha256": "a" * 64,
                "bytes": 80978388, "unsigned": True, "acknowledged": False, "downloadUrl": "/api/desktop/download"}
    elif path == "/api/model-status":
        data = {"status": "loaded", "progress": 100}
    elif path == "/api/playground/runs":
        data = {"version": 1, "runs": []}
    elif path == "/api/playground/chat":
        text = "\n\n".join(f"Fixture paragraph {i}. A long response to exercise one document scrollbar." for i in range(35))
        route.fulfill(status=200, content_type="text/event-stream", body="data: " + json.dumps({"delta": text}) + "\n\ndata: [DONE]\n\n")
        return
    elif path == "/api/playground/sessions":
        data = {"sessions": []} if request.method == "GET" else {"uuid": "fixture-session"}
    else:
        data = {}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(data))


def assert_menu_below_nav(page):
    expect(page.get_by_role("menu")).to_be_visible()
    bounds = page.get_by_role("menu").bounding_box()
    nav = page.locator(".header_body").bounding_box()
    assert bounds["y"] >= nav["y"] + nav["height"], (bounds, nav)
    assert bounds["y"] + bounds["height"] <= page.viewport_size["height"] + 1
    assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= page.viewport_size["width"] + 1


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            ignore_https_errors=os.environ.get("PLAYGROUND_IGNORE_HTTPS_ERRORS", "").lower() == "true",
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: (errors.append(str(error)), print("Browser error:", error)))
        page.route("**/api/**", respond)
        page.goto(os.environ.get("PLAYGROUND_BROWSER_URL", f"http://127.0.0.1:{server.server_port}"))
        expect(page.get_by_role("heading", name="Hello there")).to_be_visible()
        page.evaluate("document.fonts.ready")
        nav = page.locator(".header_body").bounding_box()
        assert page.locator(".pgw").bounding_box()["y"] >= nav["y"] + nav["height"]
        page.get_by_role("button", name="Expand navigation labels").click()
        expect(page.locator(".pgw-nav-label", has_text="Instructions")).to_be_visible()
        expect(page.locator("#pgw-conversations")).to_have_count(0)
        page.screenshot(path=str(directory / "navigation-labels.png"), full_page=True)
        page.get_by_role("button", name="Expand navigation labels").click()
        page.get_by_role("button", name="Open web instructions").click()
        expect(page.get_by_role("heading", name="Using the web Playground")).to_be_visible()
        page.get_by_text("Advanced tools", exact=True).click()
        page.screenshot(path=str(directory / "web-instructions.png"), full_page=True)
        page.get_by_role("button", name="Manual workspace", exact=True).click()
        expect(page.get_by_role("heading", name="Manual workspace")).to_be_visible()
        expect(page.get_by_label("Sandbox console output")).to_have_count(0)
        page.get_by_role("button", name="Manual workspace mode", exact=True).click()
        assert_menu_below_nav(page)
        page.get_by_role("menuitemradio", name="Build · explicit execution", exact=True).click()
        page.get_by_role("button", name="Close workspace", exact=True).click()
        page.get_by_role("button", name="Input context", exact=True).click()
        assert_menu_below_nav(page)
        page.get_by_role("menuitemradio", name="32K", exact=True).click()
        expect(page.get_by_role("button", name="Input context", exact=True)).to_contain_text("32K")
        assert page.locator(".pgw-composer select, .pgw-picker-chevron").count() == 0
        page.get_by_role("button", name="Playground mode", exact=True).click()
        page.get_by_role("menuitemradio", name="Build", exact=True).click()
        expect(page.get_by_role("heading", name="Plan & build")).to_be_visible()
        expect(page.get_by_role("button", name="Agent workspace mode")).to_contain_text("Build")
        expect(page.get_by_role("button", name="Send · metered")).to_be_disabled()
        page.get_by_role("button", name="Open web instructions").click()
        expect(page.get_by_role("dialog", name="Web Playground instructions")).to_be_visible()
        page.get_by_role("button", name="Close instructions").click()
        expect(page.get_by_role("button", name="Agent workspace mode")).to_contain_text("Build")
        expect(page.get_by_role("region", name="Agent sandbox workspace").get_by_role("alert")).to_have_count(0)
        page.screenshot(path=str(directory / "plan-build.png"), full_page=True)
        page.get_by_role("button", name="Agent workspace mode").click()
        page.get_by_role("menuitemradio", name="Chat", exact=True).click()
        page.get_by_role("button", name="Recorded activity", exact=True).click()
        expect(page.get_by_role("heading", name="No retained activity")).to_be_visible()
        page.screenshot(path=str(directory / "activity.png"), full_page=True)
        page.get_by_role("button", name="Recorded activity", exact=True).click()
        page.get_by_role("button", name="Attach files", exact=True).click()
        assert_menu_below_nav(page)
        expect(page.get_by_role("menuitem", name="Images", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.get_by_role("menu")).to_have_count(0)
        expect(page.get_by_role("button", name="Attach files", exact=True)).to_be_focused()
        page.get_by_role("button", name="Compaction mode", exact=True).click()
        assert_menu_below_nav(page)
        page.get_by_role("menuitemradio", name="Aggressive", exact=False).click()
        expect(page.get_by_role("button", name="Compaction mode", exact=True)).to_contain_text("Aggressive")
        page.get_by_role("button", name="Model", exact=True).click()
        assert_menu_below_nav(page)
        page.keyboard.press("Escape")
        expect(page.get_by_role("menu")).to_have_count(0)
        page.screenshot(path=str(directory / "desktop-web.png"), full_page=True)
        page.get_by_role("button", name="Download Desktop App").click()
        expect(page.get_by_role("dialog")).to_be_visible()
        expect(page.get_by_role("button", name="Download installer", exact=True)).to_be_disabled()
        expect(page.get_by_text("Unsigned installer · not lifecycle-qualified.", exact=True)).to_be_visible()
        page.get_by_role("button", name="Recheck device").click()
        expect(page.get_by_role("button", name="Recheck device")).to_be_enabled()
        page.screenshot(path=str(directory / "compatibility.png"), full_page=True)
        page.get_by_role("button", name="Cancel", exact=True).click()
        assert not any(path == "/api/desktop/installer/ack" for _, path in requests)
        page.get_by_label("Message", exact=True).fill("Fixture response only")
        page.get_by_role("button", name="Send message", exact=True).click()
        expect(page.get_by_text("Fixture paragraph 34.", exact=False)).to_be_visible()
        scrollers = page.locator(".pgw *").evaluate_all("""nodes => nodes.filter(n => !['TEXTAREA','INPUT','SELECT'].includes(n.tagName)
            && ['auto','scroll'].includes(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1).map(n=>n.className)""")
        assert scrollers == [], scrollers
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
        nav = page.locator(".header_body").bounding_box()
        assert page.locator(".pgw-topbar").bounding_box()["y"] >= nav["y"] + nav["height"]
        for width, height in [(390, 844), (1024, 600)]:
            page.set_viewport_size({"width": width, "height": height})
            page.get_by_role("button", name="New conversation", exact=True).click()
            page.get_by_role("button", name="Attach files", exact=True).click()
            assert_menu_below_nav(page)
            page.keyboard.press("Escape")
            expect(page.get_by_role("menu")).to_have_count(0)
            page.get_by_role("button", name="Model", exact=True).click()
            assert_menu_below_nav(page)
            page.keyboard.press("Escape")
            expect(page.get_by_role("menu")).to_have_count(0)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
            page.get_by_role("button", name="Expand navigation labels").click()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
            page.get_by_role("button", name="Expand navigation labels").click()
            page.screenshot(path=str(directory / f"web-{width}.png"), full_page=True)
        assert errors == [], errors
        assert not any(path in ["/api/playground/sandbox", "/api/playground/agent/turn"] for _, path in requests)
        browser.close()
        print("PASS: one document scroller, navbar clearance, compact menus at desktop/mobile/short heights, keyboard focus, concise unsigned dialog/recheck and no automatic execution. APIs/model are fixtures.")
finally:
    server.shutdown()
    server.server_close()
