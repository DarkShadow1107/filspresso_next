# Hyper-V execution library — live qualification required

**Application default changed:** Windows Sandbox is now the selected desktop VM adapter,
without custom images or guest credentials. See `docs/playground-windows-sandbox.md`.
The custom Hyper-V implementation below is retained, not automatically selected or used
as fallback. Its policy-3 receipts do not enable Windows Sandbox.

**Current policy 3:** guest pinned-handle containment, capability-free AppContainer/job
execution and durable recovery are implemented. The application can enable only with actual
machine/image/exact-build qualification. See `docs/playground-execution-safeguards.md`.
The older release-block paragraphs below are historical, not the current composition rule.

**Beta-6:** `HyperVAgentServices` and approval UI exist, but application composition now
explicitly blocks execution while guest handle containment, jobs/descendants and durable
crash recovery remain unfinished. An old seven-check receipt cannot bypass this. See
`docs/playground-beta6-qualification.md` for corrections to earlier enablement claims.
`GenericCredentialVault`/`VaultGuestCredentials` read an operator-provisioned credential;
the app never creates that guest credential. Image verification measures actual SHA-256.
The historical paragraphs below describe the pre-release library, not readiness to ship.

`HyperVSandbox` implements `ISandbox`. It does not grant execution approval and is not
connected to chat or the agent loop. A future adapter must enforce capability, account/session
ownership, Plan/Build policy and fresh per-action consent. Inference remains hosted; this
library's code boundary is the local guest VM, never a host-shell fallback.

The separate desktop **Agent conversation** screen currently composes only native clarification
questions and local conversation history. It constructs no `HyperVSandbox`, offers no file or
command tools, and is not evidence that any execution release gate below has been closed.

## Explicit prerequisites

- An operator-qualified, unattached Windows Generation 2 VHDX with PowerShell Direct and
  the required offline tools already installed. No image download/provisioning is supplied.
- A local, absolute image path and private state directory. Directory/image ACLs, parent
  reparse points, image integrity, storage quotas and crash recovery still need qualification.
- `IGuestCredentialProvider` for a dedicated guest account. No default password or production
  credential-store adapter exists. Do not reuse host credentials or Filspresso access tokens.
- A transport supporting private stdin (`PowerShellRunner`). Credentials and encoded source
  are JSON data on stdin, not command-line arguments or model context. They still exist
  transiently in process memory; this is not an encrypted-memory guarantee.
- Hyper-V administration rights and a running VM management service. The library probes
  these fail-closed; it does not request elevation or change Windows features.

## Implemented guards

- Server-independent, random VM/session names; no guest network adapters, secure boot,
  two virtual CPUs, 1–4 GiB guest memory, disabled checkpoints and automatic startup.
- One startup at a time, at most two sessions per library instance (including failed
  cleanup records), and one active operation per sandbox. These are not machine-wide quotas.
- Ready only after a bounded credentialed guest handshake (two-minute default).
- Guest source is decoded within the remote script block. Commands run in a guest child
  PowerShell; host exit status is not substituted for the command's exit code.
- Workspace-relative paths, lexical alias/traversal rejection, guest reparse-point checks,
  256 KiB files and 131,072 combined command-output characters. Guest child output is drained
  concurrently and bounded; host stdout/stderr each have a separate one-million-character cap.
- Actual elapsed operation timing, bounded command deadlines (five-minute maximum), and
  caller cancellation distinct from timeout in the host transport.
- After interrupted dispatch, invalid results or output overflow: invalidate first, then
  turn off/remove the owned VM and delete only its recorded differencing disk. Cleanup uses
  its own 30-second budget. A failed cleanup remains visible to `ListAsync` and retryable
  through `StopAsync`; it must not be treated as successful discard. An unconfirmed host
  creation process requires manual review and retains its recovery record.

## Release gates still open

No VM/VHD has been created for validation. Current checks use a fake hypervisor, real
Windows PowerShell stdin/process tests with trusted literal scripts, and parser-only checks
of generated scripts. They do not establish real boot, remoting, network isolation or cleanup.

Reparse-point checks are **not race-proof handle-based containment**. Successful commands
can still leave descendants that close their pipes; Windows job/process-tree lifetime and
resource enforcement are required before enabling agent execution. Image integrity/licensing,
guest provisioning, credential storage, disk/host-wide quotas, orphan recovery, real VM tests
and production adapters/approval UI remain pending. Never use this library's current state
as evidence that desktop agent execution is ready to ship.
