# Rust Crypto Service

Layer C cryptographic control-plane service for Titan V0.74 workflows.

## 1. Purpose

This service exposes deterministic commitment and verification operations to support secure inter-service flows.

Core responsibilities:

- generate SHA3-256 commitments from canonical payloads
- verify commitments deterministically
- enforce optional service assertion authentication and replay protection

## 2. Runtime

- Language: Rust (edition 2021)
- Framework: axum
- Default service port (compose): 8090

## 3. Endpoints

| Endpoint                  | Method | Purpose                                                  |
| ------------------------- | ------ | -------------------------------------------------------- |
| `/health`                 | GET    | Liveness and service identity                            |
| `/v1/commitment/sha3-256` | POST   | Compute deterministic commitment for domain and payload  |
| `/v1/verify/sha3-256`     | POST   | Verify provided commitment against canonicalized payload |

Request constraints:

- bounded body size via runtime config
- canonical payload handling
- operation-id alignment checks for assertion-protected flows

## 4. Security Model

Optional strict ingress controls are driven by env configuration:

- `SERVICE_ASSERTION_REQUIRED`
- `SERVICE_ASSERTION_PUBLIC_KEY` or `SERVICE_ASSERTION_PUBLIC_KEY_FILE`
- `SERVICE_ASSERTION_AUDIENCE`
- `SERVICE_ASSERTION_ISSUER_ALLOWLIST`
- `SERVICE_ASSERTION_SCOPE_COMMITMENT`
- `SERVICE_ASSERTION_SCOPE_VERIFY`
- `SERVICE_ASSERTION_ENFORCE_REPLAY`
- `SERVICE_ASSERTION_REPLAY_TTL_SECONDS`

## 5. Local Run

From repository root:

```bash
docker compose up --build rust_crypto
```

Or with Cargo:

```bash
cd rust-crypto-service
cargo run
```

## 6. Operational Validation

Health check:

```bash
curl -sS http://localhost:8090/health
```

Compose status:

```bash
docker compose ps rust_crypto
```

## 7. Related Documentation

- `rust-wasm/README.md`
- `docs/README.md`
- `security/README.md`
- root `README.md`
