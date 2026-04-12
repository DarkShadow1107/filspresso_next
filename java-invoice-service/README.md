# Java Invoice Service

This service generates branded PDF invoices for Filspresso orders.

## 1. Runtime

- Framework: Spring Boot 3.3.x
- Language: Java 17
- Entry package: `com.filspresso.invoice`
- Default service port (compose): `8082`

## 2. API Endpoints

| Endpoint               | Method | Purpose                                            |
| ---------------------- | ------ | -------------------------------------------------- |
| `/api/invoices/health` | GET    | Liveness check                                     |
| `/api/invoices/render` | POST   | Generate invoice PDF from normalized order payload |

The render endpoint normalizes order payloads and produces a deterministic invoice PDF with:

- branded header
- itemized lines
- totals and VAT section
- signature stamp rendering

## 3. Request/Response Contract

Render request expectations:

- order metadata (order number, date, status)
- customer identity and billing/shipping fields
- order line items with pricing and quantities
- payment presentation data (masked details + optional branding)

Render response:

- content type `application/pdf`
- attachment-style response headers
- deterministic formatting for stable invoice output

## 4. Dependencies

Defined in `pom.xml`:

- `spring-boot-starter-web`
- `openpdf`
- `bcprov-jdk18on`

## 5. Local Development

```bash
cd java-invoice-service
mvn spring-boot:run
```

Package jar:

```bash
cd java-invoice-service
mvn clean package
```

## 6. Docker

From repository root:

```bash
docker compose up --build invoice_java
```

## 7. Security Notes

- service assertion filter support exists for internal authenticated calls
- endpoint exposure is intended for internal service-to-service usage
- PDF generation should be fed validated order payloads from backend only

## 8. Operational Checks

1. Health:

```bash
curl -sS http://localhost:8082/api/invoices/health
```

2. Service readiness in compose:

```bash
docker compose ps invoice_java
```

3. End-to-end invoice flow (through backend orchestration):

- run backend order path that triggers invoice rendering
- verify PDF download name and metadata stability

## 9. Related Docs

- `express-api/README.md`
- `security/README.md`
- `docs/README.md`
- root `README.md`
