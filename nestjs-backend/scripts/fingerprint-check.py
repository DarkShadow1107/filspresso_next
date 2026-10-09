"""Live check: both fingerprint layers validate strictly, and reject identically.

The point is agreement. The pre-flight check and the metering endpoint read the same
header and key the same budget, so a value one accepts and the other rejects is a way to
hold two budgets at once.
"""
import json
import secrets
import urllib.error
import urllib.request
import uuid

BASE = "http://localhost:4000"
ORIGIN = "http://localhost:3000"
GOOD = "9f804ce6-e364-4363-aa5b-58c729c8d66f"
checks = []


def check(name, ok, detail=""):
    checks.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:56} {detail}")


def call(path, method="GET", body=None, fingerprint=None, raw_fp=None):
    headers = {"accept": "application/json", "origin": ORIGIN,
               "x-forwarded-for": f"198.51.100.{secrets.randbelow(250) + 1}"}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode()
    if raw_fp is not None:
        headers["x-kafelot-fingerprint"] = raw_fp
    elif fingerprint is not None:
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
            return e.code, {"raw": raw[:160]}


# The same bad value through both entry points.
BAD = [
    ("too short", "abc"),
    ("no dashes", "9f804ce6e3644363aa5b58c729c8d66f"),
    ("over 36 chars", "a" * 37),
    ("way over 36 chars", "a" * 300),
    ("the old playground format", "9f804ce6e3644363aa5b58c729c8d66f"),
    ("the old coffee fallback", "fp-1700000000000-abc123"),
    ("uppercase", GOOD.upper()),
    ("version 1 not 4", "9f804ce6-e364-1363-aa5b-58c729c8d66f"),
    ("bad variant nibble", "9f804ce6-e364-4363-ca5b-58c729c8d66f"),
    ("injection", "'; DROP TABLE ai_token_usage; --"),
]


def main():
    print("=== both layers reject the same malformed values ===")
    disagreements = []
    for label, value in BAD:
        pre = call("/api/kafelot/check-and-use", "POST",
                   {"dry_run": True, "scope": "general"}, raw_fp=value)
        bill = call("/api/billing/allowance/anonymous", raw_fp=value)
        # 401 is acceptable only for "absent"; a *present* malformed value must be 400.
        pre_ok = pre[0] == 400
        bill_ok = bill[0] == 400
        agree = pre[0] == bill[0]
        if not (pre_ok and bill_ok and agree):
            disagreements.append(f"{label}: preflight={pre[0]} billing={bill[0]}")
        print(f"  {'ok ' if pre_ok and bill_ok and agree else 'BAD'}  {label:26} "
              f"preflight={pre[0]} billing={bill[0]}")
    check("every malformed fingerprint is 400 on both layers, identically",
          not disagreements, "; ".join(disagreements) or f"{len(BAD)} values")

    print("\n=== whitespace around a header value is stripped by HTTP itself ===")
    # Not an application-layer case: OWS around a field value is not part of the value per
    # RFC 9110, so Node's parser strips it before any handler runs. The server therefore
    # receives exactly the UUID and accepts it -- correctly, because " <uuid>" and "<uuid>"
    # are indistinguishable by the time any code can see them. parseFingerprint is still
    # strict about a padded string if one is passed to it directly (unit-tested).
    pre_ws = call("/api/kafelot/check-and-use", "POST", {"dry_run": True, "scope": "general"},
                  raw_fp=" " + GOOD)[0]
    check("padded header value arrives already stripped, and is accepted",
          pre_ws == 200, f"HTTP {pre_ws} (HTTP-level OWS, not an app decision)")

    print("\n=== absent is different from malformed ===")
    pre = call("/api/kafelot/check-and-use", "POST", {"dry_run": True, "scope": "general"})
    bill = call("/api/billing/allowance/anonymous")
    check("no fingerprint at all: billing refuses with 401",
          bill[0] == 401, f"billing={bill[0]}")
    check("the pre-flight path still serves an anonymous caller with no fingerprint",
          pre[0] == 200 and pre[1].get("allowed") is True,
          "it meters by fingerprint when there is one, and is rate-limited when there is not")
    print("\n=== a valid UUID still works end to end ===")
    fp = str(uuid.uuid4())
    status, alw = call("/api/billing/allowance/anonymous", fingerprint=fp)
    check("valid UUID accepted", status == 200, f"HTTP {status}")
    check("granted 3 RON", alw.get("grantedRon") == 3, str(alw.get("grantedRon")))

    print("\n=== nothing is truncated into a shared budget ===")
    # If over-long values were truncated to 36, the 37-char version would address the same
    # budget as its prefix. It is refused instead, so these are two separate budgets.
    prefix = GOOD[:36]
    exact = f"{prefix}"
    over = f"{prefix}x"
    s1 = call("/api/billing/allowance/anonymous", fingerprint=exact)[0]
    s2 = call("/api/billing/allowance/anonymous", fingerprint=over)[0]
    check("36-character UUID accepted", s1 == 200, f"HTTP {s1}")
    check("37-character value refused, not truncated onto the 36-char one", s2 == 400, f"HTTP {s2}")

    failed = [c for c in checks if not c[1]]
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} checks passed")
    print("RESULT:", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
