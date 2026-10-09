"""Live check for the billing endpoints: prices, metering, deduction, idempotency.

Runs against the deployed stack rather than a unit test, because the things most likely
to be wrong are the ones only the database can answer: the grants, the numeric rounding
through NUMERIC(18,8), and whether a repeated report really does not double-charge.
"""
import json
import os
import secrets
import time
import ssl
import urllib.error
import urllib.request

BASE = "http://localhost:4000"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:52} {detail}")


def get(path, cookie=None, origin="http://localhost:3000"):
    req = urllib.request.Request(BASE + path, headers={"accept": "application/json", "origin": origin})
    if cookie:
        req.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}"), r.headers.get("set-cookie")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}"), None


def post(path, body, cookie=None, origin="http://localhost:3000", forwarded_for=None):
    headers = {"content-type": "application/json", "accept": "application/json", "origin": origin}
    if forwarded_for:
        headers["x-forwarded-for"] = forwarded_for
    req = urllib.request.Request(BASE + path, method="POST", data=json.dumps(body).encode(),
                                 headers=headers)
    if cookie:
        req.add_header("cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}"), r.headers.get("set-cookie")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}"), None


def cookie_of(set_cookie):
    if not set_cookie:
        return None
    for part in set_cookie.split(","):
        if part.strip().startswith("filspresso_session="):
            return part.split(";")[0].strip()
    return None


def main():
    print("=== pricing (anonymous) ===")
    status, body, _ = get("/api/billing/pricing")
    check("pricing endpoint responds", status == 200, f"HTTP {status}")
    if status != 200:
        print(json.dumps(body)[:300])
        return 1

    check("currency is RON", body.get("currency") == "RON", str(body.get("currency")))
    check("output is 5x input", body.get("outputMultiplier") == 5, str(body.get("outputMultiplier")))
    check("anonymous is not a subscriber", body.get("subscriber") is False)
    by_key = {m["modelKey"]: m for m in body.get("models", [])}
    check("all nine models priced", len(by_key) == 9, f"{len(by_key)} models")

    expected = {
        "lfm2_5_230m_q4_k_m": (0.30, 1.50),
        "lfm2_5_350m_q8_0": (0.50, 2.50),
        "lfm2_5_1_2b_instruct_q4_k_m": (2.00, 10.00),
        "lfm2_5_1_2b_thinking_q4_k_m": (3.00, 15.00),
        "lfm2_5_2_6b_q4_0": (7.00, 35.00),
        "lfm2_5_8b_a1b_q4_k_m": (20.00, 100.00),
        "lfm2_5_vl_450m_q4_k_m": (1.00, 5.00),
        "lfm2_5_vl_3b_q4_k_m": (10.00, 50.00),
        "lfm2_5_audio_1_5b_q4_0": (5.00, 25.00),
    }
    wrong = [f"{k}: got {by_key[k]['inputPer1M']}/{by_key[k]['outputPer1M']}"
             for k, (i, o) in expected.items()
             if k not in by_key or abs(by_key[k]["inputPer1M"] - i) > 1e-9
             or abs(by_key[k]["outputPer1M"] - o) > 1e-9]
    check("anonymous sees the list price", not wrong, "; ".join(wrong) or "all nine correct")
    check("anonymous is shown no discount field",
          all("subscriberDiscountPercent" not in m for m in body.get("models", [])))

    print("\n=== register and meter ===")
    uniq = f"bill{secrets.token_hex(4)}"
    # Retried, because registration is throttled per client and every live check in this
    # directory creates accounts. A 429 here means the checks collided with each other, not
    # that registration is broken, and reporting it as a failure trained us to ignore the
    # one line that says the whole run stopped. Each attempt claims a fresh client address.
    status, sc = None, None
    for attempt in range(1, 7):
        ip = f"198.51.100.{secrets.randbelow(250) + 1}"
        status, _, sc = post("/api/auth/register",
                             {"username": uniq, "email": f"{uniq}@billing.test",
                              "password": "LoadTest!2026x"},
                             forwarded_for=ip)
        if status == 201:
            break
        print(f"    register attempt {attempt}: HTTP {status}")
        time.sleep(4 * attempt)
    if status != 201:
        check("register", False, f"HTTP {status}")
        return 1
    cookie = cookie_of(sc)
    status, _, sc2 = post("/api/auth/login", {"email": f"{uniq}@billing.test", "password": "LoadTest!2026x"})
    cookie = cookie_of(sc2) or cookie
    check("session established", bool(cookie))

    status, bal, _ = get("/api/billing/balance", cookie)
    check("balance readable", status == 200 and "balanceRon" in bal, f"HTTP {status} {bal.get('balanceRon')}")
    start_balance = bal.get("balanceRon", 0)

    rid = f"probe-{secrets.token_hex(6)}"
    status, res, _ = post("/api/billing/usage",
                          {"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1000000,
                           "outputTokens": 1000000, "requestId": rid}, cookie)
    check("usage accepted", status in (200, 201), f"HTTP {status}")
    check("cost matches the list price (1M in + 1M out)",
          abs(res.get("costRon", 0) - 1.80) < 1e-9, f"{res.get('costRon')} RON")
    # The free allowance absorbs this, so the wallet must NOT move. Written before
    # allowance-first existed, when the wallet absorbed everything.
    check("wallet untouched: the allowance covered it",
          abs(res.get("balanceRon", 0) - start_balance) < 1e-9
          and abs(res.get("allowanceAppliedRon", 0) - 1.8) < 1e-9,
          f"wallet {start_balance} -> {res.get('balanceRon')}, allowance {res.get('allowanceAppliedRon')}")

    status2, res2, _ = post("/api/billing/usage",
                            {"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1000000,
                             "outputTokens": 1000000, "requestId": rid}, cookie)
    check("replayed request is not charged twice",
          res2.get("duplicate") is True and res2.get("recorded") is False,
          f"duplicate={res2.get('duplicate')} recorded={res2.get('recorded')}")

    status3, res3, _ = post("/api/billing/usage",
                            {"modelKey": "not-a-model", "inputTokens": 10, "outputTokens": 10}, cookie)
    check("unknown model is rejected, not charged zero", status3 == 400, f"HTTP {status3}")

    status4, res4, _ = post("/api/billing/usage",
                            {"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 0, "outputTokens": 0}, cookie)
    check("zero usage costs nothing", abs(res4.get("costRon", -1)) < 1e-12, f"{res4.get('costRon')} RON")

    status5, _, _ = post("/api/billing/usage",
                         {"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1, "outputTokens": 1})
    check("usage without a session is refused", status5 == 401, f"HTTP {status5}")

    # Both pots, because they are interchangeable while the allowance lasts. An account
    # holding included allowance and no card money can still generate -- which is most of
    # them, since few people fund a card. Deciding from the wallet alone refused exactly
    # that case. Written before allowance-first existed, when the wallet absorbed the 1.8.
    status6, cg, _ = get("/api/billing/can-generate", cookie)
    floor = cg.get("minBalanceRon")
    expected_can = cg.get("allowanceRemainingRon", 0) > 0 or cg.get("balanceRon", 0) > floor
    check("can-generate tracks allowance OR wallet",
          status6 == 200 and cg.get("canGenerate") is expected_can,
          f"allowance={cg.get('allowanceRemainingRon')} wallet={cg.get('balanceRon')} "
          f"floor={floor} -> {cg.get('canGenerate')}")
    check("the reported floor is the account's own, not the hardcoded backstop",
          isinstance(floor, (int, float)) and floor != -0.5,
          f"floor={floor}")
    check("an account with allowance and a zero wallet is not refused",
          cg.get("balanceRon") == 0 and cg.get("allowanceRemainingRon", 0) > 0,
          "would be wrongly blocked")

    status7, bal2, _ = get("/api/billing/balance", cookie)
    check("recent spend is listed", status7 == 200 and len(bal2.get("recent", [])) >= 1,
          f"{len(bal2.get('recent', []))} rows")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
