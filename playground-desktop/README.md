# Filspresso Playground for Windows

**Beta-6:** local project review/explorer/text artifacts work without a VM; desktop code
execution is release-blocked pending guest containment/job/crash implementation and real
qualification. See [`../docs/playground-beta6-qualification.md`](../docs/playground-beta6-qualification.md).
Use `scripts/Test-PlaygroundReadiness.ps1` for read-only single-device diagnostics.

The native WinUI 3 client for the Spectre Playground. Models run through the metered
desktop gateway; credentials remain in Windows Credential Manager.

## Interface

The desktop uses the same Filspresso charcoal, cream and copper palette and bundled
Poppins font as the web Playground:

- Compact sidebar, centered welcome, rounded composer and inline model picker.
- New conversations, session history/search, copy, edit, regenerate and stop actions.
- Conversations saved on the server appear under **Saved on the server** and resume with
  their preferences and last compaction checkpoint; forgetting one also purges its
  recorded history. Transcripts stay on this PC.
  Resuming first loads the selected conversation's details, restores model/context/compaction
  preferences without replacing display settings, and leaves your current conversation
  untouched if loading fails. With no saved checkpoint, only preferences are restored.
  Source references are not source files; attach the files again if needed.
- Native text/code rendering, a reasoning expander, and actual token/time/cost statistics.
- **API Prices** is a separate view, with account-specific allowance/wallet availability.
- **Recorded activity** lists the latest 20 account-owned runs, optionally filtered to
  the current saved conversation. It displays 100 inert events per page with completion,
  settlement and truncation evidence. Refresh reads the latest retained records; it never
  re-runs a command or reuses a recorded approval. Missing completion means **No completion
  recorded**, not "still running". First generations and hosted workspace actions may be
  unlinked to a conversation and are discoverable in the account-wide view.
- **Agent proposal review** requests one explicitly billed native model turn after an
  explicit availability check. Plan offers read proposals; Build adds write/command
  proposals. Exact arguments, untrusted answer text and run/usage/settlement receipts are
  inert. **Execution approval unavailable** is always disabled; nothing runs or reads files.
  Review follows Chat's model/context without forwarding history or attachments. Leaving
  review or changing the conversation/model/context/account clears it and cancels pending
  work. Entry is refused during Chat generation. Cancellation may still consume billed tokens.
- **Settings** includes General, Display and Import/Export. Input-context levels are 16K,
  32K, 64K and 128K; this limit includes the prompt, history and attached sources.
- Automatic compaction offers Permissive (80%), Balanced (65%, default) and Aggressive
  (45%). The last exact context measurement and an inspectable compaction summary appear
  below the composer. Original messages remain available; summary inference is metered.
  **Compact next send** queues a safe-boundary compaction, not a hidden generation now.
- The composer’s **plus** opens a grouped import menu: Media (images, videos, audio),
  Documents (PDF, Word, presentations, Excel/spreadsheets), and Files & projects (other files).
  Choosing a category opens a filtered file picker. GitHub beside it attaches a public repository snapshot.
- Video imports suggest a Vision-Language model if one is not already selected; audio imports
  suggest the Audio model. Accepting the suggestion switches the conversation model. All nine
  models are selectable; suggestions leave the choice with the user.
- Every application glyph is rendered from the TSX library in `src/icons`. The EXE,
  taskbar, shortcuts, installer and uninstaller carry the Filspresso monogram icon.
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
Windows SDK, Node.js with the root project's npm dependencies, plus WiX 5.0.2 with the UI and Util extensions.

```powershell
dotnet tool install --global wix --version 5.0.2
wix extension add --global WixToolset.UI.wixext/5.0.2 WixToolset.Util.wixext/5.0.2
npm ci

./playground-desktop/build/Build-Desktop.ps1
```

The script runs the .NET and native cleanup tests, publishes the self-contained WinUI
app, verifies that its generated PRI/XBF resources are present, builds the native
uninstaller and branded MSI, then atomically replaces:

`playground-desktop/artifacts/Filspresso.Playground.msi`

That is the file served by **Download Desktop App** on the web Playground.

### Sources and input limits

Uploads are limited to 20 MB each and 8 sources per prompt. PDFs and modern Office/
OpenDocument files are converted to text; scanned PDFs and images use the hosted Vision
model. Audio is transcribed with the Audio model. Video uses 3 sampled frames and its
audio track; media processing includes the first 2 minutes. Source details report any
page, text or snapshot limits instead of silently omitting them. Media analysis is metered
at the corresponding API model prices.

The input dropdown opens directly in the composer. The server measures the complete
templated input using the selected model's tokenizer and refuses over-budget input before
generation. It does not set `max_tokens`, which is the separate output budget. The UI
does not display GGUF quantization identifiers.

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
the chat/review interfaces do not enable unfinished agent-execution controls.

The `Filspresso.Harness` library now contains a tested bounded loop and strict tool
schemas. Chat/Plan/Build policy, fresh per-action approval, complete tool/result groups,
limits and cancellation are enforced in the library; model capability and consent default
to denied. `NativeAgentTransport` now supplies authenticated, bounded model turns through
the default-disabled native API, with capability discovery and server billing on every
follow-up. The UI composes it only with `NativeProposalReview`, **not the bounded loop or
Hyper-V**. Single-flight review checks and turns have eight/130-second bounds, immutable
receipts and cancellation/stale-response guards. Publish checks include `AgentReviewPage.xbf`.
Native transport/review tests use mocked HTTP/coordinators; no live model/runtime has been
qualified or enabled. The transport now forwards the three-level compaction preference and
validates paired-history compaction receipts; summary usage is included in the turn's token
budget and billed separately by the server. No executable desktop UI/guest adapter is connected.
The web's separately gated signed-action executor does not change this desktop boundary.
See `../docs/playground-native-agent.md` for the API boundary.
`AgentConsentQueue` now provides a tested one-shot local consent rendezvous for future UI
composition: exact action/workspace, matching-ID decisions, stale/replay rejection, and denial
on dismissal/cancellation/disposal. It does not execute tools or grant reusable approval;
proposal-review execution controls remain disabled.
Shared workspace-path checks fix lexical sibling-prefix/device/stream escapes; they do
not prove race-proof file containment. The Hyper-V library now uses explicit guest
credentials through private stdin, a guest readiness handshake, bounded output/files,
measured timing and independent VM/disk teardown after interrupted execution. Failed
cleanup remains visible and retryable. A qualified Windows VHDX and production credential
provider are still required; the app does not auto-provision an image or elevate itself.
Real VM execution, descendant job control and handle-based containment remain unverified.
See `src/Filspresso.Sandbox/README.md` and `DONE.md` for guards and limitations.

## Signing

Signing is intentionally deferred. The local MSI remains unsigned; this is expected
and does not block enhancement builds. No certificate setup is required for now.
The Windows workflow builds the same package, including its uninstaller and resources.
Enable its optional signing job with repository variable `WINDOWS_SIGNING_ENABLED=true`
and secrets `WINDOWS_SIGNING_PFX` and `WINDOWS_SIGNING_PFX_PASSWORD`.
