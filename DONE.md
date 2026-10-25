# Filspresso Playground — implementation handoff

## Current desktop direction — Windows Sandbox, not user-managed guests

The desktop now defaults to imported-text inspection plus an explicitly started Windows
Sandbox Build workspace. Generic VM consent/harness code retains the legacy Hyper-V adapter
but the app no longer composes it or requests VHDX/guest credentials. Command-generated
text changes join direct writes in reviewed checkpoints; original-project writes remain a
separate conflict-checked confirmation. Web search/fetch are consent-bound backend tools
in Plan and Build, not VM internet access. Full command networking and automatic deletion
exports are not implemented. The installed MSI bundles a user-invoked live verifier.

See [`docs/playground-windows-sandbox.md`](docs/playground-windows-sandbox.md). This PC
reports Windows 11 Pro 25H2 **26200.9711** but has no Sandbox CLI/package; no Windows
feature was enabled and no live receipt issued. Execution remains disabled until actual
VM probes pass. Existing Hyper-V qualification notes below describe the previous backend.

Regression checks for this direction: **481/481 desktop tests** and **110/110 web client
tests** pass; **352/352 NestJS backend tests** pass, including the installer/source
contracts added this increment. New tests cover hardened XML configuration, identity/foreign-instance refusal,
ambiguous-start/cleanup recovery, malformed guest replies, exact web consent in Plan,
command-edit checkpoints and native temporary-directory snapshot capture. They do not
issue or stand in for live Windows Sandbox qualification; they also cannot stand in for
the native restricted receipt. The bundled verifier reports setup requirements rather than
synthesizing passing evidence when the CLI is missing.

**Native restricted fallback (explicit, weaker opt-in):** `NativeSandbox` +
`GuestBoundary.RunRestricted` (AppContainer with UI restrictions 255, private desktop,
suspended-before-job launch, scrubbed environment, per-session profile in an app-owned
staging tree) is wired behind explicit user acknowledgement and a separate DPAPI receipt
(`native-restricted.bin`; shared host kernel; **not** a VM, **not** Codex MXC; never an
automatic downgrade). The verifier gained `native-sandbox --confirm` (incl. the
cross-process kill/recovery gate via `native-sandbox-worker`) and `native-sandbox-recover
--confirm`. On this PC, that live run passed and issued a real receipt under
`%LOCALAPPDATA%\Temp\opencode\filspresso-native-live-15cf3f3c15314cdba61965e662358678`
(probe exit 0, no unexpected loopback connection, descendant cleanup, broker process-tree
kill recovery). It is device/build-bound and expires in 30 days; the installed app account
still has no receipt until it runs its own verification. VM qualification remains pending
on the Sandbox feature enable + restart.

Final full build (tests not skipped): **459 Release desktop tests**, **18 native maintenance
checks**, WinUI publish, bundled matching verifier and **unsigned MSI 0.3.2** pass. The
package built in `%LOCALAPPDATA%\Temp\opencode\filspresso-windows-sandbox` is now **promoted
into the repository** (see the checkpoint below; not installed on this PC). Running that bundled
verifier for Windows Sandbox on this PC exits **1 with
setup instructions**, without a VM or receipt; native restricted mode needs its own explicit
verification in the app. App/bundled verifier sandbox DLL hashes match
(`ae1dddc066c786f8e2cce7c25486775f533f5da5e8975c1e9cd6d7f795c21eb6`); the earlier failing
live native run used a stale Filspresso.Qualify output directory, so its evidence is
invalid and superseded by the fresh-binary run above. MSI: 80,978,388 bytes; SHA-256
`c016b0ba9908922bca4a299969b11b7ec670f0fffc6f243eeb593fa3c9111148`; `package-manifest.json`
records `NotSigned` / `installQualified: false`. This build includes the website download
compatibility popup and the conversation's isolation picker with native restricted opt-in.

## Installer pipeline and account visibility checkpoint — 2026-10-25

The desktop app's delivery and its account-visible record are now wired end to end, with the
honesty preserved at every hop:

- **Versioned publication.** `Publish-DesktopInstaller.ps1` promotes a build into
  `desktop-installers/<version>/Filspresso.Playground.msi` + `package-manifest.json` and
  maintains the committed `desktop-installers/index.json` (latest **0.3.2**, 80,978,388
  bytes, SHA-256 `c016b0ba9908922bca4a299969b11b7ec670f0fffc6f243eeb593fa3c9111148`). The
  MSI payloads are gitignored; the manifests/index are committed so a checkout without
  binaries still records what was published. `docker-compose.yml` mounts
  `desktop-installers/` read-only at `DESKTOP_INSTALLER_DIR` (replacing the
  `playground-desktop/artifacts` mount); the legacy single-file `DESKTOP_INSTALLER_PATH`
  override remains supported.
- **Serve-time honesty.** The backend resolves the newest publication and re-verifies the
  real file against its manifest before the first byte streams: missing sha256 refuses,
  swapped bytes fall to 503 `INSTALLER_INTEGRITY`/`INSTALLER_SIGNATURE`, and with
  `DESKTOP_INSTALLER_SIGNING_SECRET` set the manifest MAC
  (`{fileName}:{bytes}:{sha256}`) is checked too. A `Test-PlaygroundReadiness.ps1` run on
  this PC reports `installerPublished: true`, `installerLatestVersion: 0.3.2`,
  `installerLatestSha256Matches: true` — the same hash check the service performs.
- **Warn → acknowledge → download.** The web popup now shows the package facts (version,
  size, SHA-256, unsigned flag), the honest warnings (SmartScreen, heuristic antivirus,
  admin/restart needs), a user-stated OS select labelled "stated, not verified", and an
  explicit acknowledgement checkbox. The download button records the acknowledgement on
  the server first (`POST /api/desktop/installer/ack`, validated against the currently
  published version — drift falls to 409 `VERSION_MISMATCH`), then navigates to
  `GET /api/desktop/download`, which re-checks Spectre access, resolves the publication,
  and requires the **server-recorded** ack row for that version before streaming; the
  post-stream audit write is logged, never converted into an HTTP error. The account
  page asks which versions were acknowledged (with the stated OS and download counts) via
  `GET /api/desktop/installations`.
- **Account-visible installs / device check-in.** The running app reports its machine's
  facts once per run, fire-and-forget, after the first successful entitlement load
  (`POST /api/desktop/device-state`): Windows edition/build/UBR and the app version.
  Unknown facts are omitted from the JSON, never sent as zeros. The account's billing tab
  shows "Playground installed on" from those reports, labelled as app-reported and
  explicitly not treated as a verification result or an entitlement input.
- **Desktop update notice.** The same maintenance pass asks the server what it would
  publish today; a numerically newer published version (0.10.0 > 0.9.0, unparseable
  versions never claimed) with Spectre access shows a passive workspace notice naming the
  version and pointing at the account page. Nothing is downloaded, elevated or restarted
  by the app.
- **EXPERIMENTAL session spend cap (default off).** A per-conversation ceiling in RON,
  `AgentSessionSpendCapRon`, null by default and normalized to off for null/non-positive
  values or anything above 10 000. When on, `SessionSpendGate` records each completed
  reply's client-side estimate against the entitlement-resolved prices, fails closed on
  any model it cannot price, the loop refuses the tool batch (not the already-delivered
  reply) when reached, the session refuses further runs until `NewConversation()` resets
  the budget, and the settings page labels the toggle estimate-only. The server is never
  told about the cap and still meters every turn.

Verification this increment: **481/481 desktop tests** in Debug and Release (22 new:
11 installer-metadata/check-in client tests, 11 spend-gate/loop/session tests), **352/352
NestJS tests** (8 new installer/source-contract tests pinning the gate order), **110/110
web client tests**, touched-file ESLint clean, backend `tsc` clean, and the WinUI app
built with VS MSBuild x64. Boundaries, unchanged: the package is unsigned; the backend
was not booted for a live browser download in this increment (serve path verified by the
contract tests, the publish-script hash check and the readiness script); no live
acknowledgement row was created against a running server for this account; Windows
Sandbox remains unqualified on this PC pending the feature enable/restart, and the
account-visible install table stays empty until a signed-in app performs the check-in.

## Current safeguards follow-up — policy 3

Guest pinned-handle file operations, capability-free AppContainer commands, suspended-before-
job launch, verified limits, normal-exit descendant termination, durable DPAPI recovery intent/
exclusive root lease, host-transport kill-on-close job and lifetime image locking are now
implemented. The permanent false execution gate is replaced with machine/image/**exact-build**
qualification. Policy-2 receipts cannot enable it. The actual-adapter qualification console
and wrapper must pass real guest/race/descendant/timeout/output/process-kill recovery checks
before issuing policy-3 evidence. No live receipt has been issued here.

See [`docs/playground-execution-safeguards.md`](docs/playground-execution-safeguards.md)
for code, enablement commands, test boundaries and the operator resources still missing.
Model probe, production engine preflight and disposable-machine MSI lifecycle entry points
also exist; adding a tool does not mean its live qualification was performed.

Verified this follow-up: **436/436 desktop tests**, including actual Windows native
AppContainer/job/race/host-transport probes; **103/103 web client tests**; root TypeScript
check and model-probe ESLint pass. The qualifier is included in the solution and is separately
built/published. WinUI publish, matching qualification executable and **unsigned MSI 0.3.1** build
successfully in `%LOCALAPPDATA%\Temp\opencode\filspresso-beta6-safeguards` (not installed
or promoted). App/qualifier sandbox DLL hashes match. Operator scripts parse. Missing model-
probe authorization/input and missing qualifier arguments fail closed without requests or
receipts. Production Docker preflight correctly refuses the local rootful/cgroup-v1 engine.

## Beta-6 current status — 2026-10-25

Branch `Beta-6-Playground` starts at `6ecfd20`. The earlier “all gates green” wording
meant fixtures/builds, **not release approval**. See
[`docs/playground-beta6-qualification.md`](docs/playground-beta6-qualification.md) for
single-device diagnostics, implemented changes, commands and explicit unfinished items.

Beta-6 hardens project import/export with pinned Windows handles, exact one-shot plans,
preflight locking/revalidation, ordinary-error rollback and explicit review confirmation.
It independently enforces desktop tool approval, fixes vault account handling, verifies
actual image SHA-256 and **release-blocks desktop execution** until guest race/job/crash
protection is implemented and qualified. The old seven-check receipt cannot bypass this.

Connected web explorer/per-file imports/checkpoint observations, compatible bounded JSON
artifacts with SHA-256, inert source previews, and explicit conversation/mode reset retaining
project files are delivered. These are not live application previews or mid-command
redirection. Export is **not crash-atomic**; earlier “all-or-nothing” claims are superseded.

Verification: **428 desktop**, **103 web client**, **344 Nest**, **123 selected Python** tests;
real Docker lifecycle/crash and Docker/PostgreSQL fixture-agent smokes pass. Isolated Next
build and unsigned MSI packaging pass. Native maintenance fixtures pass; elevated installed
MSI install/upgrade/uninstall and real Hyper-V/model qualification were not performed.

This document records the completed Playground work and gives the next developer a map of the UI, source-processing pipeline, model selection, billing boundaries, build outputs, and verification commands.

## Current conversation/question checkpoint — 2026-10-25 (roadmap is not complete)

Implemented the interaction/conversation foundation requested in the expanded checklist at
`docs/playground-workflow-todo.md`, not the entire remaining implementation/release roadmap.

- Native `question` has a fixed, cross-language bounded nested schema: up to four questions,
  eight choices each, single/multiple selection and custom answers. IDs, duplicate JSON keys,
  Unicode, bounds, cancellation, dismissal and replay are checked. The model must ask questions
  alone in a native batch and receive answers before proposing subsequent actions.
- Clarification and execution consent use separate queues and UI. An answer never approves an
  action, gets an executable ticket/database claim or reaches a sandbox. Results are paired
  native clarification data, not privileged instructions. Forms/answers are not durable events.
- Additive `conversation` carries bounded completed user/assistant turns with intact native
  groups. Duplicate IDs span prior/current history. Compaction summarizes whole older turns,
  preserves original system/current request and the latest complete group, and keeps exactly
  Permissive 80%, Balanced 65% default, Aggressive 45%. Summary billing/budgets remain separate.
- Web hosted workspace retains the conversation and displays interactive questions with fresh
  action approval still separate. Desktop `AgentWorkspacePage.xaml` offers the conversation
  surface plus, when a verified machine-bound qualification receipt exists, the local
  Hyper-V adapter (`HyperVAgentServices`) with sandbox start/discard controls, checkpoint
  review and conflict-checked export; without a receipt it stays interaction-only and shows
  the gate reason. Ordinary chat and inert proposal-only review are unchanged. New clients
  require advertised `question-v1` and `completed-turns-v1` support before requesting these features.
- One explicitly user-queued follow-up can run after successful completion only. Stop, dismissed
  questions and failures clear queued work; desktop keeps single-flight through cleanup. Partial
  failed runs cannot silently continue without complete history. Live in-place redirection and
  mode switching with retained executable project state remain unfinished; safe current behavior
  is stop/cleanup and start fresh.
- `Dockerfile.ai` now explicitly copies native agent/question modules; the prior native-agent
  COPY omission was discovered during packaging checks. A separately tagged AI image builds and
  imports both modules offline, without changing running services. The root page's asynchronous
  `searchParams` type was also corrected for Next.js 16 after isolated production-build checking.

Verified: **96 web client tests**, **343 Nest tests**, **420 desktop tests**, **176 selected
Python tests**, backend/integration typechecks and Nest build. Mounted Chromium fixtures verify
questions → answers → separate approvals → results → conversation follow-up. Real Docker and
temporary PostgreSQL verify the same protocol with fixture inference/billing, metadata-only
events and no executable question rows. WinUI publish includes `AgentWorkspacePage.xbf`.
Lint remains 0 errors/17 existing warnings. No models/production flags/VM credentials were
enabled, no VM/VHD was created, and no elevated MSI operation was performed.
The isolated Next.js 16.2.3 webpack production build passes compilation, generated route
typechecking and all 44 static pages; the active server's `.next` tree was not changed.

Follow-on delivery for the desktop execution layer (this same session, all stub-tested):

- `Filspresso.Sandbox/HyperVQualification.cs`: strict receipt parser + `TryLoadVerified`
  machine-bound gate (7 gates, policy 2, 30 days, unchanged image), `VerifyImage` re-check.
- `Filspresso.Core/Storage/GenericCredentialVault.cs` + `Sandbox/VaultGuestCredentials.cs`:
  read-only Credential Manager access for the operator-provisioned guest credential.
- `Filspresso.Sandbox/scripts/../Qualify-HyperVExecution.ps1`
  (`playground-desktop/scripts/`): seven-gate operator receipt producer, optional
  `-SaveGuestCredential` vault row, no image download.
- `Filspresso.Harness/ProjectCheckpoints.cs`: baseline/current/changes journal, deterministic
  unified diffs, bounded project import (`EnumerateImportableFiles`/`ImportPlan`), and
  plan-then-apply all-or-nothing export with sha256 conflicts + `.filspresso-export-manifest.json`.
- `Filspresso.Harness/HyperVAgentServices.cs`: the qualified adapter (tools, seeding, journaling,
  workspace-bound dispatch, background disposal), composed fail-closed in
  `AppServices.CreateAgentServices` and wired into `AgentWorkspacePage` (start/discard/import/
  export/diff viewing).

**Still unimplemented:** artifacts and isolated previews. **Still unqualified:** actual native
models, real Hyper-V execution (the receipt, credential row and VM never existed here),
dedicated/rootless production Docker and complete live/release workflows. Desktop composition
code is delivered but stays disabled without an operator qualification run. The guest
containment items (reparse races, descendant/job controls, crash recovery) also remain open
software work. These are not all environmental blockers: substantial software work remains.
Installer signing is still deferred. Changes remain uncommitted; existing user work is preserved.

Additional verification commands:

```powershell
node scripts/Check-PlaygroundFrontendBuild.cjs
node playground-sandbox/Build-AgentBrowserFixture.cjs
python tests/browser/playground-agent-workspace.py
./playground-sandbox/Smoke-Agent.ps1 -SkipBuild
```

The frontend helper stages source/config into a fresh approved temporary directory and uses
the installed Next.js **webpack** production compiler, never replacing the active `.next` tree.
It does not qualify the default Turbopack build or deploy/restart the application.

## Previous hosted-action checkpoint — 2026-10-25

This section supersedes the historical milestone descriptions below. `ENHANCEMENT.md`
remains the authoritative unchecked-work list; do not equate gated implementation or
fixture tests with live native-model/Hyper-V/production/release qualification.

### Delivered in this increment

- Separate web **Agent sandbox workspace** composes the bounded native loop with an owned,
  explicitly started hosted Docker sandbox. Ordinary Chat and proposal-only review remain
  separate. Plan permits reads; Build requires a fresh acknowledgement/decision for every
  exact write/command. The next action resets acknowledgement; Markdown/code/arguments are
  always inert. Account/model/context/conversation changes cancel and discard. Late startup
  replies are cleaned up, unconfirmed removal stays quarantined, and a pending cancelled
  creation blocks starting another until it resolves.
- Nest signs five-minute model-proposal tickets only after successful settlement. Tickets
  bind account/model/run/mode/call/name/exact argument digest. Account/run/call-unique action
  rows and atomic pending → executing/declined transitions—not event recording—authorize
  one-shot dispatch across concurrent processes/retries. Fixed server tool/path policy
  ignores caller-declared effects. Client decisions are not claimed as proof of human intent;
  results come only from independently validated broker file/command receipts.
- Additive migration: `nestjs-backend/data/migrations/2026-10-playground-agent-actions.sql`,
  mirrored by schema bootstrap. Rows store metadata/digests only, not arguments/source/output.
  Missing claims storage fails closed. Metadata retention follows the bounded hourly run-event
  retention setting (seven days by default). Claims deliberately survive activity purges until
  retention/account deletion: removing them early could reopen a still-live ticket.
- Metadata-only `tool.approval`, `tool.declined`, `tool.started`, `tool.finished` and
  `tool.failed` events describe decisions and server-observed outcomes; replay remains inert.
  Outcome recording is serialized but fail-open, and cannot block or authorize dispatch.
  Global normalization no longer trims these exact native/action/file payloads. A mounted
  Nest HTTP test exercises the actual controllers and global pipes with fixture services/auth.
- Docker policy v2 freezes/checks idle process identities after commands and discards
  surviving descendants. File/command operations and teardown are single-flight. Timeout
  completion waits for actual daemon removal. Bounded exact-owner tombstones make repeated
  discard confirmable without trusting unknown/cross-account 404s. Restart discards old-epoch
  active/idle workloads within the broker's namespace; it never adopts unknown executions.
- Native paired-history compaction reuses Spectre recent-group selection and the shared chat
  summary primitive. Thresholds remain exactly **Permissive 80%, Balanced 65% default,
  Aggressive 45%**. Original system/request and latest complete call/result group remain;
  tools-inclusive recount/no-shrink checks gate continuation. Summaries are quoted user data,
  not approval. Web activity exposes memory; both native transports validate its receipt.
  Summary output consumes the same turn/run generation budget. Reply usage aggregates
  summary/native work; Nest bills the two parts once at distinct IDs. Failed-fit summary work
  still settles. Native memory is ephemeral/recomputed per turn, not a durable rolling agent
  checkpoint; original local groups and duplicate-call checks are retained.

### Gates and validation boundaries

Native models require matching nonempty AI service keys and explicit qualified GGUF allowlists
in Nest/AI. Hosted agent dispatch additionally requires `PLAYGROUND_AGENT_EXECUTION_ENABLED=true`,
private `PLAYGROUND_AGENT_ACTION_KEY` (32+ characters), the migration/backend DB privileges,
and broker policy v2. The Compose overlay forwards these opt-ins, **disabled/empty by default**.
No production flag, model allowlist, VM image or guest credential was enabled/supplied here.

Real checks: `Smoke-Docker.ps1` builds fresh images and verifies files/isolation/approval,
normal/timeout detached-descendant disposal, confirmed owner-bound repeated discard and a
SIGKILL/restart of its **temporary** broker with active/idle old workloads. `Smoke-Agent.ps1`
uses real Docker and temporary PostgreSQL on tmpfs for signed fixture read → approved write
→ read → approved test → follow-up, cross-account refusal, metadata-only recording and
concurrent one-shot dispatch. Its **model/billing are fixtures**, not real inference/money.
No application containers, database, volumes or services are reset/restarted.

The isolated Chromium fixture mounts the real React UI in StrictMode and verifies explicit
start, per-action acknowledgement reset, inert answers/arguments, follow-ups and account
discard with **fixture APIs/model**. It does not rebuild/restart the serving Next application.
Desktop tests and Visual Studio MSBuild publish remain compile/library checks: **no VM/VHD
was created**, and elevated MSI install/uninstall/upgrade has not been run.

Verified regression totals: **83 web client tests**, **341 Nest tests**, **370 desktop tests**
and **161 selected Python tests**, all passing. Web/backend/integration TypeScript checks,
Nest build, VS MSBuild WinUI publish/resource checks, mounted Chromium fixture, real Docker
lifecycle smoke and real Docker/PostgreSQL fixture-agent smoke pass. Lint has 0 errors and
the same 17 existing warnings. A full production Next build was not rerun against the active
server's `.next` tree; frontend validation here is typecheck/lint/client tests/isolated UI.

Verification commands:

```powershell
node nestjs-backend/node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json --test tests/client/*.test.ts tests/client/*.test.tsx
npm --prefix nestjs-backend test
npm --prefix nestjs-backend run typecheck
npm --prefix nestjs-backend run typecheck:agent-integration
./node_modules/.bin/tsc.cmd --noEmit --incremental false
npm run lint
npm --prefix nestjs-backend run build
python -m pytest tests/unit/test_playground_agent.py tests/unit/test_playground_compaction.py tests/unit/test_playground_context.py tests/unit/test_playground_sandbox.py tests/test_playground_security.py tests/test_contract.py -q
./playground-sandbox/Smoke-Docker.ps1
./playground-sandbox/Smoke-Agent.ps1 -SkipBuild
node playground-sandbox/Build-AgentBrowserFixture.cjs
python tests/browser/playground-agent-workspace.py
dotnet test playground-desktop/tests/Filspresso.Core.Tests/Filspresso.Core.Tests.csproj --no-restore --verbosity minimal
```

Publish the WinUI app with **Visual Studio MSBuild**, sequentially after desktop tests, to an
isolated output directory. Required checks include `Filspresso.Playground.pri`, `App.xbf`,
`MainWindow.xbf`, `PlaygroundPage.xbf`, `RunHistoryPage.xbf`, `AgentReviewPage.xbf`,
`SettingsPage.xbf` and `Assets/Filspresso.ico`. Do not run CLI MSBuild for WinUI XAML or rebuild
the active `.next` tree while a server is using it.

### Still unfinished

- Desktop executable workspace/approval/Hyper-V composition, production guest credentials,
  qualified VHDX provisioning, race-proof containment, descendant/job controls and live
  cancellation/crash checks. Desktop execution remains unavailable, not routed to hosted
  Docker or a host-shell fallback.
- Integrated project imports, full original-project diffs/checkpoints/reviewed application,
  artifact workspaces and isolated application previews. Existing manual editor/draft
  comparison and agent activity cards do not complete these features.
- Actual model/template/runtime qualification, dedicated/rootless production Docker and
  hostile-workload/resource qualification, combined live workflows in both clients, and
  elevated MSI install/uninstall/upgrade. Installer signing remains intentionally deferred;
  unsigned MSI support is unchanged.

## Historical enhancement execution checkpoint — 2026-10-24

The enhancement roadmap and its incomplete items are tracked in `ENHANCEMENT.md`.
Web chat now uses the Nest gateway's model-aware affordability, operation IDs and
settlement, rather than its former separate generic money gate. Model-status GET
is read-only; Playground loads are authenticated/throttled and Kafelot loading uses
its existing dry-run model/budget policy. Internal warmup requests carry the service key.

Both clients now offer automatic compaction: **Permissive 80%, Balanced 65% (default),
Aggressive 45%**. The AI service measures input before/after summarizing with the
session model, shares pure compaction primitives with Spectre, preserves original
instructions/transcripts and a recent tail, and refuses a non-shrinking checkpoint.
Summary inference is billed separately with an operation-ID suffix. Active checkpoints
are additionally durable on the server: `playground_sessions` stores resume state
(preferences, source references, the compaction checkpoint) and `playground_run_events`
is the append-only, versioned record of what each generation or hosted execution did.
Generations and executions are replayable through server-minted run ids
(`dsk-`/`exec-` + 24 hex) at `GET api/playground/runs/:runId`; sessions CRUD lives at
`api/playground/sessions`, guarded and throttled like every other Playground route.
Recording is fail-open and the recorder is an optional dependency, so every existing
caller behaves exactly as before. Events are swept hourly to
`PLAYGROUND_RUN_EVENT_RETENTION_DAYS` (default 7), output-capped per run with a single
`run.truncated` marker (essential terminal/settlement facts survive the cap), and
deletable per session or per account. **Both clients now
consume this API**: every completed generation saves the conversation's resume state
(prefs, source references, the re-validated compaction checkpoint) — the web through
`src/lib/playgroundSessions.ts`, the desktop through the desktop session page and
`AppServices` — and generations thread `session_uuid` so durable run events link to the
conversation. Each sidebar lists server-saved conversations that resume into a fresh
local conversation continuing from the retained context (with delete = forget + purge).
Lists are metadata-only: both clients fetch `GET sessions/:uuid` before switching the
conversation, restore its model/input-context/compaction settings, and preserve this
device's display/send preferences. A failed or cancelled detail read leaves the current
conversation intact. Summary-only checkpoints resume as quoted user data, never system
instructions; rows with no checkpoint are explicitly labeled as preferences-only.
Source references survive follow-up saves without new attachments; source files are not
automatically re-fetched. The server stores the same checkpoint shape for both clients;
full-transcript/cross-device synchronization remains deferred. Context displays show the
last exact measurement; the manual action queues compaction for the next send.

Resume-path validation added `tests/client/playground-sessions.test.ts` (run with
`npm run test:playground-sessions`, using the existing Nest `tsx` installation) and
desktop tests covering metadata → detail → follow-up payloads, all four context levels
and three compaction modes, malformed/missing details, summary-only checkpoints, and
cancellation. The Nest controller preserves missing-row 404s for deliberate recreation;
only validation failures become 400s. Desktop saves now require a completed generation,
capture the send-time preferences, and bound token refresh plus the save to eight seconds.
Both navigation rails now expose **Recorded activity**, a read-only durable run view.
`GET api/playground/runs?limit=20[&sessionUuid=...]` lists recent account-owned metadata
without event payloads. Both clients show 100 ordered events per page from
`GET runs/:runId?afterSequence=...`; the cursor and look-ahead preserve terminal facts
after the 400-event ordinary-output cap, including sequence gaps from omitted frames.
The activity view can filter to the current saved conversation. The account-wide view
also includes unlinked first generations and hosted sandbox/workspace activity.
It never restores a transcript, reuses an approval, resubmits a job, or runs a command.
Payloads are inert text, with unknown-version/truncation notices and a 16K display cap;
work completion and settlement failure remain separate evidence. Missing completion is
explicitly labeled **No completion recorded**, not claimed to be a running job.
Reads are JWT guarded, throttled, no-store and cancellable; unavailable logs are not
fabricated as empty successful reads. `RunHistoryPage.xbf` is included in publish checks.

These session/proposal UI checks are mocked contract/render tests plus a WinUI
publish/XAML compile, not live UI, PostgreSQL query execution, or agent/Hyper-V end-to-end
validation. Separate real Docker smoke results are recorded below.
Proposal-review milestone verification: **322 Nest tests**, **359 desktop tests**, **128 selected Python tests**
(including 18 native-agent tests), **7 web session tests**, **7 web run-history tests**, and
**6 web native-agent tests**, plus **16 web proposal-review tests**, pass; both TypeScript
checks, the Nest build, and the VS MSBuild WinUI publish pass (including `AgentReviewPage.xbf`).
Lint has 0 errors and the same 17 pre-existing warnings.
Run web activity checks with `npm run test:playground-runs` (existing Nest `tsx` installation).
The desktop **bounded agent-loop safety core** is now implemented in
`playground-desktop/src/Filspresso.Harness/AgentLoop.cs`, evolving the previously unused
interface-only harness. It accepts complete native structured-call responses, never parses
answer text/code blocks as actions, validates a whole tool batch before dispatch, rejects
duplicate/replayed call IDs and preserves original instructions plus complete tool/result
groups. Closed, immutable argument schemas reject extras, duplicate fields, malformed JSON,
wrong types, overlong UTF-8 arguments and invalid workspace paths. Chat offers no tools;
Plan permits reads only; Build requires fresh consent for each mutation/command, bound to
the exact call and sandbox. Missing capability/consent defaults to denied.

Default guards: 24 model turns, 48 calls total, 8 calls per turn, 16,384 generated tokens
per run, 32,768 response characters, 16,384 tool-result characters, 262,144 context
characters, five minutes per call (including approval), one hour per run and ten seconds
for independent cleanup. Hard ceilings prevent unbounded configuration. These are
orchestration guards, **not a financial spend cap or replacement for exact tokenization**.
Output clipping is explicit; original instructions and tool pairs are never silently dropped.
Unknown execution failures/timeouts stop further calls and quarantine the sandbox, with
bounded teardown and a visible warning when teardown cannot be confirmed. Caller
cancellation propagates after cleanup. Execution event durations use measured wall time.

`Filspresso.Core/Tools/WorkspacePath.cs` also repairs a concrete lexical containment defect
in the existing Hyper-V helper: a plain root-prefix check accepted sibling directories such
as `filspresso-workspace-escape`. Paths now reject traversal, absolute/drive paths and Windows
device/alternate-stream aliases. This is **not** guest symlink/reparse-point containment.

Agent tests use fake model/approval/execution adapters; **no complete production agent/
executor composition or executable agent UI mode is enabled**, no generated code or VM was executed, and existing chat is unchanged.
The new loop buffers each model reply until terminal completion; the existing chat stream
is untouched. Native model transport is now available as a separate, default-disabled
API/client adapter with proposal-review controls; executable approval/mode controls, trusted tool-execution
events and a validated Hyper-V executor composition remain pending. This is not yet an
end-to-end coding agent.

**Native tool-proposal transport** lives at `GET api/{playground|desktop}/agent/capabilities`
and `POST api/{playground|desktop}/agent/turn`, with same-origin web proxies. The Nest routes
are JWT guarded, throttled and no-store. Every turn resolves the current tier, repeats the
existing model-specific affordability policy, mints a fresh billing/run ID and settles the
reported usage before proposals are delivered. Failed settlement stops the turn, without
rewriting completed model work as a generation failure. Invalid/length-limited native output
still settles valid reported usage but releases no proposals. Lost/missing usage cannot be
invented; durable reconciliation remains future work. Neither client automatically retries
an inference POST or falls back from native calls to parsing answer text/code/XML.

The Python endpoint always requires `AI_SERVICE_KEY`, even in development. Native transport
defaults to no qualified models; `PLAYGROUND_AGENT_MODEL_FILES` must explicitly name qualified
catalogue text GGUF filenames in both Nest and AI services. No model was enabled or qualified
live by this change. `models/playground_agent.py` preserves original instructions and complete
assistant/tool groups, uses native OpenAI tool-call fields, validates closed scalar schemas
and duplicate IDs/argument keys, and counts the actual template **including tool schemas**.
Oversized paired context is rejected rather than silently compacted/dropped; agent-specific
paired-history compaction is not yet integrated. Existing three-level chat compaction is unchanged.
Requests/completions are capped at 1 MiB (template/tokenizer responses at 4 MiB), with bounded
deadlines, disconnect cancellation and residency release. Browser and desktop model transports
are connected to proposal-only review controls, never an executor.

`tool.proposed` stores only call ID/name/argument byte count/mode plus `executed: false`.
Argument text, source contents and tool results are not persisted in the run ledger; history
sent to the model is ephemeral untrusted data, not proof that any tool ran. Client-reported
approvals/outcomes do not become server-verified execution events. Each model turn is a
separate replayable run; whole-agent-run resume/checkpointing is not delivered. Shared golden
fixtures and mocked HTTP tests cover Nest, Python, browser and C# transport compatibility.
See `docs/playground-native-agent.md`; run browser transport checks with
`npm run test:playground-agent`.

**Agent proposal review** is now available from both navigation rails. Opening it sends no
capability request or inference; users first choose **Check native availability**, then
explicitly request one **Generate proposals · billed model turn**. Plan advertises only
`read_file`; Build also advertises `write_file` and `run_command`. Every request has an empty
history, a fixed proposal-only system prompt, temperature 0.2, an 8,000-character prompt cap
and 2,048-token output budget. It follows Chat's model/input-context and optional saved-session
link without saving new preferences, forwarding transcripts/sources, inventing tool results,
or claiming approval. Vision/Audio models remain chat-only for this surface.

Web `playgroundAgentReview.ts` and desktop `NativeProposalReview.cs` validate terminal native
calls, closed tool schemas, workspace-relative paths and successful settlement receipts before
publishing immutable snapshots. Both coordinators are single-flight across capability checks
and paid generation, bound checks to eight seconds and turns to 130 seconds, reject duplicate
clicks and discard stale/cancelled replies even from an uncooperative transport. Starting a new
review cannot be overwritten or unlocked by an older request. Leaving the view, changing the
conversation/model/context, or changing accounts invalidates the review; entry during Chat
generation is refused. Stopping may still consume billed model tokens.

`PlaygroundAgentReview.tsx` and `AgentReviewPage.xaml` show exact arguments and model answers as
inert, untrusted text, plus run ID, reported usage and settlement evidence. **Execution approval
unavailable** buttons are literally disabled and have no execution handlers. Neither screen
constructs `IAgentLoop`, an executor, sandbox or guest credential provider; it cannot read files,
apply changes, run commands or automatically follow up. Clearing a review does not purge retained
run metadata or reverse billing. Desktop refreshes the balance after the explicit turn.

Regression suites are `tests/client/playground-agent-review.test.tsx` and
`playground-desktop/tests/Filspresso.Core.Tests/NativeProposalReviewTests.cs`. They cover closed
defaults, valid Plan/Build/answer-only responses, immutable snapshots, receipts, invalid paths,
single-flight checks/generation, cancellation before dispatch, stale replies and disabled/inert
rendering (web). Native desktop transport tests also assert receipt metadata. Verification is
mocked coordinator/HTTP/render tests plus WinUI XAML compilation, **not a live interactive UI,
model or sandbox qualification**. Fresh execution consent UI, trusted execution outcomes, approved
executor composition, production web-loop composition, agent compaction and previews remain pending.

### Bounded web orchestration, consent and real Docker checks

`src/lib/playgroundAgentLoop.ts` now supplies the missing web **orchestration core**. It is
not composed into the review UI and has no default executor. An explicit owned hosted-Docker
binding and native-model capability are required. Each model turn goes through the supplied
authenticated/metered transport, and the loop validates successful settlement/run receipts,
rejects repeated receipts/call IDs, validates the complete batch and file paths before any
dispatch, and preserves complete assistant/call/result groups. Answer text/Markdown/XML is
never interpreted as a tool request. Plan offers only reads; Build requires a fresh exact
call/workspace challenge for every write/command. Denied actions return explicit refusal data,
not fabricated execution results. Original instructions are retained unchanged.

Default hard ceilings: 24 model turns, 48 calls, 8 calls per turn, 16,384 generated tokens,
32,768 answer characters, 16,384 characters per serialized tool result, 262,144 total context
characters, 130 seconds per model request, five minutes per call including consent, one hour
per run, and ten seconds for independent cleanup. Limits may only be reduced. Complete-group
capacity is reserved before execution; clipped tool results are marked and remain paired.
Exact tokenization still belongs to the server; these are not financial spend ceilings.
Unknown/invalid/timed-out execution stops the entire batch, quarantines the workspace and
independently requests teardown. Adapters must invalidate it across all runs and confirm
actual descendant removal, not just abort an HTTP request. Unconfirmed cleanup stays visible.

`playgroundAgentConsent.ts` and desktop `Filspresso.Harness/AgentConsentQueue.cs` provide
one-shot local consent rendezvous: one pending immutable action, matching-ID decisions,
deny on clear/cancellation/disposal (desktop), stale-click/replay rejection and bounded ID
tracking. They do not start tools, grant blanket permission, persist reusable approval or
turn client-reported execution into trusted server evidence. They are not yet connected
to executable UI controls. Proposal-review approval buttons remain disabled.

The hosted broker now performs descriptor-relative `O_NOFOLLOW` file reads, refuses symlinks,
FIFOs and nonregular/binary targets, and bounds the actual read even if a file grows. This
replaces the earlier raceable resolve/stat/read sequence. Execution approval is a strict
boolean. `PLAYGROUND_SANDBOX_NAMESPACE` scopes broker ownership/capacity/reaper discovery;
its empty default preserves existing unnamespaced workspaces. The smoke script uses a unique
namespace, restores its environment and cleans only its own workloads/broker on completion.

**Real Docker validation now passes** `playground-sandbox/Smoke-Docker.ps1`: actual
create/write/read/run/output, empty and Unicode files, account ownership, unapproved/string
approval refusal, path traversal, symlink/FIFO/binary/missing-file refusal, non-root UID,
offline interfaces, no workload Docker socket, and timeout/container removal with a detached
descendant. This used temporary loopback-only broker/workload containers, not application
service recreation or a database reset. It does **not** qualify native model turns, normal
command-completion descendant cleanup, hostile-workload isolation, broker crash recovery,
rootless production deployment or Hyper-V. Those remain execution release gates, along with
trusted server approval/execution evidence and approved UI/adapters. Agent-specific paired
compaction, previews, original-project diffs/checkpoints and elevated MSI exercises also remain.

Historical verification: **68 web client tests** (including 26 loop and 6 consent checks),
**366 desktop tests**, **322 Nest tests**, and **140 selected Python tests** (including
12 sandbox policy checks) pass. Web/backend TypeScript checks, Nest build and VS MSBuild
WinUI publish pass; lint has 0 errors and the same 17 existing warnings. The expanded
real Docker smoke also passes with newly built images and with `-SkipBuild`.

The Hyper-V **library transport/lifecycle** has also been repaired. Guest credentials are
an explicit `IGuestCredentialProvider` dependency, separate from host/Filspresso credentials;
there is no default password, image download, auto-provisioning or automatic elevation.
Credentials and encoded guest scripts travel as one private stdin JSON line, not host
command-line arguments. Decoding happens inside PowerShell Direct with explicit credentials.
VM startup uses an unattached provisioned Windows VHDX, a real differencing disk, secure-boot
disk selection, no network adapters and disabled checkpoints/automatic startup. Ready is
published only after a bounded guest handshake. Per-instance startup is single-flight,
sessions are capped at two, and one operation is allowed per sandbox.

Guest commands run in a guest child PowerShell, with measured duration and validated guest
exit-code/output envelopes. Files are capped at 256 KiB and combined command output at
131,072 characters; the host transport separately bounds both output pipes. Empty files
are distinct from missing files. Invalid results, timeouts, cancellation after dispatch and
output overflow invalidate the session and trigger independent VM turn-off/removal plus
deletion of the recorded child disk (never a broad directory delete). Cleanup is confirmed
before a timeout is reported as discarded; failed cleanup stays visible, non-reusable and
retryable. An unconfirmed host creation process retains its recovery record for manual review.

Lifecycle tests use a fake hypervisor. `PowerShellRunnerTests.cs` additionally runs trusted,
literal Windows PowerShell scripts to check stdin/Unicode, deadlines, cancellation and output
limits, and parses generated scripts **without executing them**. No VM/VHD was created and
no Hyper-V administration or elevation was performed. Guest reparse-point checks are only defense in depth: handle-
based/race-proof containment, descendant job control, qualified image/storage/resource limits,
production credential storage, real VM cancellation/crash recovery and client adapters remain
release gates. See `playground-desktop/src/Filspresso.Sandbox/README.md` for the library boundary.

The web has an **optional manual hosted Docker workspace**: file listing/editing,
draft comparison, reviewed command approval, live console, actual completion status,
and stop/discard. It requires `docker-compose.playground.yml` and a private sandbox
service key; see `playground-sandbox/README.md`. It currently provides Python/shell
in an offline, non-root, resource-limited ephemeral container. Chat/source imports do
not automatically execute or enter the workspace. Sandbox executions are recorded in
the durable run-event ledger per attempt, like generations. Durable session
consumption and read-only durable run replay are delivered in both clients; autonomous
tools, application preview and desktop execution integration are not delivered by this update.

Installer signing is deliberately deferred, not a blocker for these changes. The MSI
remains unsigned. No elevated installation, database reset or forced dependency upgrade
was performed. Existing application containers were not recreated during validation.

## Product surfaces

The Playground is available in two clients backed by the same NestJS and Python AI services:

- **Web:** Next.js App Router, primarily `src/components/playground/` and `src/app/api/playground/`.
- **Windows desktop:** .NET 9 / WinUI 3, with UI in `playground-desktop/src/Filspresso.App/` and shared session/API code in `playground-desktop/src/Filspresso.Core/`.
- **Application backend:** NestJS in `nestjs-backend/`; it owns authentication, entitlement and usage billing for source preparation and native inference.
- **AI backend:** FastAPI in `app.py`; `models/playground_context.py` extracts uploaded sources and invokes the Vision/Audio models. The AI service is called internally by the authenticated backend or the web server proxy.

The browser and desktop clients provide a llama.cpp-style chat workspace with a slim navigation rail, centered welcome state, conversation history/search, inline model selection, settings, API Prices, and a themed Filspresso appearance. Conversations are kept locally for the working session (unless exported), and can be saved on the server and resumed from the retained compaction checkpoint on the same account. Message content is rendered as text/Markdown/code; uploaded or imported code is treated as source text and is never executed.

## Technology stack

This section distinguishes the code that renders the clients from the services that authenticate, meter, and run inference. The web and Windows apps do not connect directly to PostgreSQL or llama.cpp for user requests.

| Layer | Technologies | Responsibility |
|---|---|---|
| Web client | Next.js 16 App Router, React 19, TypeScript 5, TSX, CSS; Tailwind CSS 4 is available in the site toolchain | Playground UI, browser preferences, same-origin API proxies, streamed chat and the authenticated MSI download |
| Web build/tooling | Node.js/npm, Next Turbopack, ESLint 9, PostCSS/Tailwind | Development and production build, linting and asset processing |
| Application API | Node.js 20, NestJS 10, TypeScript 5.9, Express adapter | Authentication/session validation, subscriptions/entitlements, model affordability, request limits, media source ingress and desktop chat proxy/billing |
| AI gateway | Python 3.11, FastAPI, Starlette, Uvicorn, HTTPX | Protected upload/GitHub routes, document/media preparation, llama.cpp residency coordination, exact input tokenization and SSE chat proxying |
| Model inference | llama.cpp router/model containers, GGUF LFM 2.5 text/Vision-Language/Audio models | Model loading, image/video-frame understanding, audio transcription, and text/audio-capable Playground chat |
| File/media codecs | FFmpeg/ffprobe, Pillow, pypdf, pypdfium2, Python XML/ZIP libraries | Bounded audio/video decode, image normalization, PDF/Office/OpenDocument/ZIP text extraction |
| Persistent/runtime services | PostgreSQL, Redis, Docker Compose; OPA for policy decisions | Account and billing data, session/throttle storage, service orchestration, authorization policy |
| Windows UI | C# 12, .NET 9, WinUI 3/XAML, Windows App SDK 1.6; Windows SDK Build Tools | Native x64 desktop client and shared session/API/preferences code |
| Windows delivery | Self-contained, unpackaged `win-x64` publish; Visual Studio 2022 MSBuild; WiX Toolset 5 MSI; native C++ maintenance/uninstaller helper | Machine-wide installation, app/runtime payload, icon/shortcuts, upgrades and uninstall cleanup |
| Windows secure storage | Windows Credential Manager and DPAPI | Device/session credentials; non-secret preferences remain in JSON under the user's app data |
| Shared icon pipeline | Node.js, TypeScript transpilation, React/ReactDOM server rendering, Sharp | Renders the actual `src/icons` TSX icons as SVG assets for both clients and generates the multi-resolution Windows ICO |
| Tests | pytest, Node's test runner via `tsx`, xUnit/.NET, native C++ tests, Playwright browser checks | Extraction/contracts, backend/auth/billing, native client behavior, installer contracts, and end-to-end UI flows |

The repo also includes separate Java invoice, Kotlin subscription, Go operations, and Rust cryptography services integrated into the wider Filspresso Compose deployment. They are not on the Playground source-upload path; NestJS remains the source of truth for Playground identity, entitlement, and usage accounting.

### Windows solution structure

`playground-desktop/Filspresso.Desktop.sln` contains these projects:

- **Filspresso.App:** WinUI 3 screens, XAML resources, `AppWindow`, UI event handling, and wiring to services.
- **Filspresso.Core:** portable-to-tests session state, API clients/contracts, SSE parsing, preferences, billing/access state, and Windows credential/platform adapters.
- **Filspresso.Harness:** bounded loop, native transport, inert proposal review and client-local conversation/question/consent coordinators. The desktop conversation UI composes clarification only; no executable Hyper-V adapter is connected.
- **Filspresso.Sandbox:** Windows sandbox boundary and workspace/path handling; the Hyper-V sandbox uses PowerShell Direct and has no network adapter. Web tools execute on the host through backend egress policy.
- **Filspresso.Core.Tests:** xUnit unit/contract tests for core, session, preferences, source transport, sandbox boundaries, and installer contracts.

The app targets `net9.0-windows10.0.19041.0`, minimum Windows build 19041, `win-x64`, with `WindowsPackageType=None` and `WindowsAppSDKSelfContained=true`. It is distributed as a per-machine MSI rather than MSIX. The installer enforces the supported Windows Pro edition/build, installs the Windows App SDK runtime alongside the app, and provides Start-menu and uninstall integration. Build outputs are centralized under `playground-desktop/artifacts/` by `Directory.Build.props`.

## Composer and model behavior

### Grouped plus/import menu

The **plus** button opens an import menu rather than immediately opening an unrestricted picker. The web and Windows menus group file types as follows:

- **Media:** images; videos; audio.
- **Documents:** PDFs; Word/OpenDocument text documents; PowerPoint/OpenDocument presentations; Excel/OpenDocument spreadsheets and delimited data.
- **Files & projects:** other files, including text/code and ZIP project snapshots.

Each category opens a file picker filtered to its extensions; “Other files” accepts any file and lets the server report unsupported formats. The web client also accepts file drops and pasted files. GitHub is a separate composer action: it asks for the repository URL rather than navigating to Filspresso's GitHub page.

The UI accepts at most eight sources per prompt and limits each file to 20 MB. Preparation is serialized on the client so image/audio/video work does not race on the single resident llama.cpp model slot. Sources have queued/processing/ready/error states, may be removed, and must be ready before sending. Media files can be previewed locally; preview object URLs are revoked when sources are cleared or the component is disposed.

### Model suggestions and selector

All nine explicitly catalogued LFM models can be selected in the Playground: six text models, two Vision-Language models, and one Audio model. Prices and allowance/wallet state are displayed in **API Prices**; model identifiers and quantization suffixes are not shown to users.

- If an attached video is present and the selected model is not Vision-Language, the UI suggests **LFM 2.5 VL 450M**. Choosing the suggestion changes the selected conversation model.
- If an attached audio file is present and the selected model is not Audio, the UI suggests **LFM 2.5 Audio 1.5B**. Choosing the suggestion changes the selected conversation model.
- Selecting either VL model suppresses the video suggestion; selecting Audio suppresses the audio suggestion. Suggestions are optional and do not override the user's current model automatically.
- Media source preparation itself uses VL 450M for image/video frames and Audio 1.5B for audio transcription. The suggestion controls the model used for the following Playground chat turn; it is not required to complete media extraction.

Web model keys, names, modality, GGUF files, entitlement, and pricing metadata are centralized in `src/lib/modelAccess.ts`. The backend maintains its explicitly mapped chat catalogue in `nestjs-backend/src/desktop/text-models.ts`; `desktop-catalogue.test.ts` checks its model/file mapping against the frontend. Do not replace the explicit mapping with a name-prefix rule.

### Input context and output budget

The composer and General settings offer **Maximum input tokens** of 16K, 32K, 64K, or 128K. This is the ceiling for the complete templated input: system instructions, conversation history, current prompt, and attached source text. It is separate from output generation length (default 2,048 tokens in the clients).

Before generation, `models/tanka.py` asks llama.cpp `/apply-template` for the selected model's real rendered prompt, then `/tokenize` for the exact token count. `app.py` rejects input above the chosen context with HTTP 413 / `INPUT_CONTEXT_EXCEEDED`; it also rejects inputs that leave no space under the model's 128K window. The output budget is then bounded to the remaining model window; the input dropdown never sets output tokens. The independent Kafelot chat remains capped at 32K.

Web preferences use `filspresso_playground_preferences_v2` and migrate the old `maxTokens` preference as an input-context value. Desktop JSON preferences migrate legacy `MaxTokens` similarly. Model selection accepts text, VL, and Audio keys so a suggestion persists and can be used by the chat/prewarm path.

## Source processing and data flow

### Authenticated ingress

1. Web uploads go through `src/app/api/playground/context/file/route.ts` or `github/route.ts`, which forward the browser session to the backend. The desktop client calls the same Nest routes with a bearer token and no cookie.
2. `PlaygroundContextController` in `nestjs-backend/src/desktop/` requires `JwtAuthGuard`, rate limits uploads/GitHub requests, uses in-memory multipart handling for one file, and aborts processing if the caller disconnects.
3. `PlaygroundContextService` resolves live Playground access and, for media, checks affordability of the actual analysis model before GPU work. It sends bounded requests to the internal AI service.
4. `app.py` exposes protected internal `/api/playground/context/file` and `/github` endpoints. The Nest service validates AI results and usage, bills reported media tokens with server-side prices and idempotency keys, then removes internal usage details from the source context returned to the client.
5. Ready source contexts are sent with the current prompt and chat history. The authenticated/metered text-chat route performs its own access, affordability, input-size, and usage checks.

Text, code, and repository extraction do not call an inference model and therefore do not add media-inference tokens to the bill. Image, scanned-PDF, audio, and video analysis use the relevant priced model and report actual runtime token usage. If a later video frame/track fails after earlier analysis has consumed tokens, the successful earlier usage is preserved and settled.

### Supported inputs and bounds

Extraction lives in `models/playground_context.py` and is designed to keep uploads in memory or temporary directories and avoid executing or extracting untrusted projects onto disk.

- **Text/code:** UTF-8 text and source files are read as text. Binary-looking or undecodable content is refused with an actionable error.
- **PDF:** extracts text from at most the first 100 pages. If it is scanned/has no extractable text, the first three pages are rasterized and analyzed by VL.
- **Office/OpenDocument:** DOCX, XLSX, PPTX, ODT, ODS, and ODP XML content is extracted. CSV/TSV and other text formats use the text path.
- **ZIP/project:** reads in memory; caps at 4,000 entries, 80 MB aggregate expanded size, 8 MB per entry, and a 300:1 expansion ratio. Skips traversal entries, dependency/build directories, binaries, and empty text. Includes a bounded file listing and up to 40 text files. GitHub snapshots use the same project reader.
- **Images:** Pillow applies EXIF orientation, rejects images above 25 megapixels, converts to RGB PNG, and limits the longest edge to 1,536 pixels before VL analysis.
- **Audio:** FFmpeg/ffprobe decode a bounded set of formats; audio is converted to mono 16 kHz WAV and transcribed by Audio 1.5B.
- **Video:** FFmpeg samples three frames and extracts an audio track when present, limited to the first two minutes. Frames use VL; the audio track uses Audio. Warnings describe these sampling/truncation limits.
- **GitHub:** accepts only public repository URLs on `github.com`, downloads through fixed GitHub API/codeload hosts with bounded redirects/bytes, and creates a read-only source snapshot. Private repositories are not authenticated. Arbitrary URLs and local/private-network fetches are not supported.

Extracted text is capped at 240,000 characters per source. Chat validation limits history to 100 turns, contexts to 12 and the combined request to a bounded character count. Responses include extraction warnings when content was truncated or sampled.

## Billing and security boundaries

- Browser-supplied prices or usage costs are never trusted. Backend billing uses server-side model pricing and runtime token counts.
- The backend checks account access and media-model affordability before source inference. Desktop chat checks entitlement/affordability before calling the AI server and bills on the completed stream frame. Web chat similarly meters via its server route.
- Audio/Vision usage is reported under Playground scope. The desktop entitlement returns all nine selectable models and includes `attachmentModels` with VL/Audio pricing for media preflight/UI use.
- Internal AI calls carry the configured service key. User-facing file/GitHub routes are authenticated and throttled; the AI service ports are not the client-facing authorization boundary.
- GitHub handling does not follow arbitrary URLs or forward user credentials. ZIP entries are inspected without extracting/running them. Uploaded/repository code is never executed.
- Media decoding is bounded by file size, media duration, extraction limits, and process timeouts. Nest gives media preparation and desktop streaming a 16-minute request budget to allow slow model swaps; ordinary API calls keep their normal shorter deadline.
- Desktop credentials use the existing bearer/device-grant and secure local credential storage. Preferences contain no secrets. MSI uninstall removes this Windows user's app-owned preferences and credentials while upgrades preserve user data.

## Windows application and installer

The Windows client is a native WinUI 3 app with the Filspresso charcoal/copper theme, bundled Poppins font, conversation tools, settings, API Prices, account/MFA surfaces, source list, and streaming chat. It sends prepared contexts/history and the selected input limit through `DesktopApiClient`; generation output remains independent.

Shared UI icons are sourced from `src/icons`. `playground-desktop/build/Generate-Icons.cjs` transpiles/renders those React SVG icon components and emits SVG assets for WinUI. The same build generates a multi-resolution Windows ICO from the Filspresso brand mark. The icon is embedded in the executable and wired to the app window, uninstaller, MSI product metadata, and shortcuts.

`playground-desktop/build/Build-Desktop.ps1` is the release entry point. It runs .NET and native cleanup tests, builds the native maintenance helper, publishes self-contained WinUI resources, verifies the PRI/XBF/icon assets, and packages the MSI with WiX 5. The installer is version **0.3.0**, chooses an install parent while always creating a `Filspresso Playground` child folder, and includes an uninstaller. Full uninstall cleans this user's app data; upgrades preserve it. The current MSI is unsigned.

Artifact path: `playground-desktop/artifacts/Filspresso.Playground.msi`. The web download route streams this artifact from the configured downloads mount; live verification confirmed the downloaded bytes matched the built MSI.

## Key files

| Area | Files |
|---|---|
| Web composer/settings/import menu | `src/components/playground/PlaygroundWorkspace.tsx`, `PlaygroundSettings.tsx`, `PlaygroundSources.tsx`, `WorkspaceIcon.tsx` |
| Proposal-only review | `src/components/playground/PlaygroundAgentReview.tsx`, `src/lib/playgroundAgentReview.ts`; `playground-desktop/src/Filspresso.App/AgentReviewPage.xaml`, `Filspresso.Harness/NativeProposalReview.cs` |
| Interactive agent questions/conversation | `src/lib/playgroundQuestions.ts`, `playgroundHostedAgent.ts`, `PlaygroundAgentQuestion.tsx`; `nestjs-backend/src/desktop/playground-question-contract.ts`; `models/playground_questions.py`; desktop `AgentWorkspacePage.xaml`, `Filspresso.Harness/AgentQuestions.cs`, `AgentConversationSession.cs` |
| Web Playground APIs | `src/app/api/playground/chat/route.ts`, `src/app/api/playground/context/file/route.ts`, `src/app/api/playground/context/github/route.ts`, `src/app/api/playground/prewarm/route.ts` |
| Model IDs/prices/context | `src/lib/modelAccess.ts`, `nestjs-backend/src/desktop/text-models.ts`, `nestjs-backend/src/desktop/desktop.controller.ts` |
| Source extraction/media inference | `models/playground_context.py`, `app.py`, `models/tanka.py`, `Dockerfile.ai`, `requirements.ai.txt` |
| Authenticated source API/billing | `nestjs-backend/src/desktop/playground-context.controller.ts`, `playground-context.service.ts`, `input-context.ts`, `desktop-gateway.service.ts`, `main.ts` |
| Windows composer and suggestions | `playground-desktop/src/Filspresso.App/PlaygroundPage.xaml`, `PlaygroundPage.xaml.cs`; `Filspresso.Core/Session/AttachmentModels.cs` |
| Windows API/context contracts | `playground-desktop/src/Filspresso.Core/Api/DesktopApiClient.cs`, `PreparedSource.cs`, `Entitlement.cs`, `Storage/DesktopPreferences.cs` |
| Shared icons and MSI | `playground-desktop/build/Generate-Icons.cjs`, `Build-Desktop.ps1`, `playground-desktop/installer/` |
| Regression tests | `tests/unit/test_playground_context.py`, `tests/test_contract.py`, `nestjs-backend/test/playground-input-context.test.ts`, `request-timeout.test.ts`, `desktop-catalogue.test.ts`, `playground-desktop/tests/Filspresso.Core.Tests/` |

The NestJS `dist/` tree is tracked and used by the Docker image; rebuild it with the Nest build before packaging or deploying backend changes.

## Follow-ups and verification boundaries

- `PlaygroundPage.Render()` uses only `catalogue.Models` for API Prices. The earlier duplicate-row follow-up is already resolved; do not concatenate `attachmentModels` into that list.
- The MSI database, embedded icon/resources, wizard destination selection, and uninstall sequence were inspected; the wizard was cancelled before committing an elevated installation. A full elevated install/uninstall cycle has not been exercised here.
- The MSI is intentionally unsigned for now; signing is deferred and is not an enhancement release gate.
- The public GitHub importer is intentionally a bounded read-only source snapshot. Private repository credentials, automatic repository edits, and code execution are not implemented.

## Build and test commands

Run from the repository root unless noted:

```powershell
# Next.js type checking, production build, and static route generation
npm run build

# NestJS compile and unit/contract tests
npm --prefix nestjs-backend run build
npm --prefix nestjs-backend test

# Web resume state, inert run replay and native proposals (no live inference/execution)
npm run test:playground-sessions
npm run test:playground-runs
npm run test:playground-agent
npm run test:playground-agent-review
npm run test:playground-agent-loop

# AI source extraction, chat contracts, and residency behavior
python -m pytest tests/unit/test_playground_context.py tests/test_contract.py tests/test_residency_adoption.py -q

# Windows tests and release MSI (requires VS2022 MSBuild/C++ tools, .NET 9, WiX 5)
dotnet test playground-desktop/Filspresso.Desktop.sln -c Release -p:PlatformTarget=x64 --nologo
./playground-desktop/build/Build-Desktop.ps1
```

Earlier source-processing baseline verification (before the enhancement checkpoint above): **281 NestJS tests**, **80 Python tests**, and **161 .NET tests** passed; the Next production build passed; **34 mocked browser checks** covered the grouped menu, category filters, model suggestions, context preference, conversation flows, responsive layouts, and logged-out view. Authenticated live source checks passed for code/text, DOCX, PPTX, XLSX, ZIP, PDF, public GitHub, image, audio, and video. Separate live checks passed audio/VL warmup and metered chat, source-grounded web chat and follow-up, over-context rejection by the real tokenizer, native bearer upload/entitlement, and MSI download integrity. The native UI and MSI install-wizard/resource checks also passed.

## Development/deployment notes

- Docker images contain application code; after changing Python AI or NestJS backend sources, rebuild and recreate only the affected service, e.g. `docker compose build ai backend` followed by `docker compose up -d --no-deps ai backend`.
- Do not reset/delete Docker database volumes during app iteration. These changes do not require database resets.
- For a root Next production build, stop the existing `next start` process first, then restart the standalone server after a successful build; avoid serving stale build manifests.
- The WinUI app requires Visual Studio MSBuild and its Windows/C++ workload; `dotnet build` from a bare CLI environment is not a substitute for the release build script.
- The repository currently contains uncommitted implementation changes on top of `c804d45` (`Refresh the built orders service`). `DONE.md` records those changes; it does not mean they have been committed.
- The backend dependency audit reported existing package vulnerabilities during image builds. No broad/force dependency upgrade was applied as part of this work.
