# Conversation-first agent workflow — execution checklist

**Beta-6 correction:** current evidence and exact open items are in
[`playground-beta6-qualification.md`](playground-beta6-qualification.md). Older checked
qualification rows describe initial software, not a security sign-off. Desktop execution
remains release-blocked even with an old receipt. Export is not crash-atomic. Same-sandbox web
exploration, per-file imports, local observations, JSON artifacts and inert source previews
are delivered; live application preview and mid-command retained-workload redirection are not.

This checklist extends `ENHANCEMENT.md`. Checked code/tests are not live model,
Hyper-V, production Docker, or installer qualification. Preserve existing work.

## Conversation and questions
- [x] Versioned, bounded structured question contract across TypeScript/Python/C#.
- [x] Native `question` interaction, never a sandbox action or approval.
- [x] Choice/multiple/custom answers, dismissal, cancellation, stale/replay rejection.
- [x] Bounded continuous conversation with complete native call/result groups (local, not durable native-run resume).
- [x] Desktop conversation UI with interactive questions and local transcript (execution attachable when qualified).
- [x] Hosted web conversation UI with interactive questions (existing execution gates retained).
- [x] Explicit stop and one user-queued follow-up; no stale decisions or chargeable retries.
- [ ] In-place redirection/mode switching while retaining an executable project. Current safe behavior is stop/cleanup and start fresh, not live instruction injection.

## Separate execution consent
- [x] Exact proposed action/workspace and fresh consent UI remain separate from questions.
- [x] Independent desktop adapter enforcement (`HyperVAgentServices`): workspace-bound tool dispatch, per-call consent via `AgentConsentQueue`, quarantine on interrupted execution. Stub-tested; live Hyper-V qualification remains separate.
- [x] Original-project application requires separate exact-checkpoint review (one-shot plans, pinned/exclusive preflight, byte conflicts and ordinary-error rollback with a manifest). Not crash-atomic.

## Projects and sandbox
- [x] Bounded imports, baseline snapshots, change list and unified diffs/checkpoints (`ProjectCheckpoints`, deterministic LCS diff, ≤256 files/≤256 KiB/≤8 MiB/depth ≤16, no reparse points).
- [x] Conflict-aware reviewed application without overwriting unrelated user work.
- [x] Desktop credential storage, image trust and Hyper-V execution adapter (`GenericCredentialVault`, `HyperVQualificationReceipt` machine-bound gate, `Qualify-HyperVExecution.ps1` seven-gate receipt).
- [ ] Race-proof guest containment, descendant/resource controls and crash recovery.
- [ ] Qualified desktop composition, never hosted Docker or a host-shell fallback.
- [x] Same-sandbox web explorer, individually approved text imports and local before/after observations.
- [x] Bounded text-project JSON artifacts with SHA-256 and inert source previews in both clients.
- [ ] Binary artifacts and securely isolated live application previews (source display is not execution).

## Qualification/release (keep disabled until verified)
- [ ] Actual model/template/runtime, tokenizer, billing and cancellation checks.
- [x] Fixture matrix for all compaction thresholds at 16K/32K/64K/128K, including whole-prior-conversation compaction. Actual model qualification is separate.
- [ ] Real Hyper-V and dedicated/rootless production Docker qualification.
- [ ] Complete live workflows in both clients and hostile/failure isolation checks.
- [ ] Production builds and elevated MSI install/upgrade/uninstall (signing deferred).
- [x] Update `DONE.md`/`ENHANCEMENT.md` for this milestone, with remaining features/gates explicit. This is not final-roadmap sign-off.

## Checkpoint — 2026-10-25

Implemented/tested the conversation/question foundation, **not the full roadmap**.
New question forms/answers and prior turns remain client-local/ephemeral model data.
No model allowlist, production execution flag, VM image or guest credential was enabled.
No Hyper-V provisioning, elevated MSI operation, project application or preview occurred.
The project/sandbox and live release items above remain open software/qualification work.

Verification: 96 web client / 343 Nest / 381 desktop / 176 selected Python tests; mounted
Chromium and real Docker/PostgreSQL question/approval/conversation fixtures; isolated WinUI
publish; separately tagged AI image build/offline imports; isolated Next webpack production
build (44 static pages). No default Turbopack qualification or elevated MSI exercise.

## Checkpoint — 2026-10-25 (desktop execution adapters)

Delivered the missing software for desktop Hyper-V execution, all still fail-closed and
fixture-qualified only:

- `HyperVAgentServices`: workspace-bound adapter (`list_files`/`read_file`/`write_file`/`run_command`),
  one-shot baseline seeding, write journaling into `ProjectCheckpoints`, structural refusal of
  any call for a disposed/foreign workspace, and background stop on disposal.
- Composition gate: `AppServices.CreateAgentServices` returns the adapter only for a verified
  current, machine-bound receipt (`policyVersion` 2, seven gates, ≤30 days, image unchanged);
  otherwise the interaction-only `QuestionOnlyAgentServices` is used with the reason shown.
- `Qualify-HyperVExecution.ps1`: operator-only seven-gate receipt producer (no image
  download), optional Credential Manager entry for the dedicated guest account.
- UI: sandbox start/discard controls, mode switch, checkpoint list with per-change unified
  diff viewing and conflict-aware reviewed export.

Verification this increment: desktop suite grew 381→**420** (receipt, vault, adapter,
checkpoints/diff tests added); web client 96, Python 49 selected, mounted-Chromium agent
fixture and MSBuild WinUI publish still pass. **No live model, real Hyper-V VM, production
Docker, MSI installer or receipts were produced/executed here.** The qualification items
above remain open.
