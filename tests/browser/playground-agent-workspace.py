"""Mounted Chromium UI checks with explicit model/API fixtures, never live inference.

Build first: node playground-sandbox/Build-AgentBrowserFixture.cjs
Run: python tests/browser/playground-agent-workspace.py
"""
import functools
import hashlib
import http.server
import json
import os
import pathlib
import threading
import uuid

from playwright.sync_api import sync_playwright, expect


directory = pathlib.Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode/filspresso-agent-browser-validation"
assert (directory / "fixture.js").is_file(), "Build the isolated browser fixture first"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(directory)))
threading.Thread(target=server.serve_forever, daemon=True).start()
identity = str(uuid.uuid4())
requests = []
challenges = {}
turn = 0
project_files = {"main.py": '<script>window.__agent_injected=1</script><img src="https://preview-exfil.invalid/">'}
question_fixture = json.loads((pathlib.Path(__file__).resolve().parents[1] / "fixtures/playground-question.json").read_text(encoding="utf-8"))


def respond(route):
    global turn
    request = route.request
    path = request.url.split("/api/playground/")[1]
    body = request.post_data_json if request.post_data else None
    requests.append((request.method, path, body))
    if path == "agent/capabilities":
        data = {"version": 1, "models": ["lfm2_5_230m_q4_k_m"], "protocol": "native-v1", "executesTools": False,
                "interactionProtocols": ["question-v1"], "conversationProtocol": "completed-turns-v1"}
    elif path == "agent/actions/capabilities":
        data = {"version": 1, "enabled": True, "protocol": "actions-v1", "location": "hosted-docker"}
    elif path == "sandbox" and request.method == "POST":
        data = {"id": identity, "location": "hosted-docker", "workspace": "/workspace", "network": "disabled", "ephemeral": True, "policyVersion": 2}
    elif request.method == "DELETE":
        data = {"stopped": True}
    elif path == f"sandbox/{identity}/files":
        data = {"files": sorted(project_files)}
    elif path.startswith(f"sandbox/{identity}/file?"):
        from urllib.parse import parse_qs, urlparse
        selected = parse_qs(urlparse(request.url).query)["path"][0]
        data = {"path": selected, "text": project_files[selected]}
    elif path == f"sandbox/{identity}/file" and request.method == "PUT":
        assert body["approved"] is True
        project_files[body["path"]] = body["text"]
        data = {"path": body["path"], "bytes": len(body["text"].encode("utf-8"))}
    elif path == "agent/turn":
        calls = [{"id": "question_1", "name": "question", "arguments": json.dumps(question_fixture["form"])}] if turn == 0 else [
            {"id": "write_1", "name": "write_file", "arguments": json.dumps({"path": "main.py", "text": '<script>window.__agent_injected=1</script>'})},
            {"id": "run_1", "name": "run_command", "arguments": json.dumps({"command": "python3 main.py"})},
        ] if turn == 1 else []
        if turn == 1:
            clarification = json.loads(body["history"][0]["tool_results"][0]["content"])
            assert clarification["grantsExecutionPermission"] is False
            assert clarification["answers"][0]["selected"] == [0]
            assert clarification["answers"][1]["custom"] == "Also inspect Unicode: café 😀"
        if turn == 3:
            assert body["message"] == "Now explain the result"
            assert len(body["conversation"]) == 1 and len(body["conversation"][0]["history"]) == 2
        turn += 1
        data = {"version": 1, "runId": "dsk-" + str(turn).zfill(24), "settlement": "succeeded", "text": '<script>window.__agent_injected=1</script>',
                "finish_reason": "tool_calls" if calls else "stop", "tool_calls": calls, "usage": {"prompt_tokens": 100, "completion_tokens": 10},
                "action_tickets": [{"tool_call_id": call["id"], "token": "e30." + "a" * 43, "expires_at": 4102444800} for call in calls if call["name"] != "question"]}
    elif path == "agent/actions":
        call = body["call"]
        data = {"version": 1, "actionId": str(uuid.uuid4()), "runId": "exec-" + str(len(challenges) + 1).zfill(24), "sandboxId": identity,
                "toolCallId": call["id"], "requiresApproval": True, "expiresAt": 4102444800}
        challenges[call["id"]] = data
    elif path.endswith("/execute"):
        data = {**challenges[body["call"]["id"]], "status": "complete", "executed": True,
                "result": {"stdout": "fixture test output", "stderr": "", "exitCode": 0, "timedOut": False, "durationMs": 5, "truncated": False}}
    else:
        raise AssertionError("Unexpected browser request " + path)
    route.fulfill(status=200, content_type="application/json", body=json.dumps(data))


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("if (window === window.top) localStorage.setItem('account_profile',JSON.stringify({email:'fixture@example.invalid'}))")
        page.route("**/api/playground/**", respond)
        page.goto(f"http://127.0.0.1:{server.server_port}")
        expect(page.get_by_role("heading", name="Plan & build")).to_be_visible()
        expect(page.get_by_role("button", name="Send · metered")).to_be_disabled()
        assert requests == [], "Opening/StrictMode mounting must not request inference/capabilities"
        page.get_by_role("button", name="Check availability").click()
        expect(page.get_by_role("button", name="Start workspace", exact=True)).to_be_enabled()
        page.get_by_role("button", name="Start workspace", exact=True).click()
        page.get_by_role("button", name="Agent workspace mode").click()
        page.get_by_role("menuitemradio", name="Build", exact=True).click()
        page.get_by_label("Agent workspace request").fill("Fixture create and test")
        page.get_by_role("button", name="Send · metered").click()
        questions = page.get_by_role("form", name="Agent clarification questions")
        expect(questions).to_be_visible()
        assert not any(path == "agent/actions" or path.endswith("/execute") for _, path, _ in requests)
        expect(questions.get_by_role("button", name="Submit answers")).to_be_disabled()
        questions.get_by_role("radio", name="PostgreSQL", exact=False).check()
        questions.get_by_role("checkbox", name="Tests", exact=False).check()
        questions.get_by_role("checkbox", name="Accessibility", exact=False).check()
        questions.get_by_label("Your own answer: Checks", exact=True).fill("Also inspect Unicode: café 😀")
        questions.get_by_role("button", name="Submit answers").click()
        approval = page.get_by_role("region", name="Fresh action approval")
        expect(approval).to_be_visible()
        expect(approval.get_by_role("button", name="Approve once")).to_be_disabled()
        assert not any(path.endswith("/execute") for _, path, _ in requests)
        assert page.evaluate("window.__agent_injected || null") is None
        approval.get_by_role("checkbox").check()
        approval.get_by_role("button", name="Approve once").click()
        expect(approval.get_by_text("run_command · execution", exact=False)).to_be_visible()
        # The new action must require its OWN acknowledgement; a rapid second click/key-repeat
        # on the old control must not authorize it implicitly.
        expect(approval.get_by_role("button", name="Approve once")).to_be_disabled()
        expect(approval.get_by_role("checkbox")).not_to_be_checked()
        approval.get_by_role("checkbox").check()
        approval.get_by_role("button", name="Approve once").click()
        expect(page.get_by_text("Run finished · 3 model turns / 3 tools · 30 generated tokens", exact=True)).to_be_visible()
        assert len([1 for _, path, _ in requests if path.endswith("/execute")]) == 2
        assert page.evaluate("window.__agent_injected || null") is None
        page.get_by_label("Agent workspace request").fill("Now explain the result")
        page.get_by_role("button", name="Send · metered").click()
        expect(page.get_by_text("Run finished · 1 model turns / 0 tools · 10 generated tokens", exact=True)).to_be_visible()
        assert len([1 for _, path, _ in requests if path.endswith("/execute")]) == 2
        explorer = page.get_by_role("region", name="Agent project explorer")
        explorer.get_by_role("button", name="Inspect project files").click()
        explorer.get_by_role("button", name="main.py", exact=True).click()
        frame = page.frame_locator('iframe[title="Isolated source preview"]')
        expect(frame.locator("pre")).to_contain_text("<script>window.__agent_injected=1</script>")
        expect(frame.locator("script")).to_have_count(0)
        assert page.evaluate("window.__agent_injected || null") is None
        explorer.get_by_label("Select local UTF-8 project files · not uploaded yet").set_input_files([
            {"name": "a.txt", "mimeType": "text/plain", "buffer": "café 界\r\n".encode("utf-8")},
            {"name": "b.txt", "mimeType": "text/plain", "buffer": b"second"},
        ])
        upload = explorer.get_by_role("button", name="Approve this file upload once")
        expect(upload).to_be_disabled()
        assert not any(method == "PUT" for method, _, _ in requests)
        explorer.get_by_role("checkbox", name="I reviewed this exact path and contents.").check()
        upload.click()
        expect(explorer.get_by_text("Replace /workspace/b.txt.", exact=False)).to_be_visible()
        expect(upload).to_be_disabled()
        expect(explorer.get_by_role("checkbox")).not_to_be_checked()
        explorer.get_by_role("checkbox").check(); upload.click()
        expect(upload).not_to_be_visible()
        explorer.get_by_role("button", name="Inspect project files").click()
        expect(explorer.get_by_role("button", name="a.txt", exact=True)).to_be_visible()
        with page.expect_download() as downloading:
            explorer.get_by_role("button", name="Download bounded project + SHA-256 manifest").click()
        download = downloading.value
        download.save_as(str(directory / "project-artifact.json"))
        artifact = json.loads((directory / "project-artifact.json").read_text(encoding="utf-8"))
        for file in artifact["files"]:
            assert file["sha256"] == hashlib.sha256(file["text"].encode("utf-8")).hexdigest()
        page.get_by_role("button", name="New conversation", exact=True).click()
        page.get_by_role("button", name="Agent workspace mode").click()
        page.get_by_role("menuitemradio", name="Plan", exact=True).click()
        expect(explorer.get_by_role("button", name="a.txt", exact=True)).to_be_visible()
        # Account invalidation clears local state and discards, rather than showing old receipts.
        with page.expect_request(lambda request: request.method == "DELETE" and "/api/playground/sandbox/" in request.url):
            page.evaluate("localStorage.setItem('account_profile',JSON.stringify({email:'different@example.invalid'})); window.dispatchEvent(new Event('session-update'))")
        expect(page.get_by_text("Run finished · 3 model turns / 3 tools · 30 generated tokens", exact=True)).not_to_be_visible()
        expect(page.get_by_role("button", name="Start workspace", exact=True)).to_be_disabled()
        expect(explorer).not_to_be_visible()
        assert any(method == "DELETE" for method, _, _ in requests)
        assert errors == [], errors
        browser.close()
        print("PASS: mounted StrictMode questions/approvals/conversation, same-sandbox explorer, per-file import consent, SHA-256 artifact download, inert isolated source preview, retained project across mode reset and account-change discard. APIs/model are fixtures.")
finally:
    server.shutdown()
    server.server_close()
