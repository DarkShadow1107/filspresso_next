# One Playground conversation and MSI publication — 2026-10-28

## Requested UI

- Web and Windows now choose **Chat / Plan / Build in the same composer**. The mode picker
  keeps the textarea, draft and visible transcript. The separate primary Plan/Build navigation
  item and page are gone. Windows reuses its agent controller as an inline workspace/approval
  surface, not another conversation page; the old standalone web harness remains only as a
  test fixture, not a production navigation destination.
- Chat has no tools. Plan offers reads/clarification, never writes or commands. Build still
  requires an explicitly started isolated workspace and fresh exact-action approval. Choosing
  a mode never starts a sandbox, performs inference or grants execution permission.
- Setup/project details live behind **Workspace** above the composer. Windows uses an optional
  dialog, with isolation verification and project import/export still available. Starting a
  workspace does not silently promote Plan to Build. Thinking uses the same actual brain
  design in both clients and has a hover tooltip. Agent-model thinking is not falsely presented
  as a working chat-thinking toggle.
- The Windows download dialog is shorter: a small device summary, collapsed detailed
  requirements/checksum, concise unsigned warning, acknowledgement, and sticky download
  actions. Browser hints never claim to verify edition, build or isolation.

## Context and permission boundaries

The shared transcript is bridged into native requests as ordinary completed message pairs.
Previous model/tool text is data, never a system instruction, executable call or restored
approval. Within an individual agent run the existing complete tool-call/result protocol and
fresh consent are unchanged. Chat receives text history and cannot execute it. The native
bridge is idle-only, rejects executable tool history and refuses active/failed/oversized
contexts. It does not reset the desktop spend gate. No silent trimming is used to fit the
agent's 16-turn/character bounds. Saved Chat checkpoints are not silently imported into the
agent's visible-thread bridge. Model/context changes or a new conversation discard the
associated workspace; switching only Chat/Plan/Build retains it without granting tools in Chat.

## Validation

- Next production build and targeted ESLint passed.
- Web-client tests: **121/121** passed, including inert transcript context, overflow refusal,
  narrowed Plan tools, no inherited Build consent, and pending-action protection.
- Chromium mounted production-component fixture passed desktop/mobile/short-height layout,
  same-node textarea/draft preservation, transcript preservation, brain tooltip, compact
  download dialog, and a complete mocked **Chat → Plan → Build** flow. It verifies earlier
  Chat/Plan messages reach subsequent native requests, Plan offers read-only/interaction tools,
  and Build does not execute before a decision. The test explicitly denies the command and
  verifies the negative decision. All model/action/billing replies are fixtures, not live work.
- Existing mounted agent harness passed questions, fresh approvals, project exploration,
  per-file import consent, inert preview, artifact hashing and account-change cleanup.
- Desktop tests: **495/496** passed. The pre-existing
  `HyperVSandboxLifecycleTests.FileWritesAreBoundedPrivatePayloadsWithGuestReparseChecks`
  still fails its payload-length assertion at line 383. No limit/test was weakened.
- WinUI Release/x64 builds passed. Native automated mode interaction is **not qualified**:
  the new manual smoke/reproduction harness encountered intermittent native process exit
  `0xc0000374` during startup/accessibility interaction. This was also reproduced against
  the previous 0.3.5 candidate; its cause has not been established. A successful signed-out
  Instructions smoke is not a substitute for signed-in mode or MSI lifecycle qualification.

## Publication scope

The user explicitly requested publication of the new MSI after being told earlier candidates
were unsigned and unqualified. The refreshed package will use **0.3.6**, rather than publishing
0.3.5 as though it contained the newer unified-composer changes. Publication must retain
`signature: NotSigned` and `installQualified: false`. It is a preview publication, not signing,
release approval or a claim of install/upgrade/uninstall, live isolation or live billing
qualification. Existing signed-history/security CI failures remain separate blockers.

Frontend rollout, exact package hash, published metadata and post-rollout results will be
recorded below after verification. The backend need not be rebuilt or restarted: it reads
the versioned installer directory through its existing read-only mount.

## Repeat checks

```powershell
node tests/browser/Build-PlaygroundRefinementFixture.cjs
python tests/browser/playground-refinements.py
node playground-sandbox/Build-AgentBrowserFixture.cjs
python tests/browser/playground-agent-workspace.py
```

The experimental `python tests/browser/desktop-unified-modes.py` reproduces the native smoke
attempt using a loopback fake backend and a unique test credential/profile namespace. It is
not currently a passing qualification gate and never uses a real account. Temporary fixture
credentials are deleted on exit. No production authentication, model or execution gates are
bypassed by these tests.
