# Execution safeguards and actual enablement (policy 3)

**Default-backend change:** [`playground-windows-sandbox.md`](playground-windows-sandbox.md)
now describes the desktop application's Windows-owned Sandbox flow, without a custom VHDX
or guest account. The policy-3 custom Hyper-V backend below is retained as a library/operator
option, **not** selected automatically or used as fallback. Its receipts cannot enable the
new backend. On this device the Windows Sandbox backend still has no live VM evidence.
The third, explicitly weaker **native restricted** backend (shared host kernel; see
`playground-windows-sandbox.md`) has its own receipt type and a separately run live
qualification; that receipt never enables either VM backend.

This supersedes the earlier Beta-6 statement that guest containment/jobs/recovery had not
been implemented. It does **not** turn unperformed live checks into passing evidence.

## Implemented

- **Guest file operations:** the exact embedded .NET Framework-compatible native helper
  is compiled by PowerShell **inside the guest**. It pins every directory from the volume
  root without write/delete sharing, opens final files without following reparse points,
  rejects devices/directories/hard links, and inspects before truncating. Read/write/list
  use those handles, not a check-then-open PowerShell path guard.
- **Command authority:** a fresh Windows AppContainer with **zero capabilities** runs each
  command. The privileged remoting account is not the workload's security authority.
  Only the disposable workspace is granted Modify access/low integrity; the per-command
  lowbox also has OS-managed private storage. Windows binaries/libraries remain readable.
  There is no host-shell, WSL, Sandbox or hosted-Docker fallback for desktop commands.
- **Jobs and limits:** create the root suspended, assign the job and inspect its actual
  AppContainer token/capability count and installed job limits before resuming. Only three
  stdio handles are inherited. No breakaway: 32 processes, 512 MiB/process, 1 GiB/job,
  20% hard CPU cap, bounded time and 128 KiB aggregate output. Normal root exit terminates
  remaining descendants too; a result requires zero active job processes. Timeout, output
  overflow, invalid responses and unconfirmed cleanup discard/invalidate the whole VM.
- **Outer boundary:** local Generation-2 Hyper-V, Secure Boot, zero network adapters,
  2 vCPU, 1–4 GiB dynamic RAM. Guest commands remain untrusted. AppContainer/job controls
  are defense in depth, not a replacement for Hyper-V or protection from guest kernel bugs.
- **Crash recovery:** DPAPI-authenticated intent is flushed **before** provisioning. An
  exclusive per-root lease pins local ancestors and prevents reclaiming a live second
  client. The next owner reclaims recorded stale VMs before creating another. Recovery
  checks exact random VM name, owner note and disk path; mismatches/corrupt intents stop,
  never widen deletion to a prefix. Missing/invalid receipts or guest credentials do not
  prevent the separate `recover` command. Intent loss/tampering is not silently repaired.
- **Host administration lifetime:** trusted PowerShell blocks on a private stdin handshake
  until enrolled in its own kill-on-close job. Parent-process death closes that job, so an
  orphan creation script cannot race subsequent recovery. No model source/password is on
  its command line. Secrets travel through stdin, not environment variables or diagnostics.
- **Image integrity:** re-hash through a no-follow pinned handle at startup, then hold the
  image against write/delete for the sandbox object's lifetime. Recovery lease and image
  locking are released on disposal. Sessions expire after one hour, including idle ones.

These controls do not implement host-volume disk quotas, kernel exploit resistance,
crash-atomic original-project export, live HTML/JS preview, or mid-command redirection.
An already privileged host operator/current Windows account is trusted; the recovery journal
is not a boundary against that operator. A corrupted intent requires operator investigation,
not a forced automatic deletion. No background service reclaims a VM while the app is closed;
recovery occurs on the next start or explicit operator recovery.
The crash probe kills a worker **after guest readiness**. Exhaustive host power-loss and
every in-flight Hyper-V/service provisioning interruption window are not certified by that
single probe and still require operator stress testing on the real deployment.

## Qualification and enablement are now conditional, not permanently disabled

`HyperVQualification` accepts only **policy 3** receipts with all **17** required checks,
the current Windows machine binding, image digest/size, age at most 30 days, and SHA-256
of the **exact `Filspresso.Sandbox.dll`** running in the application. Policy-2/seven-check,
stale, foreign-machine or other-build receipts cannot enable execution. There is no override.

The qualification console uses the **actual sandbox adapter**, not seven separate mock
scripts. It runs real UTF-8 file round trips, pinned-handle concurrent mutation checks,
AppContainer privilege/write refusal, installed job limits, normal-exit descendants,
junction/hard-link attacks, timeout/overflow VM disposal, cleanup, and a separate worker
that is killed after booting a VM. A new process must recover that VM before a receipt
is written. No receipt is written on failure. A local operator receipt is operational
evidence, not an independently signed security audit or per-action permission.

The build puts exact matching application sandbox/Core bytes into the qualification tool.
The wrapper checks the app/tool assembly hashes again. Rebuilds require requalification.
Existing receipts are **not overwritten**: explicitly archive the old one before rerunning.

### Enable on a qualified single Windows device

Prerequisites still need to be supplied by an operator:

1. A licensed/provisioned, unattached Windows 10/11 Generation-2 `.vhdx`, at most 256 GiB,
   with PowerShell Direct, AppContainer APIs, and required tools available offline.
2. A **dedicated guest administrator** for trusted remoting, not the host login or Filspresso
   password. Commands themselves run in the unprivileged AppContainer.
3. Elevated PowerShell under the **same Windows account** that will use the client. Hyper-V
   administration also needs elevation when starting the client. No elevation bypass exists.
4. A configured hosted native-model service and signed-in entitled account. Model availability
   remains separately capability/allowlist-gated; a Hyper-V receipt cannot override it.

Example for the isolated package produced in this change:

```powershell
# Elevated PowerShell, same user as the application. Replace the image path yourself.
$package = "$env:LOCALAPPDATA\Temp\opencode\filspresso-beta6-safeguards"
./playground-desktop/scripts/Qualify-HyperVExecution.ps1 `
  -ImagePath 'D:\Images\your-provisioned-windows.vhdx' `
  -GuestCredential (Get-Credential) -SaveGuestCredential `
  -QualifierPath "$package\qualification\Filspresso.Qualify.exe" `
  -ApplicationSandboxAssembly "$package\publish-next\Filspresso.Sandbox.dll"
```

This intentionally boots and destroys several disposable VMs and a crash-test worker.
It may take many minutes. Do not run it against an image you have attached elsewhere.
After **actual success**, start that exact client build elevated, sign in, check native
capabilities and explicitly start the sandbox. Every proposed write/command still needs
its own fresh, exact one-shot approval. A clarification answer cannot approve anything.

Recovery without a guest password, image, valid receipt or model request:

```powershell
& "$package\qualification\Filspresso.Qualify.exe" recover `
  "$env:LOCALAPPDATA\Filspresso\Playground\sandbox"
```

Only authenticated records under that selected state root are reclaimed. Recovery still
requires Hyper-V administration. Do not delete a failed journal blindly to unblock startup.

## Other qualification entry points

- `scripts/Qualify-PlaygroundModel.ts`: an HTTPS authenticated **live** native-call/paired
  follow-up probe, separately typed confirmation before **each** of two paid requests,
  no retries, no executor or allowlist changes, and bounded metered-response evidence.
  Requires `PLAYGROUND_QUALIFICATION_TOKEN` and an interactive terminal. It does **not**
  prove wallet ledger reconciliation, all templates/models, compaction or cancellation.
  Those remain necessary operational checks; response settlement alone is not ledger proof.
- `playground-desktop/scripts/Test-ProductionSandboxEngine.ps1 -DockerContext <name>`:
  read-only Linux/rootless/seccomp/cgroup-v2/memory/PID preflight, not certification. Run the
  existing real lifecycle/crash smokes and operational/hostile-resource tests on a separately
  provisioned dedicated engine. The tool does not reconfigure or switch an existing engine.
- `playground-desktop/scripts/Qualify-MsiLifecycle.ps1`: operator-only elevated install/
  upgrade/uninstall probes on a **clean disposable VM/snapshot**, two distinct versioned MSI
  packages, explicit disposable-machine acknowledgement and a fresh typed approval before
  each operation. Refuses existing product/data. Logs exit/payload/cleanup evidence, not
  full interactive UI, reboot or failure-recovery qualification. Unsigned warning remains.

## Evidence on this device — 2026-10-25

Actual local Windows native tests, not merely generated-script string inspection, exercise
the exact Framework source with Windows PowerShell: workspace write/no administrator
authority, pinned-handle mutation races, detached-child cleanup, timeout/output bounds,
capability count and installed job limits. Tests also cover DPAPI corruption, exclusive
owner leases, recovery script ownership matching, missing descendant proof, stale/old/build-
mismatched receipts and host-administration descendant cleanup.

**Not run here:** live Windows guest qualification (no supplied image/account; current
process not elevated), authenticated live model/billing requests, or elevated MSI lifecycle.
No guest image, account, receipt or billing evidence was invented. No installed product,
Windows feature, production allowlist or production service was changed.

Read-only production-engine preflight **correctly refuses** current `desktop-linux`:
rootless **false**, cgroup **v1**, seccomp/memory/PID features present. It is not a qualified
production candidate. Existing Docker infrastructure was left unchanged.

**Consequently this device is not yet execution-qualified.** The implementation now has
an enablement path after real tests pass; it is not honest to report desktop execution
already enabled without the operator resources above. See `DONE.md` for final build/tests.

### Final checks and package

- Full desktop solution: **436/436 tests pass**, including native probes (not Hyper-V).
- Web client regression suite: **103/103 pass**. TypeScript check and model-helper ESLint pass.
- WinUI compile/publish, qualification console and unsigned **0.3.1 MSI** packaging pass.
- Operator PowerShell scripts parse. The two application/qualifier sandbox DLLs match:
  `9a56922cb4cc030b4391b5e2e75ff4eef13f1049ba150e6fa0a0ff78bcc8b946`.
- Missing model-helper authorization/interactive input and missing qualifier arguments
  fail closed, without network calls, execution or a receipt. Live model/guest/installer
  probes have **not** been substituted with passing fixtures.

Package: `%LOCALAPPDATA%\Temp\opencode\filspresso-beta6-safeguards\Filspresso.Playground.msi`
(55,971,046 bytes; SHA-256
`42f57db8953f88011551d4535d93ad9cc028ad689c93f359e12529994d20b4f4`).
It is **NotSigned**, not installed, and not promoted over the existing download. The adjacent
`package-manifest.json` is authoritative for a later rebuild; rebuilds can change hashes.
