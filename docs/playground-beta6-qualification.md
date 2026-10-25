# Beta-6 Playground: evidence and explicit limits

**Superseded where noted:** [`playground-execution-safeguards.md`](playground-execution-safeguards.md)
records the subsequent policy-3 implementation of guest handle containment, AppContainer/job
controls, durable recovery and conditional qualification/enablement. This file preserves the
earlier Beta-6 checkpoint. Its permanent-block/unfinished-code statements are historical;
its distinction between software tests and unperformed live qualification still applies.

Branch: `Beta-6-Playground`; first commit `6ecfd20` preceded implementation.
This report supersedes Beta-5's “all gates green” wording. Fixtures/builds passing does
**not** mean release qualification. Historical “all-or-nothing export” was also inaccurate.

## What the terms mean

- **Real VM qualification:** boot a Windows guest and prove actual remoting, isolation,
  resource limits, cancellation and cleanup under hostile workloads. A VM runs on this
  same computer: no second physical device is needed.
- **Receipt:** evidence of checks actually performed, not execution consent or a signed
  security audit. The old seven-check receipt measures environment smoke checks only.
- **Vault row:** Credential Manager entry for a dedicated guest account, never the host
  login or Filspresso account. The application reads it; it must not invent credentials.
- **Qualified model:** actual model/template/tokenizer/runtime produces correct native
  calls, metering, compaction, cancellation and settlement. Fixture responses cannot prove it.
- **Production Docker:** a dedicated/rootless production engine and its operational/hostile
  limits need qualification. Docker Desktop tests do not certify production isolation.
- **MSI qualification:** elevated install/upgrade/uninstall on a disposable Windows test
  installation, not simply compiling a package. Signing remains intentionally deferred.
- **Reparse races:** an attacker swaps a path between checking and opening it. `Get-Item`
  followed by opening a path is not race-proof containment.
- **Jobs/descendants:** detached children can survive a command's exit or termination.
  Restrictions must be installed before untrusted code starts, and cover normal exits too.
- **Crash recovery:** discover and safely reclaim exactly owned workloads after an abrupt
  application/broker/host failure, without deleting unrelated resources.

## This single device: observed, not inferred

Read-only diagnostics on 2026-10-25 (`Test-PlaygroundReadiness.ps1`): Windows 11 Pro,
15.7 GiB RAM, a hypervisor present, Hyper-V PowerShell module present, VM management service
running, current process **not elevated**, Docker reachable, Docker **not reporting rootless**.
No process model allowlist, AI key or execution flag was configured; the default receipt was
absent. An operator's deployment configuration may differ from this process environment.

CPU VT/SLAT flags read false while a hypervisor was already present; those flags are
**inconclusive**, not evidence to change firmware. No firmware/features, VM/image, elevation,
installed product or production service was changed. No disk-wide image search or secret
collection occurred.

## Implemented

### Desktop project and consent safety

- `PinnedLocalPath` pins every local ancestor against renaming, opens final components with
  `FILE_FLAG_OPEN_REPARSE_POINT`, and rejects reparse/device/directory/multi-link files.
  Actual Windows rename/sharing tests run here. This is **host-side** project/image safety,
  not a repair of the separate guest PowerShell file guard or protection from administrators.
- Atomic in-memory baseline installation, case/file-directory alias rejection, empty-baseline
  support; bounded files/bytes/depth/directory enumeration. Imports preserve UTF-8 BOM/CRLF/
  empty files and reject invalid UTF-8/binary. Known credential names/generated trees are
  skipped. Filename filtering is not a general secret scanner.
- Immutable instance-bound one-shot export plans; forged/stale/replayed plans refused.
  Exclusive handles lock/revalidate all destination files before modifying content. Ordinary
  errors attempt byte restoration; rollback failure is an explicit error. Existing manifests
  are not overwritten. Missing subdirectories may be created during preflight on failed exports.
- **Not crash-atomic:** process termination/power loss may still leave partial content.
  Keep backups/source control. Folder selection no longer applies files: a separate dialog
  shows exact paths/bytes/hashes and requires explicit confirmation.
- Unified diffs preserve CRLF/final-newline differences and standard no-newline markers.
- Desktop executor validates schema/workspace/location and independently consumes exact
  one-shot consent. Direct unapproved writes and replays fail, not just calls through the loop.
  Failed cleanup remains retryable and prevents another start. This is in-memory retry,
  **not durable crash recovery**.
- Credential target names are no longer mistakenly prepended as Windows account domains.
- Startup cancellation and account/view changes dispose execution and clear rendered private
  data. Imports/exports/pickers cannot race a model run or repopulate a replaced view.

### Honest qualification

- Image verification measures actual SHA-256 through exclusive pinned/no-follow handles;
  size/mtime alone no longer suffice. Receipt reads are byte-bounded strict UTF-8.
- **Application composition deliberately release-blocks desktop execution** while guest
  race/job/crash protections remain unfinished. No flag or old receipt bypasses it. Local
  project review/artifact export and interaction-only conversation still work without a VM.
- Operator script fixes scalar probe parsing, double cleanup, throw/finally behavior,
  private per-run state directories, exact-scope cleanup, parameter bounds and native secret
  buffer zeroing. Its seven checks are explicitly environment smoke evidence, not release
  qualification. It was parser-checked, **not run against a real guest**.

### Connected web projects, artifacts and source previews

- Explorer reads the **same sandbox id** used by the agent. Explicit read-only inspection is
  sequential/cancellable/bounded and performs no inference or command. First observation is
  the local baseline. Refresh sees command-created/changed/deleted files as well as agent
  writes. Concurrent edits by other clients are not an atomic filesystem snapshot.
- Local text files are staged, then each exact path/content upload needs a separate checkbox
  and button approval. Next file resets consent. Lost write replies block further writes/
  agent runs until discard, with no PUT retry. Manual editor writes now also require an
  explicit per-write acknowledgement at the authenticated gateway.
- Compatible browser/desktop JSON text-project artifacts contain sorted paths, exact source,
  byte counts and SHA-256 hashes. No executable archive, automatic extraction, or application
  to original files. Hosted files are ephemeral; transcripts/source are not durably synced.
- Browser preview is escaped **source text**, in an opaque-origin empty-permission sandboxed
  iframe with restrictive CSP/no-referrer. It does not render project HTML, run JS/CSS, fetch
  remote assets, forward ports or start a server. Desktop source inspection is inert text.
- Both clients explicitly reset conversation/change Plan/Build while retaining project files.
  Prior model context/approvals are visibly cleared. This is not mid-command injection.

### Build outputs

`Build-Desktop.ps1 -PackageDirectory <directory>` isolates publish/branding/MSI output from
the active download. WinUI resources are checked. `package-manifest.json` records size,
SHA-256, signature status and `installQualified: false`. An isolated package build found a
missing branding icon; the script now explicitly copies the published icon before packaging.

## Verification

- Desktop: **428** tests, including real local Windows handle/process/hard-link checks, not Hyper-V.
- Web: **103** client tests; Nest: **344** tests; Python: **123** selected tests.
- TypeScript check and isolated Next production build pass without touching active `.next`.
- Actual Docker engine: files/run/isolation, normal/timeout descendant disposal, owner-bound
  discard, broker SIGKILL/restart and temporary PostgreSQL action/conversation smokes pass.
  Random namespaces were cleaned; application services/database volumes were not reset.
  Model/billing remain fixtures. `-SkipBuild` used existing local broker/runtime images.
- Native maintenance fixture tests pass (owned temporary paths/junctions and temporary
  test-prefixed vault entries, cleaned afterwards), not actual installed-product removal.
- Unsigned MSI build succeeds, separately from elevated installation. A hash is integrity
  metadata, not a trusted publisher signature or successful-install proof.
- WinUI XAML/C# and runtime resources compile/publish/package; the authenticated desktop
  conversation/import/export dialogs were **not interactively exercised** against live APIs.
- Mounted StrictMode Chromium verifies separate import acknowledgements, artifact hashes,
  opaque-origin inert previews, retained files across an explicit mode reset, and account
  discard. Targeted changed-file ESLint and web/backend TypeScript checks pass.

Package output (not installed and not promoted to the existing download):
`%LOCALAPPDATA%\Temp\opencode\filspresso-beta6-package\Filspresso.Playground.msi`.
The adjacent `package-manifest.json` contains this build's actual SHA-256/size and
`signature: NotSigned`; `publish-next` contains the WinUI binaries/resources.
Recorded final package: **55,983,195 bytes**, SHA-256
`d030a485da0e49ffc067df96ac53822ac7b052078125a0cf5ac327f9e2390c57`.
Rebuilding can change the package hash; trust the adjacent manifest for a later build.

Implementation commits: `ec406cb` (desktop hardening/gates/packaging), `490d6f1` (connected
web projects/import consent/artifacts/source preview); the branch anchor is `6ecfd20`.

## Explicitly unfinished / unqualified

| Item | Why / next requirement |
| --- | --- |
| Real Hyper-V run | No supplied/licensed guest VHDX or dedicated guest account; session not elevated. Need operator resources and a disposable VM. No guest receipt/vault row was fabricated. |
| Guest handle containment | **Unfinished software**, not only hardware: replace raceable guest path operations and run hostile concurrent tests. Host `PinnedLocalPath` is not a substitute. |
| Guest jobs/descendants | **Unfinished software:** suspended-before-assignment launch, job accounting/resource limits and normal-exit descendant handling need implementation and guest tests. |
| Durable Hyper-V recovery | **Unfinished software:** durable authenticated ownership inventory, stale-run discovery and exact-owned recovery are not implemented. |
| Real model/billing qualification | No configured allowlist/key in this process and no live authorized billing workflow exercised. Fixtures do not meet this gate. |
| Production rootless Docker | Current engine does not report rootless. Use a separately operator-provisioned engine/host; changing existing infrastructure is not a safe test. |
| Live HTML/JS application preview | **Unfinished software/security design:** needs a separate uncredentialed origin, routing/egress/lifetime isolation and browser attack tests. Source display does not close this. No unsafe same-origin proxy was added. |
| Binary/large artifacts and atomic cross-client snapshots | Not delivered; current artifacts are bounded UTF-8 observations. |
| Mid-command retained-workload redirection | Not delivered; interrupted execution may need destruction. Explicit new-conversation boundaries retain files instead. |
| Crash-atomic original-project application | Not delivered; needs a durable restore/transaction design. Current export has preflight locking and ordinary-error rollback only. |
| Elevated MSI lifecycle | Not run; changes machine state and needs an elevated disposable installation/snapshot. Build/maintenance fixtures are not installation qualification. |
| Installer signing | Intentionally deferred. Unsigned publisher warning remains. |

## Reproduce without weakening gates

```powershell
./playground-desktop/scripts/Test-PlaygroundReadiness.ps1
dotnet test playground-desktop/tests/Filspresso.Core.Tests/Filspresso.Core.Tests.csproj
node nestjs-backend/node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json --test tests/client/*.test.ts tests/client/*.test.tsx
python -m pytest tests/unit/test_playground_agent.py tests/unit/test_playground_compaction.py tests/unit/test_playground_context.py tests/unit/test_playground_sandbox.py tests/test_playground_security.py -q
node playground-sandbox/Build-AgentBrowserFixture.cjs
python tests/browser/playground-agent-workspace.py
./playground-sandbox/Smoke-Agent.ps1 -SkipBuild
./playground-sandbox/Smoke-Docker.ps1 -SkipBuild
node scripts/Check-PlaygroundFrontendBuild.cjs
./playground-desktop/build/Build-Desktop.ps1 -SkipTests -PackageDirectory "$env:LOCALAPPDATA/Temp/opencode/filspresso-beta6-package"
```

Docker smokes require prebuilt local broker/runtime/PostgreSQL images. These commands do
not enable production model allowlists or qualify the missing guest implementation.
For Nest tests, run `node node_modules/tsx/dist/cli.mjs --test "test/**/*.test.ts"` from
`nestjs-backend`. Typecheck/build from the same directory with
`node node_modules/typescript/bin/tsc -p tsconfig.build.json`.
