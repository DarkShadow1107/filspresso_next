# Kotlin Subscription Service

This service computes subscription pricing, quotes, and tier reconciliation outcomes.

## 1. Runtime

- Framework: Spring Boot 3.3.x
- Language: Kotlin 1.9.x on Java 17
- Default service port (compose): `8084`

## 2. API Endpoints

| Endpoint                       | Method | Purpose                                     |
| ------------------------------ | ------ | ------------------------------------------- |
| `/api/subscriptions/health`    | GET    | Liveness check                              |
| `/api/subscriptions/quote`     | POST   | Tier and billing-cycle quote calculation    |
| `/api/subscriptions/reconcile` | POST   | Determine upgrade/downgrade/noop transition |

The quote endpoint computes:

- plan base price by tier and billing cycle
- loyalty discount
- annual savings
- recommended billing guidance

The reconcile endpoint determines upgrade/downgrade/noop actions and effective timing.

## 3. Contract Notes

Quote input highlights:

- `tier`
- `billingCycle` (`monthly` or `annual`)
- optional `currentTier`

Quote output highlights:

- base price and final price
- loyalty discount percentage and amount
- annual savings
- recommendation text

Reconcile output highlights:

- action classification (`upgrade`, `downgrade`, `noop`)
- effective timing (`immediate` or `next_renewal`)

## 4. Build And Run

```bash
cd kotlin-subscription-service
mvn spring-boot:run
```

Or package:

```bash
cd kotlin-subscription-service
mvn clean package
```

## 5. Docker

From repository root:

```bash
docker compose up --build kotlin_subscriptions
```

## 6. Security Notes

- service assertion filter support exists for internal service trust boundaries
- intended invocation path is backend-to-service

## 7. Operational Checks

Health:

```bash
curl -sS http://localhost:8084/api/subscriptions/health
```

Compose state:

```bash
docker compose ps kotlin_subscriptions
```

## 8. Related Docs

- `express-api/README.md`
- `security/README.md`
- `docs/README.md`
- root `README.md`
