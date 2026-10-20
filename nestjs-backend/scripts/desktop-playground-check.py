"""Bounded live contract check for the desktop client's catalogue, affordability and streaming.

Everything here is bounded: a 180-second overall deadline, a 10-second statement timeout on
every query, and a fresh account per run that is deleted afterwards. A check that can hang
is a check that will be stopped and not believed.

The account is created with no card and with auto-refill off, deliberately. The automatic
refill tops a wallet up to its target, which would race the empty-wallet assertions below
and make them pass or fail depending on timing. Checkout is covered by test:spectre-addon.

The point of every check is money and access, not status codes. A 200 that quotes one price
and charges another looks identical from the caller's side, which is why the ledger is read
back after every generation.
"""
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "http://localhost:4000"
SMALL = "lfm2_5_230m_q4_k_m"
BIG = "lfm2_5_8b_a1b_q4_k_m"
DEADLINE = time.monotonic() + 180
checks = []
sys.stdout.reconfigure(line_buffering=True)


def remaining(cap=20):
    seconds = DEADLINE - time.monotonic()
    if seconds <= 0:
        raise TimeoutError("desktop check exceeded its 180-second deadline")
    return min(cap, seconds)


def check(name, ok, detail=""):
    checks.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'} {name}: {detail}", flush=True)
    if not ok:
        raise AssertionError(name)


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True,
                            timeout=remaining(20), **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[:250])
    return result.stdout.strip()


def psql(sql):
    # A statement timeout as well as the process timeout: a lock held by another session
    # must fail this check quickly rather than sit until the deadline.
    return run(["docker", "compose", "exec", "-T", "postgres", "psql",
                "-U", "filspresso_user", "-d", "filspresso", "-q", "-t", "-A",
                "-v", "ON_ERROR_STOP=1"],
               input="SET statement_timeout='10s'; SET lock_timeout='5s';\n" + sql)


def call(path, token=None, body=None, stream=False):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(
        API + path, data=None if body is None else json.dumps(body).encode(),
        headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=remaining(60 if stream else 15))
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read(1_000_000).decode()
        return response.code, (payload if stream else json.loads(payload or "{}")), dict(response.headers)


def main():
    print("=== setup: isolated account, 10s SQL timeout, 180s overall deadline ===")
    suffix = secrets.token_hex(6)
    email = f"desktop-p3-{suffix}@billing.test"

    # The password hash comes from the backend's own hasher, so the fixture is a real
    # Argon2id hash rather than a copy of one that might drift.
    password_hash = run([
        "docker", "compose", "exec", "-T", "backend", "node", "-e",
        "require('./dist/common/utils/passwords.js').hashPassword('LoadTest!2026x')"
        ".then(hash => process.stdout.write(hash))",
    ])
    account = psql(
        "INSERT INTO accounts(username,email,password_hash,name,role,subscription) "
        f"VALUES ('p3_{suffix}','{email}','{password_hash}','Phase 3 test','user','Free') "
        "RETURNING id;").splitlines()[0]

    try:
        print("=== device sign-in and locked catalogue ===")
        status, grant, _ = call("/api/auth/desktop/token", body={
            "email": email, "password": "LoadTest!2026x",
            "deviceId": f"phase3-device-{suffix}", "deviceName": "Phase 3 test",
            "platform": "windows", "appVersion": "0.1.0",
        })
        check("device grant", status == 200 and bool(grant.get("accessToken")), status)
        token = grant["accessToken"]

        def entitlement():
            status, body, _ = call("/api/desktop/entitlement", token)
            check("entitlement response", status == 200, status)
            return body

        def refused(model, expected):
            status, body, _ = call("/api/desktop/chat/stream", token,
                                   {"model": model, "message": "hi", "max_tokens": 4})
            check(f"{model} refused before inference", status == expected,
                  f"HTTP {status}, {body.get('error')}")

        state = entitlement()
        check("Free account has no Spectre access", not state["access"]["hasAccess"])
        check("six labelled text models", len(state["models"]) == 6 and all(
            m.get("label") and m["label"] != m["modelKey"] for m in state["models"]))
        check("locked models cannot generate", all(
            m["locked"] and not m["canGenerate"] for m in state["models"]))

        _, public, _ = call("/api/billing/pricing?audience=api")
        rates = {m["modelKey"]: (m["inputPer1M"], m["outputPer1M"]) for m in public["models"]}
        mismatches = [m["modelKey"] for m in state["models"]
                      if rates.get(m["modelKey"]) != (m["inputPer1M"], m["outputPer1M"])]
        check("all six prices match API list prices", not mismatches, str(mismatches))

        refused(SMALL, 403)

        print("=== add-on: Kafelot allowance cannot pay for desktop usage ===")
        psql(
            f"INSERT INTO account_addons(account_id,addon_code,price_ron,billing_cycle,"
            f"status,expires_at,auto_renew) VALUES ({account},'spectre',99.99,'monthly',"
            "'active',NOW()+interval '30 days',FALSE);"
            f"INSERT INTO account_balances(account_id,balance_ron,min_balance_ron) "
            f"VALUES ({account},0,0) ON CONFLICT(account_id) DO UPDATE "
            "SET balance_ron=0, min_balance_ron=0;")

        state = entitlement()
        check("add-on grants access", state["access"]["source"] == "addon")
        check("Free allowance still exists", state["allowance"]["remainingRon"] > 0)
        check("empty wallet blocks add-on usage", not state["canGenerate"] and all(
            m["requiresWallet"] and not m["usesAllowance"] and not m["canGenerate"]
            for m in state["models"]))
        refused(SMALL, 402)

        print("=== funded stream: read tokens, then verify the server's ledger ===")
        psql(f"UPDATE account_balances SET balance_ron=20 WHERE account_id={account};")
        check("funded add-on can generate", entitlement()["canGenerate"])

        status, raw, headers = call("/api/desktop/chat/stream", token,
                                    {"model": SMALL, "message": "Reply with: ready", "max_tokens": 16},
                                    stream=True)
        # The body is included, because "HTTP 503" on its own does not say whether the
        # refusal was the billing gate, the model service, or the transport.
        check("SSE served", status == 200 and "text/event-stream" in headers.get("Content-Type", ""),
              f"HTTP {status} {raw[:160]}")
        frames = [json.loads(line[5:].strip()) for line in raw.splitlines()
                  if line.startswith("data:") and line[5:].strip() != "[DONE]"]
        check("model returned text and completed",
              any(f.get("delta") for f in frames) and any(f.get("done") for f in frames))

        request_id = headers.get("x-filspresso-request-id")
        check("server request ID", bool(request_id))
        ledger = psql(
            "SELECT COALESCE(scope,'-')||'|'||COALESCE(price_mode,'-')||'|'||"
            f"COALESCE(bill_from,'-')||'|'||cost_ron FROM ai_token_usage "
            f"WHERE account_id={account} AND request_id='{request_id}';").split("|")
        check("exactly one desktop wallet charge",
              len(ledger) == 4 and ledger[:3] == ["desktop", "playground", "wallet_only"]
              and float(ledger[3]) > 0, "|".join(ledger))

        after = entitlement()
        balance_after = float((after["wallet"] or {}).get("balanceRon") or 0)
        check("balance updated after completion", 0 < balance_after < 20, f"20.00 -> {balance_after}")

        print("=== Max versus Ultimate: selected-model affordability ===")
        psql(f"UPDATE accounts SET subscription='Max' WHERE id={account};"
             f"UPDATE ai_monthly_allowance SET tier='max',granted_ron=100,spent_ron=0 "
             f"WHERE account_id={account};"
             f"UPDATE account_balances SET balance_ron=0 WHERE account_id={account};")

        state = entitlement()
        by_key = {m["modelKey"]: m for m in state["models"]}
        check("tier wins over old add-on", state["access"]["source"] == "tier")
        check("Max small model uses allowance",
              by_key[SMALL]["usesAllowance"] and by_key[SMALL]["canGenerate"])
        check("Max 8B needs funded wallet",
              not by_key[BIG]["usesAllowance"] and not by_key[BIG]["canGenerate"])
        refused(BIG, 402)

        psql(f"UPDATE accounts SET subscription='Ultimate' WHERE id={account};")
        state = entitlement()
        check("Ultimate allowance covers every text model",
              all(m["usesAllowance"] and m["canGenerate"] for m in state["models"]))

        print("=== expired access ===")
        psql(f"UPDATE accounts SET subscription='Free' WHERE id={account};"
             f"UPDATE account_addons SET status='ended',expires_at=NOW()-interval '1 day' "
             f"WHERE account_id={account};")
        state = entitlement()
        check("lapsed subscription is locked",
              not state["access"]["hasAccess"] and not state["canGenerate"])
        refused(SMALL, 403)
    finally:
        print("=== removing this run's fixture ===")
        try:
            psql(f"DELETE FROM accounts WHERE id={account} AND email='{email}';")
        except Exception as error:
            print(f"  (fixture cleanup failed: {error})", flush=True)

    print(f"RESULT: PASS ({len(checks)}/{len(checks)} checks)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"RESULT: FAIL — {error}", flush=True)
        sys.exit(1)
