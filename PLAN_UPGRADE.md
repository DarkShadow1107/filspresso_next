# Filspresso Upgrade Plan

Master plan for the auth, model, playground and TLS work, written after the fact
so it reflects what was actually implemented and verified rather than what was
originally guessed.

Status legend: **[x]** done and verified · **[~]** done, partially verified · **[ ]** not started

---

## 1. Scope

Five phases, driven by five separate requests:

1. Fix registration/auth, and replace the browser token model with server sessions.
2. Replace the Qwen model stack with LFM 2.5 (text) and LFM 2 Vision.
3. Pre-warm models so the first prompt is not slow.
4. Add a Filspresso-themed model Playground for MAX/ULTIMATE.
5. Terminate HTTPS in front of the app with Caddy.

---

## 2. Phase 1 — Auth and session hardening

**Goal:** broken registration fixed, and no credential ever exposed to JavaScript.

### Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Algorithm | EdDSA (Ed25519), native `node:crypto` | Asymmetric keys, `kid` rotation, no `jose` dependency. `jsonwebtoken@9` has no EdDSA support. |
| Transport | `filspresso_session` httpOnly cookie | Token unreachable from JS, so XSS cannot exfiltrate it. |
| Revocation | DB lookup on every authenticated request | Logout must be immediate; a stateless JWT cannot be revoked. |
| Proxy scope | Forward only `filspresso_session` | The admin cookie must never reach the API surface. |
| Legacy clients | Bearer fallback retained | CLI tooling still needs it. |

### Root causes found in registration

1. `jsonwebtoken@9.0.3` cannot sign EdDSA → native Ed25519 in `auth-tokens.ts`.
2. `getEnvOrFile` did not resolve path-valued env vars, so
   `JWT_SIGNING_PRIVATE_KEY=secrets/jwt.pem` was read as the literal key.
3. Session tokens were stored unhashed and were long; schema moved to
   `session_token_hash CHAR(64)` and stale rows were cleared.
4. Deterministic Ed25519 signatures meant two tokens minted in the same second
   were byte-identical → added a random `jti`.

### Delivered

- `nestjs-backend/src/common/utils/auth-tokens.ts` — native Ed25519 sign/verify,
  `hashSessionToken`, random `jti`.
- `nestjs-backend/src/common/utils/secrets.ts` — path-valued secret resolution.
- `nestjs-backend/src/common/utils/session-cookie.ts` — cookie set/clear/read,
  scheme-aware `Secure` via `x-forwarded-proto`.
- `nestjs-backend/src/common/guards/active-session.service.ts` — live session check.
- `auth-guard.module.ts`, `jwt-auth.guard.ts`, `optional-jwt-auth.guard.ts`.
- Login/register/MFA/refresh return no token in the body; OAuth redirects use
  `?oauth=ok` instead of a token in the URL.
- Frontend migrated to profile-only local state: `src/lib/accountSession.ts`,
  `authState.ts`, `clientAuth.ts`.
- `src/lib/server/backend.ts` — filtered cookie + CSRF header forwarding.
- `ensureAppSchema.ts` — session migration and `filspresso_ai_svc` grants.

### Verified

Register `201`, login `200`, cookie-only `/api/auth/me` `200`, no token in body,
no-Origin mutation `403`, valid Origin accepted, logout + replay `401`.

### Deliberately left

Bearer fallback for CLI (documented, not removed).

---

## 3. Phase 2 — Model replacement

**Goal:** Qwen out, LFM in, without regressing the vision path.

### Mapping

| Role | Before | After |
| --- | --- | --- |
| Text | `Qwen3-0.6B-Q8_0.gguf` | `LFM2.5-2.6B-Q4_0.gguf` |
| Thinking | Qwen thinking variants | LFM 2.5 with per-request `reasoning` |
| Vision | `Qwen3-VL-2B-Q4_0.gguf` | `LFM2-VL-450M-Q4_0.gguf` + `mmproj-LFM2-VL-450M-Q8_0.gguf` |
| Retrieval | MiniLM | `MiniLM-L6-v2.gguf` (unchanged) |
| Extra | — | `Gemma3-1B-it-Q4_0.gguf` (unchanged) |

**Reasoning:** LFM 2.5 always thinks. `chat_template_kwargs.enable_thinking=false`
does **not** work — it leaves the `<think>` block inline in `content`. The working
switch is the per-request `"reasoning": "on" | "off"` field.

**Vision model choice:** user chose the 450M model over quality for speed and
VRAM on a 4 GB RTX 3050 Ti.

### Delivered

- Compose services renamed `llama_qwen` → `llama_lfm`,
  `llama_vision_qwen3_vl` → `llama_vision_lfm2_vl`; `--reasoning-preserve`
  removed, `--fit on` and `--flash-attn on` added.
- `models/tanka.py`, `app.py`, `python-chat` route, Kafelot UI, CSS, and all
  user-facing copy updated.
- `src/lib/server/aiHost.ts` — resolves `http://ai:5000` vs host `localhost:5000`.

### Verified

LFM text, LFM thinking, Gemma 3 and LFM 2 Vision all respond. A real 64×64
image works; a **1×1 PNG crashes the llama.cpp image preprocessor**, so the
warmup generates 64×64 deliberately.

---

## 4. Phase 3 — Model pre-warm

**Goal:** the first prompt should not pay a cold model load.

**Measured cold load on this host: 2935 ms for LFM 2 Vision.** That is the
latency this phase removes.

### Delivered

- `tanka.warmup_model()` / `warmup_status()` — per-model state, deduplicated so
  repeated requests never stack a second load into one llama.cpp slot.
- `POST /api/warmup` (schedule) and `GET /api/warmup` (poll) in `app.py`.
- `src/app/api/playground/prewarm/route.ts` — POST to warm, GET to poll,
  tier-gated server-side.
- `src/hooks/useModelPrewarm.ts` — 400 ms debounce, 2 s polling capped at 30
  attempts, bounded retries.
- Warming badge next to the Kafelot AI status badge.

**Design note:** exactly one model is warmed, chosen to match how the next
request routes (vision when in chemistry mode or an image is attached, else
text). Loading both GGUFs at once contends for VRAM on a 4 GB card and slows
down the request the warmup is meant to accelerate.

**Warmup must not consume a prompt quota**, so it does not go through the
Kafelot limiter.

---

## 5. Phase 4 — Model Playground

**Goal:** a MAX/ULTIMATE surface for talking to the raw models.

### Decisions

- New Filspresso UI inside the main Next app, reusing llama/Caddy infra. The
  sibling `playground/` repo is an unrelated CodeSentry/SentinelForge project
  and was **not** adopted.
- Separate `/playground` route, linked from Kafelot, shown only to MAX/ULTIMATE.
- Streaming, because buffered replies hide latency and remove the reason to
  pre-warm.
- Prompts are metered through the same Kafelot quota.
- Server-side tier gate is the authority; the client only decides whether to
  render the console or an upsell.

### Delivered

- `POST /api/chat/stream` (Flask SSE) and `tanka.stream_text()`.
- `src/app/api/playground/chat/route.ts` — gates tier, resolves the model
  through the shared table, forces thinking off for non-MAX/ULTIMATE, meters
  before any GPU work, and propagates abort so a cancelled browser fetch cancels
  upstream generation.
- `src/components/playground/PlaygroundContent.tsx` + CSS in the Filspresso
  palette (near-black surfaces, apricot text) — not the sentinel indigo theme.
- Registry wiring in `pages.ts`, `page.tsx`, `proxy.ts`.
- Kafelot entry point in the tab bar.

### Bugs found while testing

1. **`Connection` header on a Flask response.** PEP 3333 forbids WSGI apps from
   emitting hop-by-hop headers; waitress returned 500 for every request.
2. **Empty stream from LFM 2.5.** Even with `reasoning: "off"`, llama.cpp sends
   the thinking in `reasoning_content` deltas. Reading only `content` yielded
   nothing. `stream_text` now yields `(channel, text)` for both.
3. **Reasoning tokens consume `max_tokens`.** A small budget can be consumed
   entirely by thinking, leaving no answer. The Playground default is 512.
4. **Authorisation hole in the first draft of the prewarm route.** The tier
   guard returned the string `"none"`, which is truthy, so anonymous callers
   got 200. Now fails closed with 401.
5. **Tier table drift.** The tier→model table was duplicated in three files and
   the prewarm copy already disagreed with the others (vision restricted to
   MAX/ULTIMATE instead of BASIC+). Extracted to `src/lib/modelAccess.ts`.

### Verified

Streaming through Next **and** through Caddy: `text/event-stream`,
`Transfer-Encoding: chunked`, token-by-token deltas, metered (999/1000),
reasoning channel visible with thinking on, `403 PLAYGROUND_LOCKED` on Free.

---

## 6. Phase 5 — HTTPS at the edge

**Goal:** TLS in front of the app.

### Delivered

- Root `Caddyfile`: `tls internal`, HSTS, CSP, Permissions-Policy, 52 MB body
  cap, and `flush_interval -1` on `/api/playground/chat` so token streaming is
  not buffered into a single batch.
- `caddy` compose service on 8443, certs in named volumes.

### Deployment decision

Next currently runs on the host, so Caddy targets `host.docker.internal:3000`.
`next.config.ts` already emits a standalone build for a containerised Next; if
one is added, set `NEXT_UPSTREAM=web:3000` and drop `extra_hosts`.

### Bugs found while testing

1. **`{env.NEXT_UPSTREAM}` broke the proxy.** Caddyfile expands `{env.*}`
   textually before parsing, so `http://host:3000` had its `//` read as a
   comment and Caddy tried to resolve a host named `/host`. Fixed by requiring a
   bare `host:port` value.
2. **New edge origin blocked by the CSRF guard.** With `NODE_ENV=production` the
   localhost fallback is disabled, so `https://localhost:8443` was rejected with
   403. `CORS_ORIGIN` now appends the edge origin, derived from
   `CADDY_HTTPS_PORT` so it cannot drift.
3. **The limiter self-call could not traverse the edge.** It is a
   server-to-server hop and must not depend on the public origin: `request.url`
   has the wrong scheme behind TLS termination, and looping through Caddy made
   Node reject the `tls internal` CA
   (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). It now targets
   `INTERNAL_NEXT_ORIGIN` (default `http://localhost:3000`) while still
   relaying the browser's real `origin` for CSRF validation.

### Verified

`https://localhost:8443/` → 200 with all security headers; caddy healthy;
streaming works through the edge.

### Deliberately left

- `tls internal` is a local CA; browsers warn until it is trusted. Swap for a
  real domain to get publicly trusted certificates.
- No `Dockerfile.next` yet (see deployment decision above).

---

## 7. Prompt metering

One implementation, `src/lib/server/promptLimits.ts`, shared by
`/api/python-chat` and `/api/playground/chat`.

**It fails closed.** `python-chat` previously failed *open*
(`catch → allowed: true`), which meant any limiter outage served unmetered GPU
inference. It now rejects with 503 instead. This was an intentional behaviour
change and is the single largest risk in this plan: if the limiter is
unreachable, Kafelot prompts stop working rather than running for free.

---

## 8. Verification matrix

| Gate | Command | Result |
| --- | --- | --- |
| Frontend lint | `npm run lint` | 0 errors, 0 warnings |
| Types | `npx tsc --noEmit` | clean |
| Build | `npm run build` | success |
| Backend types | `npm --prefix nestjs-backend run typecheck` | clean |
| Backend build | `npm --prefix nestjs-backend run build` | clean |
| Backend tests | `npm --prefix nestjs-backend run test` | 7/7 |
| Python | `py_compile` on `app.py`, `models/tanka.py` | clean |
| Compose | `yaml.safe_load` | 14 services, valid |

Runtime verification was done against the live stack with throwaway Ultimate
accounts, which were deleted afterwards.

---

## 9. Known issues and open decisions

| Item | Severity | Notes |
| --- | --- | --- |
| LFM 2.5 can answer with its own reasoning when a system prompt is present | Medium | Observed via `python-chat`: the visible `content` contained "The user is asking for… I should pick…" and was truncated mid-sentence. Pre-existing, not introduced here. Likely a token-budget/reasoning-separation issue; needs a dedicated look. |
| `filspresso_backend` healthcheck is unhealthy | Low | `spawn /usr/local/bin/node ENOENT` in `SecurityObservabilityService`; `/health` returns 200. |
| MiniLM is an encoder used as a generation fallback | Low | Pre-existing: it cannot generate, so free tier gets lexical retrieval rather than an answer. |
| `nestjs-backend/dist/*.js` are tracked | Low | Build output is committed; consider gitignoring. |
| Backend CORS/CSRF allowlist must list every public origin | Medium | Any new origin (staging domain, second device) breaks cookie-authenticated POSTs until added to `CORS_ORIGIN`. |
| Session JWT TTL is 15 minutes | Low | By design; the refresh endpoint extends it. Surprised a long test run. |

---

## 10. Operating notes

```bash
# Stack
docker compose up -d
docker compose ps

# Rebuild after editing app.py / models/tanka.py (they are COPY'd into the image)
docker compose build ai && docker compose up -d ai

# Edge
curl -k https://localhost:8443/ -I

# Streaming smoke test
curl -kN https://localhost:8443/api/playground/chat \
  -H "Content-Type: application/json" \
  -H "Origin: https://localhost:8443" \
  -H "Cookie: filspresso_session=<token>" \
  -d '{"message":"Reply with exactly: OK","model":"lfm2_5_2_6b_q4_0_gguf"}'
```

Editing `docker-compose.yml` requires care: a whole-file `git checkout` reverts
unrelated in-progress changes (this happened once during Phase 5 and silently
undid the Phase 2 model swap). Prefer targeted edits.