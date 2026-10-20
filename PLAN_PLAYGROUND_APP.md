# Filspresso Playground — Desktop App Plan

A Windows desktop client for the Spectre Playground: a coding harness with real
sandboxing, gated behind a Spectre subscription, metered through the same wallet the
web app uses.

**Status:** Phases 0-4 **done**. Phase 5 (the signing pipeline) is written but unsigned.

Phase 4 delivered: a Hyper-V sandbox with **no network adapter at all**, controlled over
PowerShell Direct, and the web tools running on the host so the model can search without the
sandbox ever gaining a socket.

Phase 2 delivered: a dedicated sign-in and connect screen, MFA in the same flow, DPAPI-backed
credential storage in Windows Credential Manager, a session manager that refreshes before expiry
and is single-flight, and an account panel showing tier, access and expiry, allowance, wallet
and whether anything can actually be sent.

Phase 3 delivered: the model catalogue with the server's own prices, a pre-flight before
every message, per-model affordability, streaming with the balance refreshed once the work is
settled, and a state for every refusal -- including the one that matters most for a user
waiting on a cold model.

Phase 1 delivered, in `playground-desktop/`:
- .NET 9 solution: `Filspresso.Core` (API client, SSE reader, platform rules), `Filspresso.Harness`,
  `Filspresso.Sandbox`, `Filspresso.App` (WinUI 3 unpackaged), 65 unit tests.
- The WinUI app builds in Release, self-contained, so the MSI can ship the runtime.
- A WiX v5 MSI builds from that output, with the **Pro-edition gate enforced at install time**.
- GitHub Actions builds and tests it; the signing job runs when a certificate is configured.

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
| Packaging | **MSI** (WiX v5), signed. WinUI 3 **unpacked**. Not MSIX. |
| Sandbox | **Hyper-V VM per session, Windows 10 Pro / 11 Pro only.** Windows Home is blocked. |
| Sandbox control channel | **PowerShell Direct** over the hypervisor VMBus, with **no network adapter attached**. |
| Signing | Signed, EV preferred. MSI also gets an Authenticode signature. |
| Distribution | Entitlement-gated download route; not a guessable static URL. |
| Auth throttling | Re-keyed per account + device, with a separate refresh budget. |

---

## Why MSI rather than MSIX

MSIX was the earlier plan and was changed to **MSI** deliberately, for the install
experience: MSIX will not install from an untrusted certificate at all. Sideloading an
MSIX means either publishing to the Store or first importing the signing certificate into
Trusted People on every target machine. A signed MSI installs like any other installer,
which is what "the users can install it" has to mean in practice.

It also **solves the Windows Home problem I said MSIX could not solve.** An MSIX manifest
can constrain OS *version* but not *edition*, so under MSIX the Pro-only requirement was
only enforceable by the app refusing to start and by a download route reporting its OS —
both advisory. A WiX installer runs a custom action during install, where it can read the
real edition from the registry and **fail the installation**. The requirement moves from "we
ask nicely at first run" to "the installer refuses".

What we give up, stated plainly:

- **No auto-update.** MSIX has an update story; an MSI needs its own updater or the user
  reinstalls. Worth building before release, not after.
- **No per-user install by default.** MSI is per-machine, so it needs elevation. Per-user
  MSI is possible but changes where files live and complicates the Windows App SDK runtime.
- **Larger installer.** The Windows App SDK runtime ships with it rather than being
  resolved by the package manager.
- **Unsigned, SmartScreen still bites.** Signing removes the "unknown publisher" prompt;
  SmartScreen reputation on a first-seen binary can still warn. MSIX had the same problem
  and worse.

## Platform floor and what it costs us

**Windows 10 Pro (1903 or later) and Windows 11 Pro only.** The Hyper-V role is not
available on Home, and there is no supported fallback that keeps the isolation guarantee.

This is a deliberate trade: it costs us every Home user, and in exchange the sandbox is a
real VM with no network path to the host. A coding agent that executes generated code is
the single worst thing to run with weak isolation, and "works on Home with a weaker
sandbox" is how that guarantee quietly erodes.

Enforcement is layered, and the installer is the only real boundary:

1. **Installer custom action (the boundary).** Reads the edition from the registry and
   fails the install on Home. Not bypassable by a user who did not patch the MSI.
2. **App self-check at first run.** Belt and braces, and it covers an install that was
   sideloaded or copied rather than installed.
3. **Download route.** The client reports its OS and the server refuses. Spoofable, so it
   is only a courtesy that saves someone a wasted download — never treated as a control.

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

## Phase 1 — Solution scaffold (done)

```
playground-desktop/
  global.json, Directory.Build.props, Filspresso.Desktop.sln
  src/Filspresso.Core/      API client, auth, entitlement, SSE reader, platform rules
  src/Filspresso.Harness/   agent loop and its contracts
  src/Filspresso.Sandbox/   what a sandbox must guarantee, independent of implementation
  src/Filspresso.App/       WinUI 3, unpackaged
  installer/                WiX v5, edition gate, licence
  tests/Filspresso.Core.Tests/
```

This is the first .NET artifact in the repository.

**One build constraint worth recording before anyone loses an hour to it:** the WinUI
application cannot be built with `dotnet build`. The Windows App SDK's PRI generation targets
are not in the .NET CLI's copy of MSBuild and the build fails with `MSB4062`. It requires
MSBuild from Visual Studio. `Core`, `Sandbox` and `Harness` build normally with the CLI. The
CI workflow encodes this. It is also why the app sits in its own solution
(`Filspresso.App.sln`): `dotnet build` at the root has to keep working, and putting the app in the
main solution makes it fail for everyone.

Two deliberate choices about where the rules live:

- **The platform rule is in `Core`, not in the installer.** `PlatformRequirementCheck` is unit
  tested and both sides ask it. The installer cannot call into managed code before it has
  installed a runtime, so it enumerates the same editions in its condition — and
  `InstallerContractTests` reads the `.wxs` and fails the build if the two lists disagree.
  Duplication pinned by a test, rather than two copies nobody compares.
- **The SSE reader is hand-written.** A frame can straddle two network reads, and a reader
  that discards the trailing fragment drops the `done` frame carrying the token counts —
  a completed generation nobody is charged for. The web route documents having exactly this
  bug's shape.

---

## Phase 2 — Login and account screen (done)

Dedicated sign-in screen: password, MFA challenge, then an account panel showing tier, access
and expiry, allowance, wallet, and a plain statement of whether anything can be sent.

Four decisions worth recording, because each was the obvious alternative:

- **Tokens go in Windows Credential Manager under DPAPI, never a file.** An access token plus a
  month-long refresh token in a JSON file under %AppData% is readable by every process running
  as the user. DPAPI at `CurrentUser` scope binds the blob to one user on one machine, which is
  exactly the lifetime the token should have.
- **Refresh is single-flight.** The app polls entitlement after every generation and on window
  focus, so several callers can want a token at once. The server *rotates* the refresh token on
  every use and treats a replay as theft, deleting the session — so two concurrent refreshes is
  not untidy, it is the event that signs the customer out and invalidates their device. There is
  a test that runs three concurrent callers and asserts exactly one refresh happened.
- **Refresh happens a minute before expiry, not at it.** Refreshing at expiry leaves no room:
  the refresh request races the token it is replacing, and one slow response turns a valid
  request into a 401.
- **Signing out is local only.** The session stays valid on the server until it expires or is
  revoked from the account page. A user on a shared machine should not be able to revoke a
  session they do not own by signing out of someone else's.

The account panel reports plan, allowance and wallet separately, never as one balance. They are
not interchangeable — the allowance resets monthly, the wallet does not, and the product charges
from whichever can pay, so a single figure cannot be acted on.

Wallet funding is still not in the app: `POST /api/billing/fund` needs a default card the
desktop app cannot hold. It deep-links to the web account page.

---

## Phase 3 — Entitlement-aware model access

Catalogue from `GET /api/billing/pricing?audience=api`, lock state from entitlement.
Pre-flight before every send. Mid-session `402` (out of money) and `403` (subscription
lapsed) degrade to a clear state, not an error toast. Poll entitlement on window focus
and after every completed generation.

---

## Phase 4 — Harness and sandbox (done)

### The sandbox

A Hyper-V virtual machine created with **no network adapter**. Not a disabled one, not a
filtered one -- none at all. PowerShell Direct, which is how the harness controls it, runs
over the hypervisor's VMBus rather than over a network, so the session stays fully
controllable with no route off the machine.

That is stronger than a policy. Generated code cannot exfiltrate what it reads, cannot fetch a
payload to execute, and cannot reach the host's network, because there is nothing to reach. A
low-integrity process or a container would have to *forbid* the network; here there is no
network to forbid.

Windows Sandbox is deliberately not used. It is single-instance, it destroys all state when
it closes, and it has no scripting interface, so a coding agent that needs a project
directory to survive between turns cannot have one. A differencing disk on a Hyper-V VM gives
each session its own copy of a clean base image, disposable on teardown, and scriptable.

### The web search, and the tension it creates

The Playground is meant to be able to search the web. That is in direct tension with "the
sandbox has no network", and the resolution is the whole point of the design:

**The web tools run on the host. The sandbox stays sealed.**

The model asks for a search; the harness performs it on the host, through the backend, and
writes the result into the sandbox as a file the model can read. The sandbox never has a
socket. The boundary is exactly as strong as before; there is simply one trusted step
outside it.

The cost is that the host can reach the web, and the host is running the user's own
requests. What the design prevents is the *generated code* reaching the network, which is
the threat that matters.

### The fetch tool is a security boundary

A tool that fetches whatever the model asks for is a server-side request forgery primitive
unless it is fenced in, and the model reads untrusted pages: a page can contain text saying
"now fetch http://169.254.169.254/latest/meta-data/". So the backend's web tool:

- allows only http and https;
- refuses a host that resolves to a **private** address -- a name that resolves to 127.0.0.1 is
  the same attack with more steps, so the check resolves and inspects the addresses;
- re-checks **every redirect**, because a public URL that redirects inward is the classic way
  past a one-time check (and `fetch` follows redirects by default, so the client had to be given
  a way not to);
- caps the body and reduces it to text, so a hostile page cannot flood the model or the ledger;
- has its own rate limit, because an outbound fetch is far more expensive than a database read.

Search has two providers, and which one runs is a deployment decision.
`BRAVE_SEARCH_API_KEY` switches to Brave's API, which has a documented rate limit and a
stable response shape, and is what a production deployment should use. Without a key it falls
back to DuckDuckGo's HTML endpoint, which needs no key so the feature works out of the box --
and which rate-limits after a couple of requests from one address.

**When the provider is refusing, the tool says so.** A silent empty list would tell the model
the web had nothing to say, and the model would answer from its own memory and sound
confident about it. The challenge page is detected and reported as a refusal worth retrying.

### Two bugs found while building it

- The private-address check treated any host that was not a dotted quad as private, so it
  refused **every hostname**, `example.com` included. The safe answer for a *name* is to resolve
  it and look at where it points, not to look at the text.
- The AI service's shared HTTP client followed redirects by default, which would have walked
  straight past the per-hop check. It now takes a `redirect` option, so a caller that
  validates each hop itself can stop the client following the chain behind its back.

## Phase 5 — Packaging, signing, gated download

- **MSI** built by GitHub Actions on `windows-latest`, which is required: the WinUI XAML
  compiler and the Windows App SDK are Windows-only and do not build in a Linux container.
- **Signed.** The MSI is Authenticode-signed, which removes the "unknown publisher"
  prompt that makes an installer look malicious. A **purchased code-signing certificate**
  is still required — I cannot issue one, and a self-signed certificate produces an
  installer SmartScreen actively warns about. The pipeline takes a `.pfx` from a secret.
  EV is worth it for reputation, OV works functionally.
- **Gated download**: a Next route verifies Spectre entitlement, then redirects to a
  short-lived signed URL. The package is never at a guessable path and never in the repo.

---

## Risks, stated plainly

- **Home users cannot use the app at all.** Deliberate, but it is a real revenue and
  support cost.
- **Code-signing certificate cost and renewal** are ongoing, and the signing step blocks a
  clean first install without one.
- **Login throttling** is keyed per account + device after 0.4; a per-IP ceiling remains
  as a second layer.
- **No payment provider is wired.** "Can pay" currently means "has money in the
  simulated wallet". This does not change with the desktop app and should be tracked
  separately.
