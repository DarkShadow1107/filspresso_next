# Express API Service Reference

The `express-api` service is the orchestration core for Filspresso commerce, account management, internal service calls, and security telemetry.

## 1. Runtime Profile

- Runtime: Node.js + Express
- Entry point: `server.js`
- Default port: `4000`
- Primary database: PostgreSQL
- Key service dependencies: OPA, Go Ops, Rust Crypto, Java Invoice, Kotlin Subscriptions

## 2. Service Responsibility Boundaries

1. User-facing API domain
- auth, accounts, cards, cart, orders, products, favorites, chat, weather, repairs

2. Internal security/control plane domain
- service-events ingestion and verification
- policy decision checks
- security observability endpoints
- ledger verification and anchoring automation hooks

3. Inter-service orchestration domain
- invoices, subscription quoting/reconciliation, crypto operations, go-ops event pushes

## 3. Route Mount Matrix

| Route File | Mounted Base Path |
| --- | --- |
| `routes/auth.js` | `/api/auth` |
| `routes/accounts.js` | `/api/accounts` |
| `routes/cards.js` | `/api/cards` |
| `routes/orders.js` | `/api/orders` |
| `routes/cart.js` | `/api/cart` |
| `routes/chat.js` | `/api/chat` |
| `routes/weather.js` | `/api/weather` |
| `routes/subscriptions.js` | `/api/subscriptions` |
| `routes/repairs.js` | `/api/repairs` |
| `routes/admin.js` | `/api/admin` |
| `routes/products.js` | `/api/products` |
| `routes/favorites.js` | `/api/favorites` |
| `routes/kafelot.js` | `/api/kafelot` |
| `routes/operations.js` | `/api/operations` |
| `routes/subscriptions_engine.js` | `/api/subscriptions-engine` |
| `routes/crypto.js` | `/api/crypto` |

## 4. Middleware And Security Chain

Primary middleware stack includes:
- `helmet` security headers
- CORS origin allowlist checks
- JSON/body parsing limits
- `middleware/originGuard.js` for CSRF-style origin/fetch-metadata checks
- request timeout and request-id assignment
- `middleware/policyGate.js` for OPA authorization decisions on protected paths

Auth-related middleware:
- `middleware/auth.js`
- signed assertion verification for internal service edges

## 5. Security Endpoints And Purpose

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | GET | Basic liveness and request-id check |
| `/health/services` | GET | Dependency and service state snapshot |
| `/health/security/observability` | GET | Security metrics and severity snapshot |
| `/health/security/alerts` | GET | Alert-focused signal evaluation |
| `/health/security/alerts/dispatch` | POST | Trigger webhook dispatch based on severity/force |
| `/health/services/events` | GET | Service event incident history |
| `/health/services/events/bulk` | POST | Signed or keyed service event ingestion |
| `/health/services/ledger/verify` | GET | Tamper-evident chain integrity verification |

## 6. Key Directory Map

- `routes/`: route-level domain handlers
- `middleware/`: origin/auth/policy controls
- `utils/`: cryptographic helpers, key provider, secrets, replay guards, ledger utilities
- `db/`: DB connection and schema preflight
- `data/`: SQL schema/bootstrap and RBAC assets
- `scripts/`: security and operations automation
- `tests/`: assertion contract and policy behavior tests
- `emails/`: template rendering for transactional events

## 7. NPM Scripts (Operationally Important)

Runtime:
- `npm run dev`
- `npm start`

Validation:
- `npm run test:internal-assertion-matrix`
- `npm run security:verify-ledger`
- `npm run security:anomaly-report`

Incident/crypto lifecycle automation:
- `npm run security:archive-ledger`
- `npm run security:anchor-ledger`
- `npm run security:post-incident-check`
- `npm run security:containment-playbook`
- `npm run security:issue-service-assertion`
- `npm run security:rotate-managed-key`

## 8. Secrets And Env Pattern

Secret resolution pattern supported throughout service code:
- direct env: `NAME`
- file-backed secret: `NAME_FILE`

Implemented in `utils/secrets.js` and consumed by DB, auth, crypto, service assertion, and integration paths.

## 9. Local And Docker Runbook

Local development:

```bash
cd express-api
npm ci
npm run dev
```

Compose runtime:

```bash
docker compose up --build backend
```

Hardened runtime:

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml up --build -d
```

## 10. Verification Checklist

```bash
cd express-api
npm run test:internal-assertion-matrix
node --check server.js
npm run security:verify-ledger
```

End-to-end stack verification from repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -SkipSignedHistory
```

## 11. Related Documentation

- `docs/README.md`
- `security/README.md`
- root `README.md`
