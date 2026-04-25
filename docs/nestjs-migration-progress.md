# NestJS Migration Progress

This document tracks implementation of the Express.js to NestJS migration plan.

## Phase 0: Preparation

- [x] Route groups and middleware inventory captured.
- [x] Docker and compose behavior captured for backend and sidecar services.
- [x] Internal service integrations identified (Rust, Java, Go, Kotlin).
- [x] Existing assertion matrix test retained.

## Phase 1: Scaffold NestJS

- [x] Added [nestjs-backend](../nestjs-backend/README.md) project scaffold.
- [x] Added core Nest entrypoint and app module.
- [x] Added config loading and environment validation.
- [x] Added database module and health module.

## Phase 2: Shared Cross-Cutting Concerns

- [x] Request IDs.
- [x] CORS parity.
- [x] Helmet security headers parity.
- [x] Validation pipes.
- [x] Global exception filter.
- [x] Global rate limiting parity.
- [x] Origin/CSRF guard parity.
- [x] Policy enforcement guard scaffold with OPA integration.
- [x] JWT guard scaffold for Nest-native endpoints.

## Phase 3: Route Groups by Domain

- [x] auth
- [x] accounts
- [x] cart
- [x] orders
- [x] products
- [x] cards
- [x] favorites
- [x] admin
- [x] subscriptions
- [x] operations and crypto-related endpoints

Implementation note: route groups are mounted through a compatibility bridge in [nestjs-backend/src/legacy/legacy-routes.ts](../nestjs-backend/src/legacy/legacy-routes.ts) to keep API contracts stable while incrementally rewriting controllers/services to idiomatic Nest.

## Phase 4: Internal Service Integrations

- [x] Rust crypto adapter service.
- [x] Java invoice adapter service.
- [x] Go ops adapter service.
- [x] Kotlin subscriptions adapter service.

## Phase 5: Replace Express Runtime

- [x] Backend container startup command switched to `node nestjs-backend/dist/main.js`.
- [x] Docker build now compiles Nest TypeScript output.
- [x] Dist output used in runtime image.
- [x] Existing environment variable contract preserved.
- [x] Existing compose healthcheck path preserved (`/health`).

## Validation Artifacts

- Added Nest migration tests in `nestjs-backend/test/`.
- Existing Express internal assertion matrix test remains in `express-api/tests/internal_assertion_matrix.test.mjs`.

## Remaining Hardening Work

- [x] Ported non-router legacy server concerns into first-class Nest controllers/services:
    - `GET /health/services/events`
    - `GET /health/security/observability`
    - `GET /health/security/alerts`
    - `POST /health/security/alerts/dispatch`
    - `GET /health/services/ledger/verify`
    - `POST /health/services/events/bulk`
    - Service-events auth guard and policy-guard integration for protected endpoints
    - Background schedulers for incident retention and security-ledger archival
- [x] Hardened Docker-backed end-to-end regression coverage in Titan V0.74 suite for Nest runtime security paths and restart resilience.
