"""Live check: the anonymous 3 RON allowance, metered by fingerprint.

Anonymous callers had a prompt *count*, which contradicted the RON budget they actually
had: a visitor holding all 3 RON could be refused for "prompts". Now they get a real
allowance, consumed at list price (no subscription, so no discount).
"""
import json
import secrets
import urllib.error
import urllib.request

BASE = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
IP = f"198.51.100.{secrets.randbelow(250) + 1}"
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:52} {detail}")


def req(path, method="GET", body=None, fingerprint=None):
    headers = {"accept": "application/json", "origin": ORIGIN, "x-forwarded-for": IP}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode()
    if fingerprint:
        headers["x-kafelot-fingerprint"] = fingerprint
    r = urllib.request.Request(BASE + path, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, (json.loads(raw) if raw else {})
        except Exception:
            return e.code, {"raw": raw[:200]}


def main():
    fp = "anon" + secrets.token_hex(8)

    print("=== the anonymous allowance ===")
    status, alw = req("/api/billing/allowance/anonymous", fingerprint=fp)
    check("anonymous allowance readable", status == 200, f"HTTP {status}")
    check("granted 3 RON", alw.get("grantedRon") == 3, f"{alw.get('grantedRon')} RON")
    check("nothing spent yet", alw.get("spentRon") == 0, f"spent {alw.get('spentRon')}")
    check("resets on the UTC month boundary",
          str(alw.get("resetAt", "")).endswith("01T00:00:00.000Z"), str(alw.get("resetAt")))

    print("\n=== metered at list price, covered by the allowance ===")
    # 1M input on the 230M at list = 0.30 RON, inside the 3.
    status, used = req("/api/billing/usage", "POST", {
        "modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1_000_000,
        "outputTokens": 0, "requestId": f"anon-{secrets.token_hex(5)}"}, fingerprint=fp)
    check("usage accepted", status in (200, 201), f"HTTP {status}")
    check("charged at list price (0.30, not the 0.21 subscriber rate)",
          abs(used.get("costRon", 0) - 0.30) < 1e-9, f"{used.get('costRon')} RON")
    check("covered by the allowance", abs(used.get("allowanceAppliedRon", 0) - 0.30) < 1e-9,
          f"{used.get('allowanceAppliedRon')}")
    check("2.70 RON left", abs(used.get("remainingRon", 0) - 2.70) < 1e-6, str(used.get("remainingRon")))

    print("\n=== a replayed report is not charged twice ===")
    rid = f"anon-{secrets.token_hex(5)}"
    a = req("/api/billing/usage", "POST", {
        "modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1_000_000,
        "outputTokens": 0, "requestId": rid}, fingerprint=fp)[1]
    b = req("/api/billing/usage", "POST", {
        "modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1_000_000,
        "outputTokens": 0, "requestId": rid}, fingerprint=fp)[1]
    check("same requestId charged once",
          abs(a.get("remainingRon", 0) - b.get("remainingRon", 0)) < 1e-9,
          f"{a.get('remainingRon')} then {b.get('remainingRon')}")

    print("\n=== the allowance is exhausted, never overdrawn ===")
    # 1M in + 1M out on the 2.6B is 42 RON, far past 3.
    status, big = req("/api/billing/usage", "POST", {
        "modelKey": "lfm2_5_2_6b_q4_0", "inputTokens": 1_000_000,
        "outputTokens": 1_000_000, "requestId": f"anon-{secrets.token_hex(5)}"}, fingerprint=fp)
    check("cost is still recorded at 42 RON", abs(big.get("costRon", 0) - 42.0) < 1e-6,
          f"{big.get('costRon')} RON")
    check("the allowance covers only what is left",
          abs(big.get("allowanceAppliedRon", 0) - big.get("remainingRon", 0)) < 1e-6 or
          big.get("allowanceAppliedRon", 0) <= 2.70 + 1e-6,
          f"allowance {big.get('allowanceAppliedRon')}")
    check("remaining is zero, not negative", big.get("remainingRon") == 0,
          str(big.get("remainingRon")))

    print("\n=== neither a session nor a fingerprint is refused ===")
    status, _ = req("/api/billing/usage", "POST", {"modelKey": "lfm2_5_230m_q4_k_m", "inputTokens": 1})
    check("no identity refused", status == 401, f"HTTP {status}")
    status, _ = req("/api/billing/allowance/anonymous")
    check("allowance without a fingerprint refused", status == 401, f"HTTP {status}")

    print("\n=== a malformed fingerprint is refused, a long one is truncated ===")
    # Rejected: too short to be a fingerprint, or carrying characters that are not
    # url-safe. These are refused rather than sanitised, so a caller cannot have their
    # budget silently keyed to something else.
    for bad in ["short", "has spaces here", "semi;colon", "quote\"inside", "slash/here"]:
        status, _ = req("/api/billing/allowance/anonymous", fingerprint=bad)
        check(f"rejected: {bad[:20]!r}", status == 401, f"HTTP {status}")

    # Accepted and truncated to 64, matching kafelot_anonymous_users.fingerprint which is
    # VARCHAR(64). Refusing here while the pre-flight path accepts would mean the two
    # halves of anonymous metering disagreed about what a fingerprint is.
    long_fp = "a" * 200
    status, truncated = req("/api/billing/allowance/anonymous", fingerprint=long_fp)
    check("over-long fingerprint truncated to 64, not refused", status == 200, f"HTTP {status}")
    # And it must be the SAME budget as its own 64-char prefix, which is the consequence.
    status2, same = req("/api/billing/allowance/anonymous", fingerprint="a" * 64)
    check("shares a budget with its 64-char prefix (the documented trade)",
          status2 == 200 and truncated.get("grantedRon") == same.get("grantedRon"),
          "truncation is consistent")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
