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
  server at a temporary loopback port and the deployed Compose route through Caddy, at
  **1440×900, 390×844 and 1024×600**. They cover one page scroller after a long response,
  navbar/menu bounds, Escape/focus restoration, compaction selection, dialog/recheck, mobile
  width and no automatic sandbox creation.
  Account/model/API responses in these UI checks are **fixtures**, not live qualification.
- Against the actual running backend, the new production Next routes each returned anonymous
  **401** rather than **404**. A real authorized acknowledgement/download/device-list flow
  was not attempted; no account credentials or paid inference were used.
- After deployment, Caddy-served `/?page=playground` returned **200**. Both new proxies returned
  **401 private, no-store** without credentials, confirming routing/authentication gates rather
  than 404s. Authenticated behavior remains covered by the request-proxy tests; it was not
  live-tested without an authorized account.
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

## Commit, CI and Compose deployment

- Application commit `7e0fa48d9fa51522f985dc95196178cb30c8308b` was pushed normally to
  `Beta-8-Production`; no force push or history rewrite was used.
- The pushed GitHub Security CI run is **failed**. Frontend lint/build passed. The enforced
  signed-history job, high/critical filesystem scan, frontend high+ dependency audit, backend
  regression job and root Python dependency audit failed. Those same security gates also
  failed on the previous base commit `9bcde92`; the unsigned commit is also rejected by the
  signed-history policy. This rollout is not a claim of green CI or production qualification.
- Local Compose deployment ran `docker compose build frontend` followed by
  `docker compose up -d --no-deps --force-recreate frontend`. The deployed frontend image is
  `sha256:2c47de3e34be05e7b7d9653043d68df348ed2fe4334642b1fc2e0959b8225ad8`; its container is
  healthy with zero restarts. Caddy remained healthy and was not recreated. The backend
  remained healthy on its existing `sha256:fe1c3bd58108f74dd1caac93db59095e8f263458b520bd354883c19a114f5f29` image and was not rebuilt or restarted.
- The prior frontend image is retained as
  `filspresso_next-frontend:rollback-20261028-7e0fa48`. The installer index/package and
  account credentials were not changed. This records the Compose host rollout only; it does
  not assert deployment to any separate public infrastructure.
- The temporary validation server was stopped after testing.

## Repeat the browser checks

```powershell
node tests/browser/Build-PlaygroundRefinementFixture.cjs
python tests/browser/playground-refinements.py
```

To test a running Next build with the real navbar and CSS, set
`PLAYGROUND_BROWSER_URL=http://127.0.0.1:<port>/?page=playground` before running the Python
script. For a local HTTPS Caddy route, also set `PLAYGROUND_IGNORE_HTTPS_ERRORS=true`. Browser
API requests are still mocked so the test cannot start live model work.
