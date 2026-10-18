"""End-to-end check for the desktop client's Phase 0 surface.

Three endpoints, in the order the app will actually call them:

1. POST /api/auth/desktop/token   -- the credential a native client cannot otherwise get
2. GET  /api/desktop/entitlement  -- one call for access + allowance + affordability
3. POST /api/desktop/chat/stream  -- metered inference, gated before the model loads

The point of the checks is that the *money* is right, not that the endpoints answer 200. A
gateway that streams a perfect answer while billing it to nobody looks identical from the
client's side, which is why every assertion below is phrased against the ledger.

Also asserted, because each was a real defect while this was being built:
  - an unknown scope on the usage endpoint is refused rather than silently billed as kafelot
  - a replayed refresh token kills the session instead of minting a second one
  - the money gate refuses before the model is asked to do anything
"""
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "http://localhost:4000"
TEXT_MODEL = "lfm2_5_230m_q4_k_m"
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:54} {detail}")


def psql(sql):
    r = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "filspresso_user",
         "-d", "filspresso", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise SystemExit(f"psql failed: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def call(path, body=None, token=None, method="POST", raw=False):
    data = json.dumps(body).encode() if body is not None else None
    # A distinct forwarded address per run. The per-IP auth budgets are real controls and are
    # left at their production values; sharing loopback with every other local process means
    # one of them spending the budget fails this suite for no reason of its own. The existing
    # check scripts already do this.
    req = urllib.request.Request(API + path, method=method, data=data,
                                 headers={"Content-Type": "application/json",
                                          "x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = r.read().decode()
            return r.status, (payload if raw else json.loads(payload or "{}")), dict(r.headers)
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        try:
            parsed = payload if raw else json.loads(payload or "{}")
        except Exception:
            parsed = {"raw": payload[:300]}
        return e.code, parsed, dict(e.headers)
    except Exception as e:  # connection refused while a container is restarting
        return 0, {"error": str(e)}, {}


# One account for the whole check, reused across runs.
#
# `POST /api/auth/register` is capped at 5 per hour per IP, which is a real anti-abuse control
# and not something a test should be relaxing. A check that registered a fresh account every
# run therefore exhausted that cap partway through a full suite sweep and then failed on
# "register failed" -- a self-inflicted flake that has nothing to do with the code under test.
#
# So: try to register, and if the limiter says no, sign in with the same fixed credentials.
# State from a previous run is cleared first, so the checks mean the same thing every time
# instead of depending on a clean database.
FIXTURE_EMAIL = "desktop-phase0-check@billing.test"
FIXTURE_PASSWORD = "LoadTest!2026x"


def ensure_account():
    psql(
        f"INSERT INTO accounts (username, email, password_hash, name, role, subscription) "
        f"SELECT 'desktop_phase0_check', '{FIXTURE_EMAIL}', "
        f"(SELECT password_hash FROM accounts WHERE email <> '{FIXTURE_EMAIL}' LIMIT 1), "
        f"'Desktop Phase0 Check', 'user', 'free' "
        f"WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email = '{FIXTURE_EMAIL}');")

    # Clear anything a previous run left behind, so each run starts from the same place.
    account = psql(f"SELECT id FROM accounts WHERE email = '{FIXTURE_EMAIL}';")
    psql(f"DELETE FROM account_addons WHERE account_id = {account};")
    psql(f"DELETE FROM ai_token_usage WHERE account_id = {account};")
    psql(f"DELETE FROM user_sessions WHERE account_id = {account};")
    psql(f"DELETE FROM subscription_payments WHERE account_id = {account};")

    # A default card, because buying the add-on needs one. Kept clear of `card_id % 10 == 7`,
    # which the simulated provider declines: that test keys on the row id rather than the card
    # number, so without this the suite passes or fails on how many cards came before it.
    while True:
        psql(
            f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
            f"card_holder, card_last_four, is_default) "
            f"SELECT id, 'fixture', 'fixture', 'Load Test', '4242', TRUE FROM accounts "
            f"WHERE email = '{FIXTURE_EMAIL}' AND NOT EXISTS (SELECT 1 FROM user_cards c "
            f"JOIN accounts a ON a.id = c.account_id WHERE a.email = '{FIXTURE_EMAIL}' AND c.is_default);")
        card_id = psql(
            f"SELECT id FROM user_cards WHERE account_id = {account} ORDER BY id DESC LIMIT 1;")
        if card_id and int(card_id) % 10 != 7:
            break

    return {"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD}


def grant(creds, device_id):
    return call("/api/auth/desktop/token", {
        "email": creds["email"], "password": creds["password"],
        "deviceId": device_id, "deviceName": "Phase0 Check", "platform": "windows",
        "appVersion": "0.1.0",
    })


def main():
    print("=== 1. the device grant ===")
    creds = ensure_account()
    status, body, _ = grant(creds, "win11pro-phase0check01")
    check("a native client can obtain a credential", status == 200, f"HTTP {status}")
    token = body.get("accessToken")
    refresh = body.get("refreshToken")
    check("the access token is in the body", bool(token))
    check("and a refresh credential with it", bool(refresh))
    check("the access token's lifetime is reported", int(body.get("expiresIn") or 0) > 0,
          f"{body.get('expiresIn')}s")
    check("no cookie is set", "set-cookie" not in {k.lower() for k in _ or {}}, "no Set-Cookie header")

    session_id = psql(
        f"SELECT id FROM user_sessions WHERE account_id = "
        f"(SELECT id FROM accounts WHERE email = '{creds['email']}') AND client_type = 'desktop';")
    check("the session is recorded as a desktop device", bool(session_id), f"session {session_id}")
    check("and it carries the device name", psql(
        f"SELECT device_name FROM user_sessions WHERE id = {session_id};") == "Phase0 Check")
    check("the refresh credential is stored hashed, not in the clear", psql(
        f"SELECT count(*) FROM user_sessions WHERE id = {session_id} AND refresh_token_hash = '{refresh}';") == "0")

    print("\n=== 2. refresh rotates, and a replay kills the session ===")
    status, rotated, _ = call("/api/auth/desktop/refresh", {"refreshToken": refresh})
    check("refresh succeeds", status == 200, f"HTTP {status}")
    check("it returns a different credential", rotated.get("refreshToken") != refresh)
    status, _, _ = call("/api/auth/desktop/refresh", {"refreshToken": refresh})
    check("replaying the spent token is refused", status == 401, f"HTTP {status}")
    status, _, _ = call("/api/auth/desktop/refresh", {"refreshToken": rotated.get("refreshToken", "")})
    check("and the session it named is gone", status == 401, f"HTTP {status}")

    print("\n=== 3. entitlement, in one call ===")
    status, ent, _ = call("/api/desktop/entitlement", token=token, method="GET")
    check("the endpoint answers", status == 200, f"HTTP {status}")
    check("it reports access", "access" in ent and ent["access"]["hasAccess"] is False,
          f"hasAccess={ent.get('access', {}).get('hasAccess')}")
    check("it reports the allowance", "allowance" in ent,
          f"remaining={ent.get('allowance', {}).get('remainingRon')}")
    check("it reports the wallet", "wallet" in ent,
          f"balance={ent.get('wallet', {}).get('balanceRon')}")
    check("and whether the account can generate", "canGenerate" in ent)
    models = ent.get("models") or []
    check("it offers exactly the six text models", len(models) == 6, f"{len(models)} models")
    check("no vision or audio model is offered",
          all("vl_" not in m["modelKey"] and "audio" not in m["modelKey"] for m in models))
    check("locked models still carry a price", all(m.get("inputPer1M") for m in models))

    print("\n=== 4. the gate refuses before the model loads ===")
    status, body, _ = call("/api/desktop/chat/stream",
                           {"message": "hello", "model": TEXT_MODEL}, token=token)
    check("an account without the Playground is refused", status == 403, f"HTTP {status} {body.get('error')}")
    check("with the reason named", body.get("error") == "PLAYGROUND_LOCKED", str(body.get("error")))
    check("and nothing was metered", psql(
        f"SELECT count(*) FROM ai_token_usage WHERE account_id = "
        f"(SELECT id FROM accounts WHERE email = '{creds['email']}');") == "0")

    status, body, _ = call("/api/desktop/chat/stream", {"message": "hi", "model": "nope"}, token=token)
    check("an unknown model is refused", status == 400, f"HTTP {status} {body.get('error')}")

    print("\n=== 5. the gate answers 401 without a credential ===")
    for label, tok in (("no token", None), ("a garbage token", "not-a-jwt")):
        status, _, _ = call("/api/desktop/chat/stream", {"message": "hi", "model": TEXT_MODEL}, token=tok)
        check(f"{label} is refused", status == 401, f"HTTP {status}")

    print("\n=== 6. a real subscription streams, and is metered ===")
    status, _, _ = call("/api/spectre/subscribe", {"billingCycle": "monthly"}, token=token)
    check("the add-on can be bought with the desktop token", status in (200, 201), f"HTTP {status}")

    status, fund, _ = call("/api/billing/fund", {"amountRon": 20}, token=token)
    check("the wallet can be funded", status in (200, 201), f"HTTP {status} {str(fund)[:80]}")

    status, raw, headers = call("/api/desktop/chat/stream",
                                {"message": "Reply with the single word: ready.",
                                 "model": TEXT_MODEL, "max_tokens": 32},
                                token=token, raw=True)
    check("the stream is served", status == 200, f"HTTP {status}")
    check("it is an event stream", "text/event-stream" in str(headers.get("Content-Type", "")),
          str(headers.get("Content-Type")))
    check("the response carries an idempotency key", bool(headers.get("x-filspresso-request-id")),
          str(headers.get("x-filspresso-request-id")))
    check("tokens came back", '"delta"' in raw, f"{len(raw)} bytes")
    check("and a done frame closed it", '"done"' in raw)

    # Give the metering a moment; it is awaited before the response ends, but the HTTP
    # response can complete a beat earlier than the ledger write on a slow database.
    usage = ""
    for _ in range(20):
        usage = psql(
            f"SELECT COALESCE(scope,'-')||'|'||COALESCE(price_mode,'-')||'|'||COALESCE(bill_from,'-') "
            f"FROM ai_token_usage WHERE account_id = "
            f"(SELECT id FROM accounts WHERE email = '{creds['email']}') ORDER BY id DESC LIMIT 1;")
        if usage:
            break
        time.sleep(1)

    check("the generation was metered", bool(usage), usage or "no ledger row")
    parts = (usage.split("|") + ["-", "-", "-"])[:3]
    check("under the desktop scope", parts[0] == "desktop", usage)
    check("at the Playground rate", parts[1] == "playground", usage)
    check("billed to the wallet, since the add-on includes no usage",
          parts[2] == "wallet_only", usage)
    request_id = headers.get("x-filspresso-request-id")
    check("with the same request id the client was given", psql(
        f"SELECT count(*) FROM ai_token_usage WHERE request_id = '{request_id}';") == "1",
        f"request_id={request_id}")

    print("\n=== 7. the usage endpoint no longer under-bills an unknown scope ===")
    status, body, _ = call("/api/billing/usage",
                           {"modelKey": TEXT_MODEL, "inputTokens": 1, "outputTokens": 0,
                            "scope": "definitely-not-a-scope"}, token=token)
    check("an unknown scope is refused", status == 400, f"HTTP {status} {body.get('error')}")
    status, body, _ = call("/api/billing/usage",
                           {"modelKey": TEXT_MODEL, "inputTokens": 1, "outputTokens": 0,
                            "scope": "desktop"}, token=token)
    check("the desktop scope is accepted", status in (200, 201), f"HTTP {status}")
    check("and billed as playground, not as the cheaper kafelot rate", psql(
        f"SELECT price_mode FROM ai_token_usage WHERE account_id = "
        f"(SELECT id FROM accounts WHERE email = '{creds['email']}') ORDER BY id DESC LIMIT 1;")
        == "playground")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())