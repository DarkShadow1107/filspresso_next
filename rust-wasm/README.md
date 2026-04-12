# Titan Rust-WASM Helpers

This module provides client-side cryptographic helpers for Titan V0.74 workflows.

## 1. Purpose

The crate supplies deterministic browser-side primitives used before server verification:

- SHA3-256 commitments with explicit domain separation
- canonical JSON witness pre-processing

## 2. Build

Install `wasm-pack` and run:

```bash
cd rust-wasm
wasm-pack build --target web
```

## 3. Exported Functions

- `sha3_256_commitment(domain, payload)`
- `preprocess_witness(jsonPayload)`
- `preprocess_witness_and_commit(domain, jsonPayload)`

## 4. Design Constraints

- deterministic behavior is mandatory
- output format must stay stable across builds
- helper outputs should be reproducible by backend verification services

## 5. Integration Notes

- pair browser commitments with backend verification in `rust-crypto-service`
- keep domain labels stable and versioned
- avoid embedding secrets in client-side workflows

## 6. Browser Integration Example

```javascript
import init, { preprocess_witness_and_commit } from "./pkg/filspresso_titan_wasm.js";

await init();
const result = preprocess_witness_and_commit("checkout:proof:v1", JSON.stringify({ orderId: "abc-123" }));
console.log(result);
```

Use stable domain labels and deterministic payload structure for reproducible verification.

## 7. Related Documentation

- `rust-crypto-service/README.md`
- `docs/README.md`
- `security/README.md`
- root `README.md`
