# Playground refinements — 2026-10-28

## Changes

- The web Playground uses document scrolling for chat, activity, settings and manual
  execution. Outputs wrap and expand instead of introducing extra vertical scrollers.
  Editors, popovers and the modal dialog retain their necessary local scrolling.
- The rail stays beside the document; navbar clearance uses the measured navbar bottom.
  The navbar is opaque on the Playground. Attachment/model/compaction popovers are portaled,
  compact, keyboard navigable, and fitted to the space below the navbar.
- The manual workspace is optional and quieter. Requirements are disclosed on demand;
  an empty console is not shown before a sandbox exists. Chat never starts execution.
- The Windows download dialog has a compact fact summary, a bounded browser recheck using
  architecture/bitness/platformVersion hints, expandable requirements/checksum and explicit
  unsigned/unqualified warnings. OS family is a browser report, **not** a verified build,
  edition, virtualization or Sandbox result. Real native checks remain in the installed app.
- Added the missing Next.js proxies for `POST /api/desktop/installer/ack` and
  `GET /api/desktop/installations`. They forward authentication and CSRF headers and return
  private/no-store responses. Acknowledgement mutations are not retried after failure.
- Desktop has visible Chat / Plan / Build entry points, a cleaner composer, compact
  icon-bearing import items, a smaller model picker and quieter shared controls.
- Desktop agent setup, project changes and long explanations are progressively disclosed.
  The setup panel reports the PC's registry-read edition/build/revision and architecture,
  while keeping safety verification separate. Plan remains read-only; Build still requires
  an explicitly started isolated workspace and fresh approval for writes/commands.
  Changing mode after a completed turn requires a new conversation and retains the project.
- The old proposal-only page is now **Proposal preview**, under Safety & advanced, not a
  misleading primary agent entry point. It remains inert, metered and executor-free.

## Verification

- Production `npm run build`: passed; both new desktop routes appear in the build output.
- All web-client tests: **114/114 passed**, including OS-family hint and real proxy-function
  tests for session-cookie filtering, request body/CSRF forwarding, refusal propagation,
  private cache headers and no acknowledgement retry after an ambiguous failure.
- Targeted ESLint for Playground components, compatibility helper and desktop routes: passed.
  The full lint command exceeded its 120-second invocation timeout; no full-lint pass is claimed.
- Mounted Chromium checks passed against both an isolated fixture and the production Next
  server at a temporary loopback port, at **1440×900, 390×844 and 1024×600**. They cover
  one page scroller after a long response, navbar/menu bounds, Escape/focus restoration,
  compaction selection, dialog/recheck, mobile width and no automatic sandbox creation.
  Account/model/API responses in these UI checks are **fixtures**, not live qualification.
- Against the actual running backend, the new production Next routes each returned anonymous
  **401** rather than **404**. A real authorized acknowledgement/download/device-list flow
  was not attempted; no account credentials or paid inference were used.
- WinUI Release/x64 MSBuild and MSI packaging: passed.
- Desktop suite: **482/483 passed** after adding two UI contract tests. The untouched
  `HyperVSandboxLifecycleTests.FileWritesAreBoundedPrivatePayloadsWithGuestReparseChecks`
  fails its `call.Input.Length < PowerShellRunner.MaxInputCharacters` assertion at line 383;
  it also fails in isolation. No sandbox transport, limits or test were weakened to hide it.

## MSI candidate — not published or qualified

`playground-desktop/artifacts/candidate-0.3.4-refinements-20261028/Filspresso.Playground.msi`

- Product version: **0.3.4**
- Size: **81,019,348 bytes**
- SHA-256: `f6d648bfced71ae10e2ed6ea8af24be149ece47911a58cb83e0b5c6f851b20a3`
- Signature: **NotSigned**; manifest: **installQualified: false**
- Independent byte-count/hash checks match the manifest.
- Packaging used `-SkipTests` after the explicit suite run above; it is not an all-tests-pass
  claim. Install, upgrade, uninstall, native visual interaction and live isolation/model
  qualification were not performed. No release approval is implied.

These source changes have not been committed, pushed, deployed to Compose or promoted into
the installer index. Existing backend/frontend containers, account credentials and published
installer remain unchanged. The temporary validation server is stopped after testing.

## Repeat the browser checks

```powershell
node tests/browser/Build-PlaygroundRefinementFixture.cjs
python tests/browser/playground-refinements.py
```

To test a running Next build with the real navbar and CSS, set
`PLAYGROUND_BROWSER_URL=http://127.0.0.1:<port>/?page=playground` before running the Python
script. Browser API requests are still mocked so the test cannot start live model work.
