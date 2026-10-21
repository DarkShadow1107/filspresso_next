"""Live check: allowance-first spending, the funded wallet, and the ceiling.

Runs against the deployed stack. What only the database can answer is whether a charge is
split the way it should be: allowance first, wallet second, and the two never both paying
for the same tokens.
"""
import json
import os
import secrets
import subprocess
import urllib.error
import urllib.request

BASE = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
# A per-run client address. Register is budgeted 5/hour per IP, so repeated
# runs from one host address 429 on their own setup and every later check
# cascades as 401. Each run claims its own address.
# Random, not pid-derived: two runs started in the same second landed on the
# same address and one of them 429'd the other.
CLIENT_IP = f"198.51.100.{secrets.randbelow(250) + 1}"
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:54} {detail}")


def req(path, method="GET", body=None, cookie=None):
    headers = {"accept": "application/json", "origin": ORIGIN, "x-forwarded-for": CLIENT_IP}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode()
    if cookie:
        headers["cookie"] = cookie
    r = urllib.request.Request(BASE + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {}), resp.headers.get("set-cookie")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, (json.loads(raw) if raw else {}), None
        except Exception:
            return e.code, {"raw": raw[:200]}, None


def cookie_of(sc):
    if not sc:
        return None
    for part in sc.split(","):
        if part.strip().startswith("filspresso_session="):
            return part.split(";")[0].strip()
    return None


def psql(sql):
    """Fixture-only escape hatch.

    This check drives the product through HTTP, but promoting an account to a paid tier is
    not something a customer can do to themselves, and doing it through the subscription
    endpoint would also write a payment row -- noise in a check about allowances.
    """
    r = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "filspresso_user",
         "-d", "filspresso", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise SystemExit(f"psql failed: {r.stderr.strip()[:300]}")


def spectre_account():
    """A signed-in MAX account with no default card.

    Separate from the main fixture because this check needs to prove the card refusal is
    reachable -- which means passing the plan check first.
    """
    uniq = f"alwsp{secrets.token_hex(4)}"
    email = f"{uniq}@billing.test"
    status, _, sc = req("/api/auth/register",
                        "POST", {"username": uniq, "email": email, "password": "LoadTest!2026x"})
    if status != 201:
        return None
    psql(f"UPDATE accounts SET subscription = 'max' WHERE email = '{email}';")
    status, _, sc2 = req("/api/auth/login", "POST", {"email": email, "password": "LoadTest!2026x"})
    return cookie_of(sc2)


def main():
    uniq = f"alw{secrets.token_hex(4)}"
    email = f"{uniq}@billing.test"
    password = "LoadTest!2026x"
    status, _, sc = req("/api/auth/register", "POST", {"username": uniq, "email": email, "password": password})
    check("registered", status == 201, f"HTTP {status}")
    status, _, sc = req("/api/auth/login", "POST", {"email": email, "password": password})
    cookie = cookie_of(sc)
    check("signed in", bool(cookie))

    print("\n=== the free allowance ===")
    status, alw, _ = req("/api/billing/allowance", cookie=cookie)
    check("allowance readable", status == 200, f"HTTP {status}")
    check("free-with-account is 5 RON", alw.get("grantedRon") == 5, f"{alw.get('grantedRon')} RON")
    check("nothing spent yet", alw.get("spentRon") == 0, f"spent {alw.get('spentRon')}")
    check("reset date is the first of next month",
          str(alw.get("resetAt", "")).endswith("01T00:00:00.000Z"), str(alw.get("resetAt")))

    print("\n=== a charge is covered by the allowance, not the wallet ===")
    # 1M input on the 230M at list (free tier) = 0.30 RON, comfortably inside 5 RON.
    status, usage, _ = req("/api/billing/usage", "POST", {
        "modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1_000_000,
        "outputTokens": 0, "requestId": f"alw-{secrets.token_hex(5)}"}, cookie)
    check("usage recorded", status in (200, 201), f"HTTP {status}")
    check("cost is the list rate for a free account",
          abs(usage.get("costRon", 0) - 0.30) < 1e-9, f"{usage.get('costRon')} RON")
    check("covered entirely by the allowance",
          abs(usage.get("allowanceAppliedRon", 0) - 0.30) < 1e-9,
          f"allowance {usage.get('allowanceAppliedRon')}")
    check("wallet not touched", usage.get("walletChargedRon") == 0,
          f"wallet {usage.get('walletChargedRon')}")
    check("wallet balance unchanged", usage.get("balanceRon") == 0, f"balance {usage.get('balanceRon')}")

    status, alw2, _ = req("/api/billing/allowance", cookie=cookie)
    check("allowance reduced", abs(alw2.get("spentRon", 0) - 0.30) < 1e-9,
          f"spent {alw2.get('spentRon')}, remaining {alw2.get('remainingRon')}")

    print("\n=== the allowance spills over to the wallet rather than overdrawing ===")
    # 1M in + 1M out on the 2.6B is 7 + 35 = 42 RON at list, well past the 4.70 left.
    # A cheaper request would be covered entirely, which is correct but proves nothing
    # about the split.
    status, usage2, _ = req("/api/billing/usage", "POST", {
        "modelKey": "lfm2_5_2_6b_q4_0", "inputTokens": 1_000_000,
        "outputTokens": 1_000_000, "requestId": f"alw-{secrets.token_hex(5)}"}, cookie)
    check("usage recorded", status in (200, 201), f"HTTP {status}")
    check("cost is 42 RON", abs(usage2.get("costRon", 0) - 42.0) < 1e-6, f"{usage2.get('costRon')}")
    from_allowance = usage2.get("allowanceAppliedRon", 0)
    from_wallet = usage2.get("walletChargedRon", 0)
    check("allowance covers only what is left of it",
          abs(from_allowance - 4.70) < 1e-6, f"allowance {from_allowance} (had 4.70 left)")
    # The wallet holds 0 and its floor is 0, so there is nothing to draw and the 37.30 the
    # allowance could not cover is reported as uncovered rather than turned into debt.
    #
    # This used to assert the opposite -- that the balance went to -37.30 -- because that
    # is what the service did: canGenerate stopped the *next* request, but nothing bounded
    # *this* one, so a single generation larger than the wallet could push the balance
    # arbitrarily negative and it stayed there.
    check("the wallet is drawn only down to its floor", abs(from_wallet) < 1e-6,
          f"wallet {from_wallet}")
    uncovered = usage2.get("uncoveredRon", 0)
    check("what the wallet could not cover is reported, not absorbed",
          abs(uncovered - 37.30) < 1e-6, f"uncovered {uncovered}")
    check("the parts still add up to the cost",
          abs((from_allowance + from_wallet + uncovered) - 42.0) < 1e-6,
          f"{from_allowance} + {from_wallet} + {uncovered} = {from_allowance + from_wallet + uncovered}")
    check("the balance stops at the floor", usage2.get("balanceRon", 0) == 0,
          f"balance {usage2.get('balanceRon')}")

    status, alw3, _ = req("/api/billing/allowance", cookie=cookie)
    check("allowance is exhausted, never negative",
          alw3.get("remainingRon") == 0 and abs(alw3.get("spentRon", 0) - 5) < 1e-9,
          f"spent {alw3.get('spentRon')} of {alw3.get('grantedRon')}")

    print("\n=== the customer's own floor ===")
    status, mb, _ = req("/api/billing/min-balance", "PATCH", {"floorRon": 5}, cookie)
    check("floor settable", status == 200, f"HTTP {status}")
    check("floor stored", mb.get("minBalanceRon") == 5, str(mb.get("minBalanceRon")))
    status, mb2, _ = req("/api/billing/min-balance", "PATCH", {"floorRon": -99}, cookie)
    check("floor cannot go below the hard backstop", status == 400, f"HTTP {status2 if False else mb2.get('message','')}"[:60])
    status, mb3, _ = req("/api/billing/min-balance", "PATCH", {"floorRon": 0}, cookie)
    check("floor of 0 accepted (never negative)", status == 200 and mb3.get("minBalanceRon") == 0, str(mb3.get("minBalanceRon")))

    print("\n=== funding requires both a Spectre plan and a default card ===")
    # Two distinct refusals, and the order matters: the account below is a free tier, so it
    # is refused for its plan before its missing card is ever considered. Testing them in the
    # other order would assert the card message on an account that never reaches that check.
    status, nospectre, _ = req("/api/billing/fund", "POST", {"amountRon": 50}, cookie)
    check("a free account cannot fund the wallet at all", status == 403,
          f"HTTP {status} {str(nospectre.get('error'))[:50]}")
    check("the refusal names the plan that would work",
          "SPECTRE" in str(nospectre).upper(), str(nospectre)[:90])

    # Now a Spectre account with no card: the plan check passes and the card is the blocker.
    spectre_cookie = spectre_account()
    status, nocard, _ = req("/api/billing/fund", "POST", {"amountRon": 50}, spectre_cookie)
    check("a Spectre account without a default card is refused for the card", status == 400,
          f"HTTP {status} {str(nocard.get('error'))[:50]}")
    check("the refusal mentions the missing card", "card" in str(nocard).lower(), str(nocard)[:90])

    print("\n=== the balance endpoint carries the wallet rules ===")
    status, bal, _ = req("/api/billing/balance", cookie=cookie)
    check("auto-refill target is 30 RON", bal.get("autoRefillTargetRon") == 30, str(bal.get("autoRefillTargetRon")))
    check("ceiling is 1000 RON", bal.get("maxBalanceRon") == 1000, str(bal.get("maxBalanceRon")))
    check("allowance included", isinstance(bal.get("allowance"), dict))
    check("recent spend listed", len(bal.get("recent", [])) >= 2, f"{len(bal.get('recent', []))} rows")

    print("\n=== the allowance follows the plan the account is on ===")
    # The allowance row is keyed by (account, month), so it used to keep whatever tier
    # the account had when the month started: a customer who upgraded to Pro on the 3rd
    # metered against Free's 5 RON for the rest of the month, and the Usage & Wallet
    # page named a plan they no longer had.
    #
    # A fresh account on the free plan is the worst case for this, because the month
    # has already begun and the free row already exists.
    psql(f"UPDATE accounts SET subscription = 'max' WHERE email = '{email}';")
    status, upgraded, _ = req("/api/billing/allowance", cookie=cookie)
    check("the allowance is the new plan's", upgraded.get("grantedRon") == 100,
          f"{upgraded.get('grantedRon')} RON (tier {upgraded.get('tier')})")
    check("the allowance names the new plan", upgraded.get("tier") == "max", str(upgraded.get("tier")))
    status, upbal, _ = req("/api/billing/balance", cookie=cookie)
    check("the balance endpoint agrees",
          upbal.get("allowance", {}).get("grantedRon") == 100,
          str(upbal.get("allowance", {}).get("grantedRon")))

    # And back down again: the pot is the plan you are on, not the best one you had.
    psql(f"UPDATE accounts SET subscription = 'free' WHERE email = '{email}';")
    status, downgraded, _ = req("/api/billing/allowance", cookie=cookie)
    check("a downgrade lowers the pot again", downgraded.get("grantedRon") == 5,
          f"{downgraded.get('grantedRon')} RON (tier {downgraded.get('tier')})")
    check("what was already spent is not refunded",
          abs(downgraded.get("spentRon", 0) - 5) < 1e-9, f"spent {downgraded.get('spentRon')}")
    check("and the remaining is never negative", downgraded.get("remainingRon") == 0,
          str(downgraded.get("remainingRon")))


    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
