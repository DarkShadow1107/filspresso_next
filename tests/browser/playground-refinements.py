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
import uuid
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
        data = {"sessions": []} if request.method == "GET" else {"uuid": "00000000-0000-4000-8000-000000000042"}
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
        page.get_by_label("Message", exact=True).fill("Keep this draft across modes")
        composer = page.get_by_label("Message", exact=True).element_handle()
        page.get_by_role("button", name="Playground mode", exact=True).click()
        page.get_by_role("menuitemradio", name="Build", exact=True).click()
        expect(page.get_by_role("heading", name="Plan & build")).to_have_count(0)
        expect(page.get_by_role("button", name="Plan / Build", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Playground mode")).to_contain_text("Build")
        expect(page.get_by_label("Message", exact=True)).to_have_value("Keep this draft across modes")
        assert composer.evaluate("element => element === document.querySelector('textarea[aria-label=Message]')")
        expect(page.get_by_role("button", name="Send message")).to_be_disabled()
        expect(page.get_by_title("Thinking · controlled by the agent model in Plan and Build")).to_be_visible()
        expect(page.locator('[data-icon="brain"]')).to_be_visible()
        page.get_by_role("button", name="Open web instructions").click()
        expect(page.get_by_role("dialog", name="Web Playground instructions")).to_be_visible()
        page.get_by_role("button", name="Close instructions").click()
        expect(page.get_by_role("button", name="Playground mode")).to_contain_text("Build")
        page.screenshot(path=str(directory / "plan-build.png"), full_page=True)
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Plan", exact=True).click()
        expect(page.get_by_label("Message", exact=True)).to_have_value("Keep this draft across modes")
        expect(page.get_by_text("Plan · read and explore, no changes or commands", exact=True)).to_be_visible()
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Chat", exact=True).click()
        expect(page.get_by_label("Message", exact=True)).to_have_value("Keep this draft across modes")
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
        expect(page.get_by_role("button", name="Download installer", exact=False)).to_be_disabled()
        expect(page.get_by_text("Unsigned installer · not lifecycle-qualified.", exact=True)).to_be_visible()
        page.get_by_role("button", name="Recheck device").click()
        expect(page.get_by_role("button", name="Recheck device")).to_be_enabled()
        page.screenshot(path=str(directory / "compatibility.png"), full_page=True)
        page.get_by_role("button", name="Cancel", exact=True).click()
        assert not any(path == "/api/desktop/installer/ack" for _, path in requests)
        page.get_by_label("Message", exact=True).fill("Fixture response only")
        page.get_by_role("button", name="Send message", exact=True).click()
        expect(page.get_by_text("Fixture paragraph 34.", exact=False)).to_be_visible()
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Plan", exact=True).click()
        expect(page.get_by_text("Fixture paragraph 34.", exact=False)).to_be_visible()
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Chat", exact=True).click()
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
        # Now exercise the production shared composer through actual mounted agent logic.
        # These are fake model/actions, not a live executor or a qualification claim.
        page.set_viewport_size({"width": 1440, "height": 900})
        page.get_by_role("button", name="New conversation", exact=True).click()
        page.get_by_label("Message", exact=True).fill("Remember this shared thread")
        page.get_by_role("button", name="Send message", exact=True).click()
        expect(page.get_by_text("Fixture paragraph 34.", exact=False)).to_be_visible()
        native_requests, executions = [], []
        sandbox_id = "00000000-0000-4000-8000-000000000043"
        challenge = {"version": 1, "actionId": str(uuid.uuid4()), "runId": "exec-" + "a" * 24, "sandboxId": sandbox_id,
                     "toolCallId": "unified_command", "requiresApproval": True, "expiresAt": 4102444800}
        def agent_fixture(route):
            path = urlparse(route.request.url).path
            body = route.request.post_data_json if route.request.post_data else {}
            if path.endswith("actions/capabilities"):
                data = {"version": 1, "enabled": True, "protocol": "actions-v1", "location": "hosted-docker"}
            elif path.endswith("/capabilities"):
                data = {"version": 1, "protocol": "native-v1", "executesTools": False, "models": ["lfm2_5_230m_q4_k_m"],
                        "interactionProtocols": ["question-v1"], "conversationProtocol": "completed-turns-v1"}
            elif path.endswith("/turn"):
                native_requests.append(body)
                calls = [{"id": "unified_command", "name": "run_command", "arguments": '{"command":"fixture-only"}'}] if body["mode"] == "build" and not body["history"] else []
                data = {"version": 1, "runId": "dsk-" + str(len(native_requests)).zfill(24), "settlement": "succeeded", "text": "Plan fixture answer" if body["mode"] == "plan" else "Build fixture answer",
                        "finish_reason": "tool_calls" if calls else "stop", "tool_calls": calls, "usage": {"prompt_tokens": 100, "completion_tokens": 10},
                        "action_tickets": [{"tool_call_id": c["id"], "token": "e30." + "a" * 43, "expires_at": 4102444800} for c in calls]}
            elif path.endswith("/execute"):
                executions.append(body)
                assert body["approved"] is False, "This fixture deliberately denies every command"
                data = {**challenge, "status": "declined", "executed": False}
            else:
                data = challenge
            route.fulfill(status=200, content_type="application/json", body=json.dumps(data))
        def sandbox_fixture(route):
            data = {"stopped": True} if route.request.method == "DELETE" else {"id": sandbox_id, "location": "hosted-docker", "network": "disabled", "workspace": "/workspace", "ephemeral": True, "policyVersion": 2}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(data))
        page.route("**/api/playground/agent/**", agent_fixture)
        page.route("**/api/playground/sandbox**", sandbox_fixture)
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Plan", exact=True).click()
        page.locator(".pgw-workspace-options > summary").click()
        page.get_by_role("button", name="Check availability", exact=True).click()
        expect(page.get_by_role("button", name="Start workspace", exact=True)).to_be_enabled()
        page.get_by_role("button", name="Start workspace", exact=True).click()
        page.get_by_label("Message", exact=True).fill("Plan from the earlier chat")
        page.get_by_role("button", name="Send message", exact=True).click()
        expect(page.get_by_text("Plan fixture answer", exact=True)).to_be_visible()
        assert native_requests[0]["conversation"][0]["message"] == "Remember this shared thread"
        assert all(tool["name"] in ["read_file", "question"] for tool in native_requests[0]["tools"])
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Build", exact=True).click()
        page.get_by_label("Message", exact=True).fill("Build after planning")
        page.get_by_role("button", name="Send message", exact=True).click()
        expect(page.get_by_role("heading", name="Approve this action once?")).to_be_visible()
        expect(page.get_by_role("button", name="Playground mode")).to_be_disabled()
        assert executions == []
        page.get_by_role("button", name="Deny this action", exact=True).click()
        expect(page.get_by_role("button", name="Playground mode")).to_be_enabled()
        assert len(executions) == 1 and executions[0]["approved"] is False
        assert len(native_requests[1]["conversation"]) == 2
        assert all(turn["history"] == [] for turn in native_requests[1]["conversation"])
        page.get_by_role("button", name="Playground mode").click()
        page.get_by_role("menuitemradio", name="Chat", exact=True).click()
        expect(page.get_by_text("Remember this shared thread", exact=True)).to_be_visible()
        page.get_by_role("button", name="New conversation", exact=True).click()
        assert errors == [], errors
        browser.close()
        print("PASS: shared composer/draft/thread, Chat/Plan/Build context, read-only Plan tools, fresh Build denial, responsive layout, brain tooltip and compact unsigned dialog. APIs/model/actions are fixtures; no live execution.")
finally:
    server.shutdown()
    server.server_close()
