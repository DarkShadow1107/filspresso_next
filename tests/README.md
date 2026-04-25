# Titan V0.74 Test Suite Refactoring

## Overview

The Titan test suite has been refactored from a monolithic PowerShell script (~1700 lines) into a modular, specialized test architecture focusing on **security**, **performance**, **reliability**, and **integrity** across all system components.

## Architecture

### Directory Structure

```
tests/
├── shared/
│   └── test-utils.ps1                 # Common utilities for all tests
├── unit/
│   └── 01-utilities.ps1               # Crypto, auth, contracts, ledger utilities
├── integration/
│   └── 01-docker-compose.ps1          # Docker, Compose, service health
├── security/
│   ├── 01-authentication.ps1          # Auth, authz, CSRF, headers, CORS
│   └── 02-abuse-resistance.ps1        # Replay attacks, injection, integrity
├── performance/
│   └── 01-throughput-latency.ps1      # Throughput, latency, SLAs
├── reliability/
│   └── 01-failure-recovery.ps1        # Recovery, consistency, cascades
└── run-all-tests.ps1                  # Master orchestrator
```

### Running Tests

**All tests:**

```powershell
./tests/run-all-tests.ps1
```

**Specific category:**

```powershell
./tests/run-all-tests.ps1 -TestCategory security
./tests/run-all-tests.ps1 -TestCategory performance
./tests/run-all-tests.ps1 -TestCategory reliability
./tests/run-all-tests.ps1 -TestCategory unit
./tests/run-all-tests.ps1 -TestCategory integration
```

**With options:**

```powershell
./tests/run-all-tests.ps1 -RepoRoot "." -ComposeEnvFile "security.env.example" -FailFast
```

## Test Categories

### Unit Tests: `tests/unit/01-utilities.ps1`

Tests for core cryptographic and utility libraries in `nestjs-backend/src/common/utils/`:

- **Encryption (AES-256-GCM)**
    - Roundtrip encrypt/decrypt
    - Empty payload handling
    - Card utilities (PAN masking, card type detection)

- **Password Management (bcrypt)**
    - Hash generation and verification
    - Rehash requirement detection
    - Cost factor verification

- **JWT Tokens**
    - Token generation and verification
    - Tamper rejection
    - Signature validation

- **Service Assertions (Ed25519)**
    - Token issuance and verification
    - Scope enforcement
    - Scope rejection

- **Service Contracts**
    - Invoice contract validation
    - Invalid payload rejection

- **Security Ledger (SHA3-256 chaining)**
    - Payload canonicalization
    - Hash stability and consistency
    - Immutability guarantees

- **Replay Guard**
    - Operation ID normalization
    - Duplicate detection

**File:** [tests/unit/01-utilities.ps1](unit/01-utilities.ps1)

### Integration Tests: `tests/integration/01-docker-compose.ps1`

Tests for Docker Compose orchestration and service health:

- **Docker Setup**
    - Docker availability
    - Compose rendering and validation
    - Stack initialization

- **Service Health**
    - Service startup and readiness
    - Health endpoint verification
    - Multi-service dependency checks

- **Resilience**
    - Service restart without data loss
    - Post-restart recovery
    - Cascade prevention

**File:** [tests/integration/01-docker-compose.ps1](integration/01-docker-compose.ps1)

### Security Tests

#### Authentication & Authorization: `tests/security/01-authentication.ps1`

- **Authentication Enforcement**
    - Missing token rejection (401)
    - Invalid token rejection (401)
    - Expired token rejection (401)

- **Authorization & Access Control**
    - Admin endpoint protection
    - Route-based access control
    - 404 vs 401 differentiation

- **Security Headers**
    - X-Content-Type-Options
    - X-Frame-Options
    - X-XSS-Protection
    - Strict-Transport-Security
    - Content-Security-Policy

- **CORS & CSRF**
    - Origin validation
    - CSRF token enforcement
    - State-changing operation protection

**File:** [tests/security/01-authentication.ps1](security/01-authentication.ps1)

#### Abuse Resistance & Integrity: `tests/security/02-abuse-resistance.ps1`

- **Replay Attack Prevention**
    - Operation ID normalization and detection
    - Scope-based privilege escalation prevention
    - Service assertion boundary enforcement

- **Input Validation & Injection Prevention**
    - SQL injection resistance
    - XSS prevention (output encoding)
    - Card format validation
    - Malformed input rejection

- **Cryptographic Integrity**
    - Ledger hash chain verification
    - Tamper detection
    - Password hash strength (bcrypt cost factor ≥10)
    - Signature validation

- **Rate Limiting & Abuse Prevention**
    - Payload size limits
    - Malformed JSON rejection
    - Request validation

**File:** [tests/security/02-abuse-resistance.ps1](security/02-abuse-resistance.ps1)

### Performance Tests: `tests/performance/01-throughput-latency.ps1`

Measures throughput, latency (p50, p95, p99), and SLA compliance:

- **Encryption Performance**
    - AES-256-GCM throughput (ops/sec)
    - Latency distribution

- **Password Hashing**
    - Intentional slowness verification (bcrypt cost ≥ 50ms per hash)
    - Resistance to brute force

- **Security Ledger**
    - Hash computation throughput
    - Event processing latency

- **HTTP Endpoint Latency**
    - Health check latency (p50, p95)
    - SLA compliance monitoring

**File:** [tests/performance/01-throughput-latency.ps1](performance/01-throughput-latency.ps1)

### Reliability Tests: `tests/reliability/01-failure-recovery.ps1`

Tests for resilience, state consistency, and audit trail preservation:

- **Failure Recovery**
    - Service restart without data loss
    - Database connection recovery
    - Multi-service dependency recovery

- **State Consistency**
    - Encryption consistency across restarts
    - Ledger chain integrity
    - JWT token persistence
    - Idempotency verification

- **Cascade Failure Prevention**
    - Single service down doesn't crash others
    - Database unavailability handling
    - Graceful degradation

- **Audit Trail Preservation**
    - Ledger immutability guarantees
    - Service assertion scope immutability
    - Tamper detection

**File:** [tests/reliability/01-failure-recovery.ps1](reliability/01-failure-recovery.ps1)

## Migration: express-api → nestjs-backend

### Status: ✓ Migration Complete

All core functionality from `express-api` has been migrated to `nestjs-backend`:

#### Routes

| express-api             | nestjs-backend            |
| ----------------------- | ------------------------- |
| accounts.js             | src/accounts/             |
| admin.js                | src/admin/                |
| auth.js                 | src/auth/                 |
| cards.js                | src/cards/                |
| cart.js                 | src/cart/                 |
| chat.js                 | src/chat/                 |
| crypto.js               | src/crypto/               |
| favorites.js            | src/favorites/            |
| kafelot.js              | src/kafelot/              |
| operations.js           | src/operations/           |
| orders.js               | src/orders/               |
| products.js             | src/products/             |
| repairs.js              | src/repairs/              |
| subscriptions.js        | src/subscriptions/        |
| subscriptions_engine.js | src/subscriptions-engine/ |
| weather.js              | src/weather/              |

#### Utilities

| express-api                | nestjs-backend                        |
| -------------------------- | ------------------------------------- |
| utils/encryption.js        | src/common/utils/encryption.ts        |
| utils/passwords.js         | src/common/utils/passwords.ts         |
| utils/serviceAssertions.js | src/common/utils/serviceAssertions.ts |
| utils/serviceContracts.js  | src/common/utils/serviceContracts.ts  |
| utils/securityLedger.js    | src/common/utils/securityLedger.ts    |
| utils/replayGuard.js       | src/common/utils/replayGuard.ts       |
| utils/keyUsagePolicy.js    | src/common/utils/keyUsagePolicy.ts    |
| utils/egressPolicy.js      | src/common/utils/egressPolicy.ts      |
| utils/secrets.js           | src/common/utils/secrets.ts           |

#### Modules

| express-api       | nestjs-backend                               |
| ----------------- | -------------------------------------------- |
| server.js         | src/main.ts                                  |
| (request parsing) | src/app.module.ts                            |
| (middleware)      | src/common/middleware/                       |
| (not implemented) | src/health/ (HealthModule)                   |
| (not implemented) | src/security-observability/ (SecurityModule) |

### What Changed

1. **Removed from test suite:**
    - `npm run test:internal-assertion-matrix` (test file didn't exist in express-api)
    - `node --check server.js` (express-api/server.js syntax check)
    - Logging infrastructure (no `/logs` folder or transcript generation)

2. **Added to test suite:**
    - NestJS TypeScript syntax checking
    - Comprehensive modular test framework
    - Security-focused tests (authentication, abuse resistance, integrity)
    - Performance benchmarking
    - Reliability and failure recovery tests

## Key Testing Principles

### Security Testing

1. **Defense in Depth**
    - Authentication (token presence)
    - Authorization (token validity)
    - Cryptographic signatures (Ed25519 scope enforcement)
    - Audit trail (security ledger chaining)

2. **Threat Modeling**
    - Replay attacks (operation ID normalization)
    - Privilege escalation (service assertion scope boundaries)
    - Injection attacks (input validation, prepared statements)
    - Tampering (hash chaining, signature verification)

3. **Integrity Verification**
    - Immutable ledgers (hash chains)
    - Scope-locked assertions (Ed25519 signatures)
    - Tamper detection (hash stability)

### Performance Testing

1. **Throughput Benchmarks**
    - Encryption ops/sec (should be 1000+)
    - Ledger ops/sec (should be 1000+)
    - HTTP endpoint ops/sec

2. **Latency SLAs**
    - Encryption: <5ms p95
    - Ledger: <2ms p95
    - HTTP health: <50ms p95

3. **Cost Factor Verification**
    - Password hashing: bcrypt cost ≥10 (50-300ms per hash)
    - Intentional slowness for brute force resistance

### Reliability Testing

1. **Failure Recovery**
    - Service restart (docker compose restart)
    - Database reconnection
    - State consistency verification

2. **Cascade Prevention**
    - Health checks before dependent calls
    - Graceful degradation
    - Error isolation

3. **Audit Trail Preservation**
    - No data loss on restart
    - Ledger chain integrity
    - Token validity persistence

## Contributing New Tests

### Add a Unit Test

1. Update `tests/unit/01-utilities.ps1`
2. Wrap test in `Invoke-TestGroup` and `Invoke-TestStep`
3. Use `Invoke-NodeCode` for Node.js execution
4. Run: `./tests/unit/01-utilities.ps1`

### Add a Security Test

1. Create `tests/security/0X-feature-name.ps1`
2. Import utilities: `. (Join-Path $PSScriptRoot "..\shared\test-utils.ps1")`
3. Use `Invoke-TestGroup` and `Invoke-TestStep`
4. Use `Test-HttpEndpoint` for API testing
5. Register in `tests/run-all-tests.ps1` if needed

### Add a Performance Test

1. Update `tests/performance/01-throughput-latency.ps1`
2. Measure with `process.hrtime.bigint()` (nanosecond precision)
3. Calculate p50, p95, p99 percentiles
4. Compare against SLA thresholds

## Test Execution

### Local Development

```powershell
# Run all tests
./tests/run-all-tests.ps1

# Run specific category with options
./tests/run-all-tests.ps1 -TestCategory security -FailFast

# Run single test file
./tests/unit/01-utilities.ps1
```

### CI/CD Integration

```powershell
# Run in CI pipeline with fail-fast
./tests/run-all-tests.ps1 -FailFast -ComposeEnvFile "security.env.ci"
```

## Metrics & Monitoring

### Test Coverage

- **Unit Tests**: Core cryptographic utilities (7 areas, 20+ cases)
- **Integration Tests**: Docker, service health, resilience (3 areas)
- **Security Tests**: Auth, abuse resistance, integrity (5 areas, 20+ vectors)
- **Performance Tests**: Encryption, hashing, ledger, HTTP (4 areas)
- **Reliability Tests**: Recovery, consistency, cascades (4 areas)

### Success Criteria

- All unit tests pass ✓
- All integration tests pass ✓
- All security tests pass (or skip with rationale) ✓
- Performance meets SLAs (latency, throughput) ✓
- Reliability under failure scenarios ✓

## Troubleshooting

### Tests Skipped

Tests marked as `-Optional` will skip if services are unavailable:

- Check `docker compose ps` for service status
- Verify database is running
- Check logs: `docker compose logs backend`

### Performance Tests Fail

If latency is high:

- Check system load: `Get-Process`
- Verify no concurrent containers are consuming CPU
- Try again after system is idle

### Reliability Tests Fail

If state consistency tests fail:

- Check database transaction logs
- Verify encryption key hasn't changed
- Check for stale connections in pool

## Professional Scoring System

### Overview

The test suite employs a **weighted, multi-category scoring system** designed to provide objective, actionable assessment of security posture, performance reliability, and operational compliance.

**Overall Score = (Security × 40%) + (Performance × 25%) + (Reliability × 20%) + (Compliance × 15%)**

For the strict runner (`run-all-tests-no-integration.ps1`), score and gate are separate:

- **Score** answers: "how well is the system performing against security/reliability/SLA goals?"
- **Gate** answers: "can this run pass CI?"

Gate conditions are strict:

- **FailedTests must be 0**
- **SkippedTests must be 0**
- **TotalTests must be at least 100**

If any gate condition is violated, the script exits non-zero even if the weighted score is high.

### Scoring Categories

#### 1. Security Score (40% weight)

**Tests:**

- Authentication & Authorization (tokens, guards, CORS)
- Abuse Resistance (replay, injection, rate limiting)
- Cryptography (AES-256-GCM, Argon2id, Ed25519, SHA3-256)
- Advanced Crypto Rigor (collision resistance, timing attack protection, key isolation)

**Calculation:**

```
Security Score = (Passed Tests / Total Tests) × 100 - (Failed Tests × 5)
```

**Interpretation:**

- **90-100%:** Excellent – Strong cryptographic foundation, all threat vectors addressed
- **75-89%:** Good – Core security controls in place, minor gaps identified
- **60-74%:** Fair – Significant security concerns, hardening required
- **<60%:** Poor – Critical vulnerabilities, resolve before deployment

#### 2. Performance Score (25% weight)

**Tests:**

- Throughput & Latency (encryption, hashing, ledger operations)
- Sustained Load Testing (500+ requests, 30-second sustained throughput)
- Response Time Analysis (p50, p95, p99 latencies)
- Degradation Under Stress (linear vs exponential performance decay)

**Calculation:**

```
Performance Score = 0.60 × PerformancePassRatio + 0.40 × LatencySLACompliance

where:
PerformancePassRatio = category pass/fail-derived score from performance modules
LatencySLACompliance = (SLA checks passed / total SLA checks) × 100
```

**Latency SLA Compliance checks (explicit numeric checks):**

- **Encryption p95 latency ≤ 5ms**
- **Ledger p95 latency ≤ 2ms**
- **Health endpoint p95 latency ≤ 100ms**
- **Password hash average latency between 50ms and 300ms**
- **Sustained load success rate ≥ 90%**
- **100-request backend stability rate ≥ 95%**
- **Endurance p99 latency ≤ 2000ms**

Example:

- If 6 out of 7 SLA checks pass, then `LatencySLACompliance = (6/7) × 100 = 85.71%`.
- If `PerformancePassRatio = 90%`, then
  `PerformanceScore = 0.60 × 90 + 0.40 × 85.71 = 88.28%`.

#### 3. Reliability Score (20% weight)

**Tests:**

- Database Stress (concurrent writes, row-level locks, connection pool management)
- Failure Recovery (service restart, cascade prevention, data consistency)
- Data Integrity (ledger immutability, transaction isolation, phantom read prevention)
- Endurance (memory leaks, resource exhaustion, sustained operation)

**Calculation:**

```
Reliability Score = (Passed Tests / Total Tests) × 100 - FailurePenalty
```

`FailurePenalty` is applied at category level when reliability modules contain failed tests.

**Key Metrics:**

- **Memory growth:** < 100MB over 60 seconds of sustained load
- **Connection pool:** Graceful rejection when exhausted
- **Ledger integrity:** Hash chain immutability over 1000+ entries

#### 4. Compliance Score (15% weight)

**Tests:**

- Zero Test Failures (100% test pass rate)
- Zero Skipped Tests (no optional exclusions)
- No Security Policy Violations
- Architecture & Design Compliance

**Calculation:**

```
Compliance Score = 100 - (Failed Tests × 10) - (Skipped Tests × 5)
```

### Score Interpretation Guidelines

| Range   | Interpretation | Action Required                                                                                |
| ------- | -------------- | ---------------------------------------------------------------------------------------------- |
| 90-100% | **Excellent**  | Production-ready. Strong security posture, all SLAs met, architecture compliant.               |
| 75-89%  | **Good**       | Deployment acceptable with minor improvements. Address identified weak points post-deployment. |
| 60-74%  | **Fair**       | Significant weaknesses. Implement hardening before production.                                 |
| <60%    | **Poor**       | Critical issues. Resolve all failing tests before any deployment attempt.                      |

### Per-Module Scoring

Each test module contributes to its respective category:

```
Module Score (%) = (Passed Tests / Total Tests) × 100
```

**Modules:**

- **Security Category:**
    - Unit: Utilities (14 tests)
    - Unit: Strict Crypto Hashing (60 tests)
    - Security: Authentication (13 tests)
    - Security: Abuse Resistance (8 tests)
    - Security: ZK Architecture (70 tests)
    - Security: Advanced Cryptography (15+ tests)

- **Performance Category:**
    - Performance: Throughput Latency (4 tests)
    - Endurance: Sustained Load (8+ tests)

- **Reliability Category:**
    - Database: Stress & Attack (10+ tests)
    - Reliability: Failure Recovery (10 tests)

### Report Output

Test runs generate two reports:

1. **JSON Summary** (`summary.json`)
    - Machine-readable scores, module breakdown, detailed metrics
    - Used for CI/CD integration, metrics tracking, dashboards

2. **Text Summary** (`summary.txt`)
    - Human-readable breakdown with interpretation
    - Per-module scores, risk assessment, priority actions
    - **SLA evidence with actual measured values vs targets**

Example output:

```
Titan Strict Test Suite (No Integration) - Professional Scoring Report

=== OVERALL SCORE: 92.45% (Excellent) ===
  Weights: Security 40% | Performance 25% | Reliability 20% | Compliance 15%

=== CATEGORY BREAKDOWN ===
Security Score:      94.3% (Excellent) - Tests: 178/178 passed
Performance Score:   88.5% (Good) - Tests: 12/12 passed
    Performance Inputs: PassRatio=90% | SLACompliance=85.71% (6/7 checks)
Reliability Score:   95.2% (Excellent) - Tests: 20/20 passed
Compliance Score:    100% - Failures: 0, Skipped: 0

=== SLA EVIDENCE (MEASURED) ===
    - Encryption p95 latency: actual=3.8ms, target=5ms => PASS
    - Health endpoint p95 latency: actual=42.7ms, target=100ms => PASS
    - Endurance p99 latency: actual=611ms, target=2000ms => PASS

=== MODULE DETAILS ===
  ✓ Security: Advanced Cryptography [Security]
     Score: 100% | Tests: 15/15 | Failed: 0 | Skipped: 0
  ✓ Database: Stress & Attack [Reliability]
     Score: 95% | Tests: 20/21 | Failed: 1 | Skipped: 0
```

### Continuous Improvement

After each test run:

1. **Identify Weak Points:** Review failed tests and low-scoring modules
2. **Root Cause Analysis:** Investigate underlying security/performance issues
3. **Remediate Gaps:** Implement fixes in project code (see below)
4. **Re-run Tests:** Verify improvements and prevent regression

### Project Hardening Based on Test Results

If test results reveal security weaknesses:

1. **Timing Attacks (Crypto Module):**
    - Implement constant-time comparison in `src/common/utils/passwords.ts`
    - Use `crypto.timingSafeEqual()` for all sensitive comparisons

2. **Database Race Conditions (Stress Module):**
    - Add row-level locks: `SELECT ... FOR UPDATE`
    - Implement connection pool limits in database config
    - Add transaction isolation level: `REPEATABLE READ`

3. **Memory Leaks (Endurance Module):**
    - Profile with `--inspect` flag
    - Verify event listener cleanup
    - Check for circular references in cache

4. **Performance Degradation:**
    - Profile hot paths with sampling profiler
    - Implement caching for expensive operations
    - Optimize database queries (indexes, query plan analysis)

## Related Documentation

- [Express-API Migration](../docs/migration.md)
- [Security Architecture](../docs/security/README.md)
- [NestJS Backend](../nestjs-backend/README.md)
- [Database Schema](../nestjs-backend/src/database/ensureAppSchema.ts)
