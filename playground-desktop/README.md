# Filspresso Playground (desktop)

The Windows client for the Spectre Playground: a coding agent with every Filspresso model,
metered through the same wallet the web app uses, and sandboxed in a Hyper-V virtual machine
with no network connection to your computer.

**Design, and why: [../PLAN_PLAYGROUND_APP.md](../PLAN_PLAYGROUND_APP.md).**

---

## Layout

| Project | What it is |
| --- | --- |
| `src/Filspresso.Core` | API client, auth, entitlement, model catalogue, SSE reader, platform rules. No UI. |
| `src/Filspresso.Harness` | The agent loop and its contracts. |
| `src/Filspresso.Sandbox` | What a sandbox must guarantee, independent of how it is built. |
| `src/Filspresso.App` | WinUI 3, **unpacked**, packaged for MSI. |
| `installer` | WiX v5. The edition gate lives here. |
| `tests/Filspresso.Core.Tests` | 65 tests, including the installer contract. |

`Core`, `Sandbox` and `Harness` carry no UI dependency on purpose: they are where the
mistakes live, and they stay testable without a window.

## Building

**The WinUI application cannot be built with `dotnet build`.** The Windows App SDK's PRI
generation targets are not in the .NET CLI's copy of MSBuild, and the build fails with
`MSB4062`. It needs MSBuild from Visual Studio:

Two solutions, because the CLI cannot build the app:

- `Filspresso.Desktop.sln` — Core, Sandbox, Harness and the tests. Builds with `dotnet`.
- `Filspresso.App.sln` — adds the WinUI application. Needs MSBuild.

```powershell
# libraries and tests
dotnet build .\Filspresso.Desktop.sln -c Release
dotnet test  .\Filspresso.Desktop.sln -c Release

# the application
$msbuild = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
  -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" | Select-Object -First 1
& $msbuild .\src\Filspresso.App\Filspresso.App.csproj -restore -t:Publish `
  -p:Configuration=Release -p:Platform=x64 "-p:PublishDir=$PWD\artifacts\publish\" -v:m -nologo

# the installer
wix build .\installer\Filspresso.Installer.wxs -arch x64 `
  -d "AppPublishDir=$PWD\artifacts\publish" -d ProductVersion=0.1.0 `
  -ext WixToolset.UI.wixext -ext WixToolset.Util.wixext `
  -o .\artifacts\Filspresso.Playground.msi
```

Output: an unsigned MSI of roughly 50 MB, most of it the self-contained Windows App SDK
runtime. `WindowsAppSDKSelfContained` is why the installer can ship the runtime instead of
assuming it is on the machine.

## Why an MSI, and not an MSIX

An MSIX will not install from an untrusted certificate at all: sideloading means importing
the signing certificate onto every target machine first, or publishing to the Store. An MSI
installs the way users expect.

It also makes the **Pro-edition requirement enforceable**. An MSIX manifest can constrain the
OS *version* but not the *edition*, so under MSIX "Windows 10/11 Pro only" was advisory. A
WiX launch condition reads the real registry during installation and fails the install. The
rule itself is in `PlatformRequirementCheck` and is unit tested; the installer enumerates the
same editions, and `InstallerContractTests` fails the build if the two lists disagree.

## Signing

The installer is **unsigned** until a code-signing certificate exists. Nothing in this
repository can produce one, and a self-signed certificate produces an installer SmartScreen
actively warns about.

The pipeline (`.github/workflows/playground-desktop.yml`) has a signing job that runs when
`WINDOWS_SIGNING_PFX` is set. It is timestamped, so the signature outlives the
certificate's own validity — an installer without a timestamp stops verifying the day the
certificate expires, which for a desktop app can be years after first publication.

## Not built yet

Phase 1 is the scaffold. The sign-in and connect screen, the agent loop implementation, and
the Hyper-V sandbox are specified in the plan and are not written. The shell says so rather
than showing placeholders that look functional.