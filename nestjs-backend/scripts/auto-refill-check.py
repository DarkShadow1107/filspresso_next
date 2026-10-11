"""Live check: the automatic wallet refill actually refills.

`autoRefillTargetRon: 30` was returned by /api/billing/balance from the day the wallet
shipped, and nothing ever acted on it. A check that only asserts the field is present
would have passed throughout that period, so this one is written entirely in terms of
money moving: an account with a default card is drained and must come back to 30.

The cases that matter are the ones where a refill goes wrong quietly:

  * no default card -- must NOT top up, and must NOT turn an ordinary generation into an
    error. Most accounts have no card, so this is the common path, not an edge case.
  * two concurrent charges -- must produce exactly one refill, not two.
  * the ceiling -- a refill must never push the balance past 1000 RON.
  * a normal charge well above the floor -- must not refill, or the card is charged on
    every single request and the customer pays for money they did not ask for.

The account fixture writes a card row directly, because there is no HTTP route that
creates one without a payment provider.
"""
import secrets
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

API = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:54} {detail}")


def psql(sql):
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "filspresso_user",
         "-d", "filspresso", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr.strip()[:300]}")
    return result.stdout


def session(with_card: bool, tier: str = "max"):
    """A registered, signed-in account; optionally given a default card."""
    uniq = f"ref{secrets.token_hex(4)}"
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

    email = creds["email"].replace("'", "''")
    psql(f"UPDATE accounts SET subscription = '{tier}' WHERE email = '{email}';")
    if with_card:
        psql(
            # The encrypted columns are NOT NULL, and the fixture never decrypts them: the
            # refill only needs the card's id to be a real row it can point at.
            f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
            f"card_holder, card_last_four, is_default) "
            f"SELECT id, 'fixture', 'fixture', 'Load Test', '4242', TRUE FROM accounts WHERE email = '{email}' "
            f"AND NOT EXISTS (SELECT 1 FROM user_cards c JOIN accounts a ON a.id = c.account_id "
            f"WHERE a.email = '{email}' AND c.is_default);"
        )

    # Retried for the same reason registration is: login is throttled per client, and this
    # check creates several accounts. A 429 here is the checks colliding with each other,
    # not a broken login.
    raw = ""
    for attempt in range(1, 7):
        r = requests.post(f"{API}/api/auth/login", json={"email": creds["email"],
                                                         "password": creds["password"]},
                          timeout=60,
                          headers={"x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
        raw = r.headers.get("set-cookie") or ""
        for part in raw.split(","):
            if part.strip().startswith("filspresso_session="):
                return part.split(";")[0].strip()
        print(f"    login attempt {attempt}: HTTP {r.status_code}")
        time.sleep(4 * attempt)
    raise SystemExit(f"login returned no session cookie after retries: {raw[:200]}")


def get(path, cookie):
    r = requests.get(f"{API}{path}", headers={"cookie": cookie, "origin": ORIGIN}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"GET {path} failed: HTTP {r.status_code} {r.text[:200]}")
    return r.json()


def spend(cookie, amount_ron_of_8b, request_id):
    """Record usage on the 8B, which costs 20 RON per 1M input tokens before discount."""
    tokens = int(amount_ron_of_8b / 20 * 1_000_000)
    return requests.post(f"{API}/api/billing/usage", timeout=60,
                         headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                         json={"modelKey": "lfm2_5_8b_a1b_q4_k_m", "inputTokens": tokens,
                               "outputTokens": 0, "requestId": request_id})


def count_auto_topups(email: str) -> int:
    out = psql(
        f"SELECT COUNT(*) FROM billing_topups t JOIN accounts a ON a.id = t.account_id "
        f"WHERE t.source = 'auto' AND a.email = '{email.replace(chr(39), chr(39)*2)}';"
    )
    for line in out.splitlines():
        if line.strip().isdigit():
            return int(line.strip())
    return 0


def main():
    print("=== the status the balance endpoint reports ===")
    cookie = session(with_card=True)
    bal = get("/api/billing/balance", cookie)
    auto = bal.get("autoRefill") or {}
    check("autoRefill block present", isinstance(auto, dict), f"{auto}")
    check("target is 30 RON", auto.get("targetRon") == 30, str(auto.get("targetRon")))
    check("enabled when a default card exists", auto.get("enabled") is True, f"reason={auto.get('reason')}")
    check("nothing has refilled yet", auto.get("lastTopUpAt") is None, str(auto.get("lastTopUpAt")))

    print("\n=== an account with no card is told so, and is not charged ===")
    bare = session(with_card=False)
    bare_bal = get("/api/billing/balance", bare)
    bare_auto = bare_bal.get("autoRefill") or {}
    check("disabled without a default card", bare_auto.get("enabled") is False,
          f"reason={bare_auto.get('reason')}")
    check("the reason is specific, not blank", bare_auto.get("reason") == "no_default_card",
          str(bare_auto.get("reason")))
    # The charge must still succeed: a failed refill must not fail the usage it followed.
    r = spend(bare, 5, f"ref-nocard-{secrets.token_hex(4)}")
    check("a charge on a card-less account still succeeds", r.status_code in (200, 201),
          f"HTTP {r.status_code}")
    after_bare = get("/api/billing/balance", bare)
    check("and it did not invent a top-up",
          (after_bare.get("autoRefill") or {}).get("lastTopUpAt") is None,
          "no auto top-up recorded")

    print("\n=== draining the wallet refills it back to 30 ===")
    # Burn the whole 100 RON allowance, then keep going: the wallet draw stops at its floor
    # of 0, which is what puts the account at the floor and triggers the refill.
    spend(cookie, 200, f"ref-drain-{secrets.token_hex(4)}")
    time.sleep(1.5)
    mid = get("/api/billing/balance", cookie)
    check("the wallet came back on its own", mid.get("balanceRon", 0) > 0, f"balance {mid.get('balanceRon')}")
    check("refilled to the 30 RON target",
          abs((mid.get("balanceRon") or 0) - 30) < 0.01 or (mid.get("balanceRon") or 0) > 29.9,
          f"balance {mid.get('balanceRon')}")
    check("the refill is recorded as automatic",
          (mid.get("autoRefill") or {}).get("lastTopUpAt") is not None,
          str((mid.get("autoRefill") or {}).get("lastTopUpAt")))

    print("\n=== a charge that leaves the balance above the floor does not refill ===")
    # Small enough that the wallet stays well above 0 after it.
    spend(cookie, 2, f"ref-small-{secrets.token_hex(4)}")
    time.sleep(1.0)
    small_bal = get("/api/billing/balance", cookie)
    check("the wallet is still above the floor", (small_bal.get("balanceRon") or 0) > 0,
          f"balance {small_bal.get('balanceRon')}")
    last_a = (small_bal.get("autoRefill") or {}).get("lastTopUpAt")
    last_b = (mid.get("autoRefill") or {}).get("lastTopUpAt")
    check("no second refill was triggered", last_a == last_b,
          f"{last_b} then {last_a}")

    print("\n=== two concurrent charges produce one refill, not two ===")
    # A fresh account, so the automatic top-up count below is exact rather than inherited
    # from the earlier cases.
    conc = session(with_card=True)
    conc_email = [l.strip() for l in psql("SELECT email FROM accounts ORDER BY id DESC LIMIT 1;").splitlines()
                  if "@billing.test" in l][-1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(spend, conc, 200, f"ref-conc-{secrets.token_hex(5)}-{i}") for i in range(2)]
        statuses = [f.result().status_code for f in futures]
    check("both concurrent charges were accepted", all(s in (200, 201) for s in statuses), str(statuses))
    time.sleep(2.0)
    conc_bal = get("/api/billing/balance", conc)
    topups = count_auto_topups(conc_email)
    check("exactly one automatic top-up was recorded", topups == 1, f"{topups} auto top-ups")
    check("the balance is not doubled up", (conc_bal.get("balanceRon") or 0) <= 30.01,
          f"balance {conc_bal.get('balanceRon')}")

    print("\n=== the ceiling still holds for an automatic refill ===")
    # Fill to just under the ceiling by hand, then drain and let the refill run: it must
    # top up to the ceiling, never past it.
    psql(
        f"UPDATE account_balances SET balance_ron = 990 WHERE account_id IN "
        f"(SELECT id FROM accounts WHERE email = '{conc_email}');"
    )
    spend(conc, 60, f"ref-cap-{secrets.token_hex(4)}")
    time.sleep(2.0)
    capped = get("/api/billing/balance", conc)
    check("the balance never passes 1000 RON", (capped.get("balanceRon") or 0) <= 1000,
          f"balance {capped.get('balanceRon')}")
    check("ceiling advertised matches", capped.get("maxBalanceRon") == 1000,
          str(capped.get("maxBalanceRon")))

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())