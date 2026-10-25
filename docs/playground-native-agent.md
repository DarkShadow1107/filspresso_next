# Native agents — proposals, gated hosted actions and paired compaction

**Current desktop composition:** imported-text Inspect/Plan plus an explicitly started,
live-qualified Windows Sandbox Build workspace. Approved web tools are backend lookups,
not guest networking. See [`playground-windows-sandbox.md`](playground-windows-sandbox.md).
The custom-image Hyper-V qualification discussion below describes the retained legacy library.

**Current policy 3:** guest containment/AppContainer/jobs/durable recovery are implemented;
desktop enablement requires a fresh exact-build live receipt. See
[`playground-execution-safeguards.md`](playground-execution-safeguards.md). Earlier statements
below about a permanent release block or seven-check enablement describe older checkpoints.

**Beta-6:** see [`playground-beta6-qualification.md`](playground-beta6-qualification.md).
Desktop adapter/UI exist but application composition **release-blocks execution** until
guest race containment, jobs/descendants and durable crash recovery are implemented and
qualified. Earlier seven-check receipt enablement descriptions below are historical, not a
bypass. Web same-sandbox explorer, per-file import consent, local checkpoint observations,
bounded JSON artifacts and non-executing source previews are now available behind the
existing hosted execution gates. A source preview is not a live application preview.

## Delivered boundary

- JWT-guarded, throttled `GET /api/playground/agent/capabilities` and
  `POST /api/playground/agent/turn`; desktop aliases use `/api/desktop/agent/...`.
- Browser transport: `src/lib/playgroundAgent.ts` plus same-origin Next proxies.
- Desktop transport: `Filspresso.Harness/NativeAgentTransport.cs`. Capabilities must be
  loaded explicitly. It refreshes authentication for every turn and supplies no executor.
- Proposal-only UI: web `PlaygroundAgentReview.tsx`/`playgroundAgentReview.ts` and desktop
  `AgentReviewPage.xaml`/`NativeProposalReview.cs`, available from each navigation rail.
- Internal AI route: `POST /api/playground/agent/turn`, always requiring the service key.
- Wire example shared by all test suites: `tests/fixtures/playground-agent.json`.
- Separate executable **web** UI: `PlaygroundAgentWorkspace.tsx`/`playgroundHostedAgent.ts`.
  It composes the bounded web loop only after explicit availability/start and deployment gates.
  Proposal-only review is unchanged; web execution stays hosted-Docker only.
- Desktop **Agent conversation**: `AgentWorkspacePage.xaml`/`AgentConversationSession.cs`
  compose native conversation and structured clarification. When `AppServices.CreateAgentServices`
  verifies a current machine-bound Hyper-V qualification receipt it additionally attaches
  `HyperVAgentServices`, offering `list_files`/`read_file` (read-only) plus `write_file`/
  `run_command`, each with fresh exact-action consent in the window; the imported project
  baseline is seeded into the disposable guest and journaled writes are reviewed/exported
  via `ProjectCheckpoints`. Without a verified receipt the page remains interaction-only and
  shows the gate reason.

This API requests **one complete model turn** using native OpenAI `tool_calls`. It never
dispatches tools, accepts execution authority, reuses a recorded approval, interprets code
blocks/XML/reasoning as calls, or falls back to parsing ordinary answer text. Plain chat
and its catalogue/compaction settings are unchanged.

## Conversation and structured questions

Capabilities explicitly advertise `interactionProtocols: ["question-v1"]` and
`conversationProtocol: "completed-turns-v1"`. New conversation clients require these
advertisements; older proposal-only servers are not upgraded by a client-side assertion.
Opening either screen still performs no capability request or inference.

The reserved native `question` tool has the fixed bounded nested schema in the pure shared
`playground-question-contract.ts`, Python `playground_questions.py` and C#
`AgentQuestionProtocol`. `tests/fixtures/playground-question.json` verifies their schema
parity. This is not permission to use arbitrary nested schemas for executable tools.
There are at most four questions, eight options each, optional multiple selection and an
always-available custom answer. Raw arguments/answers are capped at 16 KiB; nested duplicate
keys, unknown fields, invalid Unicode, stale IDs and invalid/duplicate selections are refused.

Questions must be the **only call in their native batch**. The model receives the answers
before proposing later actions, rather than executing an action calculated before clarification.
`AgentQuestionQueue` is independent from `AgentConsentQueue`: answers never resolve an approval,
mint an execution ticket/claim or enter a broker. Dismissal stops the run without another model
turn/action. Results return under the matching native tool ID as bounded clarification data
with `grantsExecutionPermission: false`; they never become system instructions. Forms and
answers stay client-local/ephemeral model inputs, not durable ledger contents.

Optional `conversation` carries at most 16 **completed** user turns, each containing `message`,
terminal assistant `text`, and complete native `history` call/result groups. It conveys no
permission. All current/prior calls share duplicate-ID checks and 48-call/23-group-unit guards
(a completed user turn consumes one unit in addition to its tool groups). Oversized context is
refused, never silently dropped. Compaction can summarize whole prior turns; the original
system/current request and latest complete group remain. The existing three thresholds and
separate summary billing are unchanged. This is local continuation, not durable native-run
resumption or cross-device transcript sync.

Both conversation coordinators support one explicitly user-queued, metered follow-up. It is
sent only after successful completion, never after stop/dismissal/failure, and is not a retry.
Stop cancels pending questions/consent. Desktop retains single-flight until independent cleanup
finishes; hosted stop discards/quarantines the workspace. A failed partial run cannot silently
continue with missing tool history. Changing direction currently means stop, wait for cleanup,
then start fresh; live in-flight instruction injection is not implemented. Mode/model/context
changes require a fresh context, not transferring prior consent. Desktop conversation is
interaction-only until the Hyper-V release gates close. Projects/diffs/artifacts/previews remain
unfinished; this conversation increment does not enable desktop execution.

## Proposal-only review UI

Opening review performs no network request. **Check native availability** explicitly reads
capabilities; no models are configured by default. Only a subsequent **Generate proposals ·
billed model turn** requests inference. Plan offers `read_file`; Build adds `write_file` and
`run_command` as proposals only. Review uses Chat's model/input-context and optional saved
session link without changing preferences. Each request contains a fixed proposal-only
system prompt, the explicit review prompt (at most 8,000 characters), temperature 0.2,
2,048 output tokens and **empty history**. Chat messages, checkpoints and attached sources
are not forwarded, and no results/approval claims are fabricated.

The clients validate successful terminal receipts, native tool schemas and relative-file
path policy before displaying immutable results. Exact JSON arguments and model answers
are inert text, not Markdown actions or proof that any file/test/command was accessed.
Run IDs, reported input/output usage and settlement evidence are shown separately. All
**Execution approval unavailable** buttons are disabled and have no execution handlers.
The view owns no workspace, sandbox, guest credentials, tool dispatcher or `IAgentLoop`;
the existing manual hosted execution workspace remains a separate explicit surface.

Both coordinators are single-flight across checks and paid turns, with eight-second
capability and 130-second generation bounds. Duplicate clicks do not start parallel work;
stopping, navigation, model/context/conversation or account changes invalidate pending
work/results. Late replies cannot repopulate a cleared review or unlock a newer request.
Entry is unavailable while Chat is generating. Cancellation may still consume billed
tokens; clearing the view neither deletes retained run metadata nor reverses settlement.

Run web checks with `npm run test:playground-agent-review` (16 coordinator/render tests).
Desktop review has 14 coordinator tests in `NativeProposalReviewTests.cs`; the desktop
release publish also verifies `AgentReviewPage.xbf`. These are mocked tests and compile
checks, not live interactive UI, model/runtime or sandbox qualification.

## Default-disabled qualification gate

`PLAYGROUND_AGENT_MODEL_FILES` is empty by default. Only catalogue **text** GGUF filenames
explicitly listed in this variable are eligible. The same allowlist must be configured in
Nest and Python, with matching nonempty `AI_SERVICE_KEY` values. There is no media-model or
client-provided capability override. No deployment flags/models were enabled by this work.

Operators must first qualify the actual llama.cpp build, model chat template/native-call
support, tools-inclusive template/tokenizer behavior, finish reasons, usage, cancellation
and limits. Mock tests do not constitute model qualification. Capability discovery is a
configured transport capability, not account entitlement or permission to execute code.

## Desktop Hyper-V enablement (operator, per machine)

The desktop client enables sandbox tools only after a qualifying receipt produced on this
machine by `playground-desktop/scripts/Qualify-HyperVExecution.ps1` — no image download or
guest provisioning is provided; the operator owns the VHDX. The script validates
elevated Hyper-V administration, hashes and unattaches the base image, boots a disposable
differencing Generation 2 VM with **no network adapter**, waits for PowerShell Direct
readiness, proves `C:\filspresso-workspace` fencing, tears everything down with confirmation,
and writes `%LOCALAPPDATA%\Filspresso\Playground\qualification\hyper-v.json`.

The client re-verifies the receipt (all seven gates, `policyVersion` 2, ≤30 days, this
machine's truncated-MachineGuid binding, unchanged image size/mtime) at composition time —
fail-closed to the read/clarify-only experience otherwise. The dedicated guest credential
lives in Windows Credential Manager under `Filspresso.Playground.HyperVGuest`
(operator-provisioned; the application never writes the vault). The receipt is enablement
evidence, never consent: every write/command still needs fresh per-action approval in the
window, and journaled writes reach the real project only through an explicitly reviewed,
conflict-checked export.

## Bounds and billing

Requests use Plan/Build mode, an original user message/system prompt, closed flat tool
schemas and complete ordered assistant/call/result groups. Results remain `tool` data,
never new privileged instructions. Tool effects are declarations for proposal policy,
**not trusted execution authorization**. Executors must independently enforce tool/path,
workspace, ownership, mode and fresh consent boundaries.

The contract permits 32 tools/parameters, 23 history groups, 8 calls per group, 48 distinct
calls, 16 KiB argument strings, 262,144 context characters and 16,384 output tokens per
turn. Request/completion JSON is capped at 1 MiB; native template/tokenizer responses at
4 MiB. Tokenization includes tools and paired history and reserves output room separately.
Agent context compaction is described below; uncompactable current inputs are rejected
without dropping instructions or splitting native call/result pairs. Admission/tokenization/inference share a 120-second AI
deadline; clients allow bounded overhead. Disconnects cancel pending native work and release
the admission slot. Chargeable POSTs are never automatically retried/failover-replayed.

Every turn independently resolves tier/entitlement and model affordability. Server-minted
operation IDs provide idempotent settlement. Valid reported usage on an invalid/truncated
model reply is still billed; missing usage is not fabricated. No proposals are released
after invalid output, missing usage or failed settlement. Completed model work and failed
settlement remain separate replay facts. Lost usage/connection reconciliation and financial
per-run spend ceilings are still future work.

## Paired-history compaction

`compaction_mode` optionally selects **Permissive 80%**, **Balanced 65% (default)** or
**Aggressive 45%**. The web executable workspace follows Chat's saved preference; desktop
transport forwards its selected preference. Exact tools-inclusive tokenization triggers
summary inference only at a complete history-group boundary. The original system prompt
and user request remain unchanged; at least the latest complete call/result group survives.
The summary is quoted **user data**, never system instructions, approval or execution proof.

`spectre/app/services/compaction_core.py` supplies recent-group selection;
`models/playground_compaction.py` supplies the shared bounded summary primitive. The AI
recounts the full native template, rejects nonshrinking/still-over-threshold summaries, and
does not release a native follow-up after failed compaction. All original client groups and
duplicate-call IDs remain intact. Native summaries are ephemeral per turn: later requests
may summarize the original older prefix again. Durable resumable agent checkpoints and
rolling native-summary reuse are not delivered; this is distinct from chat checkpoints.

The optional `compaction` receipt carries mode, input limit, before/after token counts,
`consumedGroups`, quoted `summary` (when compacted) and summary `usage`. Reply `usage` is the
**aggregate summary + native** usage. Summary output is deducted from that turn's native
output allowance, so it cannot bypass the loop's generated-token cap. Nest settles summary
usage at `<runId>-compaction` and the remaining native usage at `<runId>`, without charging
the aggregate twice. Failed-fit summaries still settle their reported work; either failed
settlement withholds proposals/tickets. Missing/lost usage cannot be invented.

Both client transports validate additive compaction receipts. The web loop exposes an
inspectable, inert memory event. Durable `context.compacted` events retain counts/mode/group
metadata, **not native summary/source/output text**. Golden compatibility fixture:
`tests/fixtures/playground-agent-compaction.json`. Matrix tests use fixture tokenizers and
inference; actual model/template compaction remains a qualification gate.

## Signed one-shot hosted actions

Additional JWT-guarded/throttled/no-store endpoints:

- `GET /api/playground/agent/actions/capabilities`
- `POST /api/playground/agent/actions` — prepare `{ticket, sandboxId, call}`
- `POST /api/playground/agent/actions/:id/execute` — decide `{approved, sandboxId, call}`

No browser or history flag enables dispatch. It additionally requires
`PLAYGROUND_AGENT_EXECUTION_ENABLED=true`, a private `PLAYGROUND_AGENT_ACTION_KEY` of at least
32 characters, model qualification gates above and broker policy version **2** with
`freeze-check-discard`. These are default-disabled, separate from the manual executor.
The Compose overlay forwards the opt-in variables but does not enable them. Never expose
the signing/broker keys in `NEXT_PUBLIC_*`, source control, logs or model context.

Apply `nestjs-backend/data/migrations/2026-10-playground-agent-actions.sql` with the normal
database-owner migration workflow (also mirrored by application schema bootstrap). No
database reset is needed. Missing/unavailable claims storage fails closed. The table needs
the normal backend-role SELECT/INSERT/UPDATE/DELETE privileges.

After successful model **and summary** settlement, Nest can issue five-minute HMAC tickets
binding account, model/run, mode, call ID/name and the SHA-256 of **exact argument bytes**.
Tickets attest to a settled proposal, **not consent**. Prepare checks authenticated ownership
and fixes the server's tool policy independently of caller schemas/effects: Plan permits only
`read_file`; Build adds `write_file` and `run_command`. An action row uniquely binds
`(account_id, model_run_id, tool_call_id)`. The atomic pending → executing/declined transition
is the one-shot dispatch authority, across retries/processes; the fail-open event recorder
is not. Exact-body decorators bypass generic string normalization but not route validators.

The web prompts for an explicit acknowledgement and approval of **each** exact write/command
in its specific sandbox. A keyed component resets acknowledgement between actions, preventing
rapid repeated clicks from approving the next proposal. There is no blanket approval mode.
Authenticated-client decisions are labeled as such—not proof that a human clicked. Results
are built only from bounded file/command broker receipts, never from client-asserted output.
Lost/ambiguous outcomes consume the claim, stop further tools and independently discard or
quarantine the workload; no action POST is automatically retried.

`tool.approval`, `tool.declined`, `tool.started`, `tool.finished` and `tool.failed` are
metadata-only events under server-minted `exec-` run IDs. They preserve action/model-run/
workspace/call identity, effect, outcome and timing without raw arguments, files or output.
Action metadata follows the bounded hourly `PLAYGROUND_RUN_EVENT_RETENTION_DAYS` sweep
(default seven days) and account cascade. One-shot claims are not erased by event-history
purges; otherwise a still-live ticket could become reusable. Transcript/tool text stays local.

## Durable evidence and remaining work

`tool.proposed` records call ID, name, argument byte count, mode and `executed: false`.
The ledger does not store argument/source contents or tool-result text. Client history is
untrusted model input, not verified execution; this endpoint does not record client-asserted
approvals or outcomes as facts. Each model turn has its own replayable run ID. Whole-agent
run resumption/checkpointing is not implemented.

The UI exposes ordinary chat, manual hosted workspaces, proposal-only review and a separate
conditionally executable **web** Plan/Build workspace. The bounded web core lives in
`src/lib/playgroundAgentLoop.ts`, alongside the existing desktop `AgentLoop.cs`. Its fixed
Plan/Build tools, validated per-turn receipts, paired history, whole-batch checks, hard
bounds, cancellation and quarantine compose with `HostedAgentServices` only in that gated
surface. Run checks with `npm run test:playground-agent-loop` and
`npm run test:playground-hosted-agent`.

Local one-shot consent coordinators are `playgroundAgentConsent.ts` and desktop
`AgentConsentQueue.cs`. They expose one immutable exact-action challenge, accept a matching
explicit decision once, and deny cancelled/dismissed/replayed/stale decisions. They do not
persist permission, own an executor or provide server-verified approval evidence. No
"allow everything in the sandbox" switch has been added. The executor must independently
enforce ownership/consent and consume the exact approved action.

Real Docker/PostgreSQL fixture-agent and broker SIGKILL/restart checks pass, as does mounted
StrictMode Chromium approval/account-change/inertness validation. See
`playground-sandbox/README.md`; these do **not** qualify live model/native inference or
production isolation. The desktop software layer (qualification receipt gate, credential
vault, `HyperVAgentServices`, `Qualify-HyperVExecution.ps1`, checkpoint export with unified
diffs) is delivered and stub-tested; bounded artifacts, secure preview workspaces and
end-to-end release qualification remain pending. Desktop execution additionally requires the
image, job/process-tree and containment qualifications documented in
`playground-desktop/src/Filspresso.Sandbox/README.md`.
