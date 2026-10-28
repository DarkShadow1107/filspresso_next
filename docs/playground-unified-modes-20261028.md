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
  the identical gate set as the previous two commits — Signed Commit History Policy, Supply
  Chain Security Gates, Python Dependency Audit, Frontend Security Checks, Backend Security
  Checks. Not new, not bypassed; recorded and left for separate CI/qualification work.

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
