#!/usr/bin/env python3
"""Verify the 230M serves 4 concurrent generations and queues the rest.

Phase 10. The per-model limit was already computed correctly
(``residency.concurrency_for_model`` returns 4 for LFM2.5-230M and 1 for everything
else) and ``llama_lfm`` already runs ``-np 4``. Neither fact proves four requests are
ever *in flight together*: the limiter can be right while the upstream serialises, in
which case the queue wait is pure loss.

So this fires N simultaneous requests at ``/api/chat``, samples
``gates.llama.in_flight`` while they run, and asserts:

  * the peak equals the limit (4) -- not 1, and not unbounded
  * every request is answered, none hangs
  * the requests beyond the limit waited rather than being dropped

Run from the repo root with the stack up::

    python scripts/ai-concurrency-check.py [concurrency]
"""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = "http://localhost:5000"
MODEL = "LFM2.5-230M-Q4_K_M.gguf"
EXPECTED_LIMIT = 4


def ask(n: int) -> dict:
    """One chat request.

    The endpoint reads ``text_model``, not ``model``. Sending ``model`` is silently
    ignored and the request falls back to TEXT_MODEL_MINILM, which reports a peak
    in_flight of 0 and looks like a limiter failure rather than a wrong field name.
    """
    body = {
        "message": f"In one short sentence, what is coffee number {n}?",
        "mode": "natural_language",
        "text_model": MODEL,
    }
    started = time.monotonic()
    req = urllib.request.Request(
        f"{BASE}/api/chat",
        method="POST",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode())
            return {
                "n": n,
                "status": resp.status,
                "ms": round((time.monotonic() - started) * 1000),
                "model_used": payload.get("model_used", ""),
            }
    except urllib.error.HTTPError as exc:
        return {
            "n": n,
            "status": exc.code,
            "ms": round((time.monotonic() - started) * 1000),
            "model_used": exc.read().decode()[:140],
        }
    except Exception as exc:  # transport failure, reset, timeout
        return {
            "n": n,
            "status": 0,
            "ms": round((time.monotonic() - started) * 1000),
            "model_used": str(exc)[:140],
        }


def main() -> int:
    concurrency = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    print(f"  model       {MODEL}")
    print(f"  concurrency {concurrency} simultaneous /api/chat requests")
    print(f"  limit       {EXPECTED_LIMIT} (llama.cpp -np 4, concurrency_for_model)")
    print("")

    samples: list[tuple[int, dict]] = []
    stop = threading.Event()

    def poll() -> None:
        while not stop.is_set():
            try:
                with urllib.request.urlopen(f"{BASE}/api/health", timeout=10) as resp:
                    gate = json.load(resp).get("gates", {}).get("llama", {})
                samples.append((len(samples), gate.get("in_flight") or {}))
            except Exception:
                samples.append((len(samples), {"__error__": True}))
            time.sleep(0.05)

    poller = threading.Thread(target=poll, daemon=True)
    poller.start()

    results: list[dict] = [None] * concurrency  # type: ignore[list-item]
    workers = [
        threading.Thread(target=lambda i=i: results.__setitem__(i, ask(i)))
        for i in range(concurrency)
    ]
    started = time.monotonic()
    for w in workers:
        w.start()
    for w in workers:
        w.join()
    wall = time.monotonic() - started
    stop.set()
    poller.join(timeout=2)

    peak = 0
    for _, in_flight in samples:
        if isinstance(in_flight, dict):
            for count in in_flight.values():
                if isinstance(count, int):
                    peak = max(peak, count)

    print("  responses:")
    for r in results:
        print(f"    #{r['n']}: HTTP {r['status']} {r['ms']}ms  {r['model_used']}")

    errors = [s for s in samples if "__error__" in s]
    latencies = sorted(r["ms"] for r in results)
    served = [r for r in results if "230M" in r["model_used"]]
    print("")
    print(f"  peak concurrent in_flight : {peak}  (expected exactly {EXPECTED_LIMIT})")
    print(f"  served by the 230M        : {len(served)}/{concurrency}")
    print(f"  health samples            : {len(samples)} ({len(errors)} unreachable)")
    print(f"  wall clock                : {wall:.1f}s")
    print(f"  latency min/median/max     : {latencies[0]} / {latencies[len(latencies)//2]} / {latencies[-1]} ms")
    print("")

    checks = [
        ("peak in_flight reaches the limit", peak >= EXPECTED_LIMIT, f"peak {peak}"),
        ("peak does not exceed the limit", peak <= EXPECTED_LIMIT, f"peak {peak}"),
        ("every request answered", all(r["status"] in (200,) for r in results),
         f"statuses {sorted({r['status'] for r in results})}"),
        ("the model actually served the traffic", len(served) == concurrency,
         f"{len(served)}/{concurrency} answered by the 230M"),
        ("health stayed reachable under load", not errors, f"{len(errors)} failed samples"),
        ("no request waited on a dead limiter", latencies[-1] < 10_000,
         f"slowest {latencies[-1]}ms"),
    ]
    print("  assertions:")
    ok = True
    for name, passed, detail in checks:
        ok = ok and passed
        print(f"    {'PASS' if passed else 'FAIL'}  {name:38} {detail}")
    print("")
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
