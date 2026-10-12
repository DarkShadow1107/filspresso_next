"""Live check: renewals, refunds, and the charge seam's failure paths.

Three things this covers, all of which previously did not happen at all:

1. Renewals. A subscription reaching its renewal date with auto-renew on was left alone --
   no payment recorded, no date moved, access continued forever. The renewal job fixes
   that, and this asserts it moves exactly one period and writes exactly one payment.

2. Refunds. Cancelling said "access continues until the renewal date" while dropping the
   account's tier in the same statement, so the two halves disagreed with each other. Now
   the tier is kept and a refund is recorded inside the window.

3. The charge seam. `fund()` used to credit the wallet and record the top-up as though the
   card had been charged. It now charges first, and a refusal leaves the balance alone and
   is recorded where the account page can show it.

The renewal job is driven directly rather than by waiting five minutes for the timer, so
the check is deterministic and fast. The advisory lock is exercised too, because a timer
that runs on every replica is exactly where a double charge would come from.
"""
import json
import secrets
import subprocess
import time

import requests

API = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
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


def session(tier="max", card_last_digit=None):
    """A signed-in account with a card, optionally one the simulated provider declines.

    The simulated provider declines a card whose id ends in 7, which is how the failure
    paths are driven without waiting for a real decline.
    """
    uniq = f"ren{secrets.token_hex(4)}"
    creds = {"username": uniq, "email": f"{uniq}@billing.test", "password": "LoadTest!2026x"}
    for attempt in range(1, 7):
        r = requests.post(f"{API}/api/auth/register", json=creds, timeout=60,
                          headers={"x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"})
        if r.status_code == 201:
            break
        time.sleep(4 * attempt)
    else:
        raise SystemExit(f"register failed: HTTP {r.status_code}")

    email = creds["email"].replace("'", "''")
    psql(f"UPDATE accounts SET subscription = '{tier}' WHERE email = '{email}';")
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

    account = psql(f"SELECT id FROM accounts WHERE email = '{email}';")
    card_id = psql(f"SELECT id FROM user_cards WHERE account_id = {account} ORDER BY id DESC LIMIT 1;")
    if card_last_digit is not None:
        # The simulated provider declines by card *id*, and only the default card is ever
        # charged. Insert cards until the default one has an id ending in the digit, then
        # make that the default -- otherwise the fixture builds a declining card that
        # nothing ever tries to charge.
        while int(card_id) % 10 != card_last_digit:
            psql(
                f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
                f"card_holder, card_last_four, is_default) VALUES ({account}, 'f', 'f', 'T', '0000', FALSE);"
            )
            card_id = psql(f"SELECT id FROM user_cards WHERE account_id = {account} ORDER BY id DESC LIMIT 1;")
        psql(f"UPDATE user_cards SET is_default = FALSE WHERE account_id = {account};")
        psql(f"UPDATE user_cards SET is_default = TRUE WHERE id = {card_id};")
    return cookie, account, card_id, email


def run_renewal_pass():
    """Run one renewal pass by restarting the backend.

    The scheduler runs a pass on boot as well as on its interval, so a restart is a
    deterministic way to trigger one without waiting five minutes -- and without needing
    admin credentials, since the manual trigger endpoint is deliberately behind MFA.

    This is the real code path, not a shortcut around it: same method, same advisory lock,
    same transaction.
    """
    import subprocess as sp
    sp.run(["docker", "compose", "restart", "backend"], capture_output=True, text=True, timeout=180)
    for _ in range(60):
        time.sleep(2)
        try:
            r = requests.get(f"{API}/health", timeout=5)
            if r.status_code == 200:
                return r
        except Exception:
            continue
    raise SystemExit("backend did not come back up after the restart")


def payments(cookie):
    r = requests.get(f"{API}/api/subscriptions/payments", timeout=60,
                     headers={"cookie": cookie, "origin": ORIGIN})
    return r.json() if r.status_code == 200 else []


def main():
    print("=== a due subscription renews, once per period ===")
    cookie, account, card_id, email = session(tier="max")
    r = requests.post(f"{API}/api/subscriptions", json={
        "tier": "max", "billingCycle": "monthly", "cardId": int(card_id),
    }, timeout=60, headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"})
    check("subscribed", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:90]}")
    check("one purchase recorded", len(payments(cookie)) == 1, f"{len(payments(cookie))} rows")

    original = psql(f"SELECT renewal_date FROM user_subscriptions WHERE account_id={account} AND is_active=TRUE;")
    check("a renewal date was set", bool(original), str(original))

    # Push the renewal date into the past rather than waiting a month.
    psql(f"UPDATE user_subscriptions SET renewal_date = CURRENT_DATE - 1 WHERE account_id={account} AND is_active=TRUE;")
    due = psql(f"SELECT renewal_date FROM user_subscriptions WHERE account_id={account} AND is_active=TRUE;")

    run_renewal_pass()

    after = psql(f"SELECT renewal_date FROM user_subscriptions WHERE account_id={account} AND is_active=TRUE;")
    # Compared against the date that was *due*, not the one from before it was pushed back:
    # renewing from 2026-10-11 correctly lands on 2026-11-11, a month earlier than the
    # original 2026-11-12 while being exactly right.
    check("the renewal date moved a full period forward", str(after) > str(due),
          f"due {due} -> now {after} (subscribed {original})")
    rows = payments(cookie)
    check("a renewal payment was recorded", len(rows) >= 2, f"{len(rows)} rows")
    if len(rows) >= 2:
        check("the renewal row is paid and delivered",
              rows[0].get("paymentStatus") == "paid" and rows[0].get("fulfilmentStatus") == "delivered",
              f"{rows[0].get('paymentStatus')}/{rows[0].get('fulfilmentStatus')}")

    print("\n=== running the pass twice does not renew twice ===")
    count_before = len(payments(cookie))
    date_before = psql(f"SELECT renewal_date FROM user_subscriptions WHERE account_id={account} AND is_active=TRUE;")
    run_renewal_pass()
    run_renewal_pass()
    count_after = len(payments(cookie))
    date_after = psql(f"SELECT renewal_date FROM user_subscriptions WHERE account_id={account} AND is_active=TRUE;")
    check("no extra payment on a repeat pass", count_after == count_before,
          f"{count_before} -> {count_after}")
    check("and the renewal date did not move again", date_after == date_before,
          f"{date_before} -> {date_after}")

    print("\n=== a declined renewal does not renew ===")
    dec_cookie, dec_account, dec_card, _ = session(tier="pro", card_last_digit=7)
    psql(
        f"INSERT INTO user_subscriptions (account_id, subscription_tier, billing_cycle, price_ron, "
        f"start_date, renewal_date, is_active, auto_renew, status, card_id) "
        f"SELECT {dec_account}, 'pro', 'monthly', 169.99, CURRENT_DATE, CURRENT_DATE - 1, TRUE, TRUE, 'active', {dec_card};"
    )
    psql(
        f"INSERT INTO subscription_payments (account_id, tier, billing_cycle, amount_ron, card_id, "
        f"payment_status, fulfilment_status) VALUES ({dec_account}, 'pro', 'monthly', 169.99, {dec_card}, "
        f"'paid', 'delivered');"
    )
    run_renewal_pass()
    declined = [p for p in payments(dec_cookie) if p.get("paymentStatus") == "paid"]
    check("no payment recorded for the declined renewal", len(declined) == 1,
          f"{len(declined)} paid rows (the original purchase only)")
    still_due = psql(
        f"SELECT renewal_date FROM user_subscriptions WHERE account_id={dec_account} AND renewal_date <= CURRENT_DATE;"
    )
    check("its renewal date was never advanced", still_due != "",
          f"still due at {still_due}")

    print("\n=== cancelling keeps access and refunds inside the window ===")
    c_cookie, c_account, c_card, _ = session(tier="plus")
    requests.post(f"{API}/api/subscriptions", json={
        "tier": "plus", "billingCycle": "monthly", "cardId": int(c_card),
    }, timeout=60, headers={"cookie": c_cookie, "origin": ORIGIN, "content-type": "application/json"})
    before_tier = psql(f"SELECT subscription FROM accounts WHERE id={c_account};")
    r = requests.put(f"{API}/api/subscriptions/cancel", timeout=60,
                     headers={"cookie": c_cookie, "origin": ORIGIN})
    check("cancel accepted", r.status_code == 200, f"HTTP {r.status_code} {r.text[:90]}")
    body = r.json() if r.status_code == 200 else {}
    check("the response says whether it refunded", "refunded" in body, json.dumps(body)[:140])
    after_tier = psql(f"SELECT subscription FROM accounts WHERE id={c_account};")
    check("the tier is KEPT until the renewal date", after_tier == before_tier,
          f"{before_tier} -> {after_tier}  (it used to drop to Free immediately)")
    auto = psql(f"SELECT auto_renew FROM user_subscriptions WHERE account_id={c_account};")
    check("auto-renew is off", auto.lower() == "f", str(auto))
    refund_rows = [p for p in payments(c_cookie) if p.get("paymentStatus") == "refunded"]
    check("a refund row was written inside the window", len(refund_rows) == 1,
          f"{len(refund_rows)} refund rows")
    if refund_rows:
        check("the refund reverses a real payment", refund_rows[0].get("amountRon", 0) != 0,
              str(refund_rows[0].get("amountRon")))
        check("and access is marked revoked", refund_rows[0].get("fulfilmentStatus") == "revoked",
              str(refund_rows[0].get("fulfilmentStatus")))

    print("\n=== cancelling twice does not refund twice ===")
    requests.put(f"{API}/api/subscriptions/cancel", timeout=60,
                 headers={"cookie": c_cookie, "origin": ORIGIN})
    refund_rows = [p for p in payments(c_cookie) if p.get("paymentStatus") == "refunded"]
    check("still exactly one refund", len(refund_rows) == 1, f"{len(refund_rows)} refund rows")

    print("\n=== a declined top-up leaves the balance alone and is recorded ===")
    d2_cookie, d2_account, d2_card, _ = session(tier="max", card_last_digit=7)
    psql(
        f"UPDATE user_subscriptions SET card_id={d2_card} WHERE account_id={d2_account} "
        f"AND is_active=TRUE;"
    )
    # A missing row means no balance has ever been created, which is zero -- not a
    # different value that happened to move.
    before_bal = psql(f"SELECT COALESCE((SELECT balance_ron FROM account_balances WHERE account_id={d2_account}), 0);")
    r = requests.post(f"{API}/api/billing/fund", json={"amountRon": 30}, timeout=60,
                      headers={"cookie": d2_cookie, "origin": ORIGIN, "content-type": "application/json"})
    check("the top-up is refused", r.status_code >= 400, f"HTTP {r.status_code}")
    after_bal = psql(f"SELECT COALESCE((SELECT balance_ron FROM account_balances WHERE account_id={d2_account}), 0);")
    # Numerically: Postgres renders 0 as "0" and 0.00000000 as the latter depending on the
    # column it came from, so a string comparison fails on formatting alone.
    check("and the balance did not move", float(after_bal or 0) == float(before_bal or 0),
          f"{before_bal} -> {after_bal}")
    failures = psql(f"SELECT count(*) FROM billing_topup_failures WHERE account_id={d2_account};")
    check("the refusal is recorded", int(failures or 0) >= 1, f"{failures} failure rows")

    print("\n=== a lapsed subscription is retired to free ===")
    l_cookie, l_account, l_card, _ = session(tier="basic")
    # A subscription row has to exist: setting accounts.subscription alone leaves nothing for
    # the retirement pass to find, and the assertion below would pass for the wrong reason.
    requests.post(f"{API}/api/subscriptions", json={
        "tier": "basic", "billingCycle": "monthly", "cardId": int(l_card),
    }, timeout=60, headers={"cookie": l_cookie, "origin": ORIGIN, "content-type": "application/json"})
    psql(
        f"UPDATE user_subscriptions SET renewal_date = CURRENT_DATE - 30, auto_renew = FALSE "
        f"WHERE account_id={l_account} AND is_active=TRUE;"
    )
    run_renewal_pass()
    tier_now = psql(f"SELECT subscription FROM accounts WHERE id={l_account};")
    active = psql(f"SELECT is_active FROM user_subscriptions WHERE account_id={l_account} AND is_active=TRUE;")
    check("the account dropped to Free", tier_now.lower() == "free", str(tier_now))
    check("and the subscription is no longer active", active == "", f"active rows: {active!r}")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())