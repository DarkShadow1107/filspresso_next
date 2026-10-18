# Filspresso Playground — Desktop App Plan

A Windows desktop client for the Spectre Playground: a coding harness with real
sandboxing, gated behind a Spectre subscription, metered through the same wallet the
web app uses.

**Status:** Phase 0 **done**. Phases 1-5 are specified but not started.

Phase 0 delivered:
- `POST /api/auth/desktop/token` -- device grant, access + refresh in the body, no cookie,
  device identity recorded, MFA in one call (202 + challenge when needed).
- `POST /api/auth/desktop/refresh` -- rotates both credentials in one statement; a replayed
  token kills the session rather than minting a second one.
- `GET /api/desktop/entitlement` -- access, allowance, wallet, `canGenerate`, subscription
  terms and the model catalogue in one call.
- `POST /api/desktop/chat/stream` -- SSE gateway. Entitlement, then money gate, then the
  model; metered on the done frame with a per-request idempotency key.
- `scope: "desktop"` added to the billing policy, priced identically to the web Playground.
- The AI service is no longer an open door: bound to loopback, with an optional shared secret
  on its model routes.
- Auth throttling is now environment-configurable per route, and the desktop routes are
  keyed per account+device rather than per IP.

Verified: 252 backend unit tests, 64 python tests, and 13 live suites (41 new desktop checks
end to end, including a real metered generation).

---

## Decisions (settled)

| Area | Decision |
| --- | --- |
| Where models run | Hosted, via a **new backend gateway**. Not local, not hybrid. |
| Credential | **Device grant** returning real access + refresh tokens in the response body. |
| Packaging | **MSIX**, signed. Not MSI, not unpackaged. |
| Sandbox | **Hyper-V VM per session, Windows 10 Pro / 11 Pro only.** Windows Home is blocked. |
| Sandbox control channel | **PowerShell Direct** over the hypervisor VMBus, with **no network adapter attached**. |
| Signing | Signed with an EV code-signing certificate. |
| Distribution | Entitlement-gated download route; not a guessable static URL. |
| Auth throttling | Re-keyed per account + device, with a separate refresh budget. |

---

## Platform floor and what it costs us

**Windows 10 Pro (1903 or later) and Windows 11 Pro only.** The Hyper-V role is not
available on Home, and there is no supported fallback that keeps the isolation
guarantee. Home users are blocked at download and at first run.

This is a deliberate trade: it costs us every Home user, and in exchange the sandbox is
a real VM with no network path to the host. I think that is the right way round — a
coding agent that executes generated code is the single worst thing to run with weak
isolation, and "works on Home with a weaker sandbox" is how that guarantee quietly
erodes.

**Honest limitation:** an MSIX manifest cannot express a Pro-edition requirement. MSIX
can constrain OS *version* (`TargetDeviceFamily`), not edition. So the edition gate has
to be enforced in two other places, and neither is a security boundary on its own:

1. **App self-check at first run** — the app reads the edition and refuses to start.
   Defeats the honest user; a determined user can patch it out.
2. **Download route** — the client reports its OS, the server refuses. Spoofable, and
   treated only as a courtesy that saves a wasted download.

If we want a genuine install-time block, the only honest option is a **WiX Burn
bootstrapper** that checks the edition and then installs the MSIX. That is a real
decision with a real cost — a bootstrapper is its own install surface, its own
trust prompt, and it is *not* MSIX. My recommendation: ship the MSIX plus the
app-side check, and treat the Home block as "not supported, and it will tell you so"
rather than pretending to be an enforcement boundary.

---

## Phase 0 — Backend prerequisites (in progress)

The app cannot be built client-only. Everything here is on the critical path.

### 0.1 Device auth grant

`POST /api/auth/desktop/token` — email + password (or MFA challenge), returns
`{ accessToken, refreshToken, expiresIn, account }` **in the body**, and writes a
`user_sessions` row labelled with a device.

Why this exists: `login`, `register` and `refresh` all strip the JWT from the response
body and set only an httpOnly cookie
(`auth-complex.controller.ts:13-19`). A native process cannot read an httpOnly cookie.
`readSessionToken` *does* accept `Authorization: Bearer`, and the CSRF origin guard
passes Bearer-only callers (`origin-guard.middleware.ts:104`) — but nothing ever hands
a native client a token to put there.

- Migration adds `device_id`, `device_name`, `platform`, `app_version`, `client_type`
  to `user_sessions`.
- `SessionStoreService.createAndCache` is the single place sessions are created, so
  device identity is threaded through there rather than in each login path.
- Revives `verifyBearerToken` (`auth.service.ts:23`), which is currently dead code.

**Refresh is mandatory, not a nicety.** The access token lives 15 minutes
(`auth-tokens.ts:8`, hard-capped at 24h). The existing `POST /api/auth/refresh` is
unusable: it reads Bearer only, ignores the cookie, and then strips the very token it
rotates. An interactive coding session cannot run on a 15-minute clock.

### 0.2 Desktop inference gateway

`POST /api/desktop/chat/stream` (SSE), in NestJS.

This endpoint does not exist. Today `/api/playground/chat` is a *Next* route, and the
Python AI service on port 5000 is published to the host and completely
unauthenticated. A desktop app calling it directly would be **unmetered and unbilled**.

Order of operations, mirroring the authoritative choke point in
`kafelot.controller.ts:188-211`:

1. `JwtAuthGuard`, bearer token, no cookie.
2. `resolveSpectreAccess` — tier first, so Max/Ultimate clients draw on allowance.
3. Money gate **before** any model load. `402` genuinely spent, `503` billing
   unavailable (fail closed), never serve-then-bill.
4. Proxy to `ai:5000/api/chat/stream`, re-emit frames verbatim.
5. On the `done` frame, `recordUsage` with `scope: "desktop"` and a real `requestId`.

Step 5 also fixes a latent weakness in the web route, which meters with
`requestId: null` because the gateway id is not threaded through
(`src/app/api/playground/chat/route.ts:216-218`), leaving idempotency resting on the
stream firing exactly once.

`ai_token_usage.scope` is `text`, not a Postgres enum, so widening the TS union needs
**no migration**.

### 0.3 Entitlement endpoint

`GET /api/desktop/entitlement` — access source, expiry, allowance, wallet, `canGenerate`
and the model catalogue in a single call. The app polls this constantly; without it
every state change costs 3-4 round trips against a global limiter of 1200 req / 15 min
(`constants.ts:3-4`).

### 0.4 Auth throttling (done)

What was there, and why it broke a desktop client:

- Login is **10 per 15 minutes per IP** (`rate-limit.policy.ts:37-52`). Every user
  behind one office NAT or mobile carrier shares that budget, so one person's typo loop
  locks out everyone behind the same IP.
- Register is 5 per hour per IP.
- An escalating lockout (`auth-complex.service.ts:17-22`) keyed on
  `sha256(login|ip)`, 30s doubling to a 900s cap.
- That lockout is **disabled outside production** unless `ENABLE_STRICT_AUTH_LIMITS=true`
  (`:17-18`), so the behaviour differs between staging and production — the worst
  property a rate limiter can have.

What was done:

- The desktop grant is keyed on `sha256(account|device|ip)`, not on IP, so a shared NAT stops
  sharing a login budget and rotating source addresses no longer buys an unlimited one. A
  per-IP ceiling remains as a second layer. The web login's keying is untouched, because a
  generous per-account limit there is the vulnerability.
- Refresh has its own, looser budget (60/15min vs the grant's 6/15min): a 15-minute token
  means a legitimate desktop client refreshes several times an hour, and that must not be
  indistinguishable from password guessing -- nor unbounded.
- Every per-route budget is now overridable per environment, so a policy number can be tuned
  without a code change and a deploy. Production defaults are unchanged unless an operator
  sets a variable.

**Known remaining weakness, not fixed:** the escalating lockout in `auth-complex.service.ts`
is still disabled outside production unless `ENABLE_STRICT_AUTH_LIMITS=true`. Being
disabled in dev and active in prod means a staging environment does not exercise the
behaviour that protects production. It should key off the deployment target, not the
debugger.

### 0.5 Close the AI service exposure

`ai` is published `5000:5000` and `/api/chat/stream` reads no credential at all. Today
only this machine can reach it; a shipped desktop app turns it into a target. Bind to
loopback or require a service key, before any release.

---

## Phase 1 — Solution scaffold

```
playground-desktop/
  global.json, Directory.Build.props, Filspresso.Desktop.sln
  src/Filspresso.App/              WinUI 3, packaged for MSIX
  src/Filspresso.Core/             API client, auth, entitlement, model catalogue
  src/Filspresso.Harness/          agent loop, tool protocol, transcripts
  src/Filspresso.Sandbox.HyperV/   VM lifecycle, PowerShell Direct
  src/Filspresso.Sandbox.Shared/   the sandbox contract both backends satisfy
  packaging/                       AppxManifest, signing, MSIX pipeline
```

This is the first .NET artifact in the repository. There is no `global.json`,
`Directory.Build.props` or NuGet config to inherit, and CI currently builds only
security policies.

---

## Phase 2 — Login and account screen

Dedicated sign-in screen: password, MFA challenge, then an account panel showing tier,
Spectre status and expiry, allowance remaining, wallet balance. Tokens in Windows
Credential Manager (DPAPI), never a file. `GET /api/auth/sessions` must show these as
named devices so a user can revoke one.

Wallet funding is not in the app: `POST /api/billing/fund` requires a default card the
desktop app cannot hold. It deep-links to the web account page instead.

---

## Phase 3 — Entitlement-aware model access

Catalogue from `GET /api/billing/pricing?audience=api`, lock state from entitlement.
Pre-flight before every send. Mid-session `402` (out of money) and `403` (subscription
lapsed) degrade to a clear state, not an error toast. Poll entitlement on window focus
and after every completed generation.

---

## Phase 4 — Harness and sandbox

**Sandbox design: a Hyper-V VM per session, with no network adapter.**

The property that makes this the strongest option available: **PowerShell Direct runs
over the hypervisor's VMBus, not the network.** A VM with no network adapter attached
still has a fully scriptable control channel, and simultaneously has no route to reach
the host, the internet, or anything on the LAN. Exfiltration is not "prevented by a
policy" — it is not reachable.

- Ephemeral differencing disk per session; destroyed on close, so no state leaks between
  sessions.
- Memory and CPU caps per VM.
- Secure Boot and no integration services; no host folder sharing — the workspace is
  copied in and results copied out over PowerShell Direct.
- Job/session teardown on app exit, and on crash.

The harness runs over the gateway's SSE stream, executes tools inside the VM, and never
touches the host shell directly.

Windows Sandbox (`.wsb`) is deliberately **not** the default. It cannot do several of
the things this design needs: it is single-instance, destroys all state on close, has no
headless scripting API, and its network model is not something we control per session.

---

## Phase 5 — Packaging, signing, gated download

- **MSIX** built by GitHub Actions on `windows-latest` (MSIX is buildable headless; the
  WinUI unpackaged/XAML-compiler toolchain is far happier on Windows than in
  cross-platform containers).
- **Signed.** An MSIX will not install without a certificate the machine trusts. This
  requires an **EV code-signing certificate**; I cannot issue one, and a self-signed
  cert only produces an installer SmartScreen actively warns about. The pipeline is
  built to take a `.pfx` from a secret; the certificate has to be purchased.
- **Gated download**: a Next route verifies Spectre entitlement, then redirects to a
  short-lived signed URL. The package is never at a guessable path and never in the repo.

---

## Risks, stated plainly

- **Home users cannot use the app at all.** Deliberate, but it is a real revenue and
  support cost.
- **EV certificate cost and renewal** are ongoing, and the signing step blocks release
  without one.
- **Login throttling** is keyed per account + device after 0.4; a per-IP ceiling remains
  as a second layer.
- **No payment provider is wired.** "Can pay" currently means "has money in the
  simulated wallet". This does not change with the desktop app and should be tracked
  separately.
