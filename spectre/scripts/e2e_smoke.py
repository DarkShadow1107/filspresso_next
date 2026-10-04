"""End-to-end API smoke test against the live local stack.

Run: python scripts/e2e_smoke.py
Requires the compose stack on https://127.0.0.1:8080.
"""

import http.cookiejar
import json
import ssl
import time
import urllib.error
import urllib.request

BASE = "https://127.0.0.1:8080/api/v1"
PASSWORD = "CorrectHorseBatteryStaple!42"


def main() -> None:
    context = ssl._create_unverified_context()
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=context),
    )

    def request(path, method="GET", payload=None, headers=None):
        merged = {"Content-Type": "application/json", **(headers or {})}
        token = next((c.value for c in jar if c.name == "sf_csrf"), None)
        if method in {"POST", "PUT", "PATCH", "DELETE"} and token:
            merged.setdefault("X-CSRF-Token", token)
        req = urllib.request.Request(
            BASE + path,
            method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers=merged,
        )
        return opener.open(req, timeout=90)

    def csrf():
        return next(c.value for c in jar if c.name == "sf_csrf")

    email = f"e2e-{int(time.time())}@example.com"
    request(
        "/auth/register",
        "POST",
        {"display_name": "E2E", "email": email, "password": PASSWORD},
    )
    org = json.load(request("/organizations"))[0]
    oid = org["id"]

    case = json.load(
        request(
            f"/organizations/{oid}/cases",
            "POST",
            {
                "title": "Console validation",
                "question": "Validate the live agent console end to end.",
                "agent_settings": {"profile": "deep"},
            },
        )
    )
    assert case["agent_settings"].get("profile") == "deep", case["agent_settings"]
    assert case["agent_settings"]["max_sources"] == 12

    run = json.load(request(f"/organizations/{oid}/cases/{case['id']}/runs", "POST"))
    rid = run["id"]
    print("run:", run["status"], run["settings"]["profile"], run["budget"])

    time.sleep(8)
    tasks = json.load(request(f"/organizations/{oid}/runs/{rid}/tasks"))
    events = json.load(request(f"/organizations/{oid}/runs/{rid}/events"))
    print("tasks:", [(t["agent_name"], t["status"]) for t in tasks])
    print("events:", len(events), [e["event_type"] for e in events][:6])

    cancelled = json.load(request(f"/organizations/{oid}/runs/{rid}/cancel", "POST"))
    print("cancel:", cancelled["status"], cancelled["current_stage"])

    boundary = "----sfboundary"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="note.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "SentinelForge memory probe with enough unique body text to chunk properly today.\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    upload_request = urllib.request.Request(
        f"{BASE}/organizations/{oid}/documents",
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-CSRF-Token": csrf(),
        },
    )
    document = json.loads(opener.open(upload_request, timeout=120).read())
    print("document:", document["kind"], document["chunks_embedded"])

    hits = json.load(request(f"/organizations/{oid}/retrieve?query=memory+probe"))
    print("retrieve hits:", len(hits["hits"]))

    sources = json.load(request(f"/organizations/{oid}/sources"))
    ours = next(s for s in sources if s["version_id"] == document["version_id"])
    print("source tier/chunks:", ours["tier"], ours["chunks"], ours["embedded"])

    proposal = json.load(
        request(
            f"/organizations/{oid}/sandbox/proposals",
            "POST",
            {
                "title": "Unit probe",
                "purpose": "smoke test",
                "code": "import statistics\nresult = {'ok': True}",
                "input_json": {},
            },
            {"X-CSRF-Token": csrf()},
        )
    )
    approved = json.load(
        request(
            f"/organizations/{oid}/sandbox/proposals/{proposal['id']}/approve",
            "POST",
            {},
            {"X-CSRF-Token": csrf()},
        )
    )
    assert approved["status"] == "executed", approved
    assert approved["result_payload"]["exit_code"] == 0
    print("proposal executed:", approved["result_payload"]["output_json"])

    deleted = json.load(
        request("/auth/account", "DELETE", {"password": PASSWORD}, {"X-CSRF-Token": csrf()})
    )
    print("account:", deleted["detail"][:60])

    try:
        request("/auth/me")
    except urllib.error.HTTPError as error:
        assert error.code == 401
        print("post-delete /auth/me -> 401 OK")


if __name__ == "__main__":
    main()
