"""Live check: the Spectre Playground as a standalone add-on.

Covers the parts that are new and the parts that must *not* have changed:

1. An account on any tier -- including Free -- can buy the 99.99 RON subscription and gain
   Playground access. This is the whole point of the change: access is no longer a tier.
2. Usage in the Playground is list-priced for everyone and comes wholly from the wallet.
   An add-on holder has no allowance to draw on, so a charge that touched the allowance
   would be a billing bug that no other check would catch.
3. Max keeps its allowance in the Playground, but not for the 8B.
4. Kafelot is untouched: a paid tier still gets its discount there.
5. Cancelling keeps access until the period ends, and never clobbers a paid-for wallet.
6. Renewals advance the expiry and record exactly one payment.
7. Max and Ultimate are refused the purchase, because their plan already includes the
   Playground.
8. Upgrading to Max hands the entitlement to the tier: the add-on keeps the access it was
   paid for but stops auto-renewing, and a Max customer's usage comes out of their
   allowance. That last one is the ordering bug -- the add-on used to be resolved first, so
   a stale add-on turned a bundled plan into wallet-only billing.

Every assertion is in terms of money and database state rather than HTTP status alone,
because a 201 that charged the wrong pot looks identical to one that charged the right pot
from the caller's side.
"""
import secrets
import subprocess
import time

import requests

API = "http://localhost:4000"
WEB = "http://localhost:3000"
ORIGIN = "http://localhost:3000"
LIST_230M_IN = 0.30   # RON per 1M input tokens, from the published table
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:52} {detail}")


def psql(sql):
    r = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "filspresso_user",
         "-d", "filspresso", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise SystemExit(f"psql failed: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def session(tier="free", with_card=True, card_last_digit=None):
    uniq = f"spec{secrets.token_hex(4)}"
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
    if tier != "free":
        psql(f"UPDATE accounts SET subscription = '{tier}' WHERE email = '{email}';")
    if with_card:
        psql(
            f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
            f"card_holder, card_last_four, is_default) "
            f"SELECT id, 'fixture', 'fixture', 'Load Test', '4242', TRUE FROM accounts "
            f"WHERE email = '{email}' AND NOT EXISTS (SELECT 1 FROM user_cards c "
            f"JOIN accounts a ON a.id = c.account_id WHERE a.email = '{email}' AND c.is_default);"
        )
    account = psql(f"SELECT id FROM accounts WHERE email = '{email}';")
    card_id = ""
    if with_card:
        card_id = psql(f"SELECT id FROM user_cards WHERE account_id = {account} ORDER BY id DESC LIMIT 1;")
        # The simulated provider declines on `card_id % 10 == 7` -- the *row id*, not the card
        # number. So which card a suite ends up with depends on how many cards were inserted
        # before it, and a suite that simply takes the newest card is at the mercy of the
        # sequence position.
        #
        # That made this check fail whenever another suite ran first and shifted the ids, which
        # is why it could pass standalone and fail in a batch with no code change in between.
        # The default target is therefore "any id that is not 7", not "whatever comes next";
        # an explicit card_last_digit still wins, because the declined path needs one.
        target_digit = card_last_digit if card_last_digit is not None else None
        while int(card_id) % 10 == 7 and target_digit is None:
            psql(f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
                 f"card_holder, card_last_four, is_default) VALUES ({account}, 'f', 'f', 'T', '0000', FALSE);")
            card_id = psql(f"SELECT id FROM user_cards WHERE account_id = {account} ORDER BY id DESC LIMIT 1;")
        if target_digit is not None:
            while int(card_id) % 10 != card_last_digit:
                psql(f"INSERT INTO user_cards (account_id, card_number_encrypted, card_expiry_encrypted, "
                     f"card_holder, card_last_four, is_default) VALUES ({account}, 'f', 'f', 'T', '0000', FALSE);")
                card_id = psql(f"SELECT id FROM user_cards WHERE account_id = {account} ORDER BY id DESC LIMIT 1;")
            psql(f"UPDATE user_cards SET is_default = FALSE WHERE account_id = {account};")
            psql(f"UPDATE user_cards SET is_default = TRUE WHERE id = {card_id};")

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
    return cookie, account, card_id, email


def web(method, path, cookie, body=None):
    headers = {"cookie": cookie, "origin": WEB, "accept": "application/json"}
    if body is not None:
        headers["content-type"] = "application/json"
    return requests.request(method, f"{WEB}{path}", headers=headers, json=body, timeout=90)


def run_renewal_pass():
    """One pass, via the boot-time sweep."""
    subprocess.run(["docker", "compose", "restart", "backend"], capture_output=True, text=True, timeout=180)
    for _ in range(60):
        time.sleep(2)
        try:
            if requests.get(f"{API}/health", timeout=5).status_code == 200:
                return
        except Exception:
            continue
    raise SystemExit("backend did not come back up")


def main():
    print("=== the public terms ===")
    r = requests.get(f"{API}/api/spectre/subscription", timeout=60)
    body = r.json() if r.status_code == 200 else {}
    check("reachable without a session", r.status_code == 200, f"HTTP {r.status_code}")
    check("99.99 RON per month", float(body.get("monthlyRon", 0)) == 99.99, str(body.get("monthlyRon")))
    check("1099.99 RON a year", float(body.get("annualRon", 0)) == 1099.99, str(body.get("annualRon")))
    check("and it says usage is not included", body.get("includesUsage") is False, str(body.get("includesUsage")))

    print("\n=== a Free account has no access, and can buy it ===")
    cookie, account, card, email = session(tier="free")
    r = web("GET", "/api/spectre/access", cookie)
    access = r.json() if r.status_code == 200 else {}
    check("access refused without a subscription", access.get("hasAccess") is False, str(access.get("hasAccess")))
    check("and the reason is null", access.get("source") is None, str(access.get("source")))
    check("cannot fund a wallet yet", access.get("canFundWallet") is False, str(access.get("canFundWallet")))

    r = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                      headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"billingCycle": "monthly"})
    check("subscribe accepted", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:100]}")
    check("charged 99.99", float((r.json() if r.status_code in (200, 201) else {}).get("priceRon", 0)) == 99.99,
          str((r.json() if r.status_code in (200, 201) else {}).get("priceRon")))

    access = web("GET", "/api/spectre/access", cookie).json()
    check("access granted", access.get("hasAccess") is True, str(access.get("hasAccess")))
    check("credited to the add-on, not a tier", access.get("source") == "addon", str(access.get("source")))
    check("and it renews", access.get("autoRenew") is True, str(access.get("autoRenew")))

    print("\n=== a second subscription is refused rather than double-charged ===")
    r2 = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                       headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                       json={"billingCycle": "annual"})
    check("duplicate refused", r2.status_code >= 400, f"HTTP {r2.status_code}")

    print("\n=== usage is list-priced and comes wholly from the wallet ===")
    # Fund the wallet, then send usage through the Playground scope.
    fund = requests.post(f"{API}/api/billing/fund", timeout=60,
                         headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                         json={"amountRon": 20})
    check("an add-on holder can fund the wallet", fund.status_code in (200, 201),
          f"HTTP {fund.status_code} {fund.text[:80]}")

    tokens = 1_000_000
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": tokens, "outputTokens": 0,
                            "scope": "playground", "requestId": f"spec-{secrets.token_hex(5)}"})
    check("usage accepted", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:110]}")
    used = r.json() if r.status_code in (200, 201) else {}
    expected = LIST_230M_IN
    check("priced at the API list rate, not a subscriber rate",
          abs(float(used.get("costRon", 0)) - expected) < 1e-6,
          f"{used.get('costRon')} RON (subscriber rate would be 0.21)")
    check("nothing came from an allowance", float(used.get("allowanceAppliedRon", -1)) == 0,
          f"allowance {used.get('allowanceAppliedRon')}")
    check("the whole cost came from the wallet", abs(float(used.get("walletChargedRon", 0)) - expected) < 1e-6,
          f"wallet {used.get('walletChargedRon')}")
    check("and it says why", used.get("reason") == "wallet_only_no_allowance", str(used.get("reason")))

    row = psql(
        f"SELECT price_mode || '|' || bill_from || '|' || scope FROM ai_token_usage "
        f"WHERE account_id = {account} ORDER BY id DESC LIMIT 1;"
    )
    check("the ledger records the mode and the pot", row == "playground|wallet_only|playground", row)

    print("\n=== Kafelot is untouched: a paid tier keeps its discount there ===")
    pro_cookie, pro_account, pro_card, _ = session(tier="pro")
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": pro_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": tokens, "outputTokens": 0,
                            "scope": "kafelot", "requestId": f"spec-{secrets.token_hex(5)}"})
    kafelot = r.json() if r.status_code in (200, 201) else {}
    check("Kafelot charges the discounted rate", abs(float(kafelot.get("costRon", 0)) - 0.21) < 1e-6,
          f"{kafelot.get('costRon')} RON (list would be 0.30)")
    check("and draws on the allowance", float(kafelot.get("allowanceAppliedRon", 0)) > 0,
          f"allowance {kafelot.get('allowanceAppliedRon')}")

    print("\n=== the same Pro account pays list in the Playground ===")
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": pro_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": tokens, "outputTokens": 0,
                            "scope": "playground", "requestId": f"spec-{secrets.token_hex(5)}"})
    pg = r.json() if r.status_code in (200, 201) else {}
    check("the Playground charges list price", abs(float(pg.get("costRon", 0)) - 0.30) < 1e-6,
          f"{pg.get('costRon')} RON")

    print("\n=== Max: allowance in the Playground, but not for the 8B ===")
    max_cookie, max_account, max_card, _ = session(tier="max")
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": max_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": tokens, "outputTokens": 0,
                            "scope": "playground", "requestId": f"spec-{secrets.token_hex(5)}"})
    m_small = r.json() if r.status_code in (200, 201) else {}
    check("a small model comes from the allowance", float(m_small.get("allowanceAppliedRon", 0)) > 0,
          f"allowance {m_small.get('allowanceAppliedRon')}")
    check("priced at list, not the Max discount", abs(float(m_small.get("costRon", 0)) - 0.30) < 1e-6,
          f"{m_small.get('costRon')} RON")

    requests.post(f"{API}/api/billing/fund", timeout=60,
                  headers={"cookie": max_cookie, "origin": ORIGIN, "content-type": "application/json"},
                  json={"amountRon": 30})
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": max_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_8b_a1b_q4_k_m", "inputTokens": tokens, "outputTokens": 0,
                            "scope": "playground", "requestId": f"spec-{secrets.token_hex(5)}"})
    m_big = r.json() if r.status_code in (200, 201) else {}
    check("the 8B on Max takes nothing from the allowance", float(m_big.get("allowanceAppliedRon", -1)) == 0,
          f"allowance {m_big.get('allowanceAppliedRon')}")
    check("and says so", m_big.get("reason") == "model_excluded_from_allowance", str(m_big.get("reason")))

    print("\n=== Ultimate: the 8B is covered by its allowance ===")
    ult_cookie, ult_account, ult_card, _ = session(tier="ultimate")
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": ult_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_8b_a1b_q4_k_m", "inputTokens": tokens, "outputTokens": 0,
                            "scope": "playground", "requestId": f"spec-{secrets.token_hex(5)}"})
    ult = r.json() if r.status_code in (200, 201) else {}
    check("Ultimate draws the 8B from its allowance", float(ult.get("allowanceAppliedRon", 0)) > 0,
          f"allowance {ult.get('allowanceAppliedRon')}")

    print("\n=== cancelling keeps access until the period ends ===")
    before_expires = psql(f"SELECT expires_at FROM account_addons WHERE account_id = {account};")
    bal_before = psql(f"SELECT COALESCE((SELECT balance_ron FROM account_balances WHERE account_id = {account}), 0);")
    r = requests.put(f"{API}/api/spectre/cancel", timeout=60,
                     headers={"cookie": cookie, "origin": ORIGIN})
    check("cancel accepted", r.status_code == 200, f"HTTP {r.status_code} {r.text[:80]}")
    access = web("GET", "/api/spectre/access", cookie).json()
    check("access survives until the paid period ends", access.get("hasAccess") is True,
          str(access.get("hasAccess")))
    check("auto-renew is off", access.get("autoRenew") is False, str(access.get("autoRenew")))
    check("the expiry was not moved by cancelling", psql(
        f"SELECT expires_at FROM account_addons WHERE account_id = {account};") == before_expires,
        str(before_expires))
    bal_after = psql(f"SELECT COALESCE((SELECT balance_ron FROM account_balances WHERE account_id = {account}), 0);")
    check("a paid wallet is never clobbered by a cancellation",
          abs(float(bal_after) - float(bal_before)) < 1e-6, f"{bal_before} -> {bal_after}")

    print("\n=== a cancelled add-on does not renew ===")
    psql(f"UPDATE account_addons SET expires_at = NOW() - interval '1 day' WHERE account_id = {account};")
    run_renewal_pass()
    payments = psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {account} AND scope = 'spectre';")
    check("no renewal payment was taken", int(payments or 0) == 1, f"{payments} spectre payments")
    check("and the row is closed out",
          psql(f"SELECT status FROM account_addons WHERE account_id = {account};") == "ended",
          psql(f"SELECT status FROM account_addons WHERE account_id = {account};"))

    print("\n=== an active add-on does renew, exactly once ===")
    requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                  headers={"cookie": pro_cookie, "origin": ORIGIN, "content-type": "application/json"},
                  json={"billingCycle": "monthly"})
    check("the purchase itself is recorded as a payment",
          int(psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {pro_account} AND scope = 'spectre';") or 0) == 1,
          "one spectre payment for the purchase")
    # Only now push the period back, so the renewal is genuinely due.
    psql(f"UPDATE account_addons SET expires_at = NOW() - interval '1 day', status = 'active', "
         f"auto_renew = TRUE WHERE account_id = {pro_account};")
    run_renewal_pass()
    n1 = psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {pro_account} AND scope = 'spectre';")
    future = psql(f"SELECT expires_at > NOW() FROM account_addons WHERE account_id = {pro_account};")
    run_renewal_pass()
    n2 = psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {pro_account} AND scope = 'spectre';")
    check("the expiry advanced into the future", future == "t", f"expires_at > NOW() = {future}")
    check("one renewal payment recorded", int(n1 or 0) == 2, f"{n1} spectre payments")
    check("a repeat pass does not renew twice", int(n2 or 0) == int(n1 or 0), f"{n1} -> {n2}")

    print("\n=== a declined add-on charge grants nothing ===")
    dec_cookie, dec_account, dec_card, _ = session(tier="free", card_last_digit=7)
    r = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                      headers={"cookie": dec_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"billingCycle": "monthly"})
    check("the charge is refused", r.status_code >= 400, f"HTTP {r.status_code}")
    rows = psql(f"SELECT count(*) FROM account_addons WHERE account_id = {dec_account};")
    check("and no access was granted", int(rows or 0) == 0, f"{rows} addon rows")

    print("\n=== no card means no subscription ===")
    noc = session(tier="free", with_card=False)
    r = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                      headers={"cookie": noc[0], "origin": ORIGIN, "content-type": "application/json"},
                      json={"billingCycle": "monthly"})
    check("refused", r.status_code >= 400, f"HTTP {r.status_code}")
    check("and it says which card is missing", "CARD" in r.text.upper(), r.text[:110])

    print("\n=== Max and Ultimate cannot buy it: their plan already includes it ===")
    for tier in ("max", "ultimate"):
        c, a, card_id, _ = session(tier=tier)
        payments_before = int(psql(
            f"SELECT count(*) FROM subscription_payments WHERE account_id = {a} AND scope = 'spectre';") or 0)
        r = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                          headers={"cookie": c, "origin": ORIGIN, "content-type": "application/json"},
                          json={"billingCycle": "monthly"})
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        check(f"{tier}: the purchase is refused", r.status_code >= 400, f"HTTP {r.status_code}")
        check(f"{tier}: and the refusal says it is already included",
              body.get("error") == "ADDON_INCLUDED_IN_PLAN", str(body.get("error")))
        check(f"{tier}: nothing was written",
              int(psql(f"SELECT count(*) FROM account_addons WHERE account_id = {a};") or 0) == 0, "no addon row")
        check(f"{tier}: and nothing was charged",
              int(psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {a} AND scope = 'spectre';")
                  or 0) == payments_before, "no spectre payment")

    print("\n=== upgrading to Max: the tier wins, the add-on stops renewing, no refund ===")
    up_cookie, up_account, up_card, _ = session(tier="free")
    r = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                      headers={"cookie": up_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"billingCycle": "monthly"})
    check("bought it on Free", r.status_code in (200, 201), f"HTTP {r.status_code}")

    # A real upgrade, so the cancellation hook is what is under test rather than a row
    # edited by hand.
    #
    # The account needs an active user_subscriptions row, and that row has to sit on a tier
    # BELOW Max: changeSubscription decides upgrade vs. downgrade by comparing the target to
    # the current subscription_tier, so a 'max' row would make this a scheduled no-op and
    # never reach the hook at all.
    psql(f"UPDATE accounts SET subscription = 'Basic' WHERE id = {up_account};")
    psql(f"INSERT INTO user_subscriptions (account_id, subscription_tier, billing_cycle, price_ron, "
         f"start_date, renewal_date, auto_renew, is_active, status, card_id) "
         f"SELECT {up_account}, 'basic', 'monthly', 0, CURRENT_DATE, NOW() + interval '30 days', "
         f"FALSE, TRUE, 'active', {up_card or 'NULL'};")

    expires_before = psql(f"SELECT expires_at FROM account_addons WHERE account_id = {up_account};")
    spectre_payments_before = int(psql(
        f"SELECT count(*) FROM subscription_payments WHERE account_id = {up_account} AND scope = 'spectre';") or 0)

    r = requests.post(f"{API}/api/subscriptions/change", timeout=60,
                      headers={"cookie": up_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"tier": "max", "billingCycle": "monthly", "cardId": int(up_card or 0) or None})
    check("the upgrade succeeded", r.status_code in (200, 201), f"HTTP {r.status_code} {r.text[:110]}")
    check("and it was an immediate upgrade, not a scheduled change",
          (r.json() if r.status_code in (200, 201) else {}).get("isUpgrade") is True,
          str((r.json() if r.status_code in (200, 201) else {}).get("message"))[:90])

    access = web("GET", "/api/spectre/access", up_cookie).json()
    check("the tier is credited, not the stale add-on", access.get("source") == "tier", str(access.get("source")))
    check("the paid period was not cut short",
          psql(f"SELECT expires_at FROM account_addons WHERE account_id = {up_account};") == expires_before,
          "expires_at unchanged")
    auto_renew = psql(f"SELECT auto_renew FROM account_addons WHERE account_id = {up_account};")
    check("the add-on's auto-renew really was switched off", auto_renew == "f", f"auto_renew = {auto_renew}")

    # The bug this ordering fixes: with the add-on checked first this resolves to
    # wallet_only and the Max customer is billed for a plan they are already paying for.
    r = requests.post(f"{API}/api/billing/usage", timeout=60,
                      headers={"cookie": up_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1_000_000, "outputTokens": 0,
                            "scope": "playground", "requestId": f"spec-{secrets.token_hex(5)}"})
    up = r.json() if r.status_code in (200, 201) else {}
    check("Playground usage comes from the Max allowance, not the wallet",
          float(up.get("allowanceAppliedRon", 0)) > 0,
          f"allowance {up.get('allowanceAppliedRon')} (wallet {up.get('walletChargedRon')})")
    bill_from = psql(f"SELECT bill_from FROM ai_token_usage WHERE account_id = {up_account} ORDER BY id DESC LIMIT 1;")
    check("the row records the allowance as the pot", bill_from != "wallet_only", f"bill_from = {bill_from}")

    # Deliberately no wallet-balance assertion here. Auto-refill tops a wallet up to its
    # target on its own schedule, so a balance delta cannot be attributed to this change --
    # the payment checks below are what actually prove nothing was refunded.
    check("no refund was issued for the remaining period",
          int(psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {up_account} AND scope = 'spectre';")
              or 0) == spectre_payments_before, "still one spectre payment")
    check("and no negative payment exists for it",
          int(psql(f"SELECT count(*) FROM subscription_payments WHERE account_id = {up_account} "
                   f"AND scope = 'spectre' AND amount_ron < 0;") or 0) == 0, "no negative payment")

    print("\n=== a Max account cannot buy it again after cancelling the old one ===")
    r = requests.post(f"{API}/api/spectre/subscribe", timeout=60,
                      headers={"cookie": up_cookie, "origin": ORIGIN, "content-type": "application/json"},
                      json={"billingCycle": "monthly"})
    check("still refused", r.status_code >= 400, f"HTTP {r.status_code}")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())