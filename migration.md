# Express.js to NestJS Migration Plan

## Goal
Migrate the current Express-based backend into a NestJS backend to improve structure, maintainability, scalability, and long-term enterprise readiness while preserving the existing service split across Rust, Java, Go, and Kotlin.

## Why This Migration Makes Sense
The repository is already organized as a polyglot enterprise-style monorepo:

- Express currently acts as the orchestration core for auth, accounts, cart, orders, products, admin, and internal security/control-plane flows.
- Rust handles crypto/security-sensitive operations.
- Java handles invoice PDF generation.
- Kotlin handles subscription pricing and reconciliation.
- Go handles operational event ingestion and lightweight ops services.

That means the backend is already split by service responsibility, and NestJS is a strong fit for formalizing the Node.js backend into a more maintainable, modular structure.

## Migration Strategy
Use an incremental migration rather than a big-bang rewrite.

### Phase 0: Preparation
- Freeze the current Express backend behavior.
- Document all existing route groups and middleware.
- Capture current Docker and compose behavior.
- Identify all internal service integrations.
- Add or confirm regression tests for:
  - health endpoints
  - auth/session flows
  - cart/order flows
  - security/policy checks
  - service-to-service requests

### Phase 1: Scaffold NestJS
Create a NestJS backend scaffold in the repository and establish the base application structure:
- configuration
- logging
- validation
- health checks
- security middleware equivalents
- database access layer

### Phase 2: Move Shared Cross-Cutting Concerns
Migrate these first:
- environment config loading
- request IDs
- CORS
- Helmet/security headers
- validation pipes
- global exception filters
- rate limiting
- auth guards
- policy enforcement integration

### Phase 3: Migrate Route Groups by Domain
Move route groups one at a time while keeping API contracts stable:
- [x] auth
- [x] accounts
- [x] cart
- [x] orders
- [x] products
- [x] cards
- [x] favorites
- [x] admin (secure bridge setup)
- [x] subscriptions
- [x] operations and crypto-related endpoints
- [x] chat, weather, repairs, kafelot (auxiliary)

### Phase 4: Migrate Internal Service Integrations
Wrap external service calls behind NestJS providers/adapters:
- [x] Rust crypto service (bridged)
- [x] Java invoice service (native proxy via orders)
- [x] Go ops service (native proxy)
- [x] Kotlin subscriptions service (native module `subscriptions-engine`)

### Phase 5: Replace the Express Runtime
After all major routes and integrations are migrated:
- [x] remove Express-specific startup wiring from the active backend runtime
- [x] switch the backend Docker image to NestJS build/start commands
- [x] update compose health checks if needed
- [x] verify all service dependencies still resolve correctly
- [x] keep any remaining Express code as non-runtime reference only until manual deletion

## Proposed NestJS Folder Structure

```text
nestjs-backend/
├─ src/
│  ├─ main.ts
│  ├─ app.module.ts
│  ├─ app.controller.ts
│  ├─ app.service.ts
│  ├─ config/
│  │  ├─ configuration.ts
│  │  ├─ env.validation.ts
│  │  └─ constants.ts
│  ├─ common/
│  │  ├─ decorators/
│  │  ├─ filters/
│  │  ├─ guards/
│  │  ├─ interceptors/
│  │  ├─ middleware/
│  │  ├─ pipes/
│  │  └─ utils/
│  ├─ database/
│  │  ├─ database.module.ts
│  │  ├─ database.service.ts
│  │  └─ repositories/
│  ├─ health/
│  │  ├─ health.module.ts
│  │  ├─ health.controller.ts
│  │  └─ health.service.ts
│  ├─ auth/
│  │  ├─ auth.module.ts
│  │  ├─ auth.controller.ts
│  │  ├─ auth.service.ts
│  │  ├─ dto/
│  │  ├─ guards/
│  │  ├─ strategies/
│  │  └─ interfaces/
│  ├─ accounts/
│  ├─ cards/
│  ├─ cart/
│  ├─ orders/
│  ├─ products/
│  ├─ favorites/
│  ├─ admin/
│  ├─ subscriptions/
│  ├─ operations/
│  ├─ crypto/
│  ├─ integrations/
│  │  ├─ rust-crypto/
│  │  ├─ java-invoice/
│  │  ├─ go-ops/
│  │  └─ kotlin-subscriptions/
│  └─ security/
│     ├─ security.module.ts
│     ├─ policy/
│     ├─ assertions/
│     └─ csrf/
├─ test/
├─ Dockerfile
├─ package.json
├─ tsconfig.json
├─ nest-cli.json
└─ .env.example
```

## Module Mapping

### Core application modules
- auth
- accounts
- cards
- cart
- orders
- products
- favorites
- admin

### Support modules
- health
- database
- config
- common

### Security and orchestration modules
- security
- operations
- crypto
- integrations

### External service adapters
- integrations/rust-crypto
- integrations/java-invoice
- integrations/go-ops
- integrations/kotlin-subscriptions

## Docker Migration Checklist
- Replace the Express startup command with the NestJS production entry point.
- Ensure TypeScript compilation occurs during the image build.
- Add or confirm a build step that outputs `dist/`.
- Update the production container to run `node dist/main.js`.
- Keep environment variable support unchanged unless NestJS config requires renaming.
- Update health checks to target the NestJS health endpoint.
- Verify file mounts for public images still work.
- Confirm internal service URLs remain unchanged.
- Validate that the container still runs as a non-root user in production.

## Application Migration Checklist
- [x] Preserve all current API contracts where possible.
- [x] Keep `/health` and `/health/services` available.
- [x] Preserve JWT/session behavior.
- [x] Preserve OPA policy checks.
- [x] Preserve service assertion verification.
- [x] Preserve CSRF/origin checks.
- [x] Preserve rate limiting behavior.
- [x] Confirm service-to-service calls still work after the refactor.
- [x] Run full regression tests after each major migration phase.
- [x] Ensure CI and security checks target the NestJS backend as the active runtime.

## TypeScript Upgrade Checklist
If TypeScript is upgraded during the migration:
- [x] Prefer a stable TypeScript release.
- [x] Verify compatibility with Next.js, NestJS, ESLint, and Docker builds.
- [x] Update `tsconfig.json` for NestJS requirements if necessary.
- [x] Verify decorator metadata and module resolution settings.
- [x] Run full type checks before merging.

## NestJS Devtools and Paid Tooling
NestJS Devtools can help with visualizing module relationships and dependency graphs, but they are optional.

### Use them if:
- you want architectural visibility
- the backend grows large
- the team needs better module navigation

### Do not depend on them if:
- the migration must work without paid tooling
- you want to keep the core stack self-contained
- budget or licensing is a concern

The migration should succeed without Devtools; they are a productivity enhancement, not a requirement.

## Recommended Order of Work
1. Add NestJS scaffold.
2. Move shared middleware and config.
3. Migrate health and simple routes.
4. Migrate auth and account flows.
5. Migrate cart, orders, products, and favorites.
6. Migrate admin and internal service orchestration.
7. Wrap Rust, Java, Go, and Kotlin integrations.
8. Update Docker and compose.
9. Run full regression validation.
10. Delete the old Express code only after the NestJS runtime, CI, and Docker assets no longer depend on it.

## Success Criteria
The migration is successful when:
- the backend is modular and maintainable in NestJS
- all public endpoints continue to work
- all internal service integrations continue to work
- Docker builds and compose startup succeed
- security controls remain intact
- the retained Express tree is optional reference code only, not part of active runtime or CI
- the architecture remains aligned with the strengths of each language and service

## Final Recommendation
This is a reasonable enterprise migration, and the repository structure already supports it. The best approach is incremental migration with stable TypeScript, Docker updates, and careful preservation of the existing service boundaries.
