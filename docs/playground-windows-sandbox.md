# Desktop Inspect → Build → Review (Windows Sandbox)

This is the current desktop direction. It replaces custom-image Hyper-V as the **default
application composition**, not as an automatic fallback. The previous Hyper-V library and
operator tools remain available for their original managed deployments, but its receipts,
VHDX and stored guest account cannot enable the new default backend.

## What users can do

- **Inspect/Plan:** import a bounded local UTF-8 text baseline; the model can list/read that
  in-memory copy and ask clarification questions. No VM or arbitrary host-file reader is
  required. File contents enter hosted inference only when requested by a tool.
- **Build:** explicitly start a fresh Windows-owned Sandbox VM, seed the baseline (or start
  empty), and let the agent propose `write_file` and `run_command`. Every action still needs
  separate, exact one-shot consent. The existing native model allowlist/metering applies.
  On machines without the Sandbox CLI, an explicitly acknowledged **native restricted
  isolation** mode is available as a separate, weaker opt-in (below); it is never entered
  automatically or offered as a "retry" after the VM refuses.
- **Review:** view diffs from direct writes **and command-generated text edits**. A bounded
  post-command snapshot is validated atomically before replacing the review state. Review
  and apply the changed files to a chosen destination through the conflict-checked, one-shot
  exporter. The original repository is never mapped writable into the VM.
- **Discard:** stop the owned VM by explicit ID, confirm it no longer appears in CLI inventory,
  invalidate the workspace/approvals, and return to an imported-text inspection conversation.

Starting Build resets the inspection conversation, not the imported project. No paid model
request, Windows feature change, VM boot or tool execution happens simply by installing the
MSI. The inspector is not a claim that a running VM exists.

## Requirements and setup

Automated Build requires **Windows 11 24H2 or newer**, a supported Pro/Enterprise/Education
edition, hardware virtualization, sufficient resources, the enabled **Windows Sandbox**
optional feature, and the updated packaged Sandbox client exposing `wsb.exe`. The application
install floor (Windows 10 2004+, Home included) covers inspection and, separately, the
explicitly qualified native restricted mode; it does **not** promise Windows Sandbox VM
execution on Windows 10 or older Windows 11, and installation never approves execution or
bypasses either mode's checks. Unknown/unsupported CLI behavior fails closed.

1. If missing, enable **Windows Sandbox** in Windows Features with administrator approval.
   Save your work and restart if Windows requests it. On managed PCs, IT policy may prohibit
   this. Filspresso does not silently change features, reboot or request elevation.
2. Open Windows Sandbox once to finish the Windows-provided client installation/update,
   then stop that session before using Playground. Existing unrelated Sandbox instances
   are **never adopted or stopped** by Filspresso.
3. In Agent conversation, select **Verify Sandbox setup…**. The bundled verifier runs fixed
   probes in disposable VMs. No VHDX, OS download or guest password is requested. It tests
   offline/read-only mappings, AppContainer/jobs, file round trips, command snapshots,
   aliases/races, descendants, timeout/output disposal and ready-worker process-kill recovery.
4. Only actual success creates a DPAPI-protected receipt for this Windows user, machine,
   exact sandbox assembly, Windows build/UBR and Sandbox package version. It expires after
   30 days. Updates require re-verification; previous receipts are archived, not silently
   treated as evidence for a new build. Model, billing and installed-MSI qualification are
   separate. The app remains non-elevated for ordinary use.
5. **Start fresh Build workspace**, check native model availability, and send your task.
   Missing qualification keeps execution disabled; Inspect remains available.

Equivalent explicit console commands, using the verifier shipped beside the application:

```powershell
& 'C:\Program Files\Filspresso Playground\qualification\Filspresso.Qualify.exe' windows-sandbox --confirm
& 'C:\Program Files\Filspresso Playground\qualification\Filspresso.Qualify.exe' windows-sandbox-recover --confirm
```

## Native restricted isolation (explicit, weaker opt-in)

Machines without the Sandbox CLI, virtualization or a Pro-class edition can still use Build
after choosing **native restricted isolation** in the conversation page and acknowledging its
limits in a dialog that names the shared kernel. It is a **staged-copy execution mode**, not
an automatic fallback: VM refusal never grants it, and no host-shell, WSL, Docker, or
unrestricted-process path exists at any point.

- Mechanism: an AppContainer lowbox child with UI restrictions, a private desktop, a Job
  Object, and a fresh per-session profile under an application-owned staging tree. Commands
  get a scrubbed environment (no inherited broker secrets or user PATH) and **no network**.
- **Not a VM, not Codex MXC.** It shares the Windows kernel and much of the host filesystem
  ACL surface with the user profile; predictable isolation is weaker and public/system
  application resources may remain readable. Prefer Windows Sandbox for unfamiliar code.
- Verification is separate from the VM receipt: `native-sandbox --confirm` runs AppContainer,
  private-desktop/job, file-boundary, outside-file and network denial, environment, command
  capture, descendant cleanup, timeout/output discard and a cross-process kill/recovery probe,
  then writes `native-restricted.bin` (DPAPI, bound to machine, build and exact assembly,
  30-day expiry).

```powershell
& 'C:\Program Files\Filspresso Playground\qualification\Filspresso.Qualify.exe' native-sandbox --confirm
& 'C:\Program Files\Filspresso Playground\qualification\Filspresso.Qualify.exe' native-sandbox-recover --confirm
```

There is no fallback to a host shell, WSL, Docker or an unqualified custom guest. A Codex-like
**workflow** does not require adopting Codex's different OS sandbox implementation; the native
mode above is an independent, explicitly labelled capability, never a substitute presented
where a VM was refused.

## Network is two different permissions

`web_search` and `web_fetch` call the existing **authenticated backend** egress-controlled
web service. The native protocol receives paired, untrusted text results; nothing is
executed in the host or guest. Both are available in Plan and Build with fresh exact-action
consent, because queries/URLs send data off-device. Denial, cancellation or changed/replayed
arguments never authorize a subsequent lookup. Do not put project secrets in search queries.
Backend search configuration, authentication, entitlements and live availability still apply.

**Command networking is disabled.** `npm install`, `pip`, `curl` and code cannot reach the
internet or LAN. No checkbox pretends that enabling full Sandbox networking is a restricted
package-download channel. Dependency networking is deferred until a separately designed,
qualified egress mechanism exists. Host-installed Node/Python/.NET are not automatically
available inside a clean VM; offline toolchain provisioning is also not bundled in this change.
PowerShell and Windows-provided tools can create/run code immediately after real qualification.

## Boundary and implementation

- `WindowsSandbox.cs`: `wsb start --id`, `exec --run-as System`, `stop --id` and strict raw
  inventory. Only trusted administration executes on the host. Guest source remains a
  file on a read-only mapping, never interpolated into a host command. CLI `exec` has no
  process stdout support, so a separate reply mapping carries bounded inert JSON.
- `WindowsSandboxConfiguration.cs`: networking, vGPU, clipboard, audio/video and printer
  sharing explicitly **disabled**; Protected Client enabled; 4 GiB memory. Exactly two
  app-owned mappings: immutable-to-guest input and guest-writable reply output, **not**
  the repository/home directory. XML is generated with a serializer, not string injection.
- The guest uses the existing pinned-handle fence, fresh capability-free AppContainer and
  verified job limits before command resume. SYSTEM is the trusted **guest broker** identity,
  never the generated command's authority. Qualification must prove the command cannot write
  the broker reply mapping. Normal foreground exit kills detached descendants too.
- Each reply has a fresh correlation ID and strict field uniqueness, local no-follow
  single-link handle reads, byte/depth/file/path limits and strict UTF-8 validation. A guest
  reply is data, not executable host content or a host path. Invalid results, snapshot
  failures, interruption, timeout and overflow invalidate/discard the VM, not just the CLI.
- Durable DPAPI-authenticated intent precedes provisioning; a per-root exclusive lease
  prevents competing app instances from reclaiming each other's VMs. Next-use recovery
  reclaims only authenticated owned IDs. If creation acknowledgement was lost, an
  `.uncertain` marker blocks automatic retry: a single empty inventory is not proof the
  Windows service cannot finish an in-flight creation later. That case needs operator
  review of the exact recorded ID and retained files, not deletion of the whole state root.
- VM lifetime is limited to one hour; requests and project snapshots have explicit budgets.
  Staging is retained under `%LOCALAPPDATA%\Filspresso\Playground\windows-sandbox` for
  inspection, not recursively deleted while it may contain guest-controlled content.
  These files can contain private source and must be treated as sensitive local data.

## Explicit limits

- Microsoft permits only **one Windows Sandbox instance at a time**. This implementation
  refuses an existing unrelated instance, even if it is idle; no parallel guest execution.
- Imports and captured snapshots remain bounded **text** projects: 256 files, 256 KiB/file,
  8 MiB aggregate, finite directory depth/scan budgets, excluded secrets/generated directories.
  This is not a complete binary/Git/submodule repository clone. Large repositories must be
  narrowed. `.git`, dependencies, ignored build output and secret files are not review exports.
- Deletions appear in diffs but block automatic export for manual review/application.
  Renames are represented as a deletion plus addition. Binary changes are not exported.
- Export is conflict checked, not crash-atomic. Keep backups. An existing export manifest
  blocks another export into the same destination until explicitly handled by the user.
- No guest disk quota, managed package egress, full toolchain provisioning, interactive dev
  servers, live HTML/JS preview, parallel VMs or exhaustive power-loss certification is claimed.
  AppContainer/job controls are defense in depth; the separate Windows kernel is the outer
  boundary, not a guarantee against hypervisor/OS vulnerabilities or a privileged host user.
- Discard/recover owned VMs before uninstalling. The maintenance helper refuses user-data
  cleanup while a sandbox lease is held or unresolved intent/uncertain markers remain;
  it must not erase the only recovery inventory. Elevated MSI lifecycle remains unqualified.
- Windows Sandbox configuration/CLI schema, SYSTEM-context lowbox support and mapping
  behavior must pass the **actual installed-client probes**. Parser/fixture/component tests
  are not live VM qualification. This backend is implemented but not live-qualified here.

## Evidence on this development PC

Read-only inspection reports Windows 11 Pro **25H2 build 26200.9711**, but no `wsb.exe`
command or installed Windows Sandbox package. No feature was enabled, no restart/installation
was attempted, and no Windows Sandbox receipt has been created. Actual VM qualification is
therefore blocked on setup. Native Windows component tests from the previous work remain
component evidence only. Final test/build totals are recorded in the task handoff.

Final checks: **453/453 desktop tests** (Debug and Release), **103/103 web client tests**,
and **18 native maintenance checks** pass. WinUI publish and unsigned MSI **0.3.2** package
successfully; the app, external verifier and installed/bundled verifier use identical
sandbox DLL bytes. The bundled verifier was invoked on this PC and correctly exited **1**
with setup instructions and **no receipt**. No live VM/model/billing/MSI lifecycle success
is inferred from these component/fixture/build checks.

Package: `%LOCALAPPDATA%\Temp\opencode\filspresso-windows-sandbox\Filspresso.Playground.msi`
(80,904,660 bytes; SHA-256
`f773ecde9a099d68f7650baa767590132d8d378d5c48d83af012f326369085cc`).
It is **NotSigned**, not installed or promoted to the web download. The adjacent package
manifest remains authoritative if the source is rebuilt later.

References: Microsoft's [Sandbox CLI](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli),
[configuration](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file),
[installation](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install).
