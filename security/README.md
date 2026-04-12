# Security Assets And Enforcement Guide

This folder contains concrete security enforcement assets used by Docker runtime, Kubernetes admission, and OPA policy decisions.

## 1. Folder Inventory (Explicit)

1. `docker/seccomp-default.json`
- Default seccomp profile used by hardened service containers.
- Limits kernel syscall surface for compromise containment.

2. `kubernetes/policies/kyverno-verify-image-signatures.yaml`
- Admission policy template for image signature and provenance verification.
- Intended to block unsigned or unverifiable images in protected clusters.

3. `kubernetes/policies/kustomization.yaml`
- Kustomize entrypoint to apply the policy set consistently.

4. `opa/policies/filspresso-authz.rego`
- OPA Rego authorization rules consumed by backend policy checks.

## 2. Control Plane Mapping

| Control Plane | Asset Location | Enforcement Target | Verification Method |
| --- | --- | --- | --- |
| Runtime syscall restrictions | `security/docker/seccomp-default.json` | Container process isolation | `docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml config` |
| Deploy-time signature admission | `security/kubernetes/policies/kyverno-verify-image-signatures.yaml` | Cluster workload admission | `node scripts/verifyDeploySignaturePolicy.mjs` + Kyverno admission events |
| Request authorization policy | `security/opa/policies/filspresso-authz.rego` | Backend policy decision paths | `GET /health/services` and policy-gated endpoint behavior |

## 3. How These Assets Are Activated

1. Docker runtime hardening
- activate with `docker-compose.security.yml`
- seccomp profile referenced in hardened services
- no-new-privileges, read-only rootfs, tmpfs, capability drops

2. Kubernetes admission hardening
- apply Kyverno policy via `kubectl` or kustomize
- enforce in target namespaces used by Filspresso workloads

3. OPA policy plane
- OPA service loads policy bundle from `security/opa/policies`
- backend calls policy gate middleware for protected operations

## 4. Practical Validation Commands

1. Policy drift validation (repo-level):

```bash
node scripts/verifyDeploySignaturePolicy.mjs
```

2. Full hardened compose config validation:

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml config
```

3. Runtime and security endpoint checks:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -SkipSignedHistory
```

## 5. Security Documentation Bridge

Complementary operational guidance is consolidated in `docs/README.md` and covers:
- deploy signature policy details
- incident response flow
- key lifecycle automation path
- observability and alerting signals
- transparency anchoring behavior
- Titan V0.74 gap-closure backlog status

## 6. Rollout Boundaries

Implemented in repository:
- runtime hardening assets
- policy templates
- OPA policy source

Requires external platform rollout:
- Kyverno installed and enforced in live clusters
- immutable transparency backend provisioning
- managed KMS/HSM operational integration

## 7. Related Files

- `docker-compose.security.yml`
- `security.env.example`
- `docs/README.md`
- root `README.md`
