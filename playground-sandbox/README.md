# Hosted Playground execution

The web Playground's **Open execution workspace** panel uses this optional Docker
executor. Chat responses and uploaded sources are never automatically executed.
The first implementation supports Python 3.11 and POSIX shell commands, explicit
approval, workspace file editing/inspection, a draft comparison, streamed output,
and cancellation by discarding the sandbox. The separate **Agent sandbox workspace** now
composes a bounded native-tool loop with signed one-shot actions and fresh per-action
approval, but remains deployment-gated and has not been qualified with a live model.
See [the native-agent protocol](../docs/playground-native-agent.md) for additional gates,
the action migration, exact-body handling and paired-history compaction/billing.

## Enable

Configure a random, private `PLAYGROUND_SANDBOX_KEY` of at least 32 characters in
the deployment environment. Do not commit it or put it in `NEXT_PUBLIC_*` variables.
The backend and broker must use the same value. The ordinary AI service key is a
different credential.

```powershell
# Example for this shell only; use your secret manager for a persistent deployment.
$env:PLAYGROUND_SANDBOX_KEY = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

docker compose -f docker-compose.yml -f docker-compose.playground.yml build sandbox-runtime playground-sandbox backend ai
docker compose -f docker-compose.yml -f docker-compose.playground.yml up -d --no-deps playground-sandbox backend ai
```

Build/start the Next application separately. Never rebuild a `.next` output tree
while an existing `next start` is serving it. Do not reset database volumes.
Without this overlay/configuration, chat still works and execution clearly reports
`SANDBOX_NOT_CONFIGURED`; there is no fallback to execution on the application host.

For a bare Nest process, set `PLAYGROUND_SANDBOX_URL` to the private broker origin
and supply its key. Do not expose the broker to the browser or publish its port in
production. The browser authenticates to Nest with its normal session; Nest derives
the sandbox account owner itself and sends the internal credential.

## Boundaries and limits

- Workloads: UID/GID 10001, no network, no capabilities, no-new-privileges, read-only
  root, 512 MB memory including swap, one CPU, 128 processes, bounded file handles.
- `/workspace`: 64 MB tmpfs. `/tmp`: 16 MB tmpfs. Neither is a host/application mount.
- No Docker socket, service credentials, account tokens, or application secrets in workloads.
- Files: UTF-8, 256 KiB each; path traversal and symlink destinations are refused.
  Writes execute as the guest user and replace files atomically. Reads use descriptor-relative
  no-follow opens, refuse nonregular files/FIFOs, and bound the actual data read even if a
  file grows; they do not use a raceable resolve/stat/read sequence.
- Commands: 30 seconds through Nest, 1 MiB console output. A limit violation or
  explicit stop destroys the complete workload, not just its foreground shell.
- At most two workspaces per account and eight per broker namespace. File/command operations
  share one reservation; no edits/reads race an active command.
- After normal completion, freeze all tasks and check only original idle processes remain.
  Surviving detached children cause complete workload discard. Concurrent timeout/explicit
  teardown is single-flight; stopped receipts wait for actual daemon removal. Bounded,
  exact-owner tombstones confirm repeated discard without trusting arbitrary 404s.
- Idle expiry: 15 minutes; hard lifetime: one hour. Workspaces are **ephemeral**.
  Download useful files before closing/discarding them. Sandbox CPU is not currently
  billed; model generation/media/compaction retain their normal token billing.
- Chat compaction and hosted execution now record bounded durable run events, viewable in
  both clients' **Recorded activity**. The separate gated web agent records metadata-only
  decisions and broker-observed tool outcomes. Desktop execution remains unconnected.
  Persistent projects, full diff/checkpoint history, dependency provisioning, Node runtimes,
  previews and production agent execution remain in `ENHANCEMENT.md`.

`PLAYGROUND_SANDBOX_NAMESPACE` optionally scopes ownership, capacity and reaper discovery
for an isolated broker instance (letters/digits/`_.-`, at most 64 characters). Its empty default
addresses the unnamespaced scope. Each broker process has a fresh epoch; startup discards
old-epoch workloads in its own namespace rather than adopting unknown in-flight state.
Broker instances in different namespaces do not operate on each other's workloads. This is
a trusted control-plane setting, not a browser override;
production still requires a dedicated engine and a single broker worker per namespace.

### Privileged control plane

The broker needs Docker daemon access and must be treated as privileged infrastructure.
For production, use a **dedicated, preferably rootless Docker engine** for sandbox
workloads and a single broker worker; do not point it at the application/production
daemon. `PLAYGROUND_DOCKER_SOCKET` selects the daemon socket mounted into the broker.
The default socket is suitable for isolated local testing, not a claim that a shared
rootful host daemon is a safe public multi-tenant deployment.

Docker containers share the host kernel. These controls are not equivalent to the
desktop design's Hyper-V VM isolation. Do not add privileged mode, host networking,
host bind mounts or a Docker socket to the workload to make a command work.

## Verification

With Docker Desktop's Linux engine running and Python `requests` installed:

```powershell
./playground-sandbox/Smoke-Docker.ps1
```

This builds the two images, creates a temporary loopback-only test broker with a
random key, exercises real file/run/isolation/timeout operations, and removes its
test resources in a unique broker namespace. Even on failure its cleanup targets only
that random test scope. It does not restart the application stack or touch database volumes.
`-SkipBuild` reuses previously built images.

Verified locally on 2026-10-25 with the real Docker Linux engine: create/write/read/run/output,
empty/Unicode files, account isolation, literal-boolean approval, traversal/symlink/FIFO/binary
refusal, UID 10001/offline/no Docker socket, normal/timeout detached-descendant disposal,
owner-bound idempotent discard and SIGKILL/restart disposal of active/idle old-epoch workloads.
Only the uniquely named temporary broker is crashed. This is a smoke test, **not production
isolation certification**. Hostile-workload/resource stress, dedicated/rootless production
deployment and native model/runtime qualification remain release gates.

`./playground-sandbox/Smoke-Agent.ps1` additionally creates a temporary PostgreSQL database
on tmpfs (default image `filspresso_next-postgres:latest`, image init scripts masked) and
tests signed fixture read → approved write → read → approved test → follow-up, cross-account
refusal, metadata-only persistence and genuinely concurrent one-shot database claims. Model
and billing are explicitly **fixtures**, not live inference or money. No application database,
volumes or services are reused/reset/restarted. `-SkipBuild` uses existing sandbox images;
`-PostgresImage` selects another compatible test image. Integration typecheck:
`npm --prefix nestjs-backend run typecheck:agent-integration`.

Mounted browser validation uses only a standalone development fixture, not a Next rebuild:
`node playground-sandbox/Build-AgentBrowserFixture.cjs`, then
`python tests/browser/playground-agent-workspace.py` (Python Playwright/Chromium required).
It verifies StrictMode, explicit start, per-action acknowledgement reset, inert rendering,
follow-ups and account-change discard using fixture API/model replies.

Unit policies: `python -m pytest tests/unit/test_playground_sandbox.py -q`
(requires the optional Docker Python SDK; runtime image requirements are in this folder).
