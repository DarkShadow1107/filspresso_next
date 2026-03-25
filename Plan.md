# Filspresso Multi-Language Plan

This plan adds Go, Kotlin, Java, and C++ with WebAssembly to the existing Filspresso Next stack without replacing the current backend.

## Core rule

Keep Express as the main orchestration and commerce API layer. Add new services only where they provide clear value.

## What stays in Express

Keep Express for the parts that already fit the current Node.js backend well:

- authentication and session management
- cart and checkout orchestration
- product catalog APIs
- favorites and account APIs
- admin API routing and health aggregation
- request validation and API gateway behavior
- cross-service coordination between Next.js, Python AI, and new services

Express should remain the main integration point between the frontend and the rest of the backend services.

## Recommended order

### 1. Add Go first

Use Go for a small operational service with low runtime overhead.

Best uses:

- webhook receiver
- notification dispatcher
- telemetry or event ingestion
- background sync worker
- health/event collector
- lightweight queue worker

Why first:

- smallest operational cost
- fast startup and easy containerization
- good way to introduce one extra language without affecting commerce logic

Container role:

- one dedicated Go container
- expose a simple REST health endpoint
- called by Express for event or worker-style tasks

### 2. Add Kotlin as the primary JVM service

Use Kotlin for the main JVM service.

Best uses:

- subscription engine
- promotions and pricing rules
- order reconciliation
- billing logic
- admin reporting

Why Kotlin over Java as the default:

- concise syntax
- strong null-safety
- good fit for business logic and service code
- easier to keep the codebase compact than Java for new work

Container role:

- one dedicated Kotlin container
- owns the main business-domain service
- called by Express over HTTP or gRPC

### 3. Use Java only where it is clearly better than Kotlin

Java should not be the primary JVM language for this project. Use it only when a Java-specific advantage exists.

Best uses:

- PDF or invoice generation
- enterprise integrations
- batch jobs
- library-heavy tasks
- legacy-compatible modules

Why Java still matters:

- mature ecosystem
- broad library support
- easier fit for some enterprise SDKs and document tools

Container role:

- either a small Java-only container for a specific library-heavy service
- or no separate Java service if Kotlin covers the need

Recommended rule:

- prefer Kotlin for new backend code
- use Java only when a dependency or integration makes it the better choice
- do not create separate Java and Kotlin services unless the workloads are clearly different

### 4. Add C++ with WebAssembly after the backend services

Use C++ plus WebAssembly for client-side performance hotspots where math speed matters.

Best uses:

- image preprocessing before AI calls
- vector math and ranking in the browser
- molecule or diagram rendering helpers
- barcode or QR parsing
- local scoring or filtering before network requests
- UI-side simulation or chart computation

Priority in this project:

1. QR and barcode parsing helpers
2. image preprocessing before AI calls
3. local vector scoring and filtering
4. molecule and diagram rendering helpers
5. UI-side chart or simulation computation

Implementation intent for C++/Wasm:

- use C++ for camera-frame preprocessing (grayscale, binarization, contrast normalization)
- use C++ for QR finder-pattern scoring and scan candidate filtering
- keep final decode pluggable: C++ decoder path can be added later when needed
- run lightweight local ranking before sending requests to backend services
- use JavaScript only as orchestration glue around Wasm calls

Why after the backend services:

- it adds build complexity
- it is most useful once you already know where browser math is the bottleneck
- it should be introduced only for measurable performance wins

Container role:

- keep the native build toolchain in its own container if server-side compilation is needed
- the WebAssembly output itself should mainly be consumed by the frontend
- if you need server-side Wasm compilation or testing, use a dedicated build container

## Java and Kotlin split

Use Kotlin as the default JVM language and Java as the exception.

### Kotlin responsibilities

- subscription engine
- promotions
- order reconciliation
- billing logic
- admin reporting

### Java responsibilities

- PDF and invoice generation
- enterprise integrations
- batch jobs
- library-heavy tasks

If you only want one JVM service, make it Kotlin-first and use Java libraries inside it when needed.

## Container plan

Each language/runtime should have its own container:

- Express container: current backend orchestration and commerce API
- Go container: worker, webhook, telemetry, or notification service
- Kotlin container: main business-domain service
- Java container: only if you need a separate Java-only subsystem
- C++/Wasm build container: compile and test native modules if needed

## Suggested implementation phases

### Phase 1: Lock the boundaries

- keep Express as the main API entry point
- define which endpoints stay in Express
- define which calls move to Go or Kotlin
- define which browser tasks are candidates for Wasm

### Phase 2: Add Go

- create a Go service repository or folder
- add Dockerfile and health endpoint
- connect Express to the Go service
- use it for one narrow operational job first

### Phase 3: Add Kotlin

- create a Kotlin Spring Boot or Ktor service
- containerize it separately
- move subscription and pricing rules into Kotlin
- keep Express as the gateway and auth layer

### Phase 4: Add Java only if necessary

- introduce Java only for PDF/invoice or enterprise integration needs
- keep it separate from Kotlin unless there is a strong reason to merge them

### Phase 5: Add C++ with WebAssembly

- identify a real browser-side math bottleneck
- create the native module in C++
- compile to WebAssembly
- start with QR parsing helpers and image preprocessing functions first
- add vector scoring and filtering helpers next
- load it in the frontend only where it improves user experience

## What to keep out of new languages

Do not move these out of Express unless there is a strong reason:

- login and JWT/session handling
- cart write operations
- checkout transaction coordination
- route aggregation for frontend API calls
- simple CRUD endpoints that are already stable

Do not move these to Java, Kotlin, or Go just because the language is available. Keep the current stable logic where it already works.

## Express cleanup rule (important)

Do not delete Express route files immediately after introducing Java, Kotlin, Go, or Wasm.

Keep Express as the gateway/orchestration layer and remove old logic only when all of the following are true:

- the new service fully owns the domain behavior in production
- Express only proxies/validates/authenticates for that domain
- health checks, logging, and error handling are stable for at least one release cycle
- no frontend/client path depends on the old in-process Express implementation

Practical example:

- keep `express-api/routes/orders.js` because checkout and order orchestration still live in Express, even though invoice rendering moved to Java
- keep subscription routes in Express for auth/session/context, while quote/reconciliation calculations are delegated to Kotlin

## Why this order works

- Go gives quick operational value with low risk
- Kotlin gives the best balance of readability and JVM power for domain logic
- Java remains available for specific enterprise or library-driven tasks
- C++/Wasm is added only where performance is measurable
- Express remains the stable backbone during the transition

## Final recommendation

If you want the shortest useful path:

1. Keep Express
2. Add Go for operational tasks
3. Add Kotlin for the main new backend domain service
4. Add Java only when a specific library or integration requires it
5. Add C++ with WebAssembly only for proven math-heavy browser work

This keeps the architecture understandable while still giving you the performance and ecosystem benefits you want.
