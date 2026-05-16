# Filspresso Next

Filspresso Next is a full-stack coffee commerce platform that combines e-commerce, AI assistance, and IoT-ready machine orchestration.

It is built with Next.js (App Router), NestJS, PostgreSQL, Redis, a Python AI service (Flask + Tanka model stack), and polyglot domain services in Java, Kotlin, and Go.

## 0. Architecture Decision Snapshot

This section is a quick ADR-style summary for new contributors.

- Keep NestJS as the orchestration and commerce core (auth, cart, checkout, account, products).
- Use Java for invoice PDF rendering where mature JVM document tooling gives stable output quality.
- Use Kotlin for subscription pricing and reconciliation rules where null-safety and concise rule code reduce maintenance risk.
- Use Go for operational event ingestion and lightweight service endpoints where startup speed and memory efficiency matter.
- Keep PostgreSQL as the primary database because current architecture depends on transaction-heavy commerce flows plus extension-oriented AI/chemistry capabilities.

## 0.1 Current Revision Change Log (Beta-3)

This section tracks the most recent cross-service changes reflected in the current workspace.

### Invoice and order experience updates

- Added image-based signature rendering for invoice PDFs using `public/images/Filspresso_Signature_Invoice.png`.
- Added dedicated Java renderer class `java-invoice-service/src/main/java/com/filspresso/invoice/SignatureStampRenderer.java`.
- Updated invoice PDF generation pipeline in `java-invoice-service/src/main/java/com/filspresso/invoice/InvoiceController.java` to call the signature stamp renderer.
- Added signature image asset mount/read path under `java-invoice-service/src/main/resources/signature/`.
- Kept invoice generation deterministic by rendering static stamp assets instead of randomized runtime stroke generation.

### Legal route migration and UX alignment

- Replaced legacy legal page route `/terms-of-use` with `/terms-and-conditions`.
- Moved privacy legal route to `/manage-subscription/privacy-policy`.
- Added `src/app/terms-and-conditions/page.tsx` and `src/components/legal/TermsAndConditionsContent.tsx`.
- Added `src/app/manage-subscription/privacy-policy/page.tsx`.
- Updated shared chrome linking in `src/components/LayoutChrome.tsx` to match new legal URLs.

### Commerce/payment and integration adjustments

- Updated order and invoice integration behavior in `nestjs-backend/src/orders/orders.service.ts`.
- Updated payment flow behavior in `src/components/payment/PaymentPageContent.tsx`.
- Updated order history behavior in `src/components/account/sections/OrderHistory.tsx`.

### Documentation scope in this README revision

- Refreshed UML source references and added additional architecture diagrams in Mermaid source form.
- Added explicit technology tradeoff and performance-comparison matrix.
- Added explicit security-control comparison matrix and service hardening rationale.

## Quick Start For New Contributors (5 Minutes)

If you are new to this repository, use this section first.

### 1) Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (recommended)
- Python 3.10+ (only required if you run AI service outside Docker)

### 2) Clone and install frontend dependencies

```bash
git clone https://github.com/DarkShadow1107/filspresso_next.git
cd filspresso_next
npm install
```

### 3) Build and start the full container stack

```bash
docker compose up --build -d
```

### 4) Run the Next.js frontend

```bash
npm run dev
```

### 5) Open the app

- Frontend: http://localhost:3000
- NestJS API health: http://localhost:4000/health
- Python AI health: http://localhost:5000/api/health
- Java Invoice health: http://localhost:8082/api/invoices/health
- Go Ops health: http://localhost:8083/health
- Kotlin Subscriptions health: http://localhost:8084/api/subscriptions/health
- Rust Crypto health: http://localhost:8090/health

### Quick verification checklist

- `docker compose ps` shows `postgres`, `redis`, `backend`, `ai`, `invoice_java`, `go_ops`, `kotlin_subscriptions`, `rust_crypto`, and OPA as running
- `GET /health` on port 4000 returns status ok
- `GET /api/health` on port 5000 returns status ok
- `GET /api/invoices/health` on port 8082 returns status ok
- `GET /health` on port 8083 returns status ok
- `GET /api/subscriptions/health` on port 8084 returns status ok
- Home page loads at port 3000 and can navigate between pages

### Titan V0.74 security verification (Docker)

Run the full automated verification suite:

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -SkipSignedHistory
```

Useful flags:

```powershell
# Use explicit service-events key for protected endpoints
pwsh -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -ServiceEventsKey "<your-key>"

# Use an explicit service assertion token for strict zero-trust endpoint auth checks
pwsh -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -ServiceAssertionToken "<signed-assertion-token>"
```

Important: Docker-backed security validation is mandatory in this suite and cannot be skipped.
The suite does not build images or recreate containers; it only starts existing services and validates restart resilience.

Precondition (one-time or after topology/image changes):

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml up -d
```

After changing security middleware or observability logic, you may refresh runtime separately from the suite:

```bash
docker compose down
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml up --build -d
```

Check the hardened backend runtime config is loaded:

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml exec backend sh -lc 'env | grep -E "CSRF_REQUIRE_ORIGIN_FOR_COOKIE|SECURITY_LEDGER_ARCHIVE_ENABLED|SECURITY_OBSERVABILITY_WINDOW_MINUTES"'
```

Verify observability snapshot endpoint:

```bash
curl -sS "http://localhost:4000/health/security/observability" \
    -H "x-service-events-key: change-this-service-events-key"
```

Verify alert summary endpoint:

```bash
curl -sS "http://localhost:4000/health/security/alerts" \
    -H "x-service-events-key: change-this-service-events-key"
```

Trigger manual alert dispatch (returns `webhook_not_configured` until a webhook is configured):

```bash
curl -sS -X POST "http://localhost:4000/health/security/alerts/dispatch" \
    -H "Content-Type: application/json" \
    -H "x-service-events-key: change-this-service-events-key" \
    --data '{"force":"true"}'
```

Verify CSRF hardening blocks unsafe cookie-authenticated requests without Origin/Referer:

```bash
curl -i -X POST "http://localhost:4000/api/auth/login" \
    -H "Content-Type: application/json" \
    -H "Cookie: sid=test" \
    --data '{"username":"demo","password":"demo"}'
```

Expected result: `403` with reason indicating missing Origin/Referer.

---

## Table Of Contents

- [0. Architecture Decision Snapshot](#0-architecture-decision-snapshot)
- [0.1 Current Revision Change Log (Beta-3)](#01-current-revision-change-log-beta-3)
- [1. Product Overview](#1-product-overview)
- [2. Architecture At A Glance](#2-architecture-at-a-glance)
- [2.1 Full App UML (Component, Deployment, Domain)](#21-full-app-uml-component-deployment-domain)
- [2.2 Frontend Architecture UML](#22-frontend-architecture-uml)
- [2.3 Backend Architecture UML](#23-backend-architecture-uml)
- [2.4 Security UML](#24-security-uml)
- [2.5 Data and Infrastructure UML](#25-data-and-infrastructure-uml)
- [2.6 Operations and Workflows UML](#26-operations-and-workflows-uml)
- [3. Technology Stack](#3-technology-stack)
- [3.1 Technology Alternatives And Performance Snapshot](#31-technology-alternatives-and-performance-snapshot)
- [4. Monorepo Structure](#4-monorepo-structure)
- [5. Runtime Topology And Ports](#5-runtime-topology-and-ports)
- [6. Environment Variables](#6-environment-variables)
- [7. Local Development Workflows](#7-local-development-workflows)
- [8. Docker Involvement (Deep Dive)](#8-docker-involvement-deep-dive)
- [9. Frontend Architecture](#9-frontend-architecture)
- [10. Backend Architecture (NestJS)](#10-backend-architecture-nestjs)
- [11. AI Service Architecture (Python)](#11-ai-service-architecture-python)
- [12. API Surface Reference](#12-api-surface-reference)
- [13. Database Model And Data Lifecycle](#13-database-model-and-data-lifecycle)
- [14. Stock Integrity, Reservation, And Checkout Safety](#14-stock-integrity-reservation-and-checkout-safety)
- [15. Security Model](#15-security-model)
- [15.1 Security Control Comparison](#151-security-control-comparison)
- [16. Observability, Health, And Incidents](#16-observability-health-and-incidents)
- [17. Page Map And Route Behavior](#17-page-map-and-route-behavior)
- [18. Screenshots (All Pages)](#18-screenshots-all-pages)
- [19. Testing, Validation, And Quality Gates](#19-testing-validation-and-quality-gates)
- [20. Deployment Guide](#20-deployment-guide)
- [21. Troubleshooting Playbook](#21-troubleshooting-playbook)
- [22. Contributor Guidelines](#22-contributor-guidelines)
- [23. Operational Runbook](#23-operational-runbook)
- [24. Known Gaps And Suggested Next Improvements](#24-known-gaps-and-suggested-next-improvements)
- [25. Image Assets And Media Pipeline](#25-image-assets-and-media-pipeline)
- [26. Why These New Languages And Where](#26-why-these-new-languages-and-where)
- [27. Why PostgreSQL Over MySQL Or MariaDB Here](#27-why-postgresql-over-mysql-or-mariadb-here)
- [Appendix A. Command Reference](#appendix-a-command-reference)
- [Appendix B. Important Files](#appendix-b-important-files)
- [Appendix C. Source File Index (Snapshot)](#appendix-c-source-file-index-snapshot)

---

## 1. Product Overview

Filspresso Next delivers a unified product experience around coffee discovery and purchase:

- Commerce experiences for coffee capsules, machines, favorites, cart, payments, and account
- Multi-service backend architecture with explicit health and incident tracking
- AI assistant flows for text and image-assisted coffee guidance
- IoT command pipeline for machine command scheduling and status feedback
- Docker-first environment for local onboarding and reproducible runtime

### Primary goals

- Reliable shopping and order flows
- Correct stock behavior under concurrent usage
- Modern frontend with App Router and route rewrites
- High developer velocity with clear service boundaries

---

## 2. Architecture At A Glance

### System context diagram

![System Context Diagram](docs/uml/system-context-diagram.svg)

### Request routing and service interactions

![Request Routing And Service Interactions](docs/uml/request-routing-sequence.svg)

### Stock-safe checkout flow

![Stock-safe Checkout Flow](docs/uml/stock-safe-checkout-flow.svg)

### 2.1 Full App UML (Component, Deployment, Domain)

The following UML set covers the full platform from code modules to runtime containers and core data entities.

#### UML component diagram

![Full App UML Component Diagram](docs/uml/full-app-component-diagram.svg)

#### UML deployment diagram

![Full App UML Deployment Diagram](docs/uml/full-app-deployment-diagram.svg)

#### UML domain model (high-level)

![Full App UML Domain Model](docs/uml/full-app-domain-model.svg)

#### Coffee stock-read path (latency-sensitive)

![Coffee Stock Read Path](docs/uml/coffee-stock-read-path.svg)

### 2.2 Frontend Architecture UML

#### Frontend component architecture

![Frontend Component Architecture](docs/uml/frontend-component-architecture.svg)

#### Frontend state management flow

![Frontend State Management Flow](docs/uml/frontend-state-management-flow.svg)

#### Next.js API route handler architecture

![Next.js API Route Architecture](docs/uml/nextjs-api-route-architecture.svg)

### 2.3 Backend Architecture UML

#### Authentication flow sequence

![Authentication Flow Sequence](docs/uml/authentication-flow-sequence.svg)

#### Admin dashboard architecture

![Admin Dashboard Architecture](docs/uml/admin-dashboard-architecture.svg)

#### AI/ML pipeline sequence

![AI/ML Pipeline Sequence](docs/uml/ai-ml-pipeline-sequence.svg)

#### IoT command lifecycle

![IoT Command Lifecycle](docs/uml/iot-command-lifecycle-sequence.svg)

### 2.4 Security UML

#### Security trust-boundary map

![Security Trust Boundary](docs/uml/security-trust-boundary.svg)

#### Zero trust architecture (6 defense-in-depth rings)

![Zero Trust Architecture](docs/uml/zero-trust-architecture.svg)

#### Cross-service cryptographic commitment flow

![Cross-Service Crypto Sequence](docs/uml/cross-service-crypto-sequence.svg)

#### Data cryptography diagram

![Data Cryptography Diagram](docs/uml/data-cryptography-diagram.svg)

#### Rust WASM client-side crypto

![Rust WASM Client Crypto](docs/uml/rust-wasm-client-crypto.svg)

### 2.5 Data and Infrastructure UML

#### Multi-currency/FX conversion flow

![Multi-Currency FX Conversion](docs/uml/multi-currency-fx-conversion-flow.svg)

#### Terraform/infrastructure architecture

![Terraform Infrastructure](docs/uml/terraform-infrastructure-architecture.svg)

### 2.6 Operations and Workflows UML

#### Repair/warranty workflow state

![Repair Warranty Workflow](docs/uml/repair-warranty-workflow-state.svg)

#### Member status/loyalty tier progression

![Loyalty Tier Progression](docs/uml/member-status-loyalty-tier-progression.svg)

#### CI/CD pipeline

![CI/CD Pipeline](docs/uml/cicd-pipeline-diagram.svg)

---

## 3. Technology Stack

### Frontend

- Next.js 16 (App Router, standalone output)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Motion library for UI animation
- ESLint 9 with next config

### Backend (Commerce API)

- Node.js 20+ runtime
- NestJS 10 (TypeScript, modular architecture)
- PostgreSQL access via pg
- Security and middleware: helmet, cors, @nestjs/jwt, argon2, @nestjs/throttler, multer
- Argon2id password hashing with bcrypt migration/rehash support
- JWT EdDSA asymmetric + HS256 fallback
- OPA integration for authorization
- React Email components for email rendering

### Polyglot service layer

- Java 17 + Spring Boot (invoice and PDF generation)
- Kotlin 1.9 + Spring Boot (subscription quote and reconciliation engine)
- Go 1.22 (operations and event ingestion service)
- Redis 7 (durable shared event list for the Go ops service)

### Service ownership boundary (important)

- NestJS owns API gateway/orchestration, auth/account/cart/order orchestration, and transactional stock writes.
- Java owns invoice PDF rendering only.
- Kotlin owns subscription quote and reconciliation computations.
- Go owns operational event ingestion and lightweight ops endpoints backed by Redis.

### AI backend

- Python 3.10+
- Flask 3 with Flask-CORS
- sentence-transformers, transformers, faiss-cpu
- torch + torchvision
- Molecule pipeline support: rdkit, py3Dmol, chembl-webresource-client, MolScribe dependency set

### Models used in this app

| Model                                     | Family / package      | Where used                              | Purpose                                                          |
| ----------------------------------------- | --------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| all-MiniLM-L6-v2                          | sentence-transformers | `models/tanka.py` natural_language mode | Embedding generation for semantic retrieval over `coffee_facts`  |
| fine_tuned_minilm (optional local path)   | sentence-transformers | `models/fine_tuned_minilm` if present   | Preferred domain-tuned embedding model override                  |
| CLIP ViT-B/32                             | openai/CLIP           | `models/tanka.py` `describe_image()`    | Image understanding/classification for chat image uploads        |
| MolScribe (`swin_base_char_aux_200k.pth`) | molscribe             | `models/tanka.py` chemistry mode        | Molecule structure recognition from images and SMILES extraction |

Model behavior is lazy-loaded at runtime. This keeps startup time lower and only loads models when endpoints actually require them.

### Data and infra

- PostgreSQL 16
- pgvector and rdkit enabled by DB image setup
- Docker Compose orchestration with health checks and named volumes

### 3.1 Technology Alternatives And Performance Snapshot

The table below captures practical tradeoffs against realistic alternatives considered during implementation.

| Concern                    | Chosen stack                           | Alternative considered          | Why chosen in this codebase                                                             | Observed/expected impact                                       |
| -------------------------- | -------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Invoice rendering fidelity | Java 17 + OpenPDF/Spring               | Node PDFKit/Puppeteer templates | JVM PDF layout behavior is stable and deterministic for invoice stamping and typography | Fewer visual regressions in generated PDFs across environments |
| Business-rule safety       | Kotlin service for subscription engine | NestJS-only rules              | Kotlin null-safety and concise data classes reduce branch-heavy reconciliation bugs     | Lower rule-maintenance risk as plan matrix grows               |
| Event ingest efficiency    | Go ops service + Redis list            | NestJS worker endpoints        | Go startup and memory profile is favorable while Redis provides shared durable state    | Better horizontal scaling and restart resilience               |
| AI retrieval storage       | PostgreSQL + pgvector                  | separate vector DB              | Keeps transactional + vector data in one consistency boundary                           | Fewer sync jobs and simpler operational topology               |

#### Performance benchmark notes

- Benchmarks are workload-specific and should be repeated in your deployment target.
- The current architecture optimizes for deterministic output and operational simplicity over synthetic peak throughput.
- Recommendation: keep a benchmark harness per service (invoice render latency, subscription quote latency, event ingest p95) and track trends release-over-release.

---

## 4. Monorepo Structure

```text
.
|- .vscode/
|  |- settings.json
|- docs/
|  |- SCREENSHOTS.md
|  |- screenshots/
|  |- uml/
|- nestjs-backend/
|  |- .env
|  |- package.json
|  |- tsconfig.json
|  |- Dockerfile
|  |- src/
|  |  |- main.ts
|  |  |- app.module.ts
|  |  |- app.controller.ts
|  |  |- app.service.ts
|  |  |- accounts/
|  |  |- admin/
|  |  |- auth/
|  |  |- cards/
|  |  |- cart/
|  |  |- chat/
|  |  |- common/
|  |  |- config/
|  |  |- crypto/
|  |  |- database/
|  |  |- favorites/
|  |  |- health/
|  |  |- integrations/
|  |  |- kafelot/
|  |  |- operations/
|  |  |- orders/
|  |  |- products/
|  |  |- repairs/
|  |  |- security/
|  |  |- security-observability/
|  |  |- subscriptions/
|  |  |- subscriptions-engine/
|  |  |- weather/
|  |- data/
|  |  |- extensions.sql
|  |  |- schema.sql
|  |  |- run_migration.js
|  |  |- setup_all_tables.js
|  |  |- setup_favorites_table.js
|  |  |- setup_full_db.js
|  |  |- test_login.js
|  |  |- update_admin_creds.js
|  |- utils/
|     |- dockerManager.js
|     |- encryption.js
|     |- ensureAppSchema.js
|- logs/
|- models/
|  |- __init__.py
|  |- requirements.txt
|  |- tanka.py
|  |- data/
|  |  |- capsule_volumes.json
|  |  |- chembl-molecules.json
|  |  |- coffee_chunks.json
|  |- model/
|     |- swin_base_char_aux_200k.pth
|- public/
|  |- data/
|  |  |- chembl-molecules.json
|  |- fonts/
|  |- images/
|  |  |- Capsules/
|  |  |  |- Original/
|  |  |  |- Vertuo/
|  |  |- Machines/
|  |  |  |- Original/
|  |  |  |- Vertuo/
|  |  |- Payment/
|  |  |- icons/
|  |  |- svg/
|- scripts/
|  |- addCoffeeNotes.mjs
|  |- extractCoffeeData.mjs
|  |- extractMachinesData.mjs
|  |- remove_render_graph.py
|  |- replace_sections.py
|  |- start_all.bat
|  |- esp32/
|     |- esp32_coffeemachine.ino
|- src/
|  |- app/
|  |  |- globals.css
|  |  |- layout.tsx
|  |  |- page.tsx
|  |  |- admin/page.tsx
|  |  |- favorites/page.tsx
|  |  |- kafelot-privacy/page.tsx
|  |  |- manage-subscription/
|  |  |  |- layout.tsx
|  |  |  |- page.tsx
|  |  |  |- privacy-policy/page.tsx
|  |  |- payment/
|  |  |  |- layout.tsx
|  |  |  |- page.tsx
|  |  |- sales-refunds/page.tsx
|  |  |- services/page.tsx
|  |  |- terms-and-conditions/page.tsx
|  |  |- api/
|  |     |- chat/route.ts
|  |     |- chat/save/route.ts
|  |     |- model/route.ts
|  |     |- pages/
|  |     |- python-chat/route.ts
|  |     |- python-health/route.ts
|  |     |- services-health/route.ts
|  |     |- subscribe/route.ts
|  |- components/
|  |  |- account/
|  |  |- coffee/
|  |  |- coffee-machine-animation/
|  |  |- favorites/
|  |  |- home/
|  |  |- kafelot/
|  |  |- legal/
|  |  |- love-coffee/
|  |  |- machines/
|  |  |- payment/
|  |  |- services/
|  |  |- shopping-bag/
|  |  |- subscription/
|  |  |- AccountIconGenerator.tsx
|  |  |- Cart.tsx
|  |  |- CoffeeRecommender.tsx
|  |  |- FavoritesProvider.tsx
|  |  |- LayoutChrome.tsx
|  |  |- MoleculeVisualizer.tsx
|  |  |- Navbar.tsx
|  |  |- NotificationsProvider.tsx
|  |  |- PaymentForm.tsx
|  |  |- ScrollToTopButton.tsx
|  |  |- SubscriptionForm.tsx
|  |  |- WeatherWidget.tsx
|  |- data/
|  |  |- chat_history.json
|  |  |- coffee.generated.json
|  |  |- coffee.ts
|  |  |- machines.generated.json
|  |  |- machines.ts
|  |- hooks/
|  |  |- useCart.ts
|  |  |- useCoffeeCollections.ts
|  |  |- useMachineCollections.ts
|  |- icons/
|  |- lib/
|  |- styles/
|  |- types/
|- .dockerignore
|- .env
|- .gitignore
|- app.py
|- docker-compose.yml
|- Dockerfile.ai
|- Dockerfile.db
|- Dockerfile.nestjs
|- eslint.config.mjs
|- filspresso_next.code-workspace
|- FilspressoNext.session.sql
|- global.d.ts
|- iot_db.py
|- LICENSE
|- next-env.d.ts
|- next.config.ts
|- package.json
|- postcss.config.mjs
|- proxy.ts
|- README.md
|- requirements.txt
|- seed_vectors.py
|- tailwind.config.cjs
|- train.py
|- tsconfig.json
```

Notes:

- This structure intentionally excludes generated and dependency-heavy folders such as `.next`, `node_modules`, and virtual environments.
- The source tree under `src/icons` is large (hundreds of icon files) and is represented as a directory node to keep this README maintainable.

### Structure updates in this revision

- Added `java-invoice-service/` for Java PDF invoice generation.
- Added `kotlin-subscription-service/` for Kotlin quote/reconciliation logic.
- Added `go-ops-service/` for operational events and lightweight service tasks.
- Added Redis-backed event persistence for shared, durable ops history.
- Added new NestJS route modules for inter-service proxying: `operations.controller.ts` and `subscriptions-engine.controller.ts`.
- Added `java-invoice-service/src/main/java/com/filspresso/invoice/SignatureStampRenderer.java` and signature resource assets for invoice stamp rendering.
- Added legal route files for `/terms-and-conditions` and `/manage-subscription/privacy-policy` while deprecating legacy legal route paths.
- Added UML SVG exports under `docs/uml/*.svg` so architecture diagrams render directly in README and GitHub.

---

## 5. Runtime Topology And Ports

| Service              | Port | Responsibility                                  | Health Endpoint              |
| -------------------- | ---- | ----------------------------------------------- | ---------------------------- |
| Next.js              | 3000 | UI rendering, route handlers, proxy logic       | n/a (application page load)  |
| NestJS Backend | 4000 | Commerce/auth/cart/orders/products/admin | /health and /health/services |
| Python AI            | 5000 | AI chat/semantic search/IoT endpoints           | /api/health                  |
| Java Invoice         | 8082 | PDF invoice generation service                  | /api/invoices/health         |
| Go Ops               | 8083 | Event ingestion/webhooks/operational processing | /health                      |
| Kotlin Subscriptions | 8084 | Subscription pricing and reconciliation engine  | /api/subscriptions/health    |
| Redis                | 6379 | Durable shared event storage for Go ops         | redis-cli ping               |
| PostgreSQL           | 5432 | Transactional + vector/chemistry data           | pg_isready health check      |

### Internal container addressing

Inside Docker network:

- backend reaches db at host `postgres`
- backend reaches AI at `http://ai:5000`
- backend reaches Java invoice at `http://invoice-java:8082`
- backend reaches Go ops at `http://go-ops:8083`
- backend reaches Kotlin subscriptions at `http://kotlin-subscriptions:8084`
- go ops reaches Redis at `redis:6379`
- AI reaches db at host `postgres`

Outside Docker (host machine):

- frontend usually calls NestJS via `http://localhost:4000`
- Next route handlers proxy to AI via configured `PYTHON_AI_HOST`

---

## 6. Environment Variables

### Frontend / Next

| Variable                       | Typical Value         | Purpose                                      |
| ------------------------------ | --------------------- | -------------------------------------------- |
| NEXT_PUBLIC_API_URL            | http://localhost:4000 | Base URL used by frontend calls              |
| PYTHON_AI_HOST                 | http://localhost:5000 | Next handler upstream for AI proxy           |
| NEXT_PUBLIC_AI_URL             | optional              | Alternate client AI URL if used              |
| SERVICE_METRICS_STRICT_DB_ONLY | false                 | Controls strict mode in service health route |

### NestJS Backend

| Variable                          | Typical Value                    | Purpose                               |
| --------------------------------- | -------------------------------- | ------------------------------------- |
| PORT                              | 4000                             | NestJS listening port                 |
| DB_HOST                           | postgres or localhost            | PostgreSQL host                       |
| DB_PORT                           | 5432                             | PostgreSQL port                       |
| DB_NAME                           | filspresso                       | DB name                               |
| DB_USER                           | filspresso_user                  | DB user                               |
| DB_PASSWORD                       | secret                           | DB password                           |
| DB_PASSWORD_FILE                  | /run/secrets/db_password         | Docker secret-file fallback           |
| JWT_SECRET                        | secret                           | JWT signing                           |
| JWT_SECRET_FILE                   | /run/secrets/jwt_secret          | Docker secret-file fallback           |
| ENCRYPTION_KEY                    | secret                           | encryption helper key                 |
| ENCRYPTION_KEY_FILE               | /run/secrets/encryption_key      | Docker secret-file fallback           |
| CORS_ORIGIN                       | http://localhost:3000            | Allowed origin list                   |
| PYTHON_AI_HOST                    | http://ai:5000                   | AI health and integration host        |
| INVOICE_SERVICE_URL               | http://invoice-java:8082         | Java invoice service base URL         |
| GO_OPS_URL                        | http://go-ops:8083               | Go operational service base URL       |
| GO_OPS_API_KEY                    | filspresso-ops-key               | Go ops ingest authentication key      |
| GO_OPS_API_KEY_FILE               | /run/secrets/go_ops_api_key      | Docker secret-file fallback           |
| KOTLIN_SUBSCRIPTIONS_URL          | http://kotlin-subscriptions:8084 | Kotlin subscription service base URL  |
| DISABLE_RATE_LIMIT_FOR_DEV        | true or false                    | dev toggle                            |
| DISABLE_RATE_LIMIT                | true or false                    | explicit global rate-limiter toggle   |
| REQUEST_TIMEOUT_MS                | 20000                            | API timeout guardrail in milliseconds |
| CART_RESERVATION_MINUTES          | 20                               | cart reservation contention window    |
| CART_STOCK_BUFFER_UNITS           | 0                                | optional safety buffer                |
| SERVICE_INCIDENT_RETENTION_DAYS   | 180                              | incident retention window             |
| SERVICE_INCIDENT_RETENTION_JOB_MS | 21600000                         | cleanup job interval                  |

### Python AI

| Variable         | Typical Value            | Purpose                     |
| ---------------- | ------------------------ | --------------------------- |
| PYTHON_AI_PORT   | 5000                     | Flask bind port             |
| DB_HOST          | postgres or localhost    | PostgreSQL host             |
| DB_PORT          | 5432                     | PostgreSQL port             |
| DB_NAME          | filspresso               | DB name                     |
| DB_USER          | filspresso_user          | DB user                     |
| DB_PASSWORD      | secret                   | DB password                 |
| DB_PASSWORD_FILE | /run/secrets/db_password | Docker secret-file fallback |

---

## 7. Local Development Workflows

### Workflow A: Docker for backend services + local frontend

1. Run `docker compose up --build -d`
2. Run `npm install` and `npm run dev` in repository root
3. Access app at port 3000

### Workflow B: Fully local (no Docker for app services)

1. Ensure PostgreSQL is locally available and configured
2. Start NestJS from nestjs-backend directory: `npm install && npm run start:dev`
3. Create Python virtual environment and run app.py
4. Start Next dev server from root

### Workflow C: Windows helper script

`scripts/start_all.bat` does:

- compose up detached
- starts frontend dev server

---

## 8. Docker Involvement (Deep Dive)

Docker is not an optional side note in this project. It is part of how the architecture is intended to run locally and in production-like environments.

### Compose services

- postgres
    - Built from Dockerfile.db
    - Mounts schema/extensions SQL for initialization
    - Exposes port 5432
    - Health check via pg_isready

- backend
    - Built from nestjs-backend/Dockerfile
    - Depends on healthy postgres, opa, rust_crypto, invoice_java, go_ops, kotlin_subscriptions
    - Exposes port 4000
    - Mounts public images volume for admin media workflows
    - Health check via /health

- ai
    - Built from Dockerfile.ai
    - Depends on healthy postgres
    - Exposes port 5000
    - Uses persistent caches for HuggingFace, CLIP, and MolScribe model artifacts
    - Health check via /api/health

- invoice_java
    - Built from java-invoice-service/Dockerfile
    - Exposes port 8082
    - Generates downloadable invoice PDFs for order history flows
    - Health check via /api/invoices/health

- go_ops
    - Built from go-ops-service/Dockerfile
    - Exposes port 8083
    - Handles event ingestion and operational telemetry forwarding
    - Health check via /health

- kotlin_subscriptions
    - Built from kotlin-subscription-service/Dockerfile
    - Exposes port 8084
    - Handles pricing quotes and subscription reconciliation rules
    - Health check via /api/subscriptions/health

- redis
    - Uses redis:7.4-alpine image
    - Exposes port 6379
    - Shared durable event list backend for go_ops
    - Health check via redis-cli ping

### Compose dependency graph

![Compose Dependency Graph](docs/uml/compose-dependency-graph.svg)

### Important volumes

- postgres_data: persists relational data
- hf_cache: transformer model cache
- clip_cache: CLIP model cache
- molscribe_model: molecule model assets

### Typical Docker commands

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend
docker compose logs -f ai
docker compose down
```

### Hardened production profile (Titan V0.74)

The repository includes a defense-in-depth compose override at `docker-compose.security.yml`.

Security profile highlights:

- internal-only service/data networks for east-west traffic
- Docker secrets for DB/API/crypto credentials
- OPA policy engine for deny-by-default authorization decisions on sensitive ingestion flows
- optional Ed25519 signed service assertions for internal service-to-service writes
- non-root runtime images for NestJS and AI services
- `no-new-privileges` and dropped Linux capabilities for application containers
- explicit seccomp profile wiring plus AppArmor default profile mapping in hardened overlay
- read-only root filesystems with constrained tmpfs write areas
- strict per-service DB credential separation (`BACKEND_DB_USER` / `AI_DB_USER`) with bootstrap login-role init script
- backend outbound egress host allowlist guard for internal upstream dependencies
- reduced attack surface by removing public port bindings from internal services

Security profile startup sequence:

1. Create real secret files under `secrets/` (templates are in `secrets/*.txt.example`) or auto-generate from `.env`:

```bash
npm run security:bootstrap-secrets
```

Use dry-run to verify mapping without writing files:

```bash
npm run security:bootstrap-secrets:dry-run
```

2. (Optional, recommended for service-identity hardening) generate local mTLS certificates for backend/go_ops:

```bash
npm run security:generate-mtls-dev
```

3. Copy `security.env.example` to your deployment-specific env file and adjust values (including service users and strict credential flags).
4. Start with both compose files:

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml up --build -d
```

5. Validate controls:

```bash
docker compose -f docker-compose.yml -f docker-compose.security.yml ps
docker compose -f docker-compose.yml -f docker-compose.security.yml exec backend node -e "console.log(process.getuid && process.getuid())"
```

Expected: internal services have no host port bindings, and app containers run as non-root users.

Titan implementation checklist and security backlog are consolidated in `docs/README.md`.

---

## 9. Frontend Architecture

### Routing model

The frontend uses a page-slug pattern where root page resolves component based on query param:

- root path `/` with `?page=<slug>` loads appropriate page module
- rewrite logic in proxy.ts maps pretty paths (`/coffee`, `/machines`, `/account`, etc.) to root with page param
- bypass list protects `/api`, static assets, Next internals, and robots/sitemap

### Page composition pattern

- shared providers for notifications/cart/favorites
- hook-driven client data sync with NestJS endpoints
- feature components under src/components with domain segmentation

### Data flow

1. Component invokes hook
2. Hook calls NestJS API or Next route handler
3. State updated from authoritative backend response
4. UI reflects stock, cart totals, favorites, and account state

---

## 10. Backend Architecture (NestJS)

### Startup responsibilities

- load environment variables
- enforce security middleware
- apply CORS policy with localhost allowlist
- optionally apply global rate limiting
- attach request correlation IDs (`x-request-id`) to every response
- enforce bounded request timeout fail-fast behavior
- verify schema compatibility via ensureAppSchema
- expose health and incident endpoints
- append tamper-evident ledger entries for service incident ingestion
- mount feature route modules under /api

### Responsibilities moved out of legacy Express (migrated to NestJS)

- Invoice PDF document rendering moved to Java (`java-invoice-service`).
- Subscription quote/reconciliation calculations moved to Kotlin (`kotlin-subscription-service`).
- Operational event ingestion moved to Go (`go-ops-service`) with Redis-backed durability.

NestJS now orchestrates these domains and enforces auth, validation, and response contracts.

### Mounted route groups

- /api/auth
- /api/accounts
- /api/cards
- /api/orders
- /api/cart
- /api/chat
- /api/weather
- /api/subscriptions
- /api/repairs
- /api/admin
- /api/products
- /api/favorites
- /api/kafelot
- /api/operations
- /api/subscriptions-engine

### Operational endpoints

- GET /health
- GET /health/services
- GET /health/services/events
- GET /health/services/ledger/verify
- POST /health/services/events/bulk

---

## 11. AI Service Architecture (Python)

### Service profile

Flask app that exposes semantic Q and A, multimodal chat, and IoT command lifecycle helpers.

### Runtime model loading behavior

- Natural language mode loads MiniLM embeddings model (`all-MiniLM-L6-v2` or local fine-tuned variant if available).
- Image input path loads CLIP ViT-B/32 to score semantic image labels.
- Chemistry mode with image loads MolScribe (`models/model/swin_base_char_aux_200k.pth`) to extract molecule SMILES.
- Models are loaded lazily (first-use load), then reused in memory.

### Core endpoint behavior

- POST /api/ask-coffee
    - Embeds query
    - Runs pgvector similarity query over coffee facts
    - Returns top contextual facts

- POST /api/chat
    - Accepts JSON or multipart
    - Supports modes: natural_language and chemistry
    - Optional image path runs CLIP or MolScribe-related handling

- GET /api/health
    - Basic service health payload

### AI mode behavior summary

| Mode             | Input        | Primary behavior                         |
| ---------------- | ------------ | ---------------------------------------- |
| natural_language | text         | semantic retrieval + contextual response |
| natural_language | image + text | CLIP-style image description path        |
| chemistry        | image + text | molecule extraction/recognition path     |
| chemistry        | text only    | prompts for molecule image upload        |

---

## 12. API Surface Reference

### Next route handlers

- POST /api/python-chat
- DELETE /api/python-chat?request_id=...
- GET /api/python-health
- GET /api/services-health
- GET /api/model
- POST /api/chat
- GET|POST /api/chat/save
- POST /api/subscribe

### NestJS functional domains

- Auth and account management
- Product catalog and stock
- Cart operations
- Order creation and history
- Favorites
- Subscription lifecycle/state endpoints (pricing and quote logic delegated to Kotlin)
- Weather and repairs
- Admin operations
- Prompt/quota flow with kafelot route group

### API expectations

- JSON response envelopes for normal and error outcomes
- explicit conflict errors for stock failures
- no optimistic success assumptions in frontend behavior

---

## 13. Database Model And Data Lifecycle

Schema source is primarily in nestjs-backend/data/schema.sql and supporting migration/bootstrap scripts in nestjs-backend/data/.

### Main data domains

- Accounts and authentication: accounts, user_sessions
- Payment method data: user_cards
- Catalog/inventory: coffee_products, machine_products
- Purchasing: cart_items, orders, order_items
- Personalization: favorites, subscriptions, user_subscriptions
- AI memory/data: coffee_facts, molecules, chat_sessions, chat_messages
- IoT operations: iot_commands
- Operational records: service health incident tables and weather cache

### Data lifecycle

- startup schema checks reduce drift
- cart/order flows enforce transactional updates
- historical records retained for analytics and audit

---

## 14. Stock Integrity, Reservation, And Checkout Safety

This application is designed to avoid overselling.

### Layer 1: cart-time validation

- each add/update checks product stock
- reservation impact from other active carts is considered
- optional configured buffer is subtracted
- if unavailable, API returns conflict and does not mutate cart

### Layer 2: checkout-time transactional guard

- row locks with FOR UPDATE
- guarded decrement where stock must remain non-negative
- transaction rolls back on violation
- user receives deterministic conflict response

### Why both layers matter

- cart validation reduces bad UX early
- checkout lock guarantees data consistency under concurrency

---

## 15. Security Model

This section documents how Filspresso is currently secured, how security is monitored, and how to maintain a strong security posture over time.

### Security objectives

- prevent unauthorized data access
- reduce account takeover risk
- block common web attacks (injection, brute force, abuse)
- preserve service availability under abusive traffic
- provide operational visibility for suspicious authentication behavior

### Active controls in the current backend

#### Transport and HTTP layer

- security headers are enforced through `helmet`
- strict CORS origin checks are enabled with credential support
- NestJS identifies no implementation details via disabled `x-powered-by`
- strict JSON parsing is enabled to reject malformed payloads
- every response includes correlation-friendly `x-request-id`
- request timeout guardrails return controlled `503` payloads for hung calls

#### Authentication and session model

- JWT tokens are verified with explicit HS256 algorithm constraints
- JWT authentication requires a matching active server-side session record
- admin authentication is session-backed and refreshed with bounded session lifetimes
- logout removes server-side session entries
- password change invalidates all other active sessions for that account

#### Password and credential security

- passwords are hashed with bcrypt (cost factor 12)
- login input is normalized and size-bounded
- dummy-hash comparison is used for unknown users to reduce timing-based account enumeration

#### Brute-force and lockout protections

- global API rate limiting is enabled by default
- route-level auth rate limits protect register/login/admin login paths
- failed authentication attempts are persisted in `auth_login_attempts`
- lockout with exponential backoff is applied per normalized login key (username/email)
- lock state returns `429` with retry hints (`Retry-After` header and `retryAfterSeconds` response field)

#### SQL injection and query safety

- application queries use parameterized statements for user-supplied values
- dynamic SQL identifiers are validated with allowlisted identifier patterns
- admin raw SQL endpoint only allows single-statement read-only queries
- admin raw SQL executes in read-only transactions with statement timeout guardrails

#### Secrets and configuration hardening

- sensitive values are loaded from environment or Docker-style `*_FILE` secrets (no hardcoded fallback secrets)
- hardened runtime profile uses mounted secrets under `/run/secrets/*`
- secret templates are provided in `secrets/*.txt.example` and real values are git-ignored
- service event ingestion is protected by dedicated API key validation

#### CI security gates

- GitHub Actions workflow `.github/workflows/security-ci.yml` runs on push and PR
- checks include:
    - frontend lint and build
    - frontend dependency audit (`npm audit --audit-level=high`)
    - backend dependency audit (`npm audit --audit-level=high`)
    - Python dependency audit (`pip-audit` for both requirements files)

### Security telemetry and monitoring

Authentication telemetry is persisted to `auth_security_events` and lockout state to `auth_login_attempts`.

Admin-only telemetry endpoints:

- `GET /api/admin/security/telemetry`
    - purpose: summary metrics for failed logins, lock events, source IP concentration, and currently locked identifiers
    - query: `windowHours` (1 to 720)
- `GET /api/admin/security/events`
    - purpose: retrieve recent authentication security events for investigations
    - query: `limit` (1 to 1000)
- `DELETE /api/admin/security/lockouts/:loginKey`
    - purpose: operational unlock for a specific login key during support incidents
    - action is logged as `lockout_cleared_admin`

Security-operations endpoint:

- `GET /health/services/ledger/verify`
    - purpose: recompute and verify SHA3-256 hash-chain integrity for `security_event_ledger`
    - auth: service-events API key (`x-service-events-key` or Bearer token)
    - query: `chainScope` (default `service-health`), `maxRows` (1 to 100000)

### Secrets rotation runbook

The project uses active rotation for authentication and data-access secrets.

#### Rotate these values together

- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `SERVICE_EVENTS_API_KEY`
- `GO_OPS_API_KEY`
- `DB_PASSWORD`

#### Rotation procedure

1. Generate new cryptographically strong random values.
2. Update mounted secret files in `secrets/` (or your production secret manager path).
3. Update any environment variables still used by local-only workflows (`.env`, `nestjs-backend/.env`).
4. Apply database password rotation at the PostgreSQL role level.
5. Recreate backend and dependent services so new environment values are loaded.
6. Invalidate active sessions where appropriate (for JWT secret rotation, clear old sessions).
7. Verify health endpoints and login behavior.
8. Run ledger verification and archive the verification result with the release record.

#### Rotation cadence

- standard cadence: every 60 to 90 days
- immediate rotation: after suspected exposure, unauthorized access, or leaked logs/artifacts

### Operational maintenance checklist

Run this checklist for each release:

1. Ensure security CI jobs are green.
2. Verify rate-limit toggles are not disabling protections in production.
3. Confirm CORS origins are restricted to approved domains.
4. Confirm required secrets are present and not using placeholder values.
5. Review authentication telemetry for unusual failed-login spikes.
6. Review lockout telemetry and top source IPs for abuse indicators.
7. Confirm incident retention settings match policy.
8. Verify tamper-evident ledger chain status with `GET /health/services/ledger/verify`.

### Incident response guidance (auth attacks)

When suspicious login abuse is detected:

1. Inspect `GET /api/admin/security/telemetry` for current lockout and source-IP concentration.
2. Query `GET /api/admin/security/events` for recent attack patterns.
3. If needed, clear accidental lockouts with `DELETE /api/admin/security/lockouts/:loginKey`.
4. Increase auth lockout strictness (`AUTH_LOCK_THRESHOLD`, `AUTH_LOCK_BASE_SECONDS`, `AUTH_LOCK_MAX_SECONDS`) and redeploy.
5. Rotate security secrets if compromise is suspected.

### Security limits and ongoing work

No application can be permanently “fully secure”; security is a continuous program. Current controls significantly improve resilience, but ongoing improvement remains required:

- enforce TLS at ingress/load balancer in all environments
- add alerting integrations for telemetry thresholds
- add periodic penetration testing and threat modeling updates
- keep dependencies patched and re-audited continuously

### 15.1 Security Control Comparison

| Security area         | Current implementation                                                             | Lower-rigor alternative            | Why current approach is used                                   |
| --------------------- | ---------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| Auth token validation | JWT algorithm constrained + server-side session cross-check                        | JWT-only stateless validation      | Allows central revocation and tighter incident response        |
| Credential protection | bcrypt hashing + normalized login + dummy-hash timing mitigation                   | simple hash/naive lookup           | Reduces account enumeration and brute-force leverage           |
| Abuse resistance      | global and route-level rate limiting + lockout backoff telemetry                   | global limiter only                | Provides targeted protection for login and admin surfaces      |
| SQL safety            | parameterized queries + identifier validation + read-only guardrails for admin SQL | string-concatenated SQL            | Minimizes injection surface and blast radius                   |
| Secret handling       | required env secrets, no insecure fallbacks                                        | hardcoded defaults in code/compose | Improves portability to production and secret rotation hygiene |
| Service events auth   | API key gating for ops ingest endpoints                                            | open internal endpoint assumption  | Defends against accidental exposure in misconfigured networks  |

#### Invoice-specific security posture

- PDF output is encrypted with print-only permissions in Java invoice generation.
- Signature rendering uses static trusted assets loaded from service resources.
- Failure to load signature image degrades gracefully without breaking invoice generation.
- Invoice response is always emitted as `application/pdf` with explicit attachment disposition.

---

## 16. Observability, Health, And Incidents

### Multi-service health

NestJS exposes health state for:

- backend
- database
- ai
- administration

### Incident retention

- retention window controlled by SERVICE_INCIDENT_RETENTION_DAYS
- cleanup interval controlled by SERVICE_INCIDENT_RETENTION_JOB_MS

### Frontend behavior during outages

Next route handlers can provide degraded but explicit service status, helping user-facing pages remain informative.

---

## 17. Page Map And Route Behavior

### Core page slugs resolved by root page

- home
- love-coffee
- coffee
- machines
- subscription
- shopping-bag
- favorites
- account
- payment
- coffee-machine-animation

### Additional route pages in app directory

- /admin
- /favorites
- /payment
- /manage-subscription
- /manage-subscription/privacy-policy
- /services
- /terms-and-conditions
- /sales-refunds
- /kafelot-privacy

### Proxy rewrite concept

Pretty URLs are mapped into page slug query values so the app keeps a centralized rendering shell while preserving navigable URLs.

---

## 18. Screenshots (All Pages)

This section documents every PNG currently in `docs/screenshots`, including what each image represents and the features visible in the UI.

### Screenshot location

- docs/screenshots

### Complete gallery with explanations

#### Home (`home.png`)

![Home](docs/screenshots/home.png)

Main landing experience with hero messaging, primary navigation entry points, and featured commerce sections.

- Highlights onboarding flow into coffee and machine discovery.
- Shows the visual tone and top-level call-to-action hierarchy.

#### Coffee Catalog (`coffee.png`)

![Coffee](docs/screenshots/coffee.png)

Core coffee listing page where users browse capsule products by collection and flavor profile.

- Product cards expose name, imagery, and purchase actions.
- Serves as the primary entry to capsule detail and cart flows.

#### Coffee Types (`coffee_types.png`)

![Coffee Types](docs/screenshots/coffee_types.png)

Coffee taxonomy view focused on type segmentation and browse refinement.

- Emphasizes category discovery across coffee families.
- Supports faster filtering before adding products to cart.

#### Capsule Amount (`capsule_amount.png`)

![Capsule Amount](docs/screenshots/capsule_amount.png)

Quantity/pack-size focused UI used to communicate capsule volume options and selection controls.

- Helps users understand purchase quantity context before checkout.
- Reinforces price/volume decisions in product journey.

#### Machines (`machines.png`)

![Machines](docs/screenshots/machines.png)

Machine catalog page for browsing available coffee machine models.

- Presents machine cards with model visuals and selection actions.
- Connects hardware discovery with commerce and account features.

#### Account Machines (`account_machines.png`)

![Account Machines](docs/screenshots/account_machines.png)

Account-area machine management surface that links user profile context with owned/registered machines.

- Centralizes machine-related actions under the account domain.
- Supports post-purchase hardware lifecycle management.

#### Favorites (`favorites.png`)

![Favorites](docs/screenshots/favorites.png)

Favorites page where users keep a personal shortlist of products for quick return.

- Enables save-for-later behavior and repeat purchase patterns.
- Integrates with card/grid shopping actions.

#### Shopping Bag (`shopping_bag.png`)

![Shopping Bag](docs/screenshots/shopping_bag.png)

Cart interface summarizing selected items and quantities before payment.

- Displays line items and checkout progression controls.
- Acts as validation checkpoint for quantity and selection updates.

#### Payment (`payment_page.png`)

![Payment](docs/screenshots/payment_page.png)

Checkout payment page responsible for final transaction information entry and order confirmation path.

- Hosts payment form UI and order total context.
- Final step in commerce conversion funnel.

#### Orders (`orders.png`)

![Orders](docs/screenshots/orders.png)

Order history/status interface for reviewing previously placed purchases.

- Surfaces transactional timeline and order tracking visibility.
- Supports support/debug workflows for account-specific purchases.

#### Subscription (`subscription.png`)

![Subscription](docs/screenshots/subscription.png)

Subscription product setup view for recurring coffee delivery management.

- Shows plan configuration controls and recurring options.
- Enables retention-focused purchasing model.

#### Subscription Account (`subscription_account.png`)

![Subscription Account](docs/screenshots/subscription_account.png)

Account-specific subscription management area for updating active recurring plans.

- Provides self-service controls over cadence and subscription state.
- Complements the initial subscription enrollment flow.

#### Management Account (`management_account.png`)

![Management Account](docs/screenshots/management_account.png)

Account management dashboard area for identity/profile-related actions.

- Consolidates user-level controls in one administrative panel.
- Acts as a hub for profile and membership interactions.

#### Member Status 1 (`member_status_1.png`)

![Member Status 1](docs/screenshots/member_status_1.png)

Membership status state capture showing one phase of user membership information.

- Communicates loyalty/member tier context.
- Supports account personalization and feature gating.

#### Member Status 2 (`member_status_2.png`)

![Member Status 2](docs/screenshots/member_status_2.png)

Second membership state capture to document alternate membership status presentation.

- Shows conditional UI behavior for different account states.
- Useful for validating membership lifecycle transitions.

#### Spending Analytics (`spending_analytics.png`)

![Spending Analytics](docs/screenshots/spending_analytics.png)

User analytics screen focused on spending trends and account-level purchase metrics.

- Visualizes financial behavior for informed subscription/purchase decisions.
- Useful for retention and engagement feature storytelling.

#### Graphs (`graphs.png`)

![Graphs](docs/screenshots/graphs.png)

Data visualization surface showing charted metrics linked to account or admin intelligence.

- Demonstrates chart components and insight-focused UI.
- Supports analytical product capabilities documentation.

#### Admin (`admin_page.png`)

![Admin](docs/screenshots/admin_page.png)

Administrative dashboard for privileged operations and system-level oversight.

- Includes management controls unavailable to normal users.
- Central point for operational and moderation workflows.

#### Services (`services.png`)

![Services](docs/screenshots/services.png)

Services landing page describing customer support or platform service offerings.

- Captures non-commerce navigation branch of the app.
- Supports informational and support journey continuity.

#### Maintenance (`maintenance.png`)

![Maintenance](docs/screenshots/maintenance.png)

Maintenance/support operations view centered on machine upkeep and serviceability context.

- Documents after-sales support pathways.
- Relates to hardware lifecycle and service scheduling.

#### Warranty Repair (`warranty_repair.png`)

![Warranty Repair](docs/screenshots/warranty_repair.png)

Warranty and repair-specific page for service requests and policy-aligned remediation.

- Highlights support request flow for malfunction scenarios.
- Strengthens trust and post-purchase support documentation.

#### Kafelot (`kafelot.png`)

![Kafelot](docs/screenshots/kafelot.png)

AI assistant experience where users interact with coffee guidance and intelligent suggestions.

- Demonstrates conversational AI surface in product ecosystem.
- Connects recommendation workflow with broader shopping experience.

#### Kafelot Privacy (`kafelot_policy.png`)

![Kafelot Privacy](docs/screenshots/kafelot_policy.png)

Privacy disclosure page specific to Kafelot AI interactions and data handling boundaries.

- Clarifies AI-specific privacy promises and usage constraints.
- Supports compliance and user transparency.

#### Privacy Policy (`privacy_policy.png`)

![Privacy Policy](docs/screenshots/privacy_policy.png)

Global privacy policy page describing data collection, processing, and retention posture.

- Legal transparency for platform-wide data practices.
- Core trust and compliance documentation endpoint.

#### Terms And Conditions (`terms_of_use.png` legacy filename)

![Terms Of Use](docs/screenshots/terms_of_use.png)

Legal terms page covering usage conditions and service boundaries (route now `/terms-and-conditions`).

- Defines contractual framework for using platform features.
- Complements policy and refund/legal navigation pages.

#### Sales And Refunds (`sales_and_refunds.png`)

![Sales And Refunds](docs/screenshots/sales_and_refunds.png)

Commercial policy page documenting sales conditions, returns, and refund expectations.

- Sets user expectations for post-purchase outcomes.
- Reduces support ambiguity in order dispute scenarios.

### Optional automation for screenshot capture

You can automate capture with Playwright/Cypress in CI and export to docs/screenshots using route-by-route scripts.

### Screenshot quality and consistency guidance

- Capture each page in both desktop and mobile breakpoints where possible.
- Keep browser UI (tabs/address bar) outside the image frame.
- Use PNG for UI fidelity, especially where text overlays gradients.
- Keep naming consistent with the screenshot index in `docs/README.md` so gallery links remain valid.
- Prefer deterministic captures after data is loaded (avoid intermediate loading states).

---

## 19. Testing, Validation, And Quality Gates

This repository currently ships two GitHub Actions workflows that together enforce CI quality and deployment policy posture:

- `.github/workflows/security-ci.yml`
- `.github/workflows/enforce-cluster-security-policies.yml`

It focuses on build integrity and dependency security for frontend, backend, and Python layers.

### CI workflow summary

Workflow name:

- `Security CI`

Triggers:

- push to any branch
- pull request events
- manual run from GitHub Actions UI (`workflow_dispatch`)

Execution platform:

- `ubuntu-latest`

### CI jobs and checks (what runs in GitHub)

1. Frontend Security Checks

- install dependencies with `npm ci` (root)
- run `npm run lint`
- run `npm run build`
- run `npm audit --audit-level=high`

2. Backend Security Checks

- working directory: `nestjs-backend`
- install dependencies with `npm ci`
- run `npm audit --audit-level=high`

3. Python Dependency Audit

- install `pip-audit`
- run `pip-audit -r requirements.txt`
- run `pip-audit -r models/requirements.txt`

### How to run CI from GitHub UI

1. Open the repository on GitHub.
2. Go to the `Actions` tab.
3. Select `Security CI` in the left panel.
4. Click `Run workflow`.
5. Choose branch and confirm `Run workflow`.
6. Open the run to inspect per-job logs and failures.

---

## 20. Unified Documentation Atlas (Titan V0.74)

This section is a consolidated, repository-wide markdown digest intended to centralize architecture, security, service ownership, and operations.

It complements the service-level README files and the docs compendium, and it is intended to function as the single top-level navigation and synthesis point.

### 20.1 Canonical Documentation Sources

Primary architecture and program docs:

- `docs/README.md`

Evidence and diagram docs:

- `docs/README.md` (screenshot and diagram gallery)
- `docs/uml/*.mmd`

Infrastructure and secret docs:

- `infrastructure/README.md`
- `infrastructure/terraform/transparency-backend/README.md`
- `secrets/README.md`

Service-level docs:

- `nestjs-backend/README.md`
- `go-ops-service/README.md`
- `java-invoice-service/README.md`
- `kotlin-subscription-service/README.md`
- `models/README.md`
- `rust-crypto-service/README.md`
- `rust-wasm/README.md`
- `scripts/README.md`
- `security/README.md`

### 20.2 Combined Architecture Narrative

The platform architecture follows a layered trust and control model:

1. Client and edge shield

- Next.js frontend and edge proxy controls
- CSP, secure headers, route-level constraints, and anti-CSRF protections

2. Identity and policy plane

- workload/service identity controls
- short-lived assertions and policy decisions through OPA integration paths

3. Cryptographic control plane

- deterministic commitment and verification services
- replay-aware assertion checks
- key usage policy boundaries for sensitive operations

4. Domain service plane (polyglot)

- NestJS orchestration service
- Java invoice rendering service
- Kotlin subscription quote/reconciliation service
- Go operational ingestion service
- Python AI service plus model runtime integrations

5. Data and audit vault

- PostgreSQL-backed domain state and security ledger tables
- hash-chained tamper evidence and ledger verification flows
- anchoring and archival automation

### 20.3 Service Topology Summary

Frontend and gateway:

- Next.js app router and frontend APIs

Core backend:

- NestJS API: auth, commerce, operations, security telemetry orchestration

Polyglot domain services:

- Go Ops (`go-ops-service`): operational event ingestion/stats with assertion and optional mTLS support
- Java Invoice (`java-invoice-service`): PDF rendering pipeline with deterministic formatting
- Kotlin Subscriptions (`kotlin-subscription-service`): pricing quote and reconciliation rules
- Rust Crypto (`rust-crypto-service`): commitment and verification endpoints with optional strict assertion verification
- Rust WASM (`rust-wasm`): deterministic client commitment and witness preprocessing helpers

Data and infrastructure:

- PostgreSQL + Redis
- OPA policy engine
- Terraform transparency backend module for external immutable anchoring support

### 20.4 Security Program Consolidation

From all security markdown sources, the active control themes are:

- supply-chain trust
    - CI policy drift checks
    - image signature policy templates and admission enforcement path

- runtime hardening
    - hardened compose overlay with reduced privileges and segmented networks
    - secret loading through env plus `*_FILE` pattern

- service trust boundaries
    - service assertion verification
    - operation-scoped and replay-aware control checks

- cryptographic evidence
    - tamper-evident ledger
    - periodic anchor publication
    - incident-time integrity verification scripts

- observability and response
    - dashboard-ready security endpoints
    - severity-based anomaly workflows
    - containment and post-incident runbooks

### 20.5 Combined Checklist And Backlog View

When the implementation checklist and gap-closure backlog are merged, the current program state can be summarized as:

- implemented in repository
    - foundational policy-plane and assertion primitives
    - security ledger and verification paths
    - archive/anchor automation scripts
    - hardened compose profile and multiple runtime safeguards

- partially implemented and requiring rollout completion
    - cluster-side enforcement of admission and policy controls
    - full service-edge assertion coverage in production topology
    - complete key lifecycle automation with external custody systems
    - full observability dashboard and alert ownership execution

- external/platform dependencies
    - managed KMS/HSM operational integration
    - immutable transparency backend production provisioning
    - independent review and red-team closure cycles

### 20.6 Documentation Operating Model

To keep docs synchronized with implementation:

1. Update service-specific README files when routes, env vars, ports, or contracts change.
2. Update `docs/README.md` and `security/README.md` whenever security workflow behavior changes.
3. Update checklist and backlog sections in README files after each merged milestone.
4. Keep diagram sources under `docs/uml/` in sync with compose and runtime flows.
5. Preserve this atlas as the root entrypoint for architecture and operations context.

### 20.7 Repository Structure Snapshot

High-level folder intent:

- `src/`: Next.js app and frontend components
- `nestjs-backend/`: orchestration backend and security automation
- `go-ops-service/`: operational event plane
- `java-invoice-service/`: invoice PDF domain service
- `kotlin-subscription-service/`: subscription quote/reconciliation domain service
- `rust-crypto-service/`: cryptographic verification microservice
- `rust-wasm/`: browser-side crypto helper module
- `models/`: optional model-related assets and compatibility dependencies
- `scripts/`: automation and validation scripts
- `security/`: policy and hardening artifacts
- `docs/`: human-readable architecture, security, screenshot, and checklist documentation
- `infrastructure/`: Terraform IaC for external support systems

### 20.8 Final Consolidated Note

Titan V0.74 in this repository is not a single feature; it is a defense-in-depth program spanning code, policy, runtime, and operations.

The practical success criteria are:

- secure-by-default runtime posture
- deterministic and verifiable cryptographic workflows
- testable policy enforcement
- auditable incident and recovery pathways
- continuously maintained documentation tied to real implementation state

### How to run the same checks locally (CI parity)

Run these commands before pushing to reduce CI failures.

Frontend (repo root):

```bash
npm ci
npm run lint
npm run build
npm audit --audit-level=high
```

Backend (`nestjs-backend`):

```bash
cd nestjs-backend
npm ci
npm audit --audit-level=high
```

Python audits (repo root):

```bash
python -m pip install --upgrade pip pip-audit
pip-audit -r requirements.txt
pip-audit -r models/requirements.txt
```

Windows note:

- If `pip-audit` is not recognized, run with `python -m pip_audit -r requirements.txt`.

### Pass/fail policy

The workflow fails when any of the following happen:

- frontend lint or build fails
- high severity npm vulnerabilities are detected in frontend or backend
- `pip-audit` reports unresolved vulnerable Python dependencies

### Fast troubleshooting for CI failures

1. If frontend lint fails:

- run `npm run lint` locally and fix exact file-level errors first

2. If frontend build fails:

- run `npm run build` locally
- verify environment-dependent code paths and API URL configuration

3. If npm audit fails:

- run `npm audit --audit-level=high`
- update vulnerable packages with targeted upgrades
- re-run lint/build after upgrades

4. If pip-audit fails:

- inspect vulnerable package/version in output
- update `requirements.txt` and/or `models/requirements.txt`
- rerun both `pip-audit` commands

### Recommended CI expansion (next step)

- add unit/integration tests for NestJS routes
- add Next.js component/page tests
- add E2E smoke tests (login, browse, cart, checkout)
- add DB migration validation job for schema safety
- add a status badge for CI visibility in this README

---

## 20. Deployment Guide

### Production topology

- Next.js web service/container
- NestJS API service/container
- Python AI service/container
- PostgreSQL managed DB or HA cluster
- reverse proxy and TLS termination

### Deployment sequence

1. Provision database and extensions
2. Deploy NestJS and confirm /health
3. Deploy Python AI and confirm /api/health
4. Deploy Next.js and verify frontend integration
5. Execute smoke flows: login, browse, cart, checkout, AI chat

### Recommended hardened deployment command

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml up --build -d
```

### Post-deploy security verification

1. Check service health and dependency graph:

```bash
docker compose -f docker-compose.yml -f docker-compose.security.yml ps
curl -sS http://localhost:4000/health/services | jq
```

2. Verify ledger integrity:

```bash
curl -sS -H "x-service-events-key: <SERVICE_EVENTS_API_KEY>" "http://localhost:4000/health/services/ledger/verify?chainScope=service-health&maxRows=10000" | jq
```

3. Verify container hardening posture:

```bash
docker inspect filspresso_backend --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}}'
```

### Release checklist

- environment variables verified
- migrations/bootstrap validated
- health checks green
- rollback path prepared
- backup snapshot taken before schema-impacting release

---

## 21. Troubleshooting Playbook

### Frontend cannot fetch backend

- verify NEXT_PUBLIC_API_URL
- verify backend container status
- verify CORS_ORIGIN allows current host/port

### AI route fails from frontend

- verify PYTHON_AI_HOST
- check ai container logs
- check model cache volume permissions

### Stock conflict errors in cart

- expected when request exceeds reservable stock
- inspect reservation window and stock buffer settings
- ensure variant IDs are canonical and not cross-mapped

### Coffee page stock feels slow

- verify browser network tab only shows one GET /api/products/coffee call on initial coffee page load
- if two calls appear, ensure stock data is sourced from useCoffeeCollections instead of a separate stock fetch
- in backend, verify coffee image metadata is populated (image_filename/image_extension) to avoid expensive runtime fallback logic
- check database indexes for coffee_products(product_id), coffee_products(product_type), and coffee_products(category)
- if needed, preload or cache product payloads at app startup for high-traffic environments

### Docker stack unhealthy

- run docker compose ps
- inspect specific service logs
- verify DB credentials and dependency ordering

### Hardened profile fails to start

- confirm real secret files exist under `secrets/` and are non-empty
- verify `security.env.example` (or your env file) points to valid secret file paths
- run `docker compose -f docker-compose.yml -f docker-compose.security.yml config` to inspect merged configuration
- if redis auth errors occur, confirm `redis_password.txt` matches `REDIS_PASSWORD_FILE` path

### Ledger verification reports mismatch

- stop write traffic to the affected chain scope
- run NestJS security ledger verification for a wider scan
- export `security_event_ledger` rows and incident records for forensic review
- treat mismatches as potential integrity incidents and execute key-rotation + incident-response playbook

### Invoice PDF has missing signature

- verify `public/images/Filspresso_Signature_Invoice.png` exists and is readable
- verify `java-invoice-service/src/main/resources/signature/filspresso-signature.png` exists in the built image
- rebuild invoice service with `docker compose up --build invoice_java -d`
- check invoice service logs for resource-load failures

### start_all script exits with code 1

- run docker compose command directly and inspect output
- run npm run dev manually to isolate frontend startup issue
- ensure no conflicting process already occupies port 3000

---

## 22. Contributor Guidelines

### Branching

- create feature branch from active integration branch
- keep commits scoped and reviewable
- include migration notes if schema behavior changes

### Coding standards

- preserve API compatibility whenever possible
- avoid optimistic UI messages when backend operation failed
- keep security middleware enabled except intentional local diagnostics
- write explicit and stable error payloads for frontend consumers

### Documentation standards

- update this README when adding services, route groups, env vars, or operational behavior
- update screenshot section when UI pages materially change

---

## 23. Operational Runbook

### Daily operations

- verify service health endpoints
- monitor incident event volume
- inspect cart/order conflict trends for stock tuning

### Weekly operations

- review service incident retention status
- verify backup restore path
- refresh dependency security scans

### Incident response outline

1. detect via health endpoint degradation
2. identify failing service and upstream dependency
3. apply rollback or restart strategy
4. verify functional smoke tests
5. document postmortem and preventive fixes

---

## 24. Known Gaps And Suggested Next Improvements

- Add OpenAPI specs for NestJS and Python APIs
- Add route-level formal contracts (JSON schema)
- Add CI job that captures screenshots for all pages and updates docs/screenshots automatically
- Add full observability stack (metrics + traces + alerting)
- Add canary/blue-green deployment strategy

---

## 25. Image Assets And Media Pipeline

This section explains how image files are organized, used by the app, and maintained.

### Public image structure

- `public/images/Capsules/Original` and `public/images/Capsules/Vertuo` hold capsule product visuals.
- `public/images/Machines/Original` and `public/images/Machines/Vertuo` hold machine product visuals.
- `public/images/Payment` stores payment-brand logos shown in payment UX.
- `public/images/svg` stores beverage-size and coffee-type icon assets.
- `public/images/icons` stores generated/user icon outputs.
- `public/images/Filspresso_Signature_Invoice.png` stores the invoice signature image used by the Java PDF renderer.

### How images are consumed in the app

- Catalog pages map product metadata to image paths under `public/images/...`.
- Legal, account, and marketing surfaces use shared static brand/media assets.
- Admin/backend flows can read and write image files through mounted volumes in Docker (`./public/images:/public/images`).

### Docker and persistence implications

- The backend service mounts the host `public/images` folder, so uploads/changes survive container restarts.
- In multi-instance production setups, replace local filesystem assumptions with object storage (S3-compatible, Blob, etc.).

### Image maintenance recommendations

- Keep naming stable and lowercase where possible to avoid case-sensitivity issues across platforms.
- Prefer modern compressed formats for photos (`.avif`, `.webp`) and SVG for icons.
- Maintain consistent aspect ratios per category to avoid layout shift.
- Add basic image QA checks during releases (missing files, broken paths, oversized assets).
- Keep legal/brand-critical assets versioned and reviewed.

---

## 26. Why These New Languages And Where

Filspresso keeps a NestJS-first architecture and adds other languages only for narrowly scoped workloads where they are clearly better.

### Selection principles

- Keep checkout, account, auth, and cart flows in NestJS to avoid fragmentation of core commerce logic.
- Add a new runtime only when it gives a measurable gain in one domain (performance, tooling maturity, or maintainability).
- Isolate each specialized runtime behind stable HTTP boundaries so it can evolve independently.

### Language-to-domain mapping

| Technology            | Where it is used                                       | Why it was chosen                                                             | Why not keep it in Node only                                                                  |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Java 17 + Spring Boot | `java-invoice-service` (`/api/invoices/render`)        | Strong PDF ecosystem, reliable document rendering, predictable layout control | PDF generation quality and long-term maintainability are better with mature JVM PDF libraries |
| Kotlin + Spring Boot  | `kotlin-subscription-service` (`/api/subscriptions/*`) | Null-safety and concise business-rule code for pricing/reconciliation         | Subscription rules grow quickly; Kotlin reduces boilerplate and runtime null bugs             |
| Go 1.22               | `go-ops-service` (`/events/ingest`, `/health`)         | Fast startup, low memory use, simple concurrency model for ops/event traffic  | Operational/event paths benefit from lightweight services without Node event-loop coupling    |
| Redis 7               | shared service used by `go-ops-service`                | Durable shared event history across deploys and multi-instance Go ops traffic | In-memory slices are fast but lose history on restart and split state per instance            |

### Why this polyglot split is intentional

- It preserves stability in high-risk flows (payments/orders) by keeping them in the existing proven NestJS layer.
- It avoids a big-bang rewrite and allows incremental migration by domain.
- It improves performance where needed without overcomplicating every service.
- It keeps ownership clear: each service has one primary responsibility.

---

## 27. Why PostgreSQL Over MySQL Or MariaDB Here

PostgreSQL is the best fit for Filspresso because the platform combines commerce transactions, AI/vector retrieval, and chemistry-oriented extensions.

### Direct comparison for this codebase

| Requirement in Filspresso                  | PostgreSQL                                                                     | MySQL/MariaDB                                                        | Decision impact                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| Vector retrieval and semantic similarity   | Mature pgvector workflows already integrated                                   | Requires different ecosystem and query rewrite patterns              | PostgreSQL minimizes implementation risk          |
| Chemistry/extension-heavy stack            | Extension model aligns with current setup (including rdkit-oriented workflows) | Equivalent extension path is weaker or incompatible                  | PostgreSQL supports current architecture directly |
| Checkout consistency and stock reservation | Strong transactional behavior used with lock-based flows (`FOR UPDATE`)        | Can be implemented, but would require retesting and query adaptation | PostgreSQL keeps current concurrency model stable |
| Existing SQL, scripts, and migrations      | Current repo scripts and schema are PostgreSQL-oriented                        | Port would require broad SQL and behavior migration                  | PostgreSQL avoids expensive migration work        |

### Why this matters operationally

- Faster delivery: no database-porting project before shipping new features.
- Lower risk: existing production logic remains aligned with tested DB behavior.
- Better maintainability: one coherent data platform for AI + commerce + ops.

### Practical conclusion

For Filspresso, PostgreSQL is not only "good enough"; it is the database that best matches features already implemented and the roadmap (AI retrieval, extension use, transactional commerce).

---

## Appendix A: Command Reference

### Root

- npm run dev
- npm run build
- npm run start
- npm run lint

### NestJS

- npm run dev
- npm start

### Docker

- docker compose up --build -d
- docker compose logs -f backend
- docker compose logs -f ai
- docker compose down

---

## Appendix B: Important Files

- docker-compose.yml
- nestjs-backend/Dockerfile
- nestjs-backend/src/main.ts
- nestjs-backend/src/app.module.ts
- nestjs-backend/src/auth/auth.controller.ts
- nestjs-backend/src/cart/cart.controller.ts
- nestjs-backend/src/orders/orders.controller.ts
- nestjs-backend/src/products/products.controller.ts
- nestjs-backend/src/subscriptions-engine/subscriptions-engine.controller.ts
- nestjs-backend/data/schema.sql
- go-ops-service/main.go
- java-invoice-service/src/main/java/com/filspresso/invoice/InvoiceController.java
- java-invoice-service/src/main/java/com/filspresso/invoice/SignatureStampRenderer.java
- java-invoice-service/src/main/resources/signature/filspresso-signature.png
- kotlin-subscription-service/src/main/kotlin/com/filspresso/subscriptions/SubscriptionController.kt
- public/images/Filspresso_Signature_Invoice.png
- src/app/page.tsx
- src/app/terms-and-conditions/page.tsx
- src/app/manage-subscription/privacy-policy/page.tsx
- proxy.ts
- next.config.ts
- app.py
- iot_db.py

---

## Appendix C: Source File Index (Snapshot)

This snapshot is source-focused and excludes generated/dependency-heavy directories such as `.next`, `node_modules`, `.git`, and virtual environments.

### Root files

- `.dockerignore`
- `.env`
- `.gitignore`
- `app.py`
- `docker-compose.yml`
- `Dockerfile.ai`
- `Dockerfile.db`
- `Dockerfile.nestjs`
- `eslint.config.mjs`
- `filspresso_next.code-workspace`
- `FilspressoNext.session.sql`
- `global.d.ts`
- `iot_db.py`
- `LICENSE`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `proxy.ts`
- `README.md`
- `requirements.txt`
- `seed_vectors.py`
- `tailwind.config.cjs`
- `train.py`
- `tsconfig.json`

### docs/

- `docs/README.md`
- `docs/screenshots/` (gallery image folder)
- `docs/uml/` (UML SVG snapshots)

### nestjs-backend/

- `nestjs-backend/src/main.ts`
- `nestjs-backend/src/app.module.ts`
- `nestjs-backend/src/app.controller.ts`
- `nestjs-backend/src/app.service.ts`
- `nestjs-backend/src/auth/auth.controller.ts`
- `nestjs-backend/src/auth/auth.service.ts`
- `nestjs-backend/src/auth/auth.module.ts`
- `nestjs-backend/src/accounts/accounts.controller.ts`
- `nestjs-backend/src/admin/admin.controller.ts`
- `nestjs-backend/src/cards/cards.controller.ts`
- `nestjs-backend/src/cart/cart.controller.ts`
- `nestjs-backend/src/chat/chat.controller.ts`
- `nestjs-backend/src/favorites/favorites.controller.ts`
- `nestjs-backend/src/health/health.controller.ts`
- `nestjs-backend/src/kafelot/kafelot.controller.ts`
- `nestjs-backend/src/operations/operations.controller.ts`
- `nestjs-backend/src/orders/orders.controller.ts`
- `nestjs-backend/src/products/products.controller.ts`
- `nestjs-backend/src/repairs/repairs.controller.ts`
- `nestjs-backend/src/security-observability/security-observability.controller.ts`
- `nestjs-backend/src/subscriptions/subscriptions.controller.ts`
- `nestjs-backend/src/subscriptions-engine/subscriptions-engine.controller.ts`
- `nestjs-backend/src/weather/weather.controller.ts`
- `nestjs-backend/src/crypto/crypto.controller.ts`
- `nestjs-backend/src/config/configuration.ts`
- `nestjs-backend/src/config/env.validation.ts`
- `nestjs-backend/src/database/database.module.ts`
- `nestjs-backend/src/database/ensureAppSchema.ts`
- `nestjs-backend/data/schema.sql`
- `nestjs-backend/data/extensions.sql`

### models/

- `models/__init__.py`
- `models/requirements.txt`
- `models/tanka.py`
- `models/data/capsule_volumes.json`
- `models/data/chembl-molecules.json`
- `models/data/coffee_chunks.json`
- `models/model/swin_base_char_aux_200k.pth`

### public/

- `public/data/chembl-molecules.json`
- `public/fonts/` (Poppins and calligraphy font assets)
- `public/images/Capsules/Original`
- `public/images/Capsules/Vertuo`
- `public/images/Machines/Original`
- `public/images/Machines/Vertuo`
- `public/images/Payment`
- `public/images/icons`
- `public/images/svg`

### scripts/

- `scripts/addCoffeeNotes.mjs`
- `scripts/extractCoffeeData.mjs`
- `scripts/extractMachinesData.mjs`
- `scripts/remove_render_graph.py`
- `scripts/replace_sections.py`
- `scripts/start_all.bat`
- `scripts/esp32/esp32_coffeemachine.ino`

### src/

- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/favorites/page.tsx`
- `src/app/kafelot-privacy/page.tsx`
- `src/app/manage-subscription/layout.tsx`
- `src/app/manage-subscription/page.tsx`
- `src/app/manage-subscription/privacy-policy/page.tsx`
- `src/app/payment/layout.tsx`
- `src/app/payment/page.tsx`
- `src/app/sales-refunds/page.tsx`
- `src/app/services/page.tsx`
- `src/app/terms-and-conditions/page.tsx`
- `src/app/api/chat/route.ts`
- `src/app/api/chat/save/route.ts`
- `src/app/api/model/route.ts`
- `src/app/api/python-chat/route.ts`
- `src/app/api/python-health/route.ts`
- `src/app/api/services-health/route.ts`
- `src/app/api/subscribe/route.ts`
- `src/data/chat_history.json`
- `src/data/coffee.generated.json`
- `src/data/coffee.ts`
- `src/data/machines.generated.json`
- `src/data/machines.ts`
- `src/hooks/useCart.ts`
- `src/hooks/useCoffeeCollections.ts`
- `src/hooks/useMachineCollections.ts`
- `src/components/` (feature modules and page content components)
- `src/icons/` (large icon library)
- `src/lib/`
- `src/styles/`
- `src/types/`

For a refreshed snapshot, run the same tree command used during documentation updates and sync this appendix.

---

This README is intentionally extensive and operations-focused so new contributors, maintainers, and deployment engineers can use one document for onboarding, development, debugging, and release execution.

---

## 28. April 2026 Complete Update Ledger (Everything Current)

This section is the explicit "what is live in this repository now" ledger.

It is intended to remove ambiguity for maintainers by listing the latest runtime, security, documentation, and operations model in one place.

### 28.1 Documentation Model (Repository Policy)

Current policy:

- Documentation is consolidated into README files.
- Non-README markdown docs were folded into README coverage.

Primary documentation entrypoints:

- root system handbook: `README.md`
- docs atlas with screenshot and UML galleries: `docs/README.md`
- security controls and rollout boundaries: `security/README.md`
- service-level runbooks:
- `nestjs-backend/README.md`
    - `go-ops-service/README.md`
    - `java-invoice-service/README.md`
    - `kotlin-subscription-service/README.md`
    - `rust-crypto-service/README.md`
    - `rust-wasm/README.md`
    - `models/README.md`
    - `scripts/README.md`
    - `infrastructure/README.md`
    - `infrastructure/terraform/transparency-backend/README.md`
    - `secrets/README.md`

### 28.2 Service Runtime And Port Matrix

| Service               | Stack        | Compose Name                       | Primary Port | Purpose                                        |
| --------------------- | ------------ | ---------------------------------- | ------------ | ---------------------------------------------- |
| Web frontend          | Next.js      | `frontend` (root app runtime path) | 3000 (dev)   | UI and edge routing                            |
| API backend           | Node/NestJS | `backend`                          | 4000         | Commerce orchestration + security control APIs |
| AI service            | Python       | `ai`                               | 5000         | AI and model-assisted workflows                |
| Ops ingest            | Go           | `go_ops`                           | 8083         | Event ingestion and bounded ops history        |
| Invoice service       | Java         | `invoice_java`                     | 8082         | PDF invoice rendering                          |
| Subscriptions service | Kotlin       | `kotlin_subscriptions`             | 8084         | Pricing quote and reconcile logic              |
| Crypto service        | Rust         | `rust_crypto`                      | 8090         | Commit/verify cryptographic endpoints          |
| Policy engine         | OPA          | `opa`                              | 8181         | Authorization policy decision plane            |
| Database              | PostgreSQL   | `postgres`                         | 5432         | Primary transactional and ledger data          |
| Cache/event store     | Redis        | `redis`                            | 6379         | Operational event/state support                |

### 28.3 Core API Surface Snapshot

Backend (`nestjs-backend`) high-value endpoints:

- `/health`
- `/health/services`
- `/health/security/observability`
- `/health/security/alerts`
- `/health/security/alerts/dispatch`
- `/health/services/events`
- `/health/services/events/bulk`
- `/health/services/ledger/verify`

Go Ops endpoints:

- `/health`
- `/events/ingest`
- `/events/stats`

Rust Crypto endpoints:

- `/health`
- `/v1/commitment/sha3-256`
- `/v1/verify/sha3-256`

Invoice service endpoints:

- `/api/invoices/health`
- `/api/invoices/render`

Kotlin subscriptions endpoints:

- `/api/subscriptions/health`
- `/api/subscriptions/quote`
- `/api/subscriptions/reconcile`

### 28.4 Security Control Snapshot (Implemented vs Rollout)

Implemented in repository code/config:

- signed service assertion verification on critical internal paths
- OPA policy integration path and policy asset source
- CSRF origin/fetch metadata guard tightening for backend unsafe requests
- tamper-evident ledger append and verification workflows
- archive and anchoring automation scripts
- hardened compose overlay controls (read-only rootfs, seccomp, dropped caps, no-new-privileges)
- deploy-signature policy assets and local CI drift checks

Requires external platform rollout for completion:

- cluster-level admission enforcement in live environments
- production immutable transparency backend provisioning
- managed KMS/HSM custody and revocation workflows
- external independent security/crypto review cycles

### 28.5 Docker Profiles And Operational Modes

Standard profile:

```bash
docker compose up --build -d
```

Hardened profile:

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml up --build -d
```

Compose policy and merge validation:

```bash
docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml config
```

### 28.6 Verification And Test Matrix

Primary stack verification command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_titan_v0_74_tests.ps1 -SkipSignedHistory
```

Policy-focused checks:

```bash
node scripts/verifyDeploySignaturePolicy.mjs
node scripts/verifyDockerfileBaseImages.mjs
```

Backend assertion matrix:

```bash
npm --prefix nestjs-backend run test
```

Ledger verification:

```bash
powershell -ExecutionPolicy Bypass -File .\tests\run-all-tests-no-integration.ps1
```

### 28.7 Secrets And Key Material Workflow

Bootstrap secrets from env:

```bash
node scripts/bootstrapSecretsFromEnv.mjs --env-file .env --out-dir secrets --force
```

Generate local mTLS materials:

```bash
node scripts/generateDevMtlsCerts.mjs
```

Critical safety rule:

- Secret runtime files remain local operational assets and are not committed.

### 28.8 Infrastructure And External Anchor Path

Terraform module:

- `infrastructure/terraform/transparency-backend`

Provisioning focus:

- object-lock-enabled S3 backend
- KMS-encrypted anchor objects
- write-only publisher IAM policy

Baseline Terraform workflow:

```bash
cd infrastructure/terraform/transparency-backend
terraform init
terraform fmt
terraform validate
terraform plan -var-file=environment.tfvars
terraform apply -var-file=environment.tfvars
```

### 28.9 Incident And Recovery Quick Path

1. Detect:

- observe `/health/security/observability` and `/health/security/alerts`.

2. Contain:

- execute containment playbook via NestJS security scripts.

3. Verify integrity:

- run ledger verification and post-incident checks.

4. Archive evidence:

- run archive workflow for incident window.

5. Recover:

- validate service health matrix and critical business flows.

### 28.10 Maintainer Execution Checklist

Before merge:

- run local lint/build/tests for touched stacks
- run policy and image verification scripts
- run PowerShell end-to-end verification suite
- confirm docs updates in relevant README files

Before release:

- hardened compose config validates
- critical services report healthy
- ledger verification passes
- rollback path documented

After release:

- monitor security observability endpoints
- monitor incident stream and dependency health
- update README-ledger sections with newly shipped controls

### 28.11 Integrated Titan V0.74 Architecture (Implementation-Focused)

This section integrates the architecture blueprint directly into the operational handbook.

Mission in implementation terms:

- enforce least-privilege trust boundaries between services
- prove integrity with tamper-evident security records
- keep security controls testable through scripts, endpoints, and CI checks

Security objectives mapped to implementation:

| Objective       | Current Implementation                                                                           | How To Verify                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confidentiality | secret loading via env and `*_FILE`; hardened compose profile; internal-network segmentation     | run `docker compose --env-file security.env.example -f docker-compose.yml -f docker-compose.security.yml config` and verify secret file paths and network scoping |
| Integrity       | hash-chained security ledger + verification endpoint + CLI verifier                              | run NestJS ledger verification and `/health/services/ledger/verify`                                                                    |
| Availability    | multi-service health endpoints + bounded request middleware + resilient compose dependency model | check `/health`, `/health/services`, and `docker compose ps`                                                                                                      |
| Verifiability   | policy scripts, deploy signature policy assets, repeatable tests                                 | run `node scripts/verifyDeploySignaturePolicy.mjs` and `scripts/run_titan_v0_74_tests.ps1`                                                                        |
| Operability     | README-first runbooks and service-level contracts                                                | review this file and all service `README.md` files                                                                                                                |

Layered architecture mapped to what is implemented now:

| Layer                                | Implemented In Repo                                                                                                        | Implementation Status                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Layer A: Client and Edge Shield      | edge request policy headers, tightened backend origin/fetch-metadata guard, route hardening in frontend/backend boundaries | partial to strong baseline                                 |
| Layer B: Identity and Policy Plane   | JWT identity flows, service assertions, OPA policy gate integration, deny-by-default hardened compose posture              | strong baseline, rollout-dependent completion              |
| Layer C: Cryptographic Control Plane | rust-crypto commitment/verify APIs, key-usage policy utilities, replay-aware assertion checks                              | strong baseline                                            |
| Layer D: Domain Service Plane        | polyglot service split with explicit HTTP boundaries, service assertion filters, per-service contracts                     | strong baseline with ongoing least-privilege hardening     |
| Layer E: Data and Audit Vault        | append-only security ledger, chain verification, archive/anchor automation scripts                                         | strong baseline with external transparency rollout pending |

Threat model translated to active controls:

1. External attackers:

- route-level validation, auth middleware, rate limiting, policy checks, observability endpoints.

2. Malicious insider / key misuse risk:

- service assertion scoping, key usage policy controls, ledgered critical security events.

3. Supply chain and deploy tampering:

- deploy signature policy assets, base image verification scripts, CI vulnerability gates.

4. Runtime lateral movement risk:

- hardened compose profile, seccomp controls, read-only rootfs, reduced capabilities, internal networks.

5. Audit/log tampering risk:

- tamper-evident chain verification and anchoring workflow.

ZK and MPC integration status (implementation-first):

- ZK helper path present with deterministic rust-wasm preprocessing and backend verification plumbing.
- MPC/threshold workflow support exists for critical operation classes.
- Full production-grade rollout remains gated on external assurance and platform maturity checkpoints.

Key management status:

- implemented: key provider abstraction, lifecycle automation hooks, managed key rotation scripts.
- pending platform rollout: full external KMS/HSM custody and automated revocation operations.

Definition-of-done posture today:

- repository-level engineering controls: strong and testable.
- platform rollout requirements: still required for full-assurance closure.

### 28.12 Final Practical Statement

Filspresso documentation and operations are aligned around a README-first model with architecture and implementation context consolidated in this root handbook.

This root README should always be treated as the canonical operational source, while folder/service READMEs provide local contract detail and implementation context.
