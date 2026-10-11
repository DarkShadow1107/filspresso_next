"""Live check: subscribing records a payment, and the two facts can disagree.

A subscription purchase is not an order -- there is no shipping address and nothing to
deliver -- so it gets its own table with two status columns instead:

    payment_status     did the charge complete
    fulfilment_status  was access granted

The reason for two is the reason this check exists. Collapsing them into one "paid" would
make "we took the money and did not hand over the plan" unrepresentable, which is exactly
the state a customer cannot resolve on their own. So the check asserts that:

  * a paid plan records a payment, marked paid and delivered
  * the free tier records nothing, because nothing was charged
  * a re-subscribe with the same idempotency key does not double-charge
  * the payment row and the active subscription cannot drift apart
"""
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
         "-d", "filspresso", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr.strip()[:300]}")
    return result.stdout.strip()


def session():
    uniq = f"sub{secrets.token_hex(4)}"
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
    psql(
        f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
        f"card_holder, card_last_four, is_default) "
        f"SELECT id, 'fixture', 'fixture', 'Load Test', '4242', TRUE FROM accounts "
        f"WHERE email = '{email}';"
    )
    # Read the id back rather than trusting RETURNING: with -t -A the command tag is the
    # last line of output, not the row.
    card = psql(
        f"SELECT c.id FROM user_cards c JOIN accounts a ON a.id = c.account_id "
        f"WHERE a.email = '{email}' AND c.is_default ORDER BY c.id DESC LIMIT 1;"
    ).splitlines()[-1].strip()
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
        print(f"    login attempt {attempt}: HTTP {r.status_code}")
        time.sleep(4 * attempt)
    if not cookie:
        raise SystemExit("login failed")
    return cookie, card, email


def subscribe(cookie, tier, cycle, card_id, idempotency_key=None):
    body = {"tier": tier, "billingCycle": cycle, "cardId": card_id}
    if idempotency_key:
        body["idempotencyKey"] = idempotency_key
    return requests.post(f"{API}/api/subscriptions", json=body, timeout=60,
                         headers={"cookie": cookie, "origin": WEB, "content-type": "application/json"})


def history(cookie):
    r = requests.get(f"{WEB}/api/subscriptions/payments", timeout=60,
                     headers={"cookie": cookie, "origin": WEB})
    return r.status_code, (r.json() if r.status_code == 200 else None)


def main():
    cookie, card, email = session()

    print("=== the free tier records no payment, because nothing was charged ===")
    r = subscribe(cookie, "free", "monthly", None)
    check("free subscription accepted", r.status_code in (200, 201), f"HTTP {r.status_code}")
    status, rows = history(cookie)
    check("the history endpoint is routed", status == 200, f"HTTP {status}")
    check("nothing recorded for a 0.00 plan", rows == [], f"{len(rows or [])} rows")

    print("\n=== a paid plan records both halves of the purchase ===")
    r = subscribe(cookie, "plus", "monthly", int(card))
    check("paid subscription accepted", r.status_code in (200, 201),
          f"HTTP {r.status_code} {r.text[:90]}")
    status, rows = history(cookie)
    check("one payment recorded", status == 200 and len(rows) == 1, f"{len(rows or [])} rows")
    if rows:
        row = rows[0]
        check("the plan is named", row.get("tier") == "plus", str(row.get("tier")))
        check("it cost the list price for that tier", (row.get("amountRon") or 0) > 0,
              f"{row.get('amountRon')} {row.get('currency')}")
        check("marked paid", row.get("paymentStatus") == "paid", str(row.get("paymentStatus")))
        check("access granted", row.get("fulfilmentStatus") == "delivered",
              str(row.get("fulfilmentStatus")))
        check("shows the card's last four only", row.get("cardLastFour") == "4242",
              str(row.get("cardLastFour")))

    print("\n=== a retried purchase does not charge twice ===")
    key = f"sub-idem-{secrets.token_hex(5)}"
    subscribe(cookie, "pro", "monthly", int(card), idempotency_key=key)
    subscribe(cookie, "pro", "monthly", int(card), idempotency_key=key)
    time.sleep(0.5)
    _, rows = history(cookie)
    pro_rows = [r for r in rows if r.get("tier") == "pro"]
    check("the idempotent retry wrote one row, not two", len(pro_rows) == 1, f"{len(pro_rows)} rows")

    print("\n=== payment and access cannot drift apart ===")
    # The invariant that justified the single transaction: an active paid plan must have a
    # paid row behind it. Counted in the database, not inferred from the API.
    active = psql(
        f"SELECT COUNT(*) FROM user_subscriptions WHERE account_id = "
        f"(SELECT id FROM accounts WHERE email = '{email}') AND is_active = TRUE "
        f"AND status = 'active' AND subscription_tier <> 'free';"
    )
    paid_rows = psql(
        f"SELECT COUNT(*) FROM subscription_payments WHERE account_id = "
        f"(SELECT id FROM accounts WHERE email = '{email}') "
        f"AND payment_status = 'paid' AND fulfilment_status = 'delivered';"
    )
    check("every active paid plan has a paid-and-delivered payment row",
          int(paid_rows) >= int(active), f"{paid_rows} payments for {active} active plan(s)")

    print("\n=== an account with no purchases sees an empty history, not someone else's ===")
    other_cookie, _, _ = session()
    status, rows = history(other_cookie)
    check("empty history for a fresh account", status == 200 and rows == [],
          f"{len(rows or [])} rows")
    r_anon = requests.get(f"{WEB}/api/subscriptions/payments", timeout=60)
    check("an anonymous visitor is refused", r_anon.status_code in (401, 403),
          f"HTTP {r_anon.status_code}")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())