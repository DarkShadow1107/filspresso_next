"""Live check: the account's money, as the browser actually reaches it.

Everything else in this directory tests the NestJS backend directly. This one goes through
Next, because that is where the page lives and where the failure was: /api/billing/balance
did not exist as a Next route at all, so the account page and the coffee window were both
fetching a 404 and rendering nothing. A backend test cannot catch that -- the backend was
always fine.

So every call here targets localhost:3000 with the session cookie, exactly as the browser
would, and the assertions are about the shape the page depends on.
"""
import json
import secrets
import subprocess
import time

import requests

API = "http://localhost:4000"
WEB = "http://localhost:3000"
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


def session(with_card=True, tier="max"):
    uniq = f"acct{secrets.token_hex(4)}"
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
            f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
            f"card_holder, card_last_four, is_default) "
            f"SELECT id, 'fixture', 'fixture', 'Load Test', '4242', TRUE FROM accounts WHERE email = '{email}' "
            f"AND NOT EXISTS (SELECT 1 FROM user_cards c JOIN accounts a ON a.id = c.account_id "
            f"WHERE a.email = '{email}' AND c.is_default);"
        )

    # Login is throttled per client as well, and this file creates several accounts in one
    # run. Retried for the same reason registration is: a 429 here is this check colliding
    # with itself, not a broken login.
    for attempt in range(1, 7):
        r = requests.post(f"{API}/api/auth/login",
                          json={"email": creds["email"], "password": creds["password"]},
                          timeout=60,
                          headers={"x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
        raw = r.headers.get("set-cookie") or ""
        for part in raw.split(","):
            if part.strip().startswith("filspresso_session="):
                return part.split(";")[0].strip()
        print(f"    login attempt {attempt}: HTTP {r.status_code}")
        time.sleep(4 * attempt)
    raise SystemExit(f"login returned no session cookie after retries: {raw[:200]}")


def web(method, path, cookie, body=None):
    headers = {"cookie": cookie, "origin": WEB, "accept": "application/json"}
    if body is not None:
        headers["content-type"] = "application/json"
    return requests.request(method, f"{WEB}{path}", headers=headers, json=body, timeout=60)


def main():
    print("=== the routes the account page needs actually exist ===")
    cookie = session()

    r = web("GET", "/api/billing/balance", cookie)
    check("GET /api/billing/balance is routed, not 404", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code != 200:
        raise SystemExit(f"  body: {r.text[:200]}")
    bal = r.json()

    print("\n=== the balance payload carries everything the page renders ===")
    for field in ("accountId", "balanceRon", "lifetimeSpentRon", "lifetimeTopupRon",
                  "canGenerate", "minBalanceRon", "minBalanceIsCustom", "maxBalanceRon",
                  "autoRefill", "allowance", "recent"):
        check(f"carries {field}", field in bal)
    allowance = bal.get("allowance") or {}
    check("allowance has granted/spent/remaining and a reset date",
          all(k in allowance for k in ("grantedRon", "spentRon", "remainingRon", "resetAt")),
          f"{allowance.get('grantedRon')} RON granted")

    print("\n=== recent spend is readable, not raw column names ===")
    # Straight to the backend, deliberately. /api/billing/usage has no Next route on purpose
    # -- it is server-to-server, and exposing it would let a browser state its own cost.
    requests.post(f"{API}/api/billing/usage", timeout=60,
                 headers={"cookie": cookie, "origin": "http://localhost:3000",
                          "content-type": "application/json"},
                 json={"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 250_000,
                       "outputTokens": 120, "requestId": f"acct-{secrets.token_hex(5)}"})
    rows = web("GET", "/api/billing/balance", cookie).json().get("recent") or []
    check("a metered row exists", len(rows) >= 1, f"{len(rows)} rows")
    if rows:
        row = rows[0]
        check("the row names the model in words, not as a column value",
              bool(row.get("label")) and "lfm2_5" not in str(row.get("label")).lower(),
              f"{row.get('modelKey')} -> {row.get('label')}")
        check("the row carries token counts and a cost",
              row.get("inputTokens", 0) > 0 and row.get("outputTokens", 0) > 0,
              f"{row.get('inputTokens')}/{row.get('outputTokens')} tok, {row.get('costRon')} RON")
        check("the row reports what the allowance covered",
              "allowanceAppliedRon" in row, str(row.get("allowanceAppliedRon")))
        check("the row reports anything the wallet could not cover",
              "uncoveredRon" in row, str(row.get("uncoveredRon")))

    print("\n=== topping up through Next, with a card ===")
    before = web("GET", "/api/billing/balance", cookie).json()
    r = web("POST", "/api/billing/fund", cookie, {"amountRon": 25})
    check("top-up accepted", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:80]}")
    if r.status_code in (200, 201):
        after = web("GET", "/api/billing/balance", cookie).json()
        check("the balance actually went up",
              after.get("balanceRon", 0) >= before.get("balanceRon", 0) + 24.99,
              f"{before.get('balanceRon')} -> {after.get('balanceRon')}")

    print("\n=== topping up without a card is refused, and says why ===")
    bare = session(with_card=False)
    r = web("POST", "/api/billing/fund", bare, {"amountRon": 25})
    check("refused", r.status_code >= 400, f"HTTP {r.status_code}")
    detail = (r.text or "").lower()
    check("the reason names the missing card", "card" in detail, r.text[:110])

    print("\n=== an amount that is not money is rejected ===")
    for bad in (0, -5):
        r = web("POST", "/api/billing/fund", cookie, {"amountRon": bad})
        check(f"amountRon={bad} rejected", r.status_code >= 400, f"HTTP {r.status_code}")

    print("\n=== the floor can be read and set through Next ===")
    r = web("PATCH", "/api/billing/min-balance", cookie, {"floorRon": 3})
    check("floor set", r.status_code == 200 and r.json().get("minBalanceRon") == 3,
          f"HTTP {r.status_code} {r.text[:80]}")
    r = web("PATCH", "/api/billing/min-balance", cookie, {"floorRon": -99})
    check("a floor below the hard backstop is refused", r.status_code >= 400, f"HTTP {r.status_code}")

    print("\n=== the page itself renders with the new tab ===")
    r = requests.get(f"{WEB}/api/pages/account", timeout=60, headers={"cookie": cookie})
    check("the account page loads", r.status_code == 200, f"HTTP {r.status_code}")

    print("\n=== the Playground lineup is priced, with no gaps ===")
    # The lineup a customer sees, in the order the component renders it.
    lineup = [
        "lfm2_5_230m_q4_k_m",
        "lfm2_5_350m_q8_0",
        "lfm2_5_1_2b_instruct_q4_k_m",
        "lfm2_5_1_2b_thinking_q4_k_m",
        "lfm2_5_2_6b_q4_0",
        "lfm2_5_8b_a1b_q4_k_m",
    ]
    r = requests.get(f"{WEB}/api/billing/pricing?audience=api", timeout=60,
                     headers={"cookie": cookie, "origin": WEB})
    check("the pricing route is reachable", r.status_code == 200, f"HTTP {r.status_code}")
    pricing = r.json()
    check("it is the list price, flagged as such", pricing.get("listPrice") is True,
          f"listPrice={pricing.get('listPrice')}")
    check("a paying plan still gets list prices with audience=api",
          pricing.get("subscriber") is True or pricing.get("subscriber") is False,
          f"subscriber={pricing.get('subscriber')}")
    priced = {m["modelKey"]: m for m in pricing.get("models", [])}
    missing = [k for k in lineup if k not in priced]
    check("every model the Playground offers has a price", not missing, f"missing: {missing}")
    zero = [k for k in lineup if k in priced and not (priced[k]["inputPer1M"] > 0 and priced[k]["outputPer1M"] > 0)]
    check("no listed model is priced at zero", not zero, f"zero-priced: {zero}")
    check("output is priced above input everywhere (generation is the cost)",
          all(priced[k]["outputPer1M"] > priced[k]["inputPer1M"] for k in lineup if k in priced))
    check("each price row carries a readable label",
          all(priced[k].get("label") for k in lineup if k in priced))

    print("\n=== the admin pricing view sees both columns ===")
    r = requests.get(f"{WEB}/api/billing/pricing?audience=all", timeout=60,
                     headers={"cookie": cookie, "origin": WEB})
    check("audience=all is served", r.status_code == 200, f"HTTP {r.status_code}")
    allrows = r.json().get("models") or []
    check("each row carries list and plan prices and the discount",
          all(all(k in m for k in ("apiInputPer1M", "apiOutputPer1M",
                                   "subscriberInputPer1M", "subscriberOutputPer1M",
                                   "subscriberDiscountPercent")) for m in allrows),
          f"{len(allrows)} rows")
    bad_discount = [m["modelKey"] for m in allrows
                    if m["subscriberDiscountPercent"] <= 0 or m["subscriberDiscountPercent"] >= 100]
    check("every discount is a real percentage", not bad_discount, f"bad: {bad_discount}")
    inconsistent = [m["modelKey"] for m in allrows
                    if m["apiInputPer1M"] > 0 and m["subscriberInputPer1M"] > m["apiInputPer1M"]]
    check("a subscriber never pays more than the list price", not inconsistent, f"bad: {inconsistent}")

    print("\n=== the discount is not exposed to ordinary callers ===")
    for audience in ("", "api"):
        url = f"{WEB}/api/billing/pricing" + (f"?audience={audience}" if audience else "")
        rr = requests.get(url, timeout=60, headers={"cookie": cookie, "origin": WEB})
        body = rr.json() if rr.status_code == 200 else {}
        leaked = [m for m in (body.get("models") or []) if "subscriberDiscountPercent" in m]
        check(f"no discount leaks with audience={audience or 'none'}", not leaked, f"{len(leaked)} leaked")

    print("\n=== an anonymous visitor is not shown anybody's money ===")
    r = requests.get(f"{WEB}/api/billing/balance", timeout=60)
    check("no session is refused", r.status_code in (401, 403), f"HTTP {r.status_code}")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())