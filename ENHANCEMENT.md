# Playground enhancement plan

## Confirmed product decisions

- Execute this plan incrementally, preserving existing web/desktop chat and user changes.
- Web code execution uses **hosted Docker sandbox containers**, never the Next.js, NestJS, or inference container.
- Desktop code execution uses the existing local Hyper-V boundary; inference remains hosted.
- Installer signing is **deferred indefinitely**. Unsigned MSI builds remain supported; signing is not a release gate for this work. Continue to disclose the unsigned publisher warning.
- Automatic context compaction has exactly three choices: **Permissive 80%**, **Balanced 65% (default)**, and **Aggressive 45%** of the selected input-context limit.

## Baseline and gaps

The starting clients implemented streaming chat, nine model choices, source preparation, settings, and session-local conversations, with no connected tool loop or automatic compaction. The checkpoint now includes authenticated/metered native transport, three-level chat and paired-agent compaction adapted from Spectre, durable resume state/run activity, manual hosted workspaces, both bounded loop cores, proposal-only review in both clients, and a separate deployment-gated web agent workspace with signed one-shot actions and fresh write/command approval. Uploaded code is still source text, not automatically an executable project. Desktop execution composition, live model/Hyper-V qualification, full diffs/checkpoints/artifacts/previews and release checks remain incomplete. See `DONE.md` for verification boundaries.

Conversation-first follow-up: both loop/transport stacks now support a separate, structured
native `question` interaction and bounded completed-turn conversation history. Web shows
questions in its gated agent workspace; desktop has an explicitly interaction-only Agent
conversation screen (no file/command tools or VM). Fresh execution consent remains independent.
See `docs/playground-workflow-todo.md` for the expanded implementation checklist. This does
not complete the remaining desktop/project/preview/release roadmap.

## Phase 1 — Security and billing

- [x] Make model-status GET read-only; authenticate/throttle model-load mutations and enforce product/model policy, including Kafelot compatibility.
- [x] Protect internal model-load operations with the service key; consistently forward that key for warmup/status/tokenization/inference.
- [x] Use backend-owned model-specific Playground affordability for browser and desktop requests. Preserve wallet-only Spectre add-on and Max/8B rules.
- [x] Give generations server-owned operation IDs and idempotent settlement; improve cancellation and error propagation.
- [x] Correct stale handoff/architecture claims and add regression coverage. (Existing delivered work, now reconciled in this checklist; see `DONE.md` and the security/enhancement contract suites.)

## Phase 2 — Shared sessions and run contracts

- [x] Account-scoped durable Playground sessions, source references, active context, and compaction checkpoints, separate from the full transcript. (`playground-sessions.*`: server-side resume state with client-validated clamps; the transcript stays client-local by design.)
- [x] Versioned events for context, compaction, tool activity, execution output, approvals, and settlement; resumable run IDs. (`playground-run-events.service.ts` + gateway/sandbox recorders: `dsk-`/`exec-<24hex>` server-minted ids, allowlisted kinds, `(run_id, sequence)` idempotency, per-run cap with a single `run.truncated` marker, replay at `GET api/playground/runs/:runId`, account/session purge controls.)
- [x] Preserve existing desktop APIs and Kafelot behavior through additive contracts/migrations. (Recording hooks are optional third constructor params; every prior call site and test still constructs the services unchanged; no existing route, table, or shape was altered.)
- [x] Retention/deletion controls and compatible web/desktop conversation exports. (Hourly bounded sweep, `PLAYGROUND_RUN_EVENT_RETENTION_DAYS` default 7, `?purge=1` on session delete, `DELETE api/playground/runs[?sessionUuid=]`; exports in both clients were already compatible and were not touched. Both clients now save/resume server sessions and thread `session_uuid`. Resume fetches detail rather than the metadata-only list, restores generation preferences, and labels missing checkpoints without claiming a restored transcript. Full cross-device sync remains deferred.)
- [x] Read-only durable run activity in both clients. (`GET api/playground/runs[?sessionUuid=]` discovers recent account-owned runs, including unlinked first generations/executions; `GET runs/:runId?afterSequence=` pages past output truncation to terminal events. Web `PlaygroundRunHistory.tsx` and desktop `RunHistoryPage.xaml` show inert payloads, clipping/unknown-version notices and separate completion/settlement evidence. No recorded action is re-executed. Verified with mocked contract/render tests and WinUI publish, not live end-to-end execution.)

## Phase 3 — Automatic compaction

- [x] Adapt/reuse Spectre's pure compaction/recent-tail and summary primitives without its database or Granite runtime. (`spectre/app/services/compaction_core.py` is shared with `models/playground_compaction.py` and the research workflow.)
- [x] Persist permissive/balanced/aggressive settings in both clients, defaulting to balanced (65%). Explicitly migrate legacy semantics if importing Spectre settings.
- [x] Measure complete templated input with the real tokenizer before inference; reserve output room independently.
- [x] Compact chat at safe boundaries, preserve original instructions/current request/recent history, maintain a rolling summary, and recount before accepting it.
- [x] Integrate agent-specific compaction preserving complete native call/result groups. (`models/playground_agent.py` reuses Spectre's recent-group boundary and the shared chat summary primitive, preserves original instructions/request and at least the latest complete group, recounts with tools, rejects no-shrink/failed-fit checkpoints, and includes summary output in the turn/run token budget. Both native transports validate receipts; web activity exposes quoted memory. Native summaries are ephemeral per turn, not durable resumable agent checkpoints; full client history/duplicate-ID checks remain intact. Tested across all three thresholds/four context levels, not qualified against a live native model.)
- [x] Retain the original transcript. Do not turn untrusted source text into privileged instructions.
- [x] Single-flight/revision-safe chat checkpoints, bounded retries, no-shrink detection, clear failures for uncompactable current inputs, and metered summary inference.
- [x] Context meter, compaction events, inspectable summary, and explicit manual compaction in both clients. (The action is labeled **Compact next send**: it queues a safe-boundary operation, not an immediate hidden generation.)

## Phase 4 — Real agent and desktop executor

- [x] Implement the desktop agent-loop safety core with structured, schema-validated tool calls. (`Filspresso.Harness/AgentLoop.cs`: complete native-call responses only; immutable closed schemas; batch validation and duplicate-ID rejection; Chat/Plan/Build policies; per-call consent; bounded turns/calls/output/context/time; fail-closed cancellation/cleanup. Unit-tested library only, not a connected agent. Markdown/code blocks are never parsed as actions.)
- [x] Add default-disabled native tool-call model transport with per-turn authentication/affordability/settlement. (`playground-agent.controller.ts`, `models/playground_agent.py`, `NativeAgentTransport.cs`, web `playgroundAgent.ts`: bounded terminal OpenAI native responses, strict scalar schemas, exact tools-inclusive tokenization, paired tool roles, no text/XML fallback or automatic POST retry. `tool.proposed` records metadata only, never approval/execution or argument/source contents. Requires explicit operator-qualified model-file allowlist and service keys; no models were enabled by this change.)
- [x] Add capability-gated **proposal-only review** in both clients. (`PlaygroundAgentReview.tsx`/`playgroundAgentReview.ts`, `AgentReviewPage.xaml`/`NativeProposalReview.cs`: explicit availability check and one billed native turn; Plan offers `read_file`, Build adds `write_file`/`run_command`. Exact argument text and run/usage/settlement receipts are inert, immutable review data. Approval controls are disabled with no handlers; no sandbox, tool results, chat history or attached sources are connected. Navigation/model/context/account changes invalidate review; single-flight, deadlines, cancellation and stale-response guards are tested.)
- [x] Implement the bounded web orchestration core. (`src/lib/playgroundAgentLoop.ts`: fixed Plan/Build schemas, whole-batch validation, successful per-turn receipts, fresh exact-action consent, complete native call/result history, bounded turns/calls/tokens/context/output/time, cancellation and workspace quarantine. Now composed only in the separate deployment-gated hosted agent workspace.)
- [x] Add one-shot local consent coordinators in both clients. (`playgroundAgentConsent.ts`, `AgentConsentQueue.cs`: one pending exact call/workspace challenge, explicit matching decision, deny on dismissal/cancellation, replay/double-click/stale-ID rejection. Not reusable permission or server-verified execution evidence.)
- [x] Connect the **web** approval UI/hosted adapter and server-observed outcomes. (`PlaygroundAgentWorkspace.tsx`, `playgroundHostedAgent.ts`, signed five-minute proposal tickets, account/run/call-unique PostgreSQL claims, metadata-only events, exact arguments/workspace binding and no POST retries. Fresh acknowledgement resets for each action. Decisions are authenticated-client assertions, not proof of human intent; tool results come from broker receipts. Real Docker/PostgreSQL fixture flow and mounted StrictMode browser tests pass.)
- [x] Add structured agent-generated clarification questions and bounded client-local multi-turn conversations. (`question-v1`/`completed-turns-v1` capability advertisements; fixed nested question schema, choice/multiple/custom answers, separate one-shot question/approval queues, sole-question batches and matching native results. Web conversation retains complete prior turns; desktop `AgentWorkspacePage` composes `AgentConversationSession` with clarification only. One explicitly queued metered follow-up runs only after success; stop/failure cancels it. Live redirection/mode switching with retained executable project state is not delivered.)
- [ ] Connect the **desktop** approval UI/Hyper-V adapter and qualify real native model/runtime combinations in both clients. No live model was enabled; executable desktop composition remains unavailable.
- [x] Capability-gate native proposal generation in the UI; keep plain chat available for all catalogued models. (Capabilities default closed and are separate from entitlement/execution permission; opening the view performs no inference or capability request. Every generation remains server-authenticated/metered.)
- [ ] Expose executable Chat, Plan (read-only), and Build (approved mutations/execution) modes in both clients. (Separate ordinary Chat and gated executable web Plan/Build are delivered; desktop Plan/Build remain proposal-only.)
- [ ] Connect approved workspace file operations and commands to the desktop sandbox, not the host shell.
- [x] Repair the Hyper-V transport/lifecycle library. (`IGuestCredentialProvider` and private stdin, guest-side script decoding, bounded readiness handshake, correct differencing-disk/firmware setup, measured command timing and guest exit codes, file/output limits, single-flight operations, invalidation before independent VM/disk teardown, retryable failed cleanup. Fake-hypervisor tests plus real Windows PowerShell transport/parser tests; no VM/VHD created and no client adapter enabled.)
- [ ] Qualify VM image provisioning/trust and credentials storage; validate real PowerShell Direct execution, race-proof workspace containment, descendant-process/job limits, cancellation and crash recovery. (Lexical checks and guest reparse-point checks are defense in depth, not race-proof containment. A provisioned Windows VHDX and explicitly supplied guest credentials are required; no default password, download or automatic elevation is provided.)
- [ ] Review diffs and checkpoints before applying changes to the user's original project.

## Phase 5 — Hosted Docker execution and visible workspaces

- [x] Separate authenticated sandbox broker/executor for manual hosted execution. Workloads have no Docker socket, credentials, application mounts, or access to other sessions. Broker namespaces now isolate ownership/capacity/reaper discovery for parallel development checks.
- [x] Non-root workloads, no network by default, dropped capabilities, no-new-privileges, read-only root, bounded workspace/tmp storage, memory/CPU/PID/time/output limits, and idle expiry. (Implemented controls plus real-engine smoke validation; not a full hostile-workload/stress qualification.)
- [ ] Prefer a dedicated/rootless Docker engine for sandbox workloads. A broker with daemon access is privileged infrastructure; Docker containers share a kernel and are not equivalent to a VM isolation guarantee.
- [x] Implement and smoke-test normal/timeout descendant disposal and broker crash recovery. The broker freezes/checks original idle processes after commands, discards surviving descendants, serializes file/command operations and concurrent teardown, and discards old-epoch workloads on restart. Exact-owner bounded tombstones confirm repeated discard only after daemon removal. Real SIGKILL/restart checks verify removal of active/idle workloads; no application service is restarted. This is not hostile-workload/production isolation certification.
- [ ] Complete visible workspaces: manual web file explorer/editor/console/draft comparison and executable agent activity/tool cards are delivered; a unified project/agent explorer, full diffs/checkpoints/artifacts and isolated application preview remain pending.
- [x] Clearly label suggested code as not executed; separate hosted inference location from code-execution location.

## Phase 6 — Validation and release

- [ ] Test authentication, affordability, all compaction thresholds at 16K/32K/64K/128K, long histories, large sources, context/model changes, retries, cancellation, and isolation.
- [ ] End-to-end read → edit → test → output → compact → follow-up workflows in both clients, including real Docker/Hyper-V tests (not just script assertions).
- [ ] Exercise elevated MSI install/uninstall/upgrade. Signing remains deferred.
- [x] Update DONE.md and this file with verified behavior and explicit remaining limitations. (Incremental handoff; this does not mark the remaining integration/qualification items complete.)

## Subsequent improvements

- Persistent projects, optional cross-device sync, source indexing, unified exports, and conversation branches.
- Per-run spend ceilings including media/compaction, observable queue/load state, bounded logs, and durable reconciliation.
- Reviewed checkpoints, isolated previews, desktop health diagnostics, and verified update delivery.
- Dependency maintenance, accessibility/performance checks, and real payment-provider integration before claiming bank-settled payments.

## Execution record

Implementation started against the existing uncommitted Playground work on `Beta-5-Scaling`. Do not interpret unchecked items as completed features. No database reset, forced dependency upgrades, elevated installation, or signing-certificate setup is part of this execution.

Proposal-review checkpoint (2026-10-24): **16 web review tests**, **20 existing web session/run/transport tests**, **359 desktop tests**, **322 Nest tests**, and **128 selected Python tests** pass. Web/backend TypeScript checks, Nest build and VS MSBuild WinUI publish pass; publish checks include `AgentReviewPage.xbf`. Lint has 0 errors and 17 existing warnings. These are unit/contract/render and compile checks, not live UI/model/Docker/Hyper-V end-to-end qualification. Approval/executor composition, trusted execution-outcome recording, web orchestration, agent paired-history compaction and previews remain open.

Orchestration/consent checkpoint: added the web loop and web/desktop one-shot consent coordinators. Hardened Docker reads to use descriptor-relative no-follow/nonblocking opens and bounded regular-file reads rather than a raceable resolve/stat/read sequence; approval must be a literal boolean. The expanded **real Docker smoke passes** create/write/read/run/output, empty/Unicode files, account isolation, strict approval, traversal/symlink/FIFO/binary refusal, non-root/offline/no socket, and timeout removal with a detached descendant. Its broker/reaper uses a unique namespace and cleanup removes only that test scope; application containers/database volumes were not restarted/reset. This is not native-model qualification, a hostile-workload certification or Hyper-V validation. Production agent UI/executor composition remains disabled.

Historical orchestration regression totals: **68 web client tests**, **366 desktop tests**, **322 Nest tests**, **140 selected Python tests**; both TypeScript checks, Nest build, WinUI publish and the expanded real Docker smoke passed. Lint remained at 0 errors/17 existing warnings. These totals describe that earlier milestone, not the later hosted-action/paired-compaction checkpoint below.

Hosted-action/paired-compaction checkpoint (2026-10-25): the web composition remains **disabled by default**, requiring qualified model-file allowlists/matching AI keys, `PLAYGROUND_AGENT_EXECUTION_ENABLED=true`, private `PLAYGROUND_AGENT_ACTION_KEY` (32+ characters), the additive action migration and broker policy version 2. Exact-body route decorators prevent generic trimming from changing signed arguments or file contents. Cancellation before/after dispatch, late startup responses, one-shot concurrency, unavailable event recording, and independent cleanup have regressions. Real Docker and temporary PostgreSQL checks use fixture model/billing only; mounted Chromium tests use fixture APIs. Neither qualifies real inference, desktop execution or production hosting. Updated verification and commands are in `DONE.md`; historical totals above describe earlier milestones.

Hosted-action milestone totals: **83 web client tests**, **341 Nest tests**, **370 desktop tests**, **161 selected Python tests**. Web/backend/integration TypeScript checks, Nest build, WinUI publish/resource checks, mounted StrictMode Chromium fixture, real Docker lifecycle/crash smoke and real Docker/PostgreSQL fixture-agent smoke pass. Lint: 0 errors/17 existing warnings. Frontend validation at that milestone did not rebuild the active server's `.next` tree. The remaining unchecked features and live/release gates are still unfinished.

Conversation/question checkpoint: **96 web client tests**, **343 Nest tests**, **381 desktop
tests**, and **176 selected Python tests** pass. New fixture coverage verifies cross-language
question schema parity, no approval through answers, whole-prior-turn compaction at all three
thresholds/four context levels, queued work and stale/cancelled interactions. Real Docker +
temporary PostgreSQL now checks question → read → approved write → read → approved test →
conversation follow-up without retaining forms/answers/source or creating question action rows.
Chromium checks structured questions, fresh approval and complete conversation with fixture APIs.
AI image build/import checks include both native modules (previous explicit COPY omission fixed).
WinUI publish includes `AgentWorkspacePage.xbf`; no VM was created. None of this qualifies real
models, executable desktop composition, original-project application or previews.
The isolated Next.js 16.2.3 webpack production build also passes compilation/typechecking and
44 static pages after correcting the existing root-page `searchParams` type. Default Turbopack
was not requalified; no active `.next` tree, application service or database was replaced/reset.

Desktop execution layer checkpoint (2026-10-25): the fail-closed software for local Hyper-V
execution is delivered and stub-tested. A strict machine-bound qualification receipt parser
(`HyperVQualification.cs`; exactly eight properties, `policyVersion` 2, seven named gates,
30-day freshness, truncated-MachineGuid binding, located local `.vhdx` with unchanged size/
mtime) composes `HyperVAgentServices` only on verified evidence, and interaction-only services
otherwise — never host-shell or hosted-Docker fallback. The adapter offers read-only listing/
reading plus consent-gated `write_file` (journaled into `ProjectCheckpoints` against the
imported project baseline) and `run_command` inside the disposable, adapter-less guest;
interrupted execution quarantines the sandbox through `AbortAsync`; disposal stops a live VM
in the background and latches the workspace. `ProjectCheckpoints` adds deterministic LCS
unified diffs (no timestamps, bounded cell budget with whole-file fallback), bounded project
import (≤256 files/≤256 KiB/≤8 MiB, depth ≤16, no reparse points, generated trees skipped),
and plan-then-apply all-or-nothing export with byte-exact sha256 conflict checks and a
`.filspresso-export-manifest.json`. `Qualify-HyperVExecution.ps1` verifies the seven gates on
the operator's own image and writes the receipt plus optional Credential Manager row for the
dedicated guest credential (`GenericCredentialVault`/`VaultGuestCredentials` are read-only;
the app never writes the vault). The desktop suite grows 381→**420** tests (receipts, vault,
adapter lifecycle/authorization, checkpoints/diff round-trip via an independent patch applier);
web client 96, Python 49 selected, mounted-Chromium and MSBuild WinUI checks still pass.
**No real VM, receipt, vault row or qualification run occurred; live release qualification and
artifacts/previews remain open software/qualification work.**
