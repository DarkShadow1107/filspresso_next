# Scripts Catalog

This folder contains automation scripts for data ingestion, security verification, secret bootstrap, and environment operations.

## 1. Security And Verification Scripts

- `verifyDeploySignaturePolicy.mjs`
- `verifyDockerfileBaseImages.mjs`
- `verifySignedHistory.mjs`
- `run_titan_v0_74_tests.ps1`
- `bootstrapSecretsFromEnv.mjs`
- `generateDevMtlsCerts.mjs`

These are used to validate Docker/runtime hardening and security policy invariants.

## 2. Script Matrix (What To Run And When)

| Script                            | Purpose                                                     | Typical Trigger                |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| `run_titan_v0_74_tests.ps1`       | End-to-end zero-trust verification suite (Docker mandatory) | before merge / release         |
| `verifyDeploySignaturePolicy.mjs` | Validate deploy admission policy assets                     | CI policy check                |
| `verifyDockerfileBaseImages.mjs`  | Verify Docker base-image pinning policy                     | Dockerfile updates             |
| `verifySignedHistory.mjs`         | Validate signed-history constraints                         | release/hardening checkpoints  |
| `bootstrapSecretsFromEnv.mjs`     | Generate runtime secret files from env                      | local secured compose setup    |
| `generateDevMtlsCerts.mjs`        | Generate local dev mTLS cert chain                          | service identity local testing |

## 3. Data And Content Scripts

- `extractCoffeeData.mjs`
- `extractMachinesData.mjs`
- `addCoffeeNotes.mjs`
- `import_molecules_to_db.py`

## 4. Utility Scripts

- `replace_sections.py`
- `remove_render_graph.py`
- `start_all.bat`

## 5. Execution Notes

Node scripts:

```bash
node scripts/verifyDeploySignaturePolicy.mjs
node scripts/verifyDockerfileBaseImages.mjs
```

PowerShell test suite:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -SkipSignedHistory
```

The Titan suite enforces Docker-backed checks for hardened compose runtime, cross-service health paths, protected security endpoints, ledger verification, and CSRF policy behavior. Docker checks are mandatory and cannot be skipped.
It does not build images or recreate containers; it starts existing services and validates restart resilience.

## 6. Recommended Workflow

1. bootstrap secrets for local hardened runs
2. run verification scripts
3. run integration test suite
4. apply compose changes only after checks pass

## 7. Safety Notes

- Treat scripts that touch secrets, migrations, or key material as sensitive operations.
- Run security scripts from repository root unless script-specific docs state otherwise.
- Prefer dry-run flags where available for incident and archival scripts.

## 8. Related Docs

- `docs/README.md`
- `security/README.md`
- root `README.md`
