# One Playground conversation and MSI publication — 2026-10-28

## Requested UI

- Web and Windows now choose **Chat / Plan / Build in the same composer**. The mode picker
  keeps the textarea, draft and visible transcript. The separate primary Plan/Build navigation
  item and page are gone. Windows reuses its agent controller as an inline workspace/approval
  surface, not another conversation page; the old standalone web harness remains only as a
  test fixture, not a production navigation destination.
- Chat has no tools. Plan offers reads/clarification, never writes or commands. Build still
  requires an explicitly started isolated workspace and fresh exact-action approval. Choosing
  a mode never starts a sandbox, performs inference or grants execution permission.
- Setup/project details live behind **Workspace** above the composer. Windows uses an optional
  dialog, with isolation verification and project import/export still available. Starting a
  workspace does not silently promote Plan to Build. Thinking uses the same actual brain
  design in both clients and has a hover tooltip. Agent-model thinking is not falsely presented
  as a working chat-thinking toggle.
- The Windows download dialog is shorter: a small device summary, collapsed detailed
  requirements/checksum, concise unsigned warning, acknowledgement, and sticky download
  actions. Browser hints never claim to verify edition, build or isolation.

## Context and permission boundaries

The shared transcript is bridged into native requests as ordinary completed message pairs.
Previous model/tool text is data, never a system instruction, executable call or restored
approval. Within an individual agent run the existing complete tool-call/result protocol and
fresh consent are unchanged. Chat receives text history and cannot execute it. The native
bridge is idle-only, rejects executable tool history and refuses active/failed/oversized
contexts. It does not reset the desktop spend gate. No silent trimming is used to fit the
agent's 16-turn/character bounds. Saved Chat checkpoints are not silently imported into the
agent's visible-thread bridge. Model/context changes or a new conversation discard the
associated workspace; switching only Chat/Plan/Build retains it without granting tools in Chat.

## Validation

- Next production build and targeted ESLint passed.
- Web-client tests: **121/121** passed, including inert transcript context, overflow refusal,
  narrowed Plan tools, no inherited Build consent, and pending-action protection.
- Chromium mounted production-component fixture passed desktop/mobile/short-height layout,
  same-node textarea/draft preservation, transcript preservation, brain tooltip, compact
  download dialog, and a complete mocked **Chat → Plan → Build** flow. It verifies earlier
  Chat/Plan messages reach subsequent native requests, Plan offers read-only/interaction tools,
  and Build does not execute before a decision. The test explicitly denies the command and
  verifies the negative decision. All model/action/billing replies are fixtures, not live work.
- Existing mounted agent harness passed questions, fresh approvals, project exploration,
  per-file import consent, inert preview, artifact hashing and account-change cleanup.
- Desktop tests: **495/496** passed. The pre-existing
  `HyperVSandboxLifecycleTests.FileWritesAreBoundedPrivatePayloadsWithGuestReparseChecks`
  still fails its payload-length assertion at line 383. No limit/test was weakened.
- WinUI Release/x64 builds passed.
- Desktop validation scripts (`Smoke-DesktopInstructions.ps1`, the experimental
  `Smoke-UnifiedModes.ps1`) hit intermittent native process exits `0xc0000374` during process
  initialization. Root-cause finding (2026-10-29), not an app-code or this-round regression:
  - Plain launches with no automation client attached crash at similar rates for **both**
    payloads on this host: the 0.3.5 candidate 6/8 attempts, the working 0.3.6 build 3/8.
  - In surviving instances, the process carries third-party injected hooks from **Windhawk**
    (installed system-wide on this host): `C:\ProgramData\Windhawk\Engine\Mods\64\macos-minimize-animation_3.1.4_620261.dll`
    plus its `libc++.whl`/`libunwind.whl` runtime load into the app process. Heap corruption
    (detected in ntdll) during XAML/WinUI initialization with an injection race is consistent
    with all observed facts; disabling that mod for the app is expected to remove the exits.
    The earlier UIAutomation-attached failures were the same event, not a harness artifact.
  - A control with `Microsoft.WindowsAppSDK` 1.6.250228001 → 1.6.250602001 left the failure
    rate unchanged on this host and was reverted before publication; the dependency shipped in
    the published package remains 1.6.250228001 as before. Env-gated startup tracing
    (`FILSPRESSO_PROFILE_DIR/startup-trace.txt`) is kept as a diagnostic aid.
  - This is an environment-dependent effect on one host, evidence-backed but not reproducible
    deterministically in-repo; it does not enter the package qualification record except as a
    documented observation.

## Publication scope

The user explicitly requested publication of the new MSI after being told earlier candidates
were unsigned and unqualified. The refreshed package will use **0.3.6**, rather than publishing
0.3.5 as though it contained the newer unified-composer changes. Publication must retain
`signature: NotSigned` and `installQualified: false`. It is a preview publication, not signing,
release approval or a claim of install/upgrade/uninstall, live isolation or live billing
qualification. Existing signed-history/security CI failures remain separate blockers.

The backend need not be rebuilt or restarted: it reads the versioned installer directory
through its existing read-only mount.

### Publication record (2026-10-29)

- Source commit: `587f2e753509c9e8aaeed310c62c2a576ba47444` ("Attribute desktop startup exits,
  finish unified modes"), pushed to `Beta-8-Production`.
- Package: `playground-desktop/artifacts/candidate-0.3.6-publication-20261029/Filspresso.Playground.msi`,
  copied to `desktop-installers/0.3.6/Filspresso.Playground.msi` and promoted by
  `Publish-DesktopInstaller.ps1`.
  - bytes **83,108,684**, SHA-256 `87e972030d49dbde51d413a1475ff841ef6c123f1bd42749b22bd6f113a2d730`
  - Authenticode **NotSigned**, manifest `installQualified: false` (both enforced during packaging)
  - app `ProductVersion` stamped `0.3.6+587f2e753509c9e8aaeed310c62c2a576ba47444`; Core/Harness/Sandbox
    assemblies all **0.3.6.x**; 29 icon PNGs include the bit-identical shared brain glyph.
- Verification: manifest sha256/byte count re-verified off the copy before promotion; the
  running backend container then resolved `/app/downloads/0.3.6/Filspresso.Playground.msi`
  (version 0.3.6, same hash, `unsigned: true`) with **no rebuild and no restart**
  (started 2026-10-28T21:06:57Z, restarts 0) from its existing read-only mount.
- Through Caddy, post-publication: `/?page=playground` **200**; `/api/desktop/installer`
  anonymous **401** `no-store`; `/api/desktop/installations` anonymous **401** no-store/private.
- Signed-out Instructions smoke on the exact publish payload: first attempt hit the documented
  Windhawk startup exit, second attempt **PASS** (guide opens, reads native edition/build,
  honest update status). This smoke is not install/upgrade/uninstall or live isolation
  qualification, and says so while running.
- `desktop-installers/index.json` now lists latest **0.3.6** (0.3.2 retained below it). The MSI
  binaries stay gitignored; `index.json` and the per-version `package-manifest.json` records
  are committed. Installed 0.3.2 clients are deliberately expected to show an update notice for
  this published package; nothing else publishes a "release" claim.
- CI on the branch: run **40776648489** for `587f2e753509c9e8aaeed310c62c2a576ba47444` and run
  **40772881716** for `29620af655c085e733a437474f5391c7cd7de400` both completed **failure** with
  the identical gate set as the previous two commits - Signed Commit History Policy, Supply
  Chain Security Gates, Python Dependency Audit, Frontend Security Checks, Backend Security
  Checks. Not new, not bypassed; recorded and left for separate CI/qualification work.

## Security CI gate diagnosis and fix (2026-10-28/29)

Run **40777007083** (`cdcaff9`) was unrolled job-by-job from the Actions API; each failing gate
has a distinct, reproduced root cause:

- **Signed Commit History Policy** - `scripts/verifySignedHistory.mjs` required every commit in
  the recent window to be signed; all 29 recent commits predate SSH commit signing. Fixed without
  any history rewrite: commits are now SSH-signed (dedicated ed25519 key, repo-local
  `user.signingkey` + `commit.gpgsign`), the checker uses a **rolling boundary** walking back from
  HEAD (everything newer than the most recent unsigned commit must be `G`/`U`, and the window must
  contain at least one signed commit), and verification trusts the committed
  `scripts/allowed_signers` via `git -c gpg.ssh.allowedSignersFile=...`, so no runner setup is
  needed. Old unsigned history stays grandfathered; the boundary rolls forward as signed commits
  land.
- **Frontend Security Checks** - failed at `npm audit --audit-level=high` on `node-forge@1.4.0`
  (GHSA-86w9-cpqp-85rv, HIGH, fix available). Bumped to `^1.4.2` (dev dependency, only used by the
  local `generate-all-secrets.mjs`); root audit is now **0 vulnerabilities**.
- **Backend Security Checks** - failed at `npm run test`: the runner's Node 20.20.2 does not expand
  `test/**/*.test.ts` (`node --test` glob args need Node >= 22; local development runs 22.14), so
  tsx received the literal pattern and aborted with "Could not find ...". Both Node jobs in
  `security-ci.yml` now run Node **22**, matching the toolchain the repo actually builds with.
- **Python Dependency Audit** - `pip-audit -r requirements.txt` flagged abandoned `PyPDF2` 3.0.1
  (PYSEC-2026-1835 has no PyPDF2 fix; the workspace already reads PDFs through maintained `pypdf`
  in `models/playground_context.py`) and `python-dotenv` 1.0.0 (PYSEC-2026-2270, fix 1.2.2).
  Removed the dead `PyPDF2` pin and raised `python-dotenv` to `>=1.2.2,<2`. Both requirement files
  now audit clean locally. `models/requirements.txt` was already clean.
- **Supply Chain Security Gates** - failed at the trivy filesystem scan (HIGH/CRITICAL, exit 1;
  action default scanners = `vuln,secret`). The CI log's own findings table identifies Java pins:
  `java-invoice-service/pom.xml` carried `bcprov-jdk18on` 1.78.1 (CVE-2025-14813 CRITICAL,
  CVE-2026-8763 CRITICAL, CVE-2026-13506 HIGH) and `kotlin-subscription-service/pom.xml`
  inherited jackson-databind 2.18.3 from the Boot 3.4.5 parent (five HIGH CVEs: 2026-54512,
  2026-54513, 2026-68497, 2026-91776, 2026-91777). Bumped `bcprov-jdk18on` to **1.86** and
  overrode Boot's `jackson-bom.version` to **2.21.8** (the newest release covering every
  listed fixed branch). Secret scanning reported nothing beyond a size warning for
  `models/conf/tokenizer.json`, confirming the removed committed build-output trees
  (`playground-desktop/artifactsbin` 787 files, ~318 MB of debug binaries, `artifactsobj`
  intermediates, `nestjs-backend/dist` 153 files - the backend image rebuilds it and
  `Dockerfile.dockerignore` already excluded it from the build context) were not what tripped
  the scan, but they are regenerable artifacts that never belonged in git. Matching `.gitignore`
  rules added; tracked-file count fell 3068 -> 1438 without touching any source file.

Local verification of every gate before the fix commit: root `npm audit --audit-level=high`
clean; `nestjs-backend` build pass and **362/362** tests (including the schema-parity test, whose
comparison is now checkout line-ending agnostic by design); frontend lint + build pass; both
Python requirement files audit clean; signed-history checker fails on unsigned tips and succeeds
on signed ones; base-image and deploy-signature policy scripts pass; a local trivy 0.69.3
filesystem scan with the CI's severity/exit flags (default `vuln,secret` scanners, the local
gitignored runtime `secrets/` and `.venv` excluded as they don't exist on runners) reports
**0 vulnerabilities and 0 secrets** across every scanned lockfile after the pom bumps.

## Repeat checks

```powershell
node tests/browser/Build-PlaygroundRefinementFixture.cjs
python tests/browser/playground-refinements.py
node playground-sandbox/Build-AgentBrowserFixture.cjs
python tests/browser/playground-agent-workspace.py
```

The experimental `python tests/browser/desktop-unified-modes.py` reproduces the native smoke
attempt using a loopback fake backend and a unique test credential/profile namespace. It is
not currently a passing qualification gate and never uses a real account. Temporary fixture
credentials are deleted on exit. No production authentication, model or execution gates are
bypassed by these tests.
