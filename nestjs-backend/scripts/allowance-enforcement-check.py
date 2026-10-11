"""Live check: the AI allowance is enforced before the work, and the wallet is Spectre-only.

Two rules, both of which were previously decorative.

1. Enforcement. The RON allowance was checked only *after* a generation finished, when the
   usage report arrived. That is not enforcement -- it means the model ran at full cost and
   the balance was told afterwards. This check drains the allowance and then asserts the
   pre-flight refuses, rather than serving and billing.

   The interesting case is the one that is easy to get wrong: an account holding a wallet
   balance but no allowance must still be allowed, because the wallet is exactly what the
   allowance falls back onto. A gate that refused there would lock paying customers out.

2. Spectre-only top-ups. The wallet extends the AI allowance, and the Playground that
   spends it is MAX-and-up, so funding it on a lower plan takes money for a product the
   account cannot reach.
"""
import secrets
import subprocess
import time
import uuid

import requests

API = "http://localhost:4000"
WEB = "http://localhost:3000"
ORIGIN = "http://localhost:3000"
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


def session(tier="max", with_card=True):
    uniq = f"gate{secrets.token_hex(4)}"
    creds = {"username": uniq, "email": f"{uniq}@billing.test", "password": "LoadTest!2026x"}
    status = 0
    for attempt in range(1, 7):
        r = requests.post(f"{API}/api/auth/register", json=creds, timeout=60,
                          headers={"x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
        status = r.status_code
        if status == 201:
            break
        time.sleep(4 * attempt)
    if status != 201:
        raise SystemExit(f"register failed: HTTP {status}")

    email = creds["email"].replace("'", "''")
    psql(f"UPDATE accounts SET subscription = '{tier}' WHERE email = '{email}';")
    if with_card:
        psql(
            f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
            f"card_holder, card_last_four, is_default) "
            f"SELECT id, 'fixture', 'fixture', 'Load Test', '4242', TRUE FROM accounts "
            f"WHERE email = '{email}' AND NOT EXISTS (SELECT 1 FROM user_cards c "
            f"JOIN accounts a ON a.id = c.account_id WHERE a.email = '{email}' AND c.is_default);"
        )

    cookie = None
    for attempt in range(1, 7):
        r = requests.post(f"{API}/api/auth/login",
                          json={"email": creds["email"], "password": creds["password"]},
                          timeout=60,
                          headers={"x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
        raw = r.headers.get("set-cookie") or ""
        for part in raw.split(","):
            if part.strip().startswith("filspresso_session="):
                cookie = part.split(";")[0].strip()
        if cookie:
            break
        time.sleep(4 * attempt)
    if not cookie:
        raise SystemExit("login failed")
    return cookie, email


def allowance(cookie):
    r = requests.get(f"{API}/api/billing/allowance", headers={"cookie": cookie, "origin": ORIGIN}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"allowance read failed: HTTP {r.status_code}")
    return r.json()


def balance(cookie):
    r = requests.get(f"{API}/api/billing/balance", headers={"cookie": cookie, "origin": ORIGIN}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"balance read failed: HTTP {r.status_code} {r.text[:160]}")
    return r.json()


def drain_allowance(cookie):
    """Spend until *both* pots are empty.

    One big charge is not enough. The automatic refill sees the wallet at its floor and tops
    it straight back to 30, which is the system working exactly as designed -- so this loops
    until the allowance and the wallet are both spent. The refill has a one-minute circuit
    breaker, so the second charge within that window does not get topped up again.
    """
    last = None
    for _ in range(4):
        last = requests.post(f"{API}/api/billing/usage", timeout=60,
                             headers={"cookie": cookie, "origin": ORIGIN,
                                      "content-type": "application/json"},
                             json={"modelKey": "lfm2_5_8b_a1b_q4_k_m",
                                   "inputTokens": 100_000_000, "outputTokens": 0,
                                   "requestId": f"gate-{secrets.token_hex(5)}"})
        alw = allowance(cookie)
        bal = balance(cookie)
        if alw.get("remainingRon") == 0 and (bal.get("balanceRon") or 0) <= 0:
            return last
    return last


def preflight(cookie=None, fingerprint=None, scope="general"):
    body = {"dry_run": True, "scope": scope, "model_key": TEXT_MODEL}
    headers = {"origin": ORIGIN, "content-type": "application/json"}
    if cookie:
        headers["cookie"] = cookie
    if fingerprint:
        headers["x-kafelot-fingerprint"] = fingerprint
    return requests.post(f"{API}/api/kafelot/check-and-use", json=body, headers=headers, timeout=60)


def main():
    print("=== an account with money is allowed through the pre-flight ===")
    cookie, email = session(tier="max")
    r = preflight(cookie=cookie)
    check("allowed while the allowance is intact", r.status_code == 200,
          f"HTTP {r.status_code}")

    print("\n=== the allowance is refused BEFORE the generation, not after ===")
    drain_allowance(cookie)
    left = allowance(cookie)
    check("the allowance really is spent", left.get("remainingRon") == 0,
          f"remaining {left.get('remainingRon')}")
    # The wallet must be empty too, or this proves nothing.
    bal = balance(cookie)
    check("and the wallet is empty as well", (bal.get("balanceRon") or 0) <= 0,
          f"balance {bal.get('balanceRon')}")
    r = preflight(cookie=cookie)
    check("pre-flight refuses with 402", r.status_code == 402, f"HTTP {r.status_code}")
    body = r.json() if r.status_code == 402 else {}
    check("it says why", body.get("error") == "INSUFFICIENT_BALANCE", str(body.get("error")))
    check("it reports the remaining allowance", "allowance_remaining_ron" in body,
          str(body.get("allowance_remaining_ron")))
    check("it reports the wallet balance", "balance_ron" in body, str(body.get("balance_ron")))

    print("\n=== a wallet balance rescues an account with no allowance left ===")
    # The case that is easy to get wrong: refuse here and a paying customer is locked out of
    # a product they have already paid for, because their monthly allowance ran out.
    r = requests.post(f"{API}/api/billing/fund", timeout=60,
                      headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"amountRon": 20})
    check("a MAX account may fund the wallet", r.status_code in (200, 201),
          f"HTTP {r.status_code} {r.text[:90]}")
    if r.status_code in (200, 201):
        r = preflight(cookie=cookie)
        check("pre-flight allows again on the wallet", r.status_code == 200, f"HTTP {r.status_code}")

    print("\n=== anonymous callers are metered by fingerprint ===")
    fp = str(uuid.uuid4())
    r = preflight(fingerprint=fp)
    check("allowed with a fresh fingerprint", r.status_code == 200, f"HTTP {r.status_code}")
    requests.post(f"{API}/api/billing/usage", timeout=60,
                  headers={"x-kafelot-fingerprint": fp, "origin": ORIGIN,
                           "content-type": "application/json"},
                  json={"modelKey": "lfm2_5_8b_a1b_q4_k_m", "inputTokens": 100_000_000,
                        "outputTokens": 0, "requestId": f"gate-anon-{secrets.token_hex(5)}"})
    r = preflight(fingerprint=fp)
    check("refused once the anonymous allowance is gone", r.status_code == 402, f"HTTP {r.status_code}")

    print("\n=== the wallet is a Spectre feature ===")
    for tier, allowed in (("free", False), ("basic", False), ("plus", False),
                          ("pro", False), ("max", True), ("ultimate", True)):
        c, _ = session(tier=tier)
        r = requests.post(f"{API}/api/billing/fund", timeout=60,
                          headers={"cookie": c, "origin": ORIGIN, "content-type": "application/json"},
                          json={"amountRon": 10})
        got = r.status_code in (200, 201)
        check(f"{tier}: top-up {'allowed' if allowed else 'refused'}", got == allowed,
              f"HTTP {r.status_code}")
        if not allowed:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            detail = (body.get("details") or body)
            check(f"{tier}: refusal names the plan needed",
                  "SPECTRE" in str(detail).upper(), str(detail)[:90])

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())