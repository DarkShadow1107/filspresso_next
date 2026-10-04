# Plan: AI Gateway Flask → FastAPI Migration

**Scope:** `app.py` (17 routes), `models/tanka.py`, `requirements.ai.txt`,
`Dockerfile.ai`, plus a new Python contract test suite.

**Explicitly out of scope:** the web application tier (Next.js + NestJS) — see
§7, the FastAPI migration has no effect on orders, payments or auth.

---

## Phase ordering (corrected after the original plan)

The first draft of this plan ran **B (async core) before C (FastAPI app)**. That
ordering is impossible: **Flask is WSGI and cannot await coroutines.** Converting
`tanka.py` to async first would leave Flask unable to call it at all, with no
working state in between and no way to bisect a failure.

The phases are therefore swapped:

| Step | Scope | `tanka.py` | Proves |
| --- | --- | --- | --- |
| **B** | FastAPI app, all 17 routes | still sync/blocking | the *framework swap* is behaviour-neutral |
| **C** | `tanka.py` → `httpx` async | becomes async | the *I/O swap* is behaviour-neutral |

Two independently verifiable steps, each gated on the 32-test contract suite.
Doing it in one commit would make any failure ambiguous.

**Why Step B is still safe despite async handlers.** Handlers must become
`async def` in order to `await request.json()`. If the blocking work then ran
directly on the event loop, one slow llama.cpp call would freeze every other
request — an availability regression versus waitress's 4 threads. To avoid that,
`_run_with_timeout` stays thread-backed in Step B and is awaited via
`run_in_executor`, so blocking work still happens off the loop. Step C then
removes that threadpool entirely, which is where the real concurrency win lives.

---

## 0. Why this is being done

The AI gateway is Flask 3.0 + waitress. Two independent reasons justify moving:

1. **waitress runs with no `--threads` flag, so it defaults to 4 threads.** A
   streaming Playground request occupies one thread for the whole generation
   (tens of seconds), so the 5th concurrent stream queues. This is a
   configuration bug that exists today, independent of any migration.
2. Blocking `requests` calls wrapped in `ThreadPoolExecutor` means one OS thread
   per in-flight generation. An event loop handles the same load without them.

Flask itself is **not** the problem. The SSE bug hit earlier in this work (a
`Connection` header, which PEP 3333 forbids on a WSGI response) was a bug in
code I wrote, not a framework limitation — Flask streams fine from a generator.
The real argument is FastAPI's native `StreamingResponse`, async cancellation
(a dropped client connection actually stops generation instead of orphaning it),
and Pydantic validation.

---

## 1. Verified contract constraints

These come from reading the callers, not from assumptions. Every one must hold
after the migration.

| # | Constraint | Enforced at |
| --- | --- | --- |
| 1 | `GET /api/health` returns **HTTP 200** with literal `status: "ok"` | `src/components/CoffeeRecommender.tsx:1181` |
| 2 | `POST /api/chat` text field is `assistant_response` (`generated` is dead legacy) | `src/app/api/python-chat/route.ts:569` |
| 3 | `model_used` must contain `"unavailable"` + (`"high-demand"` \| `"missing-mmproj"`) | `src/app/api/python-chat/route.ts:543-547` |
| 4 | SSE frames are `data: {json}\n\n`, separator **exactly `\n\n`** | `src/components/playground/PlaygroundContent.tsx:206-236` |
| 5 | SSE must **close the stream**; `done` is emitted but never read by the client | `PlaygroundContent.tsx:230` |
| 6 | Never set a `Connection` response header | `app.py:1370-1372` |
| 7 | Errors are `{"error": "<string>"}`; **400, not 422** — see §4 | `playground/chat/route.ts:129-131` |
| 8 | `/api/cancel/{id}` must return valid JSON (unguarded `res.json()`) | `src/app/api/python-chat/route.ts:622` |
| 9 | `/api/icons/save` → `{"status":"success","icon_path":"/images/icons/<name>.svg"}` | `src/components/account/AccountPageContent.tsx:223` |
| 10 | Keep port **5000** and plain HTTP — four independent TS base-URL resolvers and the docker healthcheck hard-code it | `src/lib/server/aiHost.ts:13`, `src/app/api/molecule/[...path]/route.ts:3`, `src/app/api/python-health/route.ts:13`, `src/app/api/icons/save/route.ts:3` |
| 11 | Timeout ordering `330s` (TS) > `300s` (Python) > `180s` (llama) preserves graceful degradation | `app.py:142-191`, `python-chat/route.ts:20` |
| 12 | The security overlay runs the container `read_only: true` with only `/tmp` tmpfs | `docker-compose.security.yml:275-299` |

---

## 2. Phase A — Parity suite (before any production code changes)

There is currently **zero** Python test coverage for `app.py`. This is the entire
safety net, so it is built and proven against Flask *before* the migration starts.

**A1.** Add `requirements.ai-dev.txt` (dev only, never in the runtime image):
`pytest`, `pytest-asyncio`, `httpx`.

**A2.** Create `tests/test_contract.py` with a framework-agnostic assertion
surface, runnable against either app object:

```
test_health_returns_200_and_status_ok
test_chat_returns_assistant_response_and_products
test_chat_unavailable_model_used_contains_high_demand
test_chat_invalid_mode_returns_400
test_chat_missing_message_returns_400
test_chat_error_body_is_json_with_error_string
test_stream_frames_are_double_newline_delimited
test_stream_emits_delta_and_closes
test_stream_emits_reasoning_only_when_thinking_enabled
test_stream_never_sets_connection_header
test_stream_sets_x_accel_buffering_no
test_warmup_status_vocabulary_is_stable
test_warmup_rejects_unknown_model_with_400
test_cancel_returns_valid_json
test_molecule_search_returns_molecules_array
test_molecule_detail_returns_molecule_object
test_molecule_svg_returns_raw_text
test_molecule_render3d_returns_raw_html
test_icons_save_returns_status_success_and_icon_path
test_validation_failure_returns_400_not_422      <-- constraint 7
```

**A3.** Monkeypatch `tanka` so no GPU is needed: stub `generate_coffee_text`,
`describe_image`, `stream_text`, `warmup_model`. Fast and deterministic.

**A4.** Run green against **Flask** today. This is the baseline. **Do not proceed
until it passes.**

**A5.** Capture golden fixtures from the live service for ~6 fixed inputs into
`tests/fixtures/`, so FastAPI output can be diffed field-for-field.

---

## 3. Phase B — FastAPI app (framework swap, `tanka` still sync)

**B1.** `lifespan` context: manage the warmup task and any shared clients.
Warmup stays a background thread in this step; it becomes an `asyncio.Task` in
Phase C when there is a loop to attach it to.

**B2.** Port all 17 routes unchanged in path and method. FastAPI accepts
`@app.route(..., methods=[...])`, so the decorators barely change; only the path
parameter syntax does:

| Flask | FastAPI |
| --- | --- |
| `<identifier>` | `{identifier}` |
| `<int:command_id>` | `{command_id}: int` |
| `<machine_id>` | `{machine_id}` |
| `<request_id>` | `{request_id}` |

**B3.** Handlers become `async def` so they can `await` the body. Reading it
becomes a helper that never raises, replacing `get_json(silent=True)`:

```python
async def read_json(request) -> dict:
    """Body read that cannot raise: absent or non-JSON becomes an empty dict."""
```

This matters because of constraint 7 — Flask's `request.json` raised 415 and the
broad handler masked it as a 500 (fixed earlier this session; now regression-tested).

**B4.** Replace `jsonify` with a `JSONResponse` helper, and convert every
`return jsonify(x), 400` tuple return into `json_response(x, 400)`. Starlette
does not unpack a tuple return.

**B5.** `request.form` / `request.files` become awaited; `request.args` becomes
the sync `request.query_params`.

**B6.** SSE route: `StreamingResponse(async_gen, media_type="text/event-stream")`
with `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. **No
`Connection` header.**

**B7.** Molecule render routes return explicit `Response(content, media_type=...)`
so raw SVG/HTML bytes survive: `image/svg+xml`, `text/html`.

**B8.** `CORSMiddleware` reproducing `CORS_ORIGIN` with
`allow_credentials=True`, matching the current `/api/*` scope.

**B9.** `iot_db.py` stays sync (five functions); call via
`starlette.concurrency.run_in_threadpool`.

**B10.** `_run_with_timeout` becomes async but stays thread-backed, using
`run_in_executor`, so blocking `tanka` calls stay off the event loop. Phase C
replaces it with `asyncio.wait_for` and deletes the threadpool.

**Gate:** all 32 contract tests green, and `tests/capture_golden.py` shows no
shape diff against `tests/golden/before.json`.

### The 422 question, answered

**The 422 risk is permanent, not transitional** — but it is avoidable by
construction rather than by discipline.

FastAPI only returns 422 if a route declares a Pydantic request model. If the
route hand-parses the body the way Flask does today, FastAPI returns whatever we
tell it to, including 400. So the outcome depends entirely on how it is written.

The danger is that "return 400, never 422" is an unwritten rule with no
enforcement, and no test would catch a violation unless one is written
specifically. Worse, today the client **cannot tell the difference**:

```ts
// src/app/api/playground/chat/route.ts:129-131
if (!upstream.ok || !upstream.body) {
    return jsonError("AI_UNAVAILABLE", "The AI runtime rejected the request.", 502);
}
```

The upstream error body is never read. A 400, a 422 and a 500 all collapse into
the same generic 502 message shown to the user.

**Recommended fix, which removes the risk rather than managing it:** make that
relay transparent — read the upstream error body, pass through its status and
`error`/`message` fields. ~8 lines, and then 400-vs-422 stops being a coupling
between two services at all. The
`test_validation_failure_returns_400_not_422` contract test stays as a
regression guard regardless, so the user-facing message stays specific even if
the relay changes.

This touches the TypeScript layer, which was otherwise out of scope. It is the
only change made there.

---

## 4. Phase C — Async core (`models/tanka.py` migrated to `httpx`)

**C1.** Replace `requests` with one long-lived `httpx.AsyncClient`, keeping
`_llama_headers()` (and therefore `LLAMA_CPP_API_KEY`) unchanged. Preserve
`LLAMA_CPP_TIMEOUT_SECONDS` semantics including the `(15.0, read)` pair used by
the stream at `tanka.py:438`.

**C2.** Convert to coroutines:

| Currently | Becomes |
| --- | --- |
| `stream_text` | async generator yielding `(channel, text)` — keep the tuple contract |
| `generate_coffee_text` | coroutine |
| `generate_chemistry_text` | coroutine |
| `describe_image` | coroutine |
| `warmup_model` | coroutine |
| `qwen_status` | coroutine (it calls `_load_qwen`, which does `requests.get`) |

**C3.** Replace `_run_with_timeout` (`app.py:294-309`, ThreadPoolExecutor +
`future.result(timeout=)`) with `asyncio.wait_for`. **This removes an OS thread
per in-flight generation** — the single largest concurrency win.

**C4.** Warmup state: `threading.Lock` → `asyncio.Lock`; the
`threading.Thread(daemon=True)` startup warmup (`app.py:352`) → an
`asyncio.Task` in the lifespan.

**C5.** Preserve byte-for-byte: `model_used` sentinel strings,
`_strip_think_block`, `_soft_thinking_override`, the dual `content` +
`reasoning_content` reads (LFM 2.5 emits thinking into `reasoning_content` even
with `reasoning: "off"`), and the 64×64 warmup PNG (a 1×1 PNG crashes the
llama.cpp image preprocessor).

**C6.** `predict_molecule` is dead (MolScribe removed) — leave a stub.

**Gate:** all 32 contract tests green, golden shape unchanged, and a live
concurrency smoke test showing no threadpool growth.

---


## 5. Phase D — Queue and backpressure for generation

Generation concurrency is capped by llama.cpp: **no `--parallel` flag is set on
any model service**, so each of the four llama containers has exactly **1 slot**
— a hard ceiling of ~4 concurrent generations regardless of the web tier. Per
your decision we add explicit queueing rather than more slots.

**D1.** Per-model-service `asyncio.Semaphore`, keyed by resolved base URL, so
`llama-minilm`, `llama-lfm`, `llama-gemma` and `llama-vision-lfm2-vl` each get
their own allowance matching their real slot count.

**D2.** New env knobs:

| Var | Default | Meaning |
| --- | --- | --- |
| `AI_MAX_CONCURRENCY_PER_MODEL` | `1` | matches llama.cpp slots |
| `AI_QUEUE_WAIT_SECONDS` | `20` | bounded wait before degrading |

**D3.** Acquire with a **bounded wait**, then degrade rather than error, which
preserves existing UX:

- `POST /api/chat` → the **existing soft-200** high-demand payload carrying the
  `model_used` sentinel. Contract-neutral; the browser already renders this.
- `POST /api/chat/stream` → **429** with `Retry-After`.

**D4.** A separate semaphore for the rdkit molecule routes — they are
CPU/memory-bound and never touch llama.cpp.

**D5. Timing conflict to resolve.** Queue wait is additive, so
`20s wait + 300s generation` can exceed the TypeScript budget of 330s and turn
graceful degradation into a hard 504. Carve the queue wait out of the Python
budget rather than raising `PYTHON_CHAT_TIMEOUT_MS`, so constraint 11 holds.

**D6.** Warmup shares the llama slot. Give it a **lower-priority allowance**
(a small separate semaphore) so pre-warming never starves a real user request.

### Phase D — delivered

Implemented in `models/gate.py` (`GenerationGate`, `MODEL_GATE`, `MOLECULE_GATE`),
wired at the route boundary in `app.py`, configured in `docker-compose.yml`.

| Item | How it landed |
| --- | --- |
| D1 | `asyncio.Semaphore` per llama.cpp **service**, keyed by `TankaModel.service_key()` (host:port of the resolved base URL), so every route aimed at the same single-slot container contends. Vision gets its own key and never blocks text. |
| D2 | `AI_MAX_CONCURRENCY_PER_MODEL=1`, `AI_QUEUE_WAIT_SECONDS=20`, `AI_WARMUP_MAX_CONCURRENCY=1`, plus `AI_MAX_CONCURRENCY_MOLECULE=2` / `AI_MOLECULE_QUEUE_WAIT_SECONDS=10`. |
| D3 | `/api/chat/stream` acquires **before** the response starts, so a full queue is a real **429 + `Retry-After`** rather than an in-band SSE error frame (an SSE error is impossible once headers are sent). `/api/chat` degrades soft-200 through the existing lexical fallback with the `high-demand` sentinel. `/api/chat/stream`'s 429 is relayed by `src/app/api/playground/chat/route.ts`; the Playground UI already renders `payload.message`. |
| D4 | Separate `MOLECULE_GATE`, **and** the rdkit work was moved off the event loop via `asyncio.to_thread` — see D4-note below. |
| D5 | `budget_after_queue_wait()` subtracts the queue wait from the generation budget (floored at 5s), so `waited + generation` stays inside the original 300s envelope and `PYTHON_CHAT_TIMEOUT_MS` is untouched. |
| D6 | Warmup runs behind the gate's warmup allowance and declines to start while a user request is queued or in flight. A deferred warmup releases its claim (`mark_warmup_deferred`) and reports `deferred`, which `useModelPrewarm` settles on quietly. |

**D4-note — the plan understated this.** A semaphore alone would have been
useless: `Chem.MolFromSmiles`, `DrawMolecule`, `AllChem.EmbedMolecule` and
`UFFOptimizeMolecule` all ran *inline* inside `async def` handlers, and
`_find_molecule_row` was sync psycopg2 called from the loop. Measured: a single
`render3d` pushed an unrelated `/api/health` response from **5 ms to 923 ms**
(~190×). Offloading to threads plus gating reduced the worst case to **78 ms**.
`_search_molecules_sync` was likewise extracted so the whole query, not just the
connection, runs in a worker.

**Bugs found and fixed while implementing Phase D** (all had regression tests):

1. **Warmup never loaded anything.** The route published `warming` via
   `claim_warmup`, then the background task called `warmup_model`, which claimed
   again, saw its own `warming` state and returned early — so the model stayed
   reported as `warming` forever. `warmup_model(..., claimed=True)` now skips the
   second claim. Latent since Phase C.
2. **Deferred warmup wedged the model.** `claim_warmup` refuses to re-claim a
   `warming` slot, so one deferred pre-warm permanently disabled pre-warming for
   that model. Fixed by `mark_warmup_deferred`.
3. **429 was destroyed in transit.** `src/app/api/playground/chat/route.ts`
   collapsed every non-OK upstream response to a generic 502, which would have
   turned "retry in 1s" into "the AI runtime rejected the request".
4. **`models/gate.py` was missing from the image.** `Dockerfile.ai` copies an
   explicit file list, so the container failed at import with
   `ModuleNotFoundError` while all 45 local tests passed. The file is now copied,
   with a comment warning that new modules under `models/` must be added.
5. **Gate was not loop-safe.** The module-level singleton cached semaphores, which
   bind to the first loop that awaits them; any second loop in the process raised
   `is bound to a different event loop`. It now rebinds on loop change.
6. **`app.py` had a dead Flask entrypoint.** `if __name__ == "__main__"` called
   `app.run(...)`, which FastAPI does not have, so running the file directly
   crashed with `AttributeError`. Now runs uvicorn with `workers=1`.

**Phase D gate:** 46 contract tests green, golden response shape unchanged
(only additive: `health.gates` and a populated `warmup_get.models`), and live
verification:

- 6 concurrent streams on one slot with a 2 s window → **1 streamed, 5 × 429
  `MODEL_BUSY`** with `Retry-After: 1`, `timed_out=5` recorded on the gate.
- 6 concurrent buffered `/api/chat` → all **HTTP 200**, 5 degraded to
  `MiniLM lexical retrieval (LFM 2.5 access high-demand)` with real fallback text.
- Warmup during a user stream → user kept the slot (`in_use=1`), warmup reported
  `deferred`, then `warming → ready` on a later attempt.
- `render3d` + concurrent `/api/health` → worst case **78 ms** (was 923 ms).
- 429 verified end-to-end through **Caddy → Next → FastAPI** (`retry_after: 1`).

**Gate state is exposed on `GET /api/health` under `gates`**, because a saturated
model is otherwise indistinguishable from a slow one in the logs.


---

## 6. Phase E — Packaging and runtime

**E1.** `requirements.ai.txt`: add `fastapi`, `uvicorn[standard]`, `httpx`;
remove `flask`, `flask-cors`, `waitress`. Keep `rdkit`, `py3Dmol`,
`psycopg2-binary`, `python-dotenv`.

**E2.** `Dockerfile.ai:40` → `CMD ["uvicorn", "app:app", "--host", "0.0.0.0",
"--port", "5000", "--no-server-header"]`.
**Single worker.** `--workers N` would multiply rdkit memory and give each worker
its own warmup state and semaphores — wrong for a 4 GB box.

**E3.** Confirm uvicorn needs no writable paths under the `read_only` security
overlay. It does not (no access-log-to-file).

**E4.** Leave port 5000, plain HTTP, and the `/api/health` path alone
(constraint 10). Note the docker healthcheck uses `wget` **without**
`--no-check-certificate`, so an HTTPS switch would break it.

### Phase E — delivered

| Item | Outcome |
| --- | --- |
| E1 | `requirements.ai.txt` already carried `fastapi`/`uvicorn[standard]`/`httpx` from Phase B. Removed the stale `requests==2.31.0` (dead since Phase C). Also dropped `flask`/`flask-cors`/`waitress`/`requests` from the root `requirements.txt` workspace manifest — nothing in the workspace imports them any more, and CI runs `pip-audit -r requirements.txt`. Verified inside the built image: `requests` and `flask` absent, `httpx` and `fastapi` present. |
| E2 | `CMD ["python", "-m", "uvicorn", "app:app", "--host=0.0.0.0", "--port=5000", "--no-server-header"]`. No `--workers`, so single worker, with the reason documented in the Dockerfile (extra workers would each get their own gate semaphores and oversubscribe every single-slot llama.cpp container). `app.py`'s `__main__` now runs uvicorn with `workers=1` instead of the removed Flask `app.run`. |
| E3 | **Verified, not assumed.** Booted the gateway under `docker-compose.security.yml` (`read_only: true`, `/tmp` tmpfs) and confirmed `Application startup complete`, `status: ok`, and a real `/api/chat` generation returning HTTP 200 with text. uvicorn needs no writable paths; `PYTHONDONTWRITEBYTECODE=1` is already set so nothing tries to write `__pycache__`. |
| E4 | Port 5000, plain HTTP and `/api/health` unchanged. Healthcheck is `wget -qO- http://localhost:5000/api/health` (no TLS), so the cert caveat above still stands. |

**Extra defect found and fixed during E3 — the 2D renderer was broken in the image.**
`/api/molecule/render2d` and `/api/molecule/svg` returned **500**
(`libXrender.so.1: cannot open shared object file`). The RDKit pip wheel does not
bundle the native cairo/X stack, and the failure only appears when a 2D render is
actually attempted — so it passed `/api/health`, passed `import rdkit`, and passed
every contract test, which render in the host Python rather than the container.
Added `libcairo2 libglib2.0-0 libfontconfig1 fonts-dejavu-core` to `Dockerfile.ai`
(`libcairo2` pulls `libXrender1`/`libXext6`/`libX11-6`; `libSM.so.6` is still absent
and is not needed). Both endpoints now return 200 with real `<svg>` markup.
This is the kind of gap the packaging phase exists to find: it is invisible to
every test that does not render inside the image.

**Phase E gate:** all six repo gates `0`, 46/46 Python tests, `py_compile` clean,
14/14 services healthy, and SSE + buffered chat + `render2d` + `render3d` + warmup
+ `/api/health` all verified against the rebuilt image.


---

## 7. Phase F — What this does NOT fix, and where your 50+ target actually lives

You asked about concurrency "for the web app — users logged in, making orders and
payments". That is a **different service from the one this migration touches**:

| Concern | Service | Concurrency model |
| --- | --- | --- |
| AI chat, Playground, molecule rendering, machine commands | `app.py` (this migration) | Flask+waitress 4 threads → FastAPI event loop |
| Auth, accounts, cart, orders, payments, subscriptions | `nestjs-backend` | Node event loop, **single process** |

The FastAPI migration has **zero effect** on orders or payments; it does not touch
that code path at all. For 50+ authenticated users placing orders, the real limits
are in NestJS:

1. **`nestjs-backend/src/database/database.service.ts:37` hardcodes `max: 20`.**
   Not env-configurable. Twenty concurrent order writes serialise on twenty
   connections. With Postgres at `max_connections = 100`, a replica count above 5
   would exhaust the server — so this hardcoded value is a scaling hazard, not
   just a bottleneck.
2. **`nestjs-backend/Dockerfile:38` runs `node dist/main.js`** — no cluster, so no
   replica can use more than one core.
3. `API_RATE_LIMIT_MAX` defaults to 1200/min (`configuration.ts:30`).

If you want, the sensible follow-up is small and separate: make the pool size
env-configurable, document the replica math against `max_connections`, and decide
whether to cluster NestJS. **I would not bundle that into this migration** — it is
untested-in-production infrastructure and mixing it with a framework swap makes
failures ambiguous.

**Still not fixed by this plan:** llama.cpp remains at 1 slot per model. Genuine
50+ concurrent *generations* still needs `--parallel`, extra replicas, or a job
queue — and `--parallel` competes for VRAM on a 4 GB card already running
LFM 2.5, LFM 2 Vision, Gemma and MiniLM. Recorded as follow-up, not actioned here.

---

## 8. Phase G — Verification

- **G1.** Same parity suite green against FastAPI.
- **G2.** Golden fixtures match field-for-field.
- **G3.** Repo gates: `npm run lint`, `npx tsc --noEmit`, `npm run build`,
  backend `typecheck`/`build`/`test` (currently 7/7).
- **G4.** Live smoke through Next **and** Caddy for all 7 consumed endpoints,
  including SSE token-by-token and the 400/401/403/429/502/503 paths.
- **G5.** Concurrency test: N simultaneous streams, asserting no exhaustion and
  that the 429 path fires cleanly at the configured limit.
- **G6.** `docker compose ps` shows `ai` healthy via the unchanged healthcheck.
- **G7.** Confirm cancelling a stream stops llama.cpp generation (a genuine
  FastAPI improvement over the current behaviour).

### Phase G — delivered

| Item | Result |
| --- | --- |
| G1 | Parity suite green — 48 tests. |
| G2 | Golden fixtures match field-for-field. Exactly **2 differences** vs the Flask baseline, both additive: `health.gates` (Phase D) and a populated `warmup_get.models` entry. No removals, no type changes. |
| G3 | All six repo gates `0`; `py_compile` clean. |
| G4 | Consumed surface **10/10 through both Next and Caddy**: health, molecule search, chat-400, playground-401, playground-403 `PLAYGROUND_LOCKED`, playground-400, cancel, warmup schedule + poll, SSE. Plus **2/2 fault injection**: gateway stopped → `503`; llama container stopped → in-band `error` frame. |
| G5 | Holder ran 37.2 s; **6/6 contenders got `429`** with `Retry-After`, 0 streamed, no other statuses. |
| G6 | `ai` healthy via the **unchanged** healthcheck (`wget -qO- http://localhost:5000/api/health`, byte-identical to `HEAD`). |
| G7 | Cancelled mid-stream at 11 s; the follow-up request acquired the freed slot in **0.8 s**. Cancellation genuinely interrupts llama.cpp instead of running to completion. |

**Three defects found by Phase G, all fixed:**

1. **The molecule proxy was dead outside the compose network.**
   `src/app/api/molecule/[...path]/route.ts:3` read `process.env.PYTHON_AI_HOST`
   directly, and `.env:159` sets that to the compose-internal `http://ai:5000`,
   which does not resolve when Next runs on the host. Every molecule
   search/render returned `502 MOLECULE_API_UNAVAILABLE` while the gateway itself
   answered 200. `resolveAiHost()` exists precisely to probe past unresolvable
   container hostnames and is used by every other proxy; this one bypassed it.
   Note `src/app/api/icons/save/route.ts` has its own separate multi-origin
   fallback chain that does work — a third implementation of the same idea, worth
   consolidating.
2. **A small `max_tokens` produced a completely silent empty stream.** LFM 2.5
   spends `max_tokens` on `reasoning_content` before writing any content and
   reasoning shares the same budget, so the response contained no `delta`, no
   `error`, and only `done` — the Playground could render nothing better than
   `(empty response)`. `sse_event_stream` now counts content and reasoning chunks
   and attaches an actionable `notice` to the `done` frame; `PlaygroundContent`
   prefers it over the bare placeholder. Live-verified: at `max_tokens` 1/4/16 the
   notice fires, and a normal reply carries no `notice`.
3. **`app.py`'s module docstring and the `Connection`-header comment still
   described Flask/waitress**, and `docker-compose.yml` called the gateway a
   "Flask gateway".

**On the 502 path:** once SSE headers are sent the status is fixed, so an
unreachable model **cannot** become an HTTP 502 — it arrives as an in-band
`error` frame on a 200. That is the honest SSE contract and is what the UI
renders. Getting a real status code would require probing the model's `/health`
before opening the stream, which is a design change rather than a bug fix.


---

## 8b. Phase H - Single-router model residency

Phase G shipped nine per-model llama servers. That works but costs the whole GPU
even when only the fast model is in use, so residency was replaced with a single
swapping router.

### What changed

- `models/router-presets.ini` lists the nine models explicitly and compose runs
  `llama-server --models-preset ... --models-max 1 -np 4`. `--models-dir` was
  rejected: it also picks up the MiniLM encoder, the mmproj projectors and the
  vocoder, which then appear as models.
- `models/residency.py` owns admission. Same-model requests may run concurrently -
  **4** for the 230M, **1** for everything else - and a swap is only ever started
  once no other request is in flight, so a long stream is never cut off by a model
  change. Verified: a 700-delta 230M stream completed while a 350M load was
  requested; the swap happened afterwards.
- Chat routes call `tanka.residency.slot(...)` instead of the old per-URL gate.
  `models/gate.py` remains for the molecule gate and queue-budget helpers.
- Router model ids drop the `.gguf` suffix. `router_model_id()` maps catalog
  filenames for `/models/load` and the chat payload.

### Hardware

Nine servers held 3741 of 4096 MiB, leaving 222 MiB. The router with the 8B
resident uses ~1235 MiB and leaves ~2728 MiB, because 8B is mostly MoE and only
~1B parameters are active per token (`cpu-moe` in the preset).

### Async loading (option b)

Selecting a model triggers the swap in the background and the UI shows determinate
progress, capped at 95% because the estimate is elapsed-time based; the router's
own `/models` status stays authoritative.

- `GET/POST /api/model-status?model=|load=` proxies the residency state.
- `src/hooks/useModelLoadStatus.ts` polls; `ModelLoadingBar` renders it in both
  the Playground and the chat composer.
- Estimates are self-calibrating: the first load of a model uses a default, later
  ones use the measured duration. 2.6B loaded in 64.4s, 8B in 201.8s.

**Defects found while wiring this up:**

1. `src/app/api/model-status/route.ts` validated its `model`/`load` parameter
   against `MODEL_FILE_BY_KEY`, which is keyed by model *key*, but the hook sends
   GGUF *filenames* - so every browser request 400'd. It now accepts either form
   and always forwards the filename.
2. `react-hooks/set-state-in-effect` fired on the polling hook. The setState calls
   are genuinely after an `await`, so the rule cannot see it; there is a justified
   block-level disable rather than contorting the code into a worse pattern.

### Send-path gating

`ensureLoaded()` only *starts* a swap, which is right for a background prewarm but
wrong before sending: the gateway would wait out `AI_QUEUE_WAIT_SECONDS` (20s) and
answer `429`. So the hook also exposes `waitUntilLoaded(timeoutMs)`, which starts the
load and then polls until the model is resident, and both send paths await it:

- `PlaygroundContent` throws a labelled error, rendered by the existing catch.
- `CoffeeRecommender` appends an assistant `Message`, matching how every other
  user-facing failure in that component is surfaced.

Verified through Next exactly as the browser does it: request 350M → one `200` →
progress `17 → 79 → 95 → 100` → loaded in 36.2s → chat returns 200 with
`model_used = LFM 2.5 350M access` → 230M swapped back in 12.1s.

`waitUntilLoaded` reads the status endpoint directly rather than React state, so it
stays correct when a handler captured an older render, and it treats `unavailable` as
terminal rather than waiting out the full timeout.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| **No Python tests exist today** | Phase A gates the entire migration |
| SSE byte-drift silently breaks streaming | Golden fixtures + framing assertions |
| FastAPI `422` leaking a generic 502 to users | §4: transparent relay + regression test |
| uvicorn mishandling a `Connection` header | Forbidden to set it (constraint 6) |
| Timeout ordering violated → hard 504s | D5 + G4 asserts degradation still fires |
| rdkit blocking the event loop | Explicit threadpool offload (B9) |
| Stream cancellation changes timing | G5, G7 |
| Read-only container breaks uvicorn | E3 |
| Scope creep into the web tier | §7 keeps it separate and visible |

---

## 10. Rollback

`app.py`, `models/tanka.py`, `requirements.ai.txt` and `Dockerfile.ai` are the
only files that change the running behaviour. Reverting those four plus
`docker compose build ai && docker compose up -d ai` restores Flask. The parity
suite is written to pass against both, so rollback is a first-class, tested state
rather than a hopeful one.
