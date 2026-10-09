"""End-to-end: a real chat through Next must move the allowance.

This is the check that matters most, because it is the only one that proves the chain is
joined: browser -> Next /api/python-chat -> AI gateway -> usage block -> Next reports it ->
NestJS bills it -> the allowance falls. Every other check tests one link.

Two things about this environment shape the test:

  * /api/python-chat speaks multipart, not JSON. The route calls request.formData(), so a
    JSON body parses to no fields and the gateway answers "No data provided".
  * Each GGUF runs with a concurrency of 1 and a bounded queue, so a chat arriving while
    the model is busy is answered by the lexical fallback with zero tokens. That is a
    correct answer that correctly costs nothing, so it would look like a metering failure
    if the test only tried once. It retries until a real generation is billed.

Reading the allowance before and after means any missing link fails the same way -- with
"the allowance did not move".
"""
import json
import secrets
import time

import requests

BASE = "http://localhost:3000"          # Next, not the backend: the point is the proxy.
API = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
TEXT_MODEL = "LFM2.5-230M-Q4_K_M.gguf"
MAX_ATTEMPTS = 8
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:52} {detail}")


def session():
    """Register and sign in, retrying the registration throttle.

    The throttle is per client, and the other live checks in this directory create accounts
    too, so a 429 here means "this test collided with itself", not "the product is broken".
    Each attempt claims a different client address.
    """
    uniq = f"e2e{secrets.token_hex(4)}"
    creds = {"username": uniq, "email": f"{uniq}@billing.test", "password": "LoadTest!2026x"}
    last = ""
    for attempt in range(1, 7):
        ip = f"198.51.100.{secrets.randbelow(250) + 1}"
        r = requests.post(f"{API}/api/auth/register", json=creds, timeout=60,
                          headers={"x-forwarded-for": ip})
        if r.status_code == 201:
            break
        last = f"HTTP {r.status_code} {r.text[:120]}"
        print(f"    register attempt {attempt}: {last}")
        time.sleep(4 * attempt)
    else:
        raise SystemExit(f"register failed after retries: {last}")

    r = requests.post(f"{API}/api/auth/login",
                      json={"email": creds["email"], "password": creds["password"]}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"login failed: HTTP {r.status_code} {r.text[:200]}")
    raw = r.headers.get("set-cookie") or ""
    for part in raw.split(","):
        if part.strip().startswith("filspresso_session="):
            return part.split(";")[0].strip()
    raise SystemExit(f"login returned no session cookie: {raw[:200]}")


def allowance(cookie=None, fingerprint=None):
    """Remaining and spent, as the customer would see them.

    A non-200 is raised, never smoothed over. Treating an error response as "0 spent" is
    how a broken read turns into a green run: the billing checks would see no charge and
    could not tell that apart from a working zero.
    """
    if cookie:
        r = requests.get(f"{API}/api/billing/allowance", headers={"cookie": cookie}, timeout=60)
    else:
        r = requests.get(f"{API}/api/billing/allowance/anonymous",
                         headers={"x-kafelot-fingerprint": fingerprint}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"allowance read failed: HTTP {r.status_code} {r.text[:200]}")
    return r.json()


def chat(prompt, cookie=None, fingerprint=None):
    """One chat through Next. Returns (status, body)."""
    files = {
        "messages": (None, json.dumps([{"role": "user", "content": prompt}])),
        "mode": (None, "general"),
        "model": (None, "tanka_chat"),
        "text_model": (None, TEXT_MODEL),
    }
    headers = {"accept": "application/json", "origin": ORIGIN,
               "x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"}
    if fingerprint:
        headers["x-kafelot-fingerprint"] = fingerprint
    # The raw header, because the value already carries the cookie's name.
    if cookie:
        headers["cookie"] = cookie
    try:
        r = requests.post(f"{BASE}/api/python-chat", files=files, headers=headers, timeout=300)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, {"raw": r.text[:200]}
    except Exception as exc:
        return 0, {"error": str(exc)}


def spent_now(read):
    return read.get("spentRon") or 0


def charge_via_chat(cookie, fingerprint, prompt, label):
    """Chat until one is actually billed. Returns (attempts, model_used)."""
    read = (lambda: allowance(cookie=cookie)) if cookie else (lambda: allowance(fingerprint=fingerprint))
    start = spent_now(read())
    model_used = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        status, body = chat(prompt, cookie=cookie, fingerprint=fingerprint)
        model_used = body.get("model_used", "") or model_used
        if status != 200:
            print(f"    attempt {attempt}: HTTP {status} {str(body)[:90]}")
        # The report is fire-and-forget, so allow it to land.
        for _ in range(8):
            time.sleep(0.35)
            if spent_now(read()) > start:
                return attempt, model_used
        print(f"    attempt {attempt}: answered by '{model_used}', nothing billed, retrying")
        time.sleep(2.5)
    return MAX_ATTEMPTS, model_used


def main():
    print("=== anonymous: a chat through Next must spend the fingerprint allowance ===")
    import uuid
    fp = str(uuid.uuid4())
    before = allowance(fingerprint=fp)
    print(f"  before: {before.get('remainingRon')} RON of {before.get('grantedRon')}")

    attempts, model_used = charge_via_chat(None, fp, "In one sentence, what is an espresso?", "anon")
    after = allowance(fingerprint=fp)
    check("a chat through Next was billed", spent_now(after) > spent_now(before),
          f"{spent_now(before)} -> {spent_now(after)} RON in {attempts} attempt(s)")
    check("remaining equals granted minus spent",
          abs((before.get("grantedRon", 0) - spent_now(after)) - after.get("remainingRon", 0)) < 1e-6,
          f"remaining {after.get('remainingRon')}")
    check("a zero-token fallback is never billed",
          all(a.get("spentRon", 0) <= a.get("grantedRon", 0) for a in [after]),
          "spent never exceeds granted")

    print("\n=== a signed-in subscriber: same chain ===")
    cookie = session()
    print(f"  signed in, session cookie {len(cookie)} chars")
    sub_before = allowance(cookie=cookie)
    print(f"  before: {sub_before.get('remainingRon')} RON of {sub_before.get('grantedRon')}")

    attempts, model_used = charge_via_chat(cookie, fp, "In one sentence, what is a ristretto?", "sub")
    sub_after = allowance(cookie=cookie)
    check("a subscriber chat was billed", spent_now(sub_after) > spent_now(sub_before),
          f"{spent_now(sub_before)} -> {spent_now(sub_after)} RON in {attempts} attempt(s)")

    print("\n=== a second chat charges again, so the first was not a fluke ===")
    third = spent_now(sub_after)
    attempts, _ = charge_via_chat(cookie, fp, "In one sentence, what is a doppio?", "sub2")
    fourth = spent_now(allowance(cookie=cookie))
    check("the next chat is charged on top", fourth > third, f"{third} -> {fourth} RON")

    print("\n=== the usage is on the account's ledger ===")
    bal = requests.get(f"{API}/api/billing/balance", headers={"cookie": cookie}, timeout=60)
    if bal.status_code != 200:
        raise SystemExit(f"balance read failed: HTTP {bal.status_code} {bal.text[:200]}")
    rows = bal.json().get("recent") or []
    check("usage rows recorded", len(rows) >= 2, f"{len(rows)} rows")
    if rows:
        r0 = rows[0]
        check("the row names the model and the tokens",
              bool(r0.get("modelKey")) and r0.get("inputTokens", 0) > 0 and r0.get("outputTokens", 0) > 0,
              f"{r0.get('modelKey')} {r0.get('inputTokens')}/{r0.get('outputTokens')} tok")

    print("\n=== an anonymous row is not attached to any account ===")
    acc_rows = requests.get(f"{API}/api/billing/balance", headers={"cookie": cookie},
                            timeout=60).json().get("recentAnonymous") or []
    check("the anonymous ledger is separate from the subscriber's", len(acc_rows) == 0,
          f"{len(acc_rows)} anonymous rows on a subscriber account")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
