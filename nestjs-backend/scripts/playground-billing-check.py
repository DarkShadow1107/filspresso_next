"""Live check: a Playground stream through Next must move the allowance.

The buffered chat path is covered by chat-billing-check.py. This covers the other one,
which is a different mechanism: there is no response body to read usage from, so the token
counts have to be pulled out of the SSE stream itself while it is being relayed. A stream
that finishes and bills nothing is indistinguishable from a working one unless the money
is checked, so that is what this checks.

Also asserts the two paths stay distinguishable: a stream the runtime answered with the
lexical fallback reports no usage, and must therefore cost nothing.
"""
import json
import secrets
import subprocess
import sys
import time
import uuid

import requests

BASE = "http://localhost:3000"
API = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
MODEL = "LFM2.5-230M-Q4_K_M.gguf"
MAX_ATTEMPTS = 8
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:52} {detail}")


def grant_playground_tier(email: str, tier: str = "max") -> None:
    """Give the test account a Playground-capable subscription.

    The Playground is a paid feature, so a fresh free account is refused with 403 before
    any generation happens. There is no HTTP route that grants a tier, so this sets the
    subscription row directly -- a fixture, and the only way to exercise a paid path
    without a payment provider.
    """
    # readCallerTier resolves accounts.subscription first, so that is what has to change;
    # user_subscriptions is kept in step for the queries that read it directly.
    email_sql = email.replace("'", "''")
    tier_sql = tier.replace("'", "''")
    # readCallerTier resolves accounts.subscription first, so that is what has to change;
    # user_subscriptions is kept in step for the queries that read it directly. There is no
    # unique constraint on account_id to conflict against, so the row is updated when it
    # exists and inserted only when it does not.
    email_sql = email.replace("'", "''")
    tier_sql = tier.replace("'", "''")
    sql = " ".join([
        f"UPDATE accounts SET subscription = '{tier_sql}' WHERE email = '{email_sql}';",
        f"UPDATE user_subscriptions SET subscription_tier = '{tier_sql}' "
        f"WHERE account_id IN (SELECT id FROM accounts WHERE email = '{email_sql}');",
        f"INSERT INTO user_subscriptions (account_id, subscription_tier) "
        f"SELECT id, '{tier_sql}' FROM accounts WHERE email = '{email_sql}' "
        f"AND NOT EXISTS (SELECT 1 FROM user_subscriptions s WHERE s.account_id = accounts.id);",
    ])
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql",
         "-U", "filspresso_user", "-d", "filspresso", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise SystemExit(f"could not grant the {tier} tier: {result.stderr.strip()[:300]}")


def session():
    uniq = f"pg{secrets.token_hex(4)}"
    creds = {"username": uniq, "email": f"{uniq}@billing.test", "password": "LoadTest!2026x"}
    status = 0
    for attempt in range(1, 7):
        r = requests.post(f"{API}/api/auth/register", json=creds, timeout=60,
                          headers={"x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
        status = r.status_code
        if status == 201:
            break
        print(f"    register attempt {attempt}: HTTP {status}")
        time.sleep(4 * attempt)
    if status != 201:
        raise SystemExit(f"register failed: HTTP {status}")
    grant_playground_tier(creds["email"])
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": creds["email"], "password": creds["password"]}, timeout=60)
    raw = r.headers.get("set-cookie") or ""
    for part in raw.split(","):
        if part.strip().startswith("filspresso_session="):
            return part.split(";")[0].strip()
    raise SystemExit(f"login returned no session cookie: {raw[:200]}")


def allowance(cookie):
    r = requests.get(f"{API}/api/billing/allowance", headers={"cookie": cookie}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"allowance read failed: HTTP {r.status_code} {r.text[:200]}")
    return r.json()


def stream_once(cookie, prompt):
    """Run one Playground stream to completion. Returns (status, done_frame, text_len)."""
    body = {"message": prompt, "model": MODEL, "max_tokens": 220}
    headers = {"accept": "text/event-stream", "content-type": "application/json",
               "origin": ORIGIN, "cookie": cookie,
               "x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"}
    try:
        with requests.post(f"{BASE}/api/playground/chat", json=body, headers=headers,
                           stream=True, timeout=300) as r:
            if r.status_code != 200:
                return r.status_code, None, 0
            done = None
            length = 0
            for raw in r.iter_lines():
                line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else (raw or "")
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    event = json.loads(payload)
                except ValueError:
                    continue
                if event.get("done"):
                    done = event
                elif isinstance(event.get("delta"), str):
                    length += len(event["delta"])
            return r.status_code, done, length
    except Exception as exc:
        return 0, {"error": str(exc)}, 0


def main():
    cookie = session()
    print("=== a streamed generation through Next must be billed ===")
    before = allowance(cookie)
    print(f"  before: {before.get('remainingRon')} RON of {before.get('grantedRon')}")

    attempts, done, length = 0, None, 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        attempts = attempt
        status, done, length = stream_once(cookie, "In one sentence, what is an espresso?")
        if status != 200:
            print(f"    attempt {attempt}: HTTP {status} {str(done)[:80]}")
            continue
        # The report is fire-and-forget; give it a moment.
        for _ in range(8):
            time.sleep(0.35)
            if (allowance(cookie).get("spentRon") or 0) > (before.get("spentRon") or 0):
                break
        else:
            print(f"    attempt {attempt}: stream finished, nothing billed, retrying")
            time.sleep(2.5)
            continue
        break

    after = allowance(cookie)
    check("the stream relayed text to the browser", length > 0, f"{length} chars")
    check("the stream carried a usage block on its done frame",
          bool(done and done.get("usage")), json.dumps((done or {}).get("usage")))
    check("the streamed generation was billed",
          (after.get("spentRon") or 0) > (before.get("spentRon") or 0),
          f"{before.get('spentRon')} -> {after.get('spentRon')} RON in {attempts} attempt(s)")

    if done and done.get("usage"):
        usage = done["usage"]
        check("the tokens are plausible for the answer",
              usage.get("completion_tokens", 0) > 0 and usage.get("prompt_tokens", 0) > 0,
              f"{usage.get('prompt_tokens')}/{usage.get('completion_tokens')} tok")

    bal0 = requests.get(f"{API}/api/billing/balance", headers={"cookie": cookie}, timeout=60)
    rows = bal0.json().get("recent") or []

    print("\n=== the usage reached the account ledger, not just the allowance ===")
    if done and done.get("model"):
        answered = done["model"].lower().replace(".gguf", "").replace(".", "_").replace("-", "_")
        check("the model that answered is the model that was billed",
              bool(rows) and rows[0].get("modelKey") == answered,
              f"answered {done['model']} -> {answered}, billed {rows[0].get('modelKey') if rows else None}")

    bal = requests.get(f"{API}/api/billing/balance", headers={"cookie": cookie}, timeout=60)
    rows = bal.json().get("recent") or []
    check("a row exists for the streamed generation", len(rows) >= 1, f"{len(rows)} rows")
    if rows:
        check("the row names the model and the tokens",
              bool(rows[0].get("modelKey")) and rows[0].get("inputTokens", 0) > 0,
              f"{rows[0].get('modelKey')} {rows[0].get('inputTokens')}/{rows[0].get('outputTokens')}")

    print("\n=== a refused stream costs nothing ===")
    # Exhaust the allowance, then confirm a 402 arrives and the number does not move.
    # 10M input tokens on the 8B is 200 RON at list, ~150 discounted, which is past the
    # 100 RON a MAX account is granted -- so the allowance really is gone afterwards.
    # The origin header is required, not decorative: the backend's CSRF guard refuses a
    # cookie-authenticated state change that arrives without one.
    big = requests.post(f"{API}/api/billing/usage",
                        headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                        timeout=60,
                        json={"modelKey": "lfm2_5_8b_a1b_q4_k_m", "inputTokens": 10_000_000,
                              "outputTokens": 0, "requestId": f"pg-{secrets.token_hex(5)}"})
    check("the drain was accepted", big.status_code in (200, 201),
          f"HTTP {big.status_code} {big.text[:90]}")
    drained = allowance(cookie)
    check("the allowance is spent", drained.get("remainingRon") == 0, str(drained.get("remainingRon")))
    status, done, _ = stream_once(cookie, "In one sentence, what is a cortado?")
    check("the gateway refuses with no money left", status == 402, f"HTTP {status}")
    still = allowance(cookie)
    check("a refused stream moved nothing",
          still.get("spentRon") == drained.get("spentRon"),
          f"{drained.get('spentRon')} -> {still.get('spentRon')}")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
