# NestJS Backend

This backend is the active backend runtime. It preserves the existing API contracts in NestJS modules while keeping archived Express-era code in the repository only for manual reference during the final cleanup period.

## What this implementation includes

- NestJS application scaffold with modular structure.
- Global config loading and environment validation.
- Cross-cutting concerns moved into Nest bootstrap:
    - Helmet security headers
    - Request ID propagation
    - CORS with non-production localhost fallback
    - Global API rate limit parity
    - CSRF/origin guard parity
    - Request timeout parity
    - Validation pipes and global exception filter
- Native Nest health endpoints:
    - `GET /health`
    - `GET /health/services`
- Integration adapters for Rust, Java, Go, and Kotlin services.

## Route migration strategy in code

The active runtime does not mount legacy route groups anymore. [src/legacy/legacy-routes.ts](src/legacy/legacy-routes.ts) remains in place as an explicit guardrail that the mount list is empty.

## Build and run

```bash
cd nestjs-backend
npm install
npm run build
npm start
```

## Test

```bash
cd nestjs-backend
npm test
```

## Docker runtime

The repository-level backend image build runs this NestJS runtime directly. The retained `express-api` tree is not part of the active Docker runtime or CI path.
