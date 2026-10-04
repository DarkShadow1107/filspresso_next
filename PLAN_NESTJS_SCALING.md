# Plan: NestJS Web Tier — Concurrency & Correctness for 50+ Authenticated Users

**Scope:** `nestjs-backend/` — the web tier serving auth, accounts, cart, orders,
cards, subscriptions, repairs and security observability.

**Related but separate:** the AI gateway migration lives in
`PLAN_FASTAPI_MIGRATION.md` (repo root). This plan has **no effect** on AI
generation concurrency, which is bounded by llama.cpp slots, not by this tier.

---

## 0. Decisions taken

| Decision | Choice |
| --- | --- |
| Session store | Move to Redis, **with an explicit invalidation write on logout** so revocation stays immediate |
| Rate limiting | `@nestjs/throttler` with a **Redis storage adapter** |
| Order bugs | Fix **both** in this plan (plus the wider pricing trust issue) |
| Process model | **Single process.** Fix the blockers rather than clustering |

**Why single process is right here.** Node's event loop handles I/O-bound traffic
on one core. This workload is dominated by Postgres and container-to-container
HTTP, not CPU. Clustering multiplies pool connections against
`max_connections = 100`, so N workers × pool is a connection-exhaustion trap for
no measured gain. Revisit only if Phase 0 shows event-loop saturation.

---

## 1. Baseline: what actually breaks at 50+ users

Ranked by likelihood of a real incident, not by code smell.

### 1.1 Argon2 saturates libuv's 4-thread threadpool — highest risk

`common/utils/passwords.ts:30` and `:38` are `async`, but `argon2` and `bcrypt`
are native addons whose async APIs dispatch onto **libuv's threadpool**:

```
node_modules/argon2/argon2.cpp:8   class HashWorker final : public Napi::AsyncWorker
node_modules/bcrypt/bcrypt.js:153  return bindings.encrypt(data, salt, cb);
```

`UV_THREADPOOL_SIZE` is **not set anywhere** (verified absent from `.env`,
`docker-compose.yml`, `Dockerfile`), so the pool is **4 threads**. At
`m=19456 KiB, t=3, p=1` (`passwords.ts:5-11`) each verify is ~50–150 ms CPU:

| Concurrent logins | Queued work | Tail latency |
| --- | --- | --- |
| 4 | 1 wave | ~150 ms |
| 20 | 5 waves | ~750 ms |
| 50 | ~12 waves | **~1.8 s** |

Plus transient RSS ≈ 19 MiB × 4 threads = 78 MiB.

**Compounding:** `auth/auth-complex.service.ts:416` calls `pool.connect()`, then
`:434` `await passwords.verifyPassword(...)` — the KDF runs **while holding one of
20 pooled connections**. Slow hashing therefore pins DB connections, so the two
bottlenecks feed each other.

Good news: no sync KDF exists. `hashSync|compareSync|verifySync|pbkdf2Sync|scryptSync`
→ **zero matches** repo-wide. `needsPasswordRehash` (`passwords.ts:62`) is sync but
only parses parameters out of an encoded digest — no KDF work.

### 1.2 Rate limiting does not exist

`common/middleware/global-rate-limit.middleware.ts` is 7 lines:

```ts
export function shouldEnableGlobalRateLimit(): boolean { return false; }
export function createGlobalRateLimiter() { return (req: any, res: any, next: any) => next(); }
```

No `@nestjs/throttler` in `package.json`, no `ThrottlerModule`, no `APP_GUARD`.
`main.ts:87-93` therefore always takes the `else` branch and logs the warning
*"Route-specific limiters remain active"* — **there are none**. Meanwhile:

- `API_RATE_LIMIT_*`, `ENABLE_RATE_LIMIT`, `DISABLE_RATE_LIMIT` are declared in
  `config/env.validation.ts:9-13` and read into `configuration.ts:29-33`, and
  **nothing consumes them.**
- `GLOBAL_RATE_LIMIT_EXCLUDED_PATHS` (`config/constants.ts:6-12`) is **never imported.**
- A `redis:7.4-alpine` container runs with `appendonly yes`, and
  **`grep redis|ioredis` across `nestjs-backend/src` returns nothing** — the backend
  never connects. `REDIS_URL` is absent from compose and `.env`.

The tier has no flood protection, and the expensive unauthenticated endpoints
(§1.5) are directly reachable.

### 1.3 No graceful shutdown in Docker

`main.ts:112-118` registers SIGTERM/SIGINT handlers **only when not in Docker**:

```ts
const runningInDocker = fs.existsSync("/.dockerenv");
if (runningInDocker) { logger.log("Running inside Docker. ..."); }
else { await dockerManager.startContainer(); dockerManager.setupShutdownHandlers(); }
```

In the container, `dumb-init --` forwards SIGTERM and Node has **no handler**, so
the process dies immediately: no request draining, no `pool.end()`, no
`app.close()`. Every `docker compose restart backend` or deploy drops in-flight
orders. `SecurityObservabilityScheduler.onModuleDestroy` — the only thing that
clears its two `setInterval`s — never runs.

Outside Docker the handler is worse for review purposes: `dockerManager.ts:125-129`
**stops the Postgres container and `process.exit(0)`**, dropping in-flight work.

### 1.4 Order correctness bugs that only appear under concurrency

`orders/orders.service.ts:205-268`:

```ts
const orderNumber = `ORD-${Date.now()}`;                                // :234  collides
for (const item of items) {                                             // :226-229
  const price = Number(item["unitPrice"] || item["unit_price"] || 0);  // client-controlled
  subtotal += price * Number(item["quantity"] || 1);
}
const shippingCost = freeShipping ? 0 : Number(body["shippingCost"] || ...); // :231 client-controlled
```

Three distinct problems:

1. **`orderNumber` collides.** Two checkouts in the same millisecond produce the
   same number, and there is no unique constraint, so duplicates are stored silently
   rather than rejected.
2. **Pricing is entirely client-trusted.** `unitPrice` (`:226`), `shippingCost`
   (`:231`) and per-item `totalPrice` (`:261`) all come from the request body.
   Nothing re-prices from the catalogue, and there is **no stock check anywhere** —
   `createOrder` never touches `coffee_products.stock` or `machine_products.stock`.
   A client can order any quantity at any price, and can waive shipping.
3. **Serial inserts.** `:251-264` issues one `INSERT INTO order_items` per item,
   awaited individually, all inside one transaction on a dedicated client. An order
   with N items costs **N + 3 round-trips**.

### 1.5 Unauthenticated expensive endpoints, no limits

| Endpoint | Cost |
| --- | --- |
| `GET /api/products/coffee` | `products.service.ts:38-48` — per-row `fs.existsSync`, **1–6 filesystem stats per product row** across the whole catalogue. Unguarded, uncached. |
| `GET /health/services` | `health.service.ts:155-189` — **serial** postgres + AI + admin checks, ~7 s worst case. Unguarded, unauthenticated, uncached. |
| `GET /health/services/ledger/verify?maxRows=` | `security-observability.service.ts:151-197` — **synchronous SHA3-256 chain walk over up to 100 000 rows** on the event loop; `maxRows` is caller-influenced. |
| `POST /api/repairs` | `repairs.service.ts:37-39` — `fetch` to `api.open-meteo.com` with **no `AbortController`/timeout**. Can hang indefinitely. |
| `GET /api/weather` | `weather.service.ts:76` — fetches `http://ip-api.com/...` over **plaintext HTTP**; `:105` open-meteo with no timeout. |

### 1.6 Pinned DB connections and unbounded waits

| Site | Problem |
| --- | --- |
| `weather.service.ts:84` → `:105` | `pool.connect()`, then an **untimed external HTTP call**, release at `:121`. An idle upstream holds one of 20 connections indefinitely. |
| `orders.service.ts:292` → `:316` | `pool.connect()`, then a 10 s cross-container fetch to `invoice-java`, buffering the **entire PDF in memory**, release at `:325`. The PDF is then gzipped by `compression({level:6})` (`main.ts:97`). |
| `subscriptions-engine.service.ts:57-76` | `fetch` to `kotlin-subscriptions` with **no timeout, no retry**. A hung service holds a socket forever. |
| `operations.service.ts:118-119` | `chunks.push(chunk)` with **no size cap** on the go-ops response. |
| `common/utils/replayGuard.ts:39` | An **unconditional `DELETE FROM security_operation_replay_guard WHERE expires_at < NOW()`** on every guarded request — a full-table write on the hot path, applied to 10 `/api/crypto/*` routes plus `/api/operations/events`. |

### 1.7 Per-request event-loop waste

- **Uncached key parsing.** `auth-tokens.ts:191-193` rebuilds the Ed25519
  `KeyObject` from the cached PEM string on **every authenticated request** (OpenSSL
  PEM parse + `EVP_PKEY` setup). Same at `serviceAssertions.ts:89` and `:165`
  (`createPrivateKey`, on every outbound invoice/crypto/subscription request).
- **Three full walks of the request body.** `main.ts:95` parses up to **10 MB**;
  `common/pipes/trim-strings.pipe.ts:3-18` then **deep-clones the entire object
  graph** (`Object.entries().map()` + `Object.fromEntries()` per node);
  `ValidationPipe` at `:104-108` walks it a third time.
- **`crypto.hkdfSync`** at `encryption.ts:66` and `:68` — a genuinely synchronous
  KDF, reached via `encrypt`/`decrypt` on every MFA enroll/verify and card
  create/list (`cards.service.ts:24-26`, `auth-complex.service.ts:384,499,594`).
- **`HttpExceptionFilter` does not log at all.** 4xx noise is invisible, so there is
  no signal on the very traffic we would rate-limit.

---

## 2. Phase 0 — Instrumentation (first)

You cannot tune what you cannot see, and this tier emits no per-request signal.

**0.1.** Add a duration log via an interceptor in `main.ts`: method, path template,
status, `durationMs`, existing `requestId`. Skip `/health*` and static assets.
Behind a new `LOG_REQUESTS` flag so it can start off in production.

**0.2.** Make `HttpExceptionFilter` log at `warn` for 4xx and `error` for 5xx,
including `requestId` and route. Currently silent.

**0.3.** Add `LOG_LEVEL` (default `["log","error","warn"]`) via
`Logger.overrideLogger`. NestJS enables `debug` and `verbose` by default — pure
overhead in production.

**0.4.** Verify `ORIGIN_GUARD_DEBUG` is `false` in the running container.
`origin-guard.middleware.ts:62-74` logs the **full header set of every
state-changing request** when enabled.

**0.5.** Expose pool `totalCount` / `idleCount` / **`waitingCount`** on
`GET /health/services`. `pg` provides all three and `waitingCount` is the single
most useful saturation signal for sizing.

---

## 3. Phase 1 — Configuration-only fixes

Cheapest real wins; no business-logic change.

| Change | Where | Why |
| --- | --- | --- |
| `UV_THREADPOOL_SIZE=16` | backend env | Fixes §1.1 immediately |
| `LOG_LEVEL` | new env | §0.3 |
| `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_IDLE_TIMEOUT_MS` | new env, read at `database.service.ts:31-44` | Makes the hardcoded `max: 20` (`:37`) tunable. **Keep the default at 20** and tune from Phase 0 data. |
| Document `UV_THREADPOOL_SIZE` in `.env.example` | — | It is otherwise invisible |

**Also fix the hourly error noise.** `security-observability.service.ts:160` calls
`execFile(process.execPath, args, { cwd: resolveExpressApiPath() })`, and
`legacy-paths.ts:12` maps that to an internal legacy bridge that was removed —
that is the `spawn /usr/local/bin/node ENOENT` seen hourly. Point `cwd` at an
existing path or disable the scheduler via the existing
`SECURITY_LEDGER_ARCHIVE_ENABLED` flag. Left alone it is a permanent red herring.

> **Correction (verified against the running stack, 2026-10-02).** This note
> previously claimed the ENOENT "also keeps the backend healthcheck `unhealthy`".
> **That is wrong**, and acting on it would have been wasted work. The ENOENT is
> caught and logged (see the `try/catch` at `:174-179`); it never affects the
> healthcheck. The healthcheck failed for two *separate* reasons, both now fixed:
>
> 1. **Flaky healthcheck command** (`docker-compose.yml:200-212`). The probe was
>    `node -e "http.get(..., r => { if (r.statusCode !== 200) throw ... })"` with no
>    `process.exit()`, so the verdict depended on the event loop draining — a
>    keep-alive socket held it open past the 5 s timeout and Docker recorded
>    `exit -1, Health check exceeded timeout (5s)` while `/health` answered 200 in
>    ~5 ms. Now `res.resume()` + explicit `process.exit(0|1)` + an `.on('error')`
>    handler, making the verdict deterministic. **Fixed.**
> 2. **Unhandled `'error'` on the pg pool** (`database.service.ts:31`). `new
>    Pool(...)` had no `pool.on("error", ...)`. Postgres terminates idle clients
>    (`code: '57P01'`, `admin_shutdown` — seen here every few minutes), the
>    resulting `PoolClient` emitted `'error'` with no listener, and Node rethrew:
>    `throw er; // Unhandled 'error' event` — killing the whole process and
>    crash-looping it (`RestartCount` climbed past 11). pg already discards the bad
>    client and opens a fresh one, so the fix is to log and keep serving.
>    **Fixed** by adding the listener.
>
> Net effect: the backend is `running healthy` with `RestartCount=0`. Do **not**
> re-point the healthcheck at the archive scheduler — that is a cosmetic error-log
> cleanup, not a health issue.

### Phase 1 — delivered

| Change | Where | Note |
| --- | --- | --- |
| `UV_THREADPOOL_SIZE=16` | backend env in `docker-compose.yml`, documented in `.env.example` | Verified live in the container. |
| `DB_POOL_MAX` / `DB_POOL_MIN` / `DB_POOL_IDLE_TIMEOUT_MS` | read at `database.service.ts` via a new `parsePoolInt` helper | Defaults keep the historical `20 / 2 / 30000`, so nothing changes until deliberately tuned. The helper falls back rather than handing NaN to `pg`. |
| `LOG_LEVEL` | `resolveLogLevel()` in `config/constants.ts`, applied with `app.useLogger([level])` in `main.ts` | This was **not** merely a new env var: the app is created with `bufferLogs: true` and nothing ever called `useLogger()`, so the level was hardcoded. `useLogger()` also takes a `LogLevel[]`, not a single level. Unrecognised values fall back to `log` so logging cannot be accidentally disabled. |
| Archive scheduler | `security-observability.service.ts` | The script `archive_security_ledger.js` **does not exist anywhere in the repo** and `src/legacy-bridge` is gone, so this job could never succeed — pointing `cwd` at a real path (the plan's first suggestion) would only change the error text. Default flipped to opt-in, the script path is checked with `fs.existsSync` before spawning, and the warning is logged once instead of hourly. `SECURITY_LEDGER_ARCHIVE_ENABLED` defaulted to `false` in `.env.example` and both compose files. |

> **Note on `.env`:** your local `.env:81` still says
> `SECURITY_LEDGER_ARCHIVE_ENABLED=true`, so it overrides the new compose default.
> The job now logs one actionable warning per boot instead of an hourly
> `spawn ... ENOENT`. Set it to `false` to silence that line.

**Measured login tail latency** (`UV_THREADPOOL_SIZE=16`, same account, all
requests returned 200, no lockouts):

| Concurrent logins | median | p95 |
| --- | --- | --- |
| 4 | 118 ms | 125 ms |
| 10 | 234 ms | 265 ms |
| 20 | 2375 ms | 2500 ms |
| 40 | 665 ms | 859 ms |

**This does not confirm §1.1 is fixed.** Up to ~10 concurrent logins the tail is
flat and sub-300 ms, which is the threadpool behaving as intended. But the
c=20 result is a hard 2.5 s plateau, and c=40 is *faster* than c=20 — libuv
threadpool queueing is monotonic in concurrency, so this cannot be hashing. It
points at a second, independent serialization, most likely the §1.1 compounding
factor (`auth-complex.service.ts` holds a pooled connection across
`verifyPassword`, so `DB_POOL_MAX=20` caps 20 concurrent logins *while* they
hash) or §1.6.

**Consequence for sequencing:** raising `UV_THREADPOOL_SIZE` alone does not buy
50-user headroom. Phase 7 (stop pinning connections across the KDF) is on the
critical path for login latency, and Phase 0 instrumentation should be used to
confirm which of the two is the real limiter before Phase 7 starts.



---

## 4. Phase 2 — Graceful shutdown

Move `setupShutdownHandlers` registration **out** of the `else` branch so it runs
in Docker, and rewrite it properly:

1. `app.enableShutdownHooks()` so `onModuleDestroy` runs (this is what clears the
   observability intervals).
2. On SIGTERM: stop accepting new connections → drain in-flight requests with a
   hard deadline → `pool.end()` → exit.
3. **Keep "stop the Postgres container" strictly non-Docker.** In compose, Postgres
   has `restart: unless-stopped` and a healthcheck; a handler that stops it would
   take the database down on every restart.
4. Bound the drain (~25 s) so `docker stop` does not escalate to SIGKILL
   mid-checkout.

---

### Phase 2 — delivered

| Change | Where | Note |
| --- | --- | --- |
| `app.enableShutdownHooks()` | `main.ts` | Registered **unconditionally**. It previously lived in the non-Docker branch, so in Docker — i.e. every real deployment — the graceful path never ran and the observability intervals were never cleared. |
| SIGTERM/SIGINT handler | `main.ts` | `app.close()` (stop accepting, drain in-flight) → `DatabaseService.endPool()` → exit 0. Idempotent via a `shuttingDown` flag. |
| `endPool()` | `database.service.ts` | `pool.end()` drains in-flight queries. Without it the process exits with sockets open, which is what produces "server closed the connection unexpectedly" for a checkout interrupted mid-write. Errors are logged, not thrown, so shutdown always terminates. |
| `SHUTDOWN_TIMEOUT_MS` (25 s) + `stop_grace_period: 40s` | `.env.example`, `docker-compose.yml` | The drain is hard-bounded so `docker stop` cannot escalate to SIGKILL mid-checkout. Compose's grace period must **exceed** the drain budget or the SIGKILL lands first and the drain is pointless. |

Live-verified: `docker compose stop backend` produced
`Received SIGTERM; draining for up to 25000ms` →
`PostgreSQL pool closed cleanly` → `Graceful shutdown complete`,
and `RestartCount=0`.

Deliberately **not** done: stopping the Postgres container from the handler.
Postgres has `restart: unless-stopped` and a healthcheck, so a handler that
stopped it would take the database down on every restart.

## 5. Phase 3 — Sessions in Redis (biggest structural change)

**Goal:** remove the per-request `SELECT ... FROM user_sessions` that
`ActiveSessionService.resolve` used to run on every authenticated request, while
keeping logout revocation **immediate**.

### Design

- **Key:** `sess:<sha256(token)>` — reuse the existing `hashSessionToken`, so no raw
  token is ever stored.
- **Value:** `{ sessionId, accountId }`.
- **TTL:** the token's remaining lifetime (`claims.exp - now`).
- **Write:** on login/register/OAuth/MFA — `SET … EX <ttl>` alongside the existing
  `INSERT INTO user_sessions`.
- **Invalidate:** on logout, logout-all and per-session revoke — **`DEL` the key
  immediately**, so revocation stays instant. The `DELETE FROM user_sessions`
  remains for the audit trail.
- **Read path:** Redis first; on a miss, fall back to the Postgres query and
  repopulate Redis (self-healing after a Redis restart).

### Why this preserves the security property

Logout performs an explicit `DEL`, so there is **no cache window** — unlike a TTL
cache, which would widen it to the TTL. The JWT `exp` is unchanged and still caps
the session. `user_sessions` stays authoritative for `GET /api/auth/sessions`, which
is low-frequency.

### Failure mode

If Redis is unavailable, **fall back to Postgres** rather than failing open. The
tier must degrade to correct-but-slower, never to unauthenticated.

### Required groundwork

Redis currently has **no password** and is published on host `6379`. Now that it
holds session credentials it must:

- Add `requirepass` and expose `REDIS_URL` with credentials.
- Remove the host port publish in `docker-compose.security.yml` (internal network
  only), mirroring how `ai` is handled there.
- Add `redis` to the backend's `depends_on` with `condition: service_healthy`.
- Add graceful-shutdown handling to the Redis client so in-flight commands drain.

### Phase 3 - delivered

Implemented in `common/guards/session-store.service.ts`.

**Read path.** `ActiveSessionService.resolve` no longer queries Postgres. It calls
`SessionStoreService.findLiveSession`, which reads Redis, falls back to Postgres on
a miss, and repopulates. Verified live: **150 authenticated requests produced 0
`user_sessions` reads** (measured via `pg_stat_all_tables`, unchanged across the
load). The JWT signature and `exp` are still verified on every request, so Redis is
never an authority for *identity* -- only for *liveness*.

**Writes.** `createAndCache` replaces the five duplicated `INSERT INTO user_sessions`
statements (register, password login, MFA completion, OAuth, admin login) with one
call that writes the row and the cache entry together, so they cannot drift. These
run on an autocommit pooled connection, so the row is committed before it is cached
and there is no transaction/rollback window.

**Revocation.** `invalidateSession` (logout) issues the Redis `DEL` **before** the
Postgres delete, so revocation does not depend on the database and is not widened by
it. `revokeSession` now returns `session_token_hash` and evicts by hash via
`keyForHash`, which is why keys are `sess:<sha256(token)>` -- the DB stores that same
hash, so a revoke that only knows the row can still compute the key. Verified live:
logout and revoke-by-id each evict exactly one key, and the revoked cookie 401s
immediately on `/api/auth/me`, `/api/auth/sessions` and `/api/chat/sessions`.

**TTL.** The entry expires at `min(row remaining, token remaining)`, computed in one
shared `ttlForSession` so the login and fallback paths cannot drift.

> Live testing caught this being wrong twice. `JWT_EXPIRES_IN` is `15m` but
> `AUTH_SESSION_IDLE_TIMEOUT_DAYS` is `30`, so keying the TTL off the row gave every
> login a ~30-day cache entry for a 15-minute token. The login path was fixed, and
> then a `FLUSHALL` probe showed the fallback path *still* re-seeded 30-day entries.
> The fix was to collapse both paths onto one function rather than patch the second
> site. Not exploitable -- `verifyToken` rejects an expired token before the cache is
> consulted -- but it would have leaked ~30 days of dead keys per login.

**Degradation.** With Redis stopped, `/api/auth/me` still returned 200 via the
Postgres fallback and a forged token still 401s, i.e. it degrades to slower rather
than to unauthenticated. A missing `error` listener would have killed the process,
the same class of bug as the missing `pg` pool listener.

**Self-heal.** After `FLUSHALL`, one request repopulated the key from Postgres and
subsequent requests were cache hits again (0 further DB reads).

**Groundwork.** Base compose gained `REDIS_URL`/`REDIS_PASSWORD`/`REDIS_PASSWORD_FILE`
on the backend and `redis: condition: service_healthy` in `depends_on`. The hardened
overlay mounts `redis_password` into the backend, and the redis healthcheck is
overridden to `REDISCLI_AUTH="$(cat /run/secrets/redis_password)" redis-cli ping |
grep -q PONG` -- a bare `redis-cli ping` returns `NOAUTH` once `requirepass` is set,
which would have left redis permanently unhealthy and hung every dependent service.
Verified against a throwaway Redis with `requirepass` before relying on it.

Credentials follow the convention `go_ops` already uses: the backend reads
`REDIS_PASSWORD_FILE` first (a Docker secret), so no password is interpolated into a
compose file or env dump.

**Shutdown.** `onModuleDestroy` calls `quit()` rather than `disconnect()`, so
in-flight commands drain. Verified: SIGTERM logs `Graceful shutdown complete`, exit 0.

Tests: `test/session-store.test.ts` (15 cases) covers key derivation, account
matching, revoked/expired rows, `EX` never being <= 0, inverted-config precedence,
malformed tokens, and Redis-down degradation.

---

## 6. Phase 4 — Rate limiting

- Add `@nestjs/throttler` + a Redis storage adapter
  (`@nest-lab/throttler-storage-redis`), registering `ThrottlerGuard` globally.
- Wire the already-declared `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` as the
  global default, so the dead env vars become live and tunable without a deploy.
- **Per-route overrides**, tighter than the global default, on:
  `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/mfa/*`,
  `POST /api/admin/login`, `POST /api/admin/mfa/*`, `POST /api/orders`,
  `POST /api/repairs`, `GET /health/services*`,
  `GET /health/services/ledger/verify`, `POST /api/crypto/mpc/*`.
- Honour the existing `GLOBAL_RATE_LIMIT_EXCLUDED_PATHS` intent: auth and Kafelot
  paths are excluded from the *global* limiter but get their own per-route limits,
  not none.
- **Fix the misleading boot warning** at `main.ts:90-92`, which claims route-specific
  limiters remain active when none existed.
- Delete the dead `global-rate-limit.middleware.ts` no-op and its unused
  `GLOBAL_RATE_LIMIT_EXCLUDED_PATHS` export, so there is one limiter rather than a
  disabled one plus a real one.

### Phase 4 - delivered

- `@nestjs/throttler` 6.7.1 + `@nest-lab/throttler-storage-redis` 1.2.0.
  `ThrottlerGuard` is registered globally via `APP_GUARD` in
  `common/guards/rate-limit.module.ts`.
- **Redis-backed counters**, not the in-memory default. The backend sits behind
  Caddy and can be scaled out, so a per-process counter would make the effective
  limit `limit x replicas`. Verified live: counters appear in Redis as
  `{<tracker-hash>:default}:hits` / `:blocked`, so replicas share one budget.
- `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` now actually drive the global
  default. They were previously declared, Joi-validated, and never read.
- Per-route overrides live in `config/rate-limit.policy.ts` rather than inline on
  each handler, so the policy is reviewable in one place and a test can assert its
  invariants. Applied to all ten routes the plan names: auth login/register/mfa,
  admin login/mfa, orders, repairs, `GET /health/services`,
  `GET /health/services/ledger/verify`, and the three MPC routes.
- Deleted `global-rate-limit.middleware.ts` (a no-op returning `next()`
  unconditionally, behind `shouldEnableGlobalRateLimit()` which returned `false`)
  and the unused `GLOBAL_RATE_LIMIT_EXCLUDED_PATHS` in `constants.ts`, which moved
  to the policy module and is now actually consulted.
- Removed the boot warning claiming "Route-specific limiters remain active" when
  none existed.

Verified live: `POST /api/auth/login` allows 10 attempts per 15 minutes and returns
`429` + `Retry-After: 900` on the 11th with `ThrottlerException`.
`GET /health/services` and `GET /health` are unaffected, confirming the limiter is
per-route.

**This is a second, independent lockout.** `auth_login_attempts` already limits per
*username* with an escalating backoff (`AUTH_LOCK_THRESHOLD`, min 8, default 10).
The new limiter is per *client IP*. They are complementary: the old one stops
repeated attempts against one account, the new one bounds the total attempt rate
from one client.

> Testing note: measuring the new limiter with a single username is a trap.
> `auth_login_attempts` trips first and returns its own `429` ("Too many failed
> login attempts"), which reads like the throttler firing at the wrong threshold.
> Use a distinct username per request to isolate the IP limiter.

**Rate vs. window.** The tests assert that no override permits a higher request
*rate* than the global default, rather than comparing `limit` and `ttl`
independently. A raw window comparison is wrong: `register` allows 5 requests per 60
minutes against a global 1200 per 15 minutes, so its window is longer while its
permitted rate is ~960x lower.

Tests: `test/rate-limit.policy.test.ts` (6 cases) covers plan coverage, the rate
invariant, credential routes being the tightest group, sane values, prefix-based
exclusion matching, and that every excluded auth/admin path still has its own rule.

---

## 7. Phase 5 — Auth hot path

**5.1.** Move the Argon2 verify **outside** the pooled connection.
`auth-complex.service.ts:416-443` should: fetch the user row → `release()` →
`await verifyPassword()` → re-acquire and write. Decouples the two bottlenecks in
§1.1.

**5.2.** Reassess `ARGON2_*` after measuring. Note they live in root `.env:151-154`
but are **not passed into the backend container** (`docker-compose.yml:90-193` has no
`ARGON2_*` keys), so the container silently uses hardcoded defaults — the deployed
parameters are not the documented ones. Either wire them through or change the
defaults deliberately.

**5.3.** Cache the Ed25519 `KeyObject` (§1.7) — a module-level `Map<kid, KeyObject>`
in `auth-tokens.ts`, and the same in `serviceAssertions.ts` for public and private
keys. Removes a PEM parse from every authenticated request and every outbound
service call.

### Phase 5 - delivered

All three items are done.

**5.1.** `login` reads the user row, releases, verifies with no connection, then
re-acquires for the write phase. The binding is `let client: PoolClient | null` and
`finally` is `client?.release()`, because a throw between the phases must not release
the same client twice. The password hash is lifted out of `user` before the release.

`test/login-connection-release.test.ts` asserts the **ordering**, not the latency, and
fails on the previous code. Latency turned out to be the wrong instrument:
`passwords.ts` clamps `ARGON2_TIME_COST` to 10, so the verify window is ~200 ms — about
the same size as login's own database work, which is not enough separation to measure
against. Measured end-to-end, wall clock did **not** improve, and at `DB_POOL_MAX=2` it
was slightly *worse*, because the extra connect/release pair costs more than it saves
when the pool is already the binding constraint.

So the honest statement of the benefit is: this reduces pool **occupancy**, not login
latency, and it only pays off when logins contend with other database work at a
realistic pool size. Re-measure once the write phase — `invalidateExpiredUserMfaChallenges`
in particular — is no longer its own bottleneck.

**5.2.** Wired through with the same values `passwords.ts` already defaulted to, so
nothing changes until `.env` says otherwise — but `.env` now has effect. Verified
present in the running container. Note the clamp: `ARGON2_TIME_COST` is capped at 10
regardless of what is set, which is worth knowing before anyone tries to tune it.

**5.3.** Both modules memoise by **PEM**, not by `kid`. Keying on `kid` would be the
obvious choice and is wrong: the same `kid` can legitimately be re-pointed at a new key
during a rotation, and a `kid`-keyed cache would then keep verifying with the old key.
`test/ed25519-key-cache.test.ts` covers the failure modes — a malformed key must still
throw and must not poison the cache, distinct keys must not collide, and a token signed
by an untrusted key must still be rejected.

**Measured: 5.3 buys nothing measurable.** 300 authenticated `GET /api/auth/me` over one
keep-alive connection, three runs each, with and without the cache:

| | p50 | mean |
|---|---|---|
| without cache | 3.74–4.47 ms | 3.95–5.05 ms |
| with cache | 3.53–4.15 ms | 3.74–4.40 ms |

The spread within each variant is as large as the difference between them, so this is
noise, not a win. Parsing an Ed25519 PEM is microseconds, and an authenticated request is
dominated by HTTP, Redis and Postgres. The cache is kept because it is strictly less work
and costs nothing, but it should not be cited as a performance improvement — the original
framing of 5.3 as removing per-request overhead overstated it.

Verified live: login succeeds, a wrong password is still rejected, `/api/auth/me`
round-trips, 30 consecutive authenticated requests all return 200, and logout still
revokes immediately.

### Fixed alongside

Chat retention was capped from `req.user.subscription`, but `ActiveSessionService`
returns `{ token, claims, accountId }` and carries no subscription. The tier argument
was therefore always null and **every** plan was capped at the anonymous allowance of 5
conversations, including MAX and ULTIMATE. `replaceHistory` no longer accepts a tier at
all; it reads the account row inside the write transaction, so the cap cannot be widened
by the caller. Previously this was only verified on a free account, where the correct
and broken answers are both 5.

---

## 8. Phase 6 — Order correctness and throughput

**8.1.** Replace `ORD-${Date.now()}` with a collision-free identifier — a Postgres
sequence or `crypto.randomUUID()`. Add a unique constraint on `orders.order_number`
via `ensureAppSchema.ts` so the database rejects duplicates rather than storing them.

**8.2.** **Re-price server-side inside the transaction.** Load authoritative prices
and stock for the requested product ids (`SELECT … FOR UPDATE` on catalogue rows),
compute subtotal, discount, shipping and total from DB data, and reject unknown
products or insufficient stock with a 409. Ignore client-supplied `unitPrice`,
`totalPrice` and `shippingCost` entirely. Persist the DB-derived
`product_name`/`product_image` rather than the client's copies.

Highest-value fix in the plan: it closes a direct revenue-loss path.

**8.3.** Batch the item inserts with a single
`INSERT … SELECT * FROM unnest($1::int[], …)` instead of N awaited statements,
taking an order from N+3 round-trips to ~4.

**8.4.** Add an **idempotency key** on `POST /api/orders` (accept `Idempotency-Key`,
store and replay the prior response), so a retried request from a flaky mobile
connection cannot create a duplicate order. Complements 8.1 rather than replacing it.

### Phase 6 - delivered (8.1-8.3; 8.4 outstanding)

**Checkout was completely dead.** Three independent faults, each enough to return 500
for every request:

1. `createOrder` called `assertServiceContract("order_create_v1", ...)` but that name
   was never registered in `CONTRACT_VALIDATORS`, and `assertServiceContract` throws on
   an unknown name. Registered, with validation that also rejects a negative or
   implausibly large total.
2. `shipping_address` / `billing_address` are **jsonb**, but the value was passed
   through from the request as a string. A client omitting the address inserted `""`,
   which is not valid JSON. A client that sent an object happened to work, which is
   exactly why this stayed hidden.
3. The new `unnest()` insert initially declared seven alias columns against six arrays.

So the 12 orders in the table predate the current code. Nothing was losing money,
because nothing could be bought.

**8.2 — server-side pricing.** The request is now only a wish list: product identity and
quantity are the only values taken from it. Price, stock and name come from
`coffee_products` / `machine_products` with `FOR UPDATE`, so two concurrent checkouts
cannot both pass the stock check and drive it negative. Unknown product and insufficient
stock are now `409`s rather than order lines for something that may not exist. Stock is
decremented after the insert, guarded on `stock >= quantity`. Money is rounded to minor
units per step rather than accumulated as a float.

Shipping was previously whatever the client posted, including zero. There is no
server-side shipping table anywhere, so `SHIPPING_FLAT_RON` is now an explicit configured
rate (default 24.99, matching the only non-zero value in the table) — **this must be set
to the real carrier cost.**

**Currency: non-RON is refused.** The catalogue holds one unconverted price per product,
and historic orders carry RON, CHF, PLN, CZK, DKK and TRY against identical numbers, so
those totals were never converted. Refusing is deliberate — silently labelling a RON
amount "CHF" is the worse failure. Restoring multi-currency requires an FX table and is
a separate decision.

**Images.** Persisted only when the catalogue holds a usable path, which today means
`machine_products`. Capsule paths cannot be rebuilt from `coffee_products`: the public
path needs a sub-collection segment ("Vertuo/Barista Creation") the catalogue does not
store, and `popular_products_cache` is both unreadable by `filspresso_backend_svc` and
covers 12 of 100 products, so it is not a catalogue. NULL is correct rather than the
client's string — `Cart.tsx` already resolves a missing image from `product_id` via
`getProductImageForId`, and an order record should not be able to name an arbitrary path.
The real fix is an `image_path` column on `coffee_products`.

**8.1 — order numbers.** `ORD-${Date.now()}` collides within a millisecond.
`orders_order_number_key` (UNIQUE) already existed, so the collision failed the
customer's checkout rather than duplicating an order — still a lost sale. Now a sequence,
unique by construction, with the constraint kept as the backstop. The sequence is granted
to `filspresso_backend_svc`, because the application does not connect as the owner; that
grant is the one thing to update if `BACKEND_DB_USER` changes.

**8.3 — batched inserts.** One `unnest()` statement instead of one per item: N+3
round-trips down to ~4.

Verified live: a real product posted at 0.01 is charged the catalogue price; client
shipping of 0 is replaced by the server rate; unknown product and over-stock both 409;
six concurrent checkouts yield six distinct order numbers; stock decrements by the
quantity ordered; the persisted line carries the database name and price.

**8.4 is not done.** The sequence makes accidental collisions impossible, but it does
nothing about a *retried request* — a flaky mobile connection that replays
`POST /api/orders` will create a second order. That still needs an `Idempotency-Key`.

---

## 9. Phase 7 — Stop pinning connections, bound waits

- `weather.service.ts`: move the open-meteo fetch **above** `pool.connect()`; add an
  `AbortController` timeout to both fetches; move `ip-api.com` off plaintext HTTP.
- `orders.service.ts:292-325`: release the client **before** the invoice-java call;
  skip gzip for `application/pdf`.
- `subscriptions-engine.service.ts:57-76`: add `AbortController` + timeout.
- `repairs.service.ts:37-39`: add `AbortController` + timeout.
- `operations.service.ts:118-119`: cap buffered response bytes.
- `replayGuard.ts:39`: replace the per-request full-table `DELETE` with a periodic
  sweep (e.g. every 60 s) or TTL expiry, so the hot path stops issuing a write.
- Add timeouts to the three dead `integrations/*` adapters, or delete them — they
  are registered as global providers and are a trap if ever wired up.

---

## 10. Phase 8 — Event-loop hygiene

- **Body size:** `main.ts:95` allows 10 MB. Most routes take small JSON. Lower the
  global limit to ~1 MB and raise it only where genuinely needed (admin image
  upload is already separately capped at 15 MB by multer).
- **`TrimStringsPipe`:** mutate in place instead of rebuilding every object via
  `Object.fromEntries`, or skip subtrees it would not change. Currently the
  second-largest CPU cost after `JSON.parse`.
- **`hkdfSync` → async `hkdf`**, or memoize derived keys, at `encryption.ts:66,68`.
- **`security-observability.service.ts:151-197`:** cap `maxRows` far below 100 000
  or move the hash-chain verification to a worker. A 100k-row synchronous SHA3 loop
  is an availability hazard, not just slow.
- **Bulk events:** `security-observability.service.ts:503-576` runs 3 serial queries
  per event with no array cap — add a cap and batch the inserts.
- **`products.service.ts:38-48`:** replace per-row `fs.existsSync` with a one-time
  extension map built at startup.

---

## 11. Phase 9 — Verification

- **V1.** Backend tests stay green (`npm --prefix nestjs-backend run test`, currently
  7/7). Add tests for: Redis session set/get/del and the Postgres fallback; logout
  revokes immediately; throttler returns 429; order re-pricing rejects a tampered
  `unitPrice` and insufficient stock; order-number uniqueness under concurrent inserts.
- **V2.** Full repo gates: `npm run lint`, `npx tsc --noEmit`, `npm run build`,
  backend `typecheck`/`build`/`test`.
- **V3.** **Load test** — the point of the plan. Drive ≥50 concurrent authenticated
  users through a mix of orders, subscriptions and cards. Assert: no pool exhaustion
  (`waitingCount` stays near 0), login p95 under target, no 5xx, and correct
  behaviour when Redis is killed mid-run (fall back to Postgres, never fail open).
- **V4.** **Redis-outage drill:** stop Redis, confirm authenticated traffic still
  works via the Postgres fallback and that logout still revokes.
- **V5.** **Shutdown drill:** `docker compose stop backend` during active traffic;
  confirm in-flight orders complete and `pool.end()` runs.
- **V6.** `docker compose ps` — the backend should report **healthy**. It used to
  report `unhealthy` while `/health` returned 200; both causes are now fixed (see
  the correction note in §3) and it reports `running healthy` with
  `RestartCount=0`. Keep this as a regression check: a bare `unhealthy` here with
  a working `/health` means the healthcheck command regressed, not the service.

---

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| Redis becomes a new hard dependency for auth | Postgres fallback + V4 outage drill |
| Re-pricing breaks clients that send their own `unitPrice` | Return a clear 409 with the authoritative price; the frontend already reads prices from `/api/products` |
| `UV_THREADPOOL_SIZE=16` raises peak RSS | ~19 MiB × 16 worst case; measure with V3 |
| Pool resize could exhaust Postgres | Default stays 20, tune only from V3 data, document `replicas × pool < max_connections` |
| Throttler misconfiguration locks out real users | Per-route limits rather than one tight global value; dry-run first |
| Graceful-shutdown change alters restart behaviour | V5 drill before relying on it |
| Instrumentation is itself expensive | Behind `LOG_REQUESTS`, off by default |

---

## 13. Explicitly out of scope

- **AI generation concurrency** — bounded by llama.cpp's 1 slot per model. See
  `PLAN_FASTAPI_MIGRATION.md` §5 for the 429 queue there.
- **Clustering / multi-replica** — deferred until V3 shows event-loop saturation.
- **The payments domain** — there is no payments module in NestJS; payment-adjacent
  work is split across `orders`, `cards` and `subscriptions`. Phase 6 hardens order
  creation, but a full payments review is its own piece of work.
- **The three unused `integrations/*` adapters** are flagged in Phase 7, but
  deleting them is a separate call.
