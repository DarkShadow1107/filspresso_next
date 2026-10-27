# Beta 8 Production Plan

**Status:** plan saved before implementation. Live checks and production deployment evidence
must be recorded only after they actually run. A skipped, unavailable or refused check is
not a pass.

## Decisions and boundaries

- The desktop app remains on its Windows Sandbox VM path plus an explicit native-restricted
  Windows option. **No Docker or WSL fallback is added to desktop.** Native restricted is
  not a VM and is not claimed to be Codex MXC.
- The current Docker Desktop engine (Linux, seccomp, memory/PID limits, cgroup v1, rootful)
  may run the existing **web hosted sandbox** for local/single-operator use. Its broker smoke
  passed on 2026-10-26. This does not qualify it for public multi-tenant production.
- A second rootless/cgroup-v2 WSL2 engine is a future upgrade. Do not install it or expose a
  Docker TCP API as part of Beta 8 unless the scope is explicitly changed.
- The Next.js server will become a distinct production `frontend` container. The existing
  backend, database and reverse-proxy boundaries remain explicit.
- The installer is built/promoted into the project’s versioned installer directory and is
  available only through authenticated backend routes and a private read-only artifact mount.
  It must not be served as a public static file. A browser necessarily exposes an authorized
  download request/response in DevTools; the goal is to prevent anonymous/cross-account
  access and public static URLs, not to hide bytes from the account that downloads them.

## Execution sequence

### 1. Establish a safe baseline

- Confirm branch and clean/known working-tree state before changes; use `Beta-8-Production`
  for the Beta 8 implementation.
- Check Docker context and daemon properties read-only. Keep the production preflight strict:
  current rootful/cgroup-v1 Docker is expected to fail the production rootless/cgroup-v2 gate.
- Check Compose configuration and service health without resetting database volumes or
  pruning Docker resources.
- Treat the web sandbox overlay as local-only unless a dedicated production engine and its
  access controls have actually been qualified.

### 2. Connect and verify the current web sandbox

- Configure a random private `PLAYGROUND_SANDBOX_KEY` for the backend and broker; never
  commit it or expose it to the browser.
- Use `docker-compose.playground.yml` with the current `desktop-linux` engine. Start only
  the intended broker/backend services; preserve unrelated service and volume state.
- Run `playground-sandbox/Smoke-Docker.ps1` against a unique test namespace. Confirm the
  broker reports completion and its temporary workloads are removed afterward.
- Verify the browser-facing route remains authenticated and the broker has no public port.
- Do not enable the separate native agent/model execution flags merely to enable the basic
  web sandbox.

### 3. Perform live model and billing qualification

- Preflight that an explicitly designated test account, current authentication token,
  selected model and live billing service are configured. Do not print or persist tokens.
- Make only the smallest explicitly approved live request(s), with no automatic retry.
  Live inference may incur real charges; record the selected model and the amount observed.
- Verify the actual account entitlement, request/response usage, billing ledger/settlement,
  and expected refusal behavior. A model response or returned usage receipt alone does not
  prove ledger reconciliation.
- If credentials, test-account authorization, model availability or explicit paid-call
  confirmation are missing, stop and report the exact blocker. Do not substitute fixtures
  and label them live.

### 4. Containerize Next.js

- Add a production multi-stage frontend image using the repository’s Next.js standalone
  output (or document and justify an alternative if repository configuration prevents it).
- Add a dedicated `frontend` Compose service with production start command, non-root runtime
  where supported, health check, bounded resources, required runtime environment and no
  secret `NEXT_PUBLIC_*` values.
- Route public web traffic through the existing ingress/reverse-proxy design; keep the
  frontend-to-backend connection on the private Compose network. Do not publish backend,
  database or sandbox-broker ports unnecessarily.
- Verify clean image build, readiness/health, browser routes, authenticated API calls, static
  assets, graceful restart, and that no secrets are present in browser bundles or image
  layers.
- Do not remove the working host-based Next deployment until the container path is tested
  and its cutover/rollback procedure is clear.

### 5. Make the MSI project-local and backend-private

- Build the MSI into the versioned project artifact directory, not AppData temp. Preserve
  the release manifest, exact byte count and SHA-256; fail promotion on mismatch.
- Store/retain the binary in backend-private read-only storage (a deployment-owned volume or
  equivalent private mount), outside the web root and outside any public static asset path.
- Serve it only through the authenticated backend download route, with account entitlement,
  server-recorded acknowledgement for the currently published version, rate limiting,
  integrity verification and audit recording.
- Test anonymous, unauthenticated, wrong-account, expired-session, non-entitled,
  unacknowledged, version-drift and integrity-mismatch refusal cases; test an entitled
  acknowledged account can download the exact manifest-matching bytes.
- Set private/no-store response behavior and prevent CDN/static caching. Do not claim the
  authorized account cannot inspect or save its own browser download in DevTools.
- Keep the MSI unsigned warning honest until signing is implemented and verified.

### 6. Final verification and evidence

- Run backend, web-client and desktop test suites; build the backend, frontend container and
  WinUI desktop app through their supported toolchains.
- Run Compose health and routing checks without treating a local cgroup-v1 engine as
  production sandbox qualification.
- Record live model/billing results, actual Docker engine facts, MSI digest, and each
  completed/refused check in the release evidence. Clearly label fixture, local, staging and
  production evidence.
- Do not claim production approval if the live billing ledger check, deployment access
  controls, production-engine qualification or required security smokes remain unperformed.

## Beta 8 completion criteria

- Web sandbox works on the existing local cgroup-v1 engine and remains clearly separate
  from desktop execution.
- The new frontend container is healthy and routed through the intended ingress without
  exposing private services.
- Live model/billing evidence is genuine and reconciled against the account ledger, or the
  remaining blocker is explicitly recorded.
- MSI is built in the project release path, retained privately for the backend, and only
  backend authorization can deliver it; all refusal and integrity tests pass.
- All automated tests/builds pass, with no claims beyond the evidence obtained.

## Execution evidence — 2026-10-26

**State: local implementation and smoke checks passed; Beta 8 is not production-qualified.**

### Local deployment checks

- Work was performed on `Beta-8-Production`. Compose configuration validates.
- The web broker's earlier `Smoke-Docker.ps1` real-Docker smoke completed and cleaned up its
  temporary workloads. Its live health response is `200`, `hosted-docker`,
  `network=disabled`; the broker has no published port. This is local web-sandbox evidence
  only.
- The strict production-engine preflight refused the current Docker Desktop `desktop-linux`
  engine: it is rootful and cgroup v1. Do not use it as public multi-tenant qualification.
- The Next.js 16.4.3 / Sharp 0.35.5 standalone frontend image built and is running as
  `nextjs`, healthy, with no published port. Caddy is healthy; the root and sampled
  `/_next/static` assets return `200`. The public MSI path returns `404`.
- Backend is healthy on `127.0.0.1:4000`; frontend port 3000 and broker ports are
  unpublished. PostgreSQL was recreated after explicit approval to apply
  `127.0.0.1:5432`; it is healthy and uses the unchanged
  `filspresso_next_postgres_data` volume. The AI container was not restarted.
- The public download proxy returns anonymous `401` with `Cache-Control: private, no-store`;
  installer metadata returns anonymous `401` with `no-store`. The backend download route
  also refuses anonymous access. No sandbox or qualification credential is present in the
  frontend container environment.

### Installer evidence

- The existing project-local `0.3.2` MSI is 80,978,388 bytes with SHA-256
  `c016b0ba9908922bca4a299969b11b7ec670f0fffc6f243eeb593fa3c9111148`. Its BOM-free
  manifest matches those bytes. The rebuilt backend resolves that exact version, size and
  hash from its read-only `/app/downloads` mount; it reports the package as unsigned.
- `Get-AuthenticodeSignature` reports `NotSigned`; the manifest says
  `installQualified: false`. The MSI was not rebuilt or install-qualified in this run.
- The WiX installer conditions allow x64 Windows client editions listed in
  `Filspresso.Installer.wxs` on build 19041 or newer; a per-machine installation requires
  elevation. These conditions do not prove install/upgrade/uninstall success. Windows
  Sandbox execution separately requires an eligible Windows 11 24H2+ edition, virtualization
  and the Sandbox feature. The app SDK runtime is packaged self-contained; the missing local
  PRI build task blocks rebuilding from source, not by itself installing this existing MSI.
- The PowerShell build/publish scripts now write BOM-free UTF-8 manifests. Backend tests
  cover BOM-prefixed manifest parsing, hash mismatch refusal, and missing/invalid signing
  metadata. Controller contract tests cover entitlement, acknowledgement, version and audit
  gates. The browser proxy now marks both success and refusal responses `private, no-store`.
- Live wrong-account, expired-session, non-entitled, unacknowledged, version-drift and
  acknowledged-download cases remain untested: no designated authorized test account or
  `PLAYGROUND_QUALIFICATION_TOKEN` was available. Anonymous `401` is not evidence for those
  cases. Authorized downloads remain visible to the account in browser DevTools.

### Tests, builds and dependency review

- Backend: **355/355 tests passed**; TypeScript typecheck passed. Backend image rebuilt from
  this checkout and is healthy.
- Web client: `npm run build` passed; all seven Playground suites passed (**98 tests** after
  adding the download cache-header regression cases). The Next.js 16.4.3 / Sharp 0.35.5
  frontend image rebuilt, was deployed locally, and is healthy. Root and sampled static
  assets return `200`; anonymous MSI download is `401 private, no-store`. Lint reports
  **0 errors and 18 warnings**.
- Desktop core suite: **481/481 tests passed**. The WinUI app build did not complete: this
  environment lacks `Microsoft.Build.Packaging.Pri.Tasks.dll` required by the Windows App
  SDK's PRI task. The MSI was therefore not rebuilt. Both edited PowerShell scripts parse
  with zero syntax errors.
- Non-forced npm audit fixes updated Next.js to `16.4.3`, Axios to `1.20.0`, and compatible
  backend dependencies, including `proxy-addr` to `2.0.8`. Frontend Sharp is now `0.35.5`
  and `node-forge` is dev-only; the frontend production audit is **0 findings**. The full
  frontend audit still reports **1 high, dev-only `node-forge`** advisory with no published
  fix. The backend production audit remains at **11 findings (5 high, 6 moderate)**,
  including NestJS/Express transitive dependencies, backend Sharp and UUID. NestJS 12 is a
  coordinated migration path, not an automatic fix for every finding: its Express adapter
  currently pins a Multer version still flagged by audit, and the Redis throttler adapter
  does not declare Nest 12 peer support. See
  [`nestjs-12-security-migration-plan.md`](nestjs-12-security-migration-plan.md) for the
  rationale, known breakage and staged remediation plan. No NestJS major upgrade was made.

### Outstanding production gates recorded 2026-10-26

- No paid live model request or billing-ledger reconciliation was attempted. A designated
  account, qualification token and explicit live-call approval are still required.
- Production rootless/cgroup-v2 engine qualification, deployment access controls and the
  authenticated MSI entitlement/acknowledgement matrix remain outstanding.
- Resolve the remaining backend dependency advisories and the missing Windows PRI build
  tooling, then rebuild and lifecycle-qualify a new MSI (including signing) before release
  approval. The existing unsigned MSI is not known to be un-installable; its install lifecycle
  simply has not been qualified.
- These local checks do not amount to production approval or a claim that Beta 8 is complete.

## Follow-up evidence — 2026-10-27

**State: a separate desktop MSI candidate was built, the NestJS 11 migration was validated
locally, and only the frontend container was renamed/recreated. No MSI was published and the
backend image was not deployed. Beta 8 remains not production-qualified.**

### MSI candidate

- Built version **0.3.3** to
  `playground-desktop/artifacts/candidate-0.3.3-20261027/Filspresso.Playground.msi` as a
  separate candidate; it was not promoted to the public installer index.
- The manifest records **81,007,060 bytes** and SHA-256
  `b08a8581a1c3b6b842c161f493024ace3215756cccb2f7fa26b7b5f81dff04e2`; an independent hash
  and byte-count check matched. `Get-AuthenticodeSignature` reports `NotSigned` and the
  manifest says `installQualified: false`.
- Desktop core tests passed **481/481** and native maintenance tests passed. MSI install,
  upgrade, uninstall, signing and qualification remain unperformed; this candidate is not a
  release-ready installer.

### NestJS migration and image build

- Migrated the backend dependency tree from Nest 10 to Nest **11.2.8** with Config **4.0.4**,
  Express **5.2.1**, Multer **2.5.0** (including an adapter override), Sharp **0.35.5** and
  UUID **11.1.1**. Nest 11 retains the current Redis throttler adapter's declared peer
  support; the existing bounded Redis/local fallback implementation remains in place.
- Added an admin upload guard before Multer, Express 5 route/parser regression tests and Config
  v4 environment validation coverage. A clean `npm ci` succeeded; backend tests passed
  **362/362**, both typechecks and the backend TypeScript build passed. Production and full npm
  audits each report **0 findings**.
- `docker compose build backend` succeeded without replacing the running backend. A separate
  container smoke on Node **20.20.2** loaded the Nest Express adapter/Multer and generated a
  PNG with Sharp **0.35.5**. A live backend startup against Postgres/Redis, canary and
  deployment were not performed.

### Frontend container rename

- Compose now sets `container_name: filspresso_frontend`. Only the frontend service was
  force-recreated (`--no-deps --no-build`); the old `filspresso_next-frontend-1` container is
  gone. The new `filspresso_frontend` is running and healthy with zero restarts; Caddy remained
  healthy and `https://localhost:8443/` returned `200`.
- No orphan containers were removed, and the backend, databases, AI and other services were
  not recreated by this rename.

### Remaining production gates

- The current Docker Desktop engine remains rootful/cgroup v1 and is not qualified for public
  multi-tenant sandbox workloads. Production rootless/cgroup-v2 engine qualification and
  deployment access controls are still required.
- Live model billing reconciliation and the authenticated MSI entitlement/acknowledgement
  matrix still require an authorized test account and explicit paid-call approval.
- Sign and lifecycle-qualify an MSI (install/upgrade/uninstall) before any release approval.
  The 0.3.3 candidate's unsigned, unqualified state must remain visible in any future evidence.
- The NestJS image is built but not deployed; run a staging startup, DB/Redis health and
  request/authorization smoke, monitor it, and retain a rollback path before promotion.
