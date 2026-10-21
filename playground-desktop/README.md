# Filspresso Playground for Windows

The native WinUI 3 client for the Spectre Playground. Models run through the metered
desktop gateway; credentials remain in Windows Credential Manager.

## Interface

The desktop uses the same Filspresso charcoal, cream and copper palette and bundled
Poppins font as the web Playground:

- Compact sidebar, centered welcome, rounded composer and inline model picker.
- New conversations, session history/search, copy, edit, regenerate and stop actions.
- Native text/code rendering, a reasoning expander, and actual token/time/cost statistics.
- **API Prices** is a separate view, with account-specific allowance/wallet availability.
- **Settings** includes General, Display and Import/Export. Output levels are 16K, 32K,
  64K and 128K; the model context is 128K.
- Sign-in/MFA and account views use the same theme. Balance and access refusals remain
  distinct from model/network failures.

## Installation and removal

Run `Filspresso.Playground.msi`. The location page chooses a **parent directory**;
Setup always creates its own `Filspresso Playground` subfolder there. The default is
`C:\Program Files\Filspresso Playground`. The parent is remembered for upgrades.

The installation folder contains **`Uninstall.exe`**, also available as a Start-menu
shortcut. It starts Windows Installer's registered removal flow. Windows Settings >
Apps uses the same removal sequence.

On full uninstall, before the cleanup executable is removed, the MSI:

- closes the app;
- removes this Windows user's `Filspresso.Playground/session` and
  `Filspresso.Playground/device-id` credentials;
- removes the app-owned `Filspresso\Playground` directories under Local and Roaming
  AppData, including preferences and diagnostic logs;
- removes installed files, shortcuts and installer registry entries.

Cleanup runs under the uninstalling user's identity. It does not traverse junctions
or symbolic links into neighboring folders. Major upgrades skip user-data cleanup,
so an update preserves settings and the saved sign-in. Conversations stay in memory
unless explicitly exported to a location chosen by the user.

## Build

Requirements: Windows, .NET 9, Visual Studio 2022 MSBuild with the x64 C++ tools and
Windows SDK, plus WiX 5.0.2 with the UI and Util extensions.

```powershell
dotnet tool install --global wix --version 5.0.2
wix extension add --global WixToolset.UI.wixext/5.0.2 WixToolset.Util.wixext/5.0.2

./playground-desktop/build/Build-Desktop.ps1
```

The script runs the .NET and native cleanup tests, publishes the self-contained WinUI
app, verifies that its generated PRI/XBF resources are present, builds the native
uninstaller and branded MSI, then atomically replaces:

`playground-desktop/artifacts/Filspresso.Playground.msi`

That is the file served by **Download Desktop App** on the web Playground.

For library-only tests:

```powershell
dotnet test playground-desktop/Filspresso.Desktop.sln -c Release -p:PlatformTarget=x64
```

WinUI publishing requires Visual Studio MSBuild, not the .NET CLI's MSBuild. The
`Build-Desktop.ps1` entry point locates the appropriate toolset automatically.

## Configuration and storage

| Setting | Purpose |
| --- | --- |
| `FILSPRESSO_BACKEND_URL` | Desktop API origin; defaults to `http://localhost:4000/`. |
| `FILSPRESSO_WEB_URL` | Web account/subscription links; defaults to `https://localhost:8443/`. |
| `FILSPRESSO_PROFILE_DIR` | Optional isolated preference/log directory for testing. |
| `FILSPRESSO_CREDENTIAL_PREFIX` | Optional isolated Credential Manager prefix for testing. |

Normal preferences are stored in
`%LOCALAPPDATA%\Filspresso\Playground\preferences.json`. Access/refresh tokens and the
device identity are not stored in that JSON file.

The installer and app retain the Windows 10/11 Pro-or-equivalent Hyper-V edition
requirement. The sandbox implementation and host-side web tools are separate libraries;
the chat interface does not present unfinished agent-execution controls.

## Signing

The local MSI is unsigned until a purchased code-signing certificate is configured.
The Windows workflow builds the same package, including its uninstaller and resources.
Enable its optional signing job with repository variable `WINDOWS_SIGNING_ENABLED=true`
and secrets `WINDOWS_SIGNING_PFX` and `WINDOWS_SIGNING_PFX_PASSWORD`.
