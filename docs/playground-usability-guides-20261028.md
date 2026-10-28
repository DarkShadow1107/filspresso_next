# Playground modes, guides and desktop update discovery — 2026-10-28

## User-facing changes

- Web Chat now has a **Chat / Plan / Build** picker. The agent and advanced manual
  workspace use compact Plan/Build pickers, not wide native selects. Input context,
  compaction and model pickers have no decorative arrows and use rounder menus.
- The navigation toggle expands **tab names only** in both clients. Conversations remains
  a separate action; proposal-only preview is no longer a primary web navigation item.
- Plan/Build, Activity and installer guidance use shorter summaries, clearer hierarchy and
  expandable technical details. Proposal preview is kept as an advanced diagnostic: it is
  useful for inspecting a single model turn, not as another executor or everyday workspace.
- Both clients have an **Instructions** icon with separate, version-specific guides. Help is
  an overlay, so opening/closing it does not navigate away from or discard the agent workspace.
  Explicitly choosing another advanced tool still leaves that view and discards it.
- Web guidance explains hosted files, browser-only limitations and retained checkpoints;
  desktop guidance explains local staged files, Windows Sandbox/native isolation, approvals,
  system facts and update discovery. Neither starts models, enables Windows features or grants
  execution consent when opened.
- The website cannot read Windows Home/Pro/Enterprise. The download dialog says this plainly;
  **Desktop Instructions → System & updates** reads edition/build/revision directly from this
  PC's registry. Isolation verification remains separate and required.
- Shared desktop glyphs are rasterized from the same TSX designs to 3× PNG assets, resolved
  from the unpackaged app directory instead of relying on `ms-appx` SVG loading. Native
  menus retain keyboard support and rounded presentation. Packaging checks all 29 PNG assets
  (27 glyphs plus dark send/stop variants) against their generated hashes.

## Why update notices were missing or misleading

1. The old notice was rendered only in the agent workspace, not the app shell.
2. Its one-time request ran after device check-in, so check-in failure/timeout could suppress it.
3. A built candidate does not become an update release until deliberately published. This
   change does **not** publish an MSI or change the backend's current installer index.
4. Package inspection found another bug: changing the MSI's `ProductVersion` did not change
   the app assembly's hard-coded default `0.3.0`. Version comparison could therefore use the
   wrong installed version. `Build-Desktop.ps1` now stamps the app/qualifier/dependencies with
   the requested version and refuses a mismatched app assembly before packaging.

Update discovery is now independent, single-flight, bounded to eight seconds and throttled on
startup/window activation. The global shell can show a newer published build on every page;
**Instructions → Check for updates** forces a manual retry. It displays installed/published
versions or a retryable failure, not a false "up to date" claim. Sign-out clears notices and
late replies cannot repopulate account-scoped state. Nothing downloads, elevates or restarts
automatically. Download permission is still enforced by the server/account page.

## Verification and limits

- Next production build passed; targeted ESLint passed.
- **117/117 web-client tests passed** (help/picker contracts, idle cleanup and existing
  consent/agent/transport tests included).
- Chromium checks passed against the isolated fixture and the production Next server at a
  temporary loopback port at 1440×900, 390×844 and 1024×600. They cover label-only navigation,
  mode/context selection, arrow-free menus, navbar bounds, modal focus/close, help preserving
  the agent view, Activity empty state and the installer dialog. All browser API/model replies
  were fixtures; no paid inference or live execution was used.
- The mounted agent fixture passed clarification/fresh approval, inert preview, project/import,
  artifact hashing, mode reset and account-change cleanup checks.
- WinUI Release/x64 and MSI packaging passed. The published app payload was launched with a
  fresh test credential/profile namespace. UI Automation opened desktop Instructions while
  signed out and confirmed native edition/build text and the disabled signed-out update check.
  The help glyph was visible. This is not full signed-in native UI or live update qualification.
- Desktop tests: **493/494 passed**. Eight new update-checker cases and the UI/package
  contracts passed. The pre-existing
  `HyperVSandboxLifecycleTests.FileWritesAreBoundedPrivatePayloadsWithGuestReparseChecks`
  still fails its payload-length assertion at line 383. No sandbox limit/test was weakened.
- Help, labels and modes do not bypass model/executor availability. The hosted deployment's
  disabled execution state remains disabled. A Plan picker is not permission to run code.

## MSI 0.3.5 candidate — unsigned, unqualified, not published

`playground-desktop/artifacts/candidate-0.3.5-guides-20261028/Filspresso.Playground.msi`

- Size: **81,048,392 bytes**
- SHA-256: `bd798887af977f1a74ed08dce479d5a748f98abe6bd4a5255e2fe01cb75de6be`
- Signature: **NotSigned**; manifest: **installQualified: false**
- App, Core, Harness and Sandbox assembly versions independently checked: **0.3.5**.
- Hash/size match the manifest. All 29 PNGs are in the published payload; packaging checks
  their hashes and the compiled Instructions XBF before creating the MSI.
- Built with `-SkipTests` after the explicit suite run above. Install/upgrade/uninstall,
  signing, live model billing and native isolation remain unqualified; no release approval
  or production readiness is claimed. An unpackaged payload launch is not an MSI install test.

These changes are local and **not committed, pushed or deployed**. No existing installed app,
published installer, account credentials, backend flags or Compose containers were replaced.
The temporary Next test server was stopped; smoke-test credentials use a unique namespace and
its device-id credential is removed by the smoke script.

## Repeat checks

```powershell
node tests/browser/Build-PlaygroundRefinementFixture.cjs
python tests/browser/playground-refinements.py
node playground-sandbox/Build-AgentBrowserFixture.cjs
python tests/browser/playground-agent-workspace.py
powershell.exe -NoProfile -File playground-desktop/tests/Smoke-DesktopInstructions.ps1 `
  -AppPath playground-desktop/artifacts/candidate-0.3.5-guides-20261028/publish-next/Filspresso.Playground.exe
```

Set `PLAYGROUND_BROWSER_URL` to a temporary production Next server to test its real navbar/CSS;
API replies stay mocked. Do not promote this candidate merely to make an update notice appear.
