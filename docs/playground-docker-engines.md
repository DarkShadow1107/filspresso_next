# Playground Docker sandbox engines

This document separates the **currently usable local Docker sandbox** from a possible
future rootless production engine. A cgroup-v2/rootless engine is **not** required to run
the existing web Playground sandbox locally. The stricter engine preflight is a future
production qualification gate, not a switch that disables the current cgroup-v1 engine.

## Scope: web Playground only

The Docker runner belongs to the web Playground's optional **Open execution workspace**
feature. The NestJS backend authenticates the account and calls the private sandbox broker;
the broker creates short-lived Linux workload containers through the Docker Engine API.
The browser never receives the Docker socket or a direct broker port.

The desktop app is deliberately separate. Its Build workspace uses Windows Sandbox as the
preferred VM and native restricted isolation only as a clearly acknowledged, weaker
Windows-kernel option. Desktop has **no Docker or WSL fallback**, and a Docker failure must
never silently change the desktop isolation mode. Native restricted mode is not a VM and is
not Codex MXC.

The desktop app continues to use:

- [`playground-windows-sandbox.md`](playground-windows-sandbox.md) for the Windows Sandbox
  VM path;
- [`playground-execution-safeguards.md`](playground-execution-safeguards.md) for the
  separate Hyper-V/operator qualification material.

## Engine decision

| Engine | Intended use | May run the existing web sandbox? | Production-qualified? |
| --- | --- | --- | --- |
| Current Docker Desktop `desktop-linux`, rootful, cgroup v1 | Local development and single-operator smoke/integration testing | **Yes**, when the broker overlay is configured and Docker reports seccomp, memory limits and PID limits | **No** |
| Future dedicated rootless Linux engine, seccomp, cgroup v2, memory/PID controllers | Production candidate for hosted workloads | Yes, after the broker is deliberately connected to it and the deployment is tested | Not merely by passing the preflight; lifecycle, crash, hostile-workload and deployment-access checks remain required |

The local engine observed on **2026-10-26** reported:

```text
Docker context: desktop-linux
Client/server: 29.2.1
Daemon OS/architecture: linux/amd64
Security option: seccomp, profile=builtin
Cgroup version: 1
MemoryLimit: true
PidsLimit: true
CPU count: 8
Daemon-visible memory: 8,170,524,672 bytes (about 7.61 GiB)
Rootless: no (no `name=rootless` security option)
```

The important local facts are that the daemon reports **seccomp and memory/PID controller
support**. Cgroup v1 does not prevent this broker from setting its existing per-container
limits. The rootful daemon and cgroup v1 do prevent this setup from passing the stricter
future production-candidate preflight. These are different claims.

## Current local cgroup-v1 sandbox

The hosted runner image is pinned in `playground-sandbox/Dockerfile.runtime` and currently
provides Python 3.11 plus POSIX shell. A sandbox is a disposable container, not a host shell.
The current broker applies:

- UID/GID `10001:10001` for generated commands;
- Docker's default seccomp profile, all Linux capabilities dropped, and
  `no-new-privileges`;
- no network (`network_mode=none`), no host bind mount, no Docker socket and no application
  credentials in the workload;
- a read-only container root; `/workspace` is a 64 MiB tmpfs and `/tmp` is a 16 MiB tmpfs;
- 512 MiB memory including swap, one CPU, 128 processes, bounded file size and open files;
- a bounded command duration/output, exact workspace paths, and removal of the complete
  container if timeout, cancellation, or descendant cleanup is unconfirmed.

The broker itself is trusted control-plane code. It has access to the Docker socket so it
can create and remove workloads. Access to a **rootful Docker socket is effectively host
administrator authority**; `cap_drop` on the broker does not make that API unprivileged.
Therefore the default socket setup is for local testing, not a public multi-tenant production
service. Keep the broker private, keep its random 32+ character key secret, and do not add
the Docker socket to a workload container.

### Run the local smoke test

From PowerShell at the repository root:

```powershell
./playground-sandbox/Smoke-Docker.ps1
```

Use `-SkipBuild` only when the runtime and broker images already exist:

```powershell
./playground-sandbox/Smoke-Docker.ps1 -SkipBuild
```

The script chooses a random broker name, loopback-only test port, secret and Docker label
namespace. It exercises actual create/write/read/run operations, approval parsing, account
separation, path/symlink/FIFO/binary refusals, workload UID/network/socket boundaries,
normal and timeout descendant disposal, owner-bound discard, and broker-kill/restart cleanup.
Its cleanup targets only its unique test namespace and temporary broker. It does not reset
database volumes or restart the application stack.

On **2026-10-26**, the current `desktop-linux` cgroup-v1 engine passed the smoke with
`-SkipBuild`, including the SIGKILL/restart cleanup checks. This is evidence that the
current local sandbox works on this engine; it is **not** a memory/PID exhaustion stress
test, kernel-escape assessment or production certification. Those remain future hostile-
workload qualification items.

### Enable the optional hosted web runner

The Compose overlay is optional. It mounts the selected Docker socket into the trusted
broker, exposes no broker port to the host, and places the broker on the application's
internal Compose network. From PowerShell, use a random private key for the local session:

```powershell
$env:PLAYGROUND_SANDBOX_KEY = [Convert]::ToHexString(
  [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

docker compose -f docker-compose.yml -f docker-compose.playground.yml `
  build sandbox-runtime playground-sandbox backend ai

docker compose -f docker-compose.yml -f docker-compose.playground.yml `
  up -d --no-deps playground-sandbox backend ai
```

The backend and broker must receive the same key. Do not commit it, put it in a
`NEXT_PUBLIC_*` variable, or return it to the browser. The web account still needs the
required Playground/Spectre entitlement. The optional native agent remains separately
deployment-gated; enabling the basic execution overlay does not turn on native model/agent
execution. The Next.js server is currently separate; moving it into its own frontend
container is a separate Beta-8 production task.

Stop only the Compose services you intentionally started. Do not use broad `docker system
prune` cleanup: it can remove unrelated images, containers, caches or volumes.

## Why the production preflight rejects the current engine

Run the read-only candidate check with a Docker context:

```powershell
./playground-desktop/scripts/Test-ProductionSandboxEngine.ps1 `
  -DockerContext desktop-linux
```

It requires all of:

1. A Linux Docker daemon;
2. rootless mode;
3. seccomp enabled;
4. cgroup v2;
5. Docker-reported memory and PID limit support.

The current engine has seccomp and memory/PID support, but is **not rootless** and reports
**cgroup v1**. The expected result is therefore a refusal. The check is read-only: it does
not install an engine, change contexts, create containers or issue a qualification receipt.
Do not remove the rootless/cgroup-v2 checks to make the current daemon look production-ready.

Even a candidate that passes this basic check is not certified. The production work still
needs a dedicated engine, actual lifecycle/crash-recovery runs, resource/hostile-workload
tests, and deployment access controls. Rootless Docker reduces daemon privilege; containers
still share a Linux kernel and are not per-workload VMs.

## Future upgrade: an on-demand rootless engine in WSL2

This section describes a **future option**, not a current dependency. Do not install or
configure it just to use the cgroup-v1 local sandbox above. The goal is a separate rootless
daemon that can be started for sandbox work and stopped afterward, while Docker Desktop's
primary engine remains the ordinary application/development engine.

### Resource and lifecycle expectations

- This is a second Docker **daemon**, not a second Docker Desktop installation. It has some
  additional idle process and image-storage cost, but it does not require a separately
  managed VirtualBox VM. WSL2 supplies its managed Linux environment.
- Docker Desktop's `docker-desktop` distro is internal. Do not install packages into it or
  edit its files. Use a normal Ubuntu WSL2 distro for an independently managed daemon.
- Do **not** enable systemd user lingering (`loginctl enable-linger`) for an on-demand setup.
  Start the rootless service when needed and stop it afterward. A login/boot-enabled service
  contradicts the goal of keeping the second engine off when idle.
- `wsl --terminate <Ubuntu-distro>` stops that distro. `wsl --shutdown` stops **all** WSL2
  distros and may also stop Docker Desktop's WSL backend; avoid it when the primary engine
  must stay running.
- `.wslconfig` memory/CPU limits apply broadly to WSL2, not only to the second daemon, and
  may constrain Docker Desktop too. Prefer per-workload Docker limits unless a global WSL
  cap is intended. WSL can retain allocated memory until it reclaims it or the WSL VM stops.

### Future setup outline

1. Inspect `wsl --list --verbose`; select or install a normal Ubuntu LTS distro running as
   WSL version 2. Keep Docker Desktop's internal distro untouched.
2. If needed, merge `systemd=true` under `[boot]` in `/etc/wsl.conf`; inspect and preserve
   existing settings. Applying WSL configuration may require a WSL restart, which interrupts
   WSL workloads.
3. Install Docker Engine and `docker-ce-rootless-extras` from Docker's official Ubuntu
   package repository, plus the documented rootless prerequisites (`uidmap`,
   `dbus-user-session`, and `slirp4netns`). Do not add the user to the `docker` group.
4. As the unprivileged Ubuntu user, run `dockerd-rootless-setuptool.sh install`. Do not
   enable lingering. Start it only for a test session:

   ```bash
   systemctl --user start docker
   export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
   docker info --format 'OS={{.OSType}} Security={{json .SecurityOptions}} Cgroups={{.CgroupVersion}} Memory={{.MemoryLimit}} PIDs={{.PidsLimit}}'
   ```

5. Confirm Linux, `name=rootless`, seccomp, cgroup version 2, and memory/PID limits. If a
   controller reports unavailable, stop: diagnose WSL kernel/cgroup delegation rather than
   weakening container policy or claiming a pass.
6. Run the production-candidate preflight and the full lifecycle, crash, resource and
   hostile-workload checks. A successful preflight is only an initial prerequisite.
7. Stop workloads through the broker, verify its owned containers are gone, stop the daemon,
   and close only the selected distro when finished:

   ```bash
   systemctl --user stop docker
   ```

   ```powershell
   wsl --terminate Ubuntu-24.04
   ```

Official references:

- [Docker Engine rootless mode](https://docs.docker.com/engine/security/rootless/)
- [Docker Desktop WSL2 backend](https://docs.docker.com/desktop/features/wsl/)
- [WSL configuration (`.wslconfig`)](https://learn.microsoft.com/windows/wsl/wsl-config)

### Connecting the future daemon to the broker

Installing a second daemon does **not** automatically make the broker use it. Today the
Compose overlay mounts `${PLAYGROUND_DOCKER_SOCKET:-/var/run/docker.sock}` into the trusted
broker. A future deployment must deliberately select the rootless socket/endpoint and prove
that the broker can reach it while workload containers cannot.

Preferred direction: co-locate the broker with the rootless engine, or connect through a
deliberately authenticated private channel. Never expose an unauthenticated Docker TCP API,
publish the broker directly to the Internet, or mount the rootless socket into an untrusted
workload. Validate the actual Compose bind source and Docker context on the target; Windows
Docker Desktop path translation is not proof that a WSL socket is the selected daemon.

Until this integration and its tests exist, the current local cgroup-v1 engine remains the
local web-sandbox path and the second engine remains future work. Neither engine changes the
desktop app's Windows Sandbox/native-restricted isolation design.
