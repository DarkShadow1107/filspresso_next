# Go Ops Service Reference

The Go Ops service ingests operational events and stores bounded event history in Redis for security and runtime observability workflows.

## 1. Runtime Profile

- Language: Go 1.22
- Module: `filspresso/go-ops-service`
- Entry point: `main.go`
- Default service port: `8083`
- Data backend: Redis list storage with bounded retention

## 2. Endpoint Contract

| Endpoint         | Method | Purpose                                       |
| ---------------- | ------ | --------------------------------------------- |
| `/health`        | GET    | Liveness + runtime mode (tls/mtls) summary    |
| `/events/ingest` | POST   | Validate and ingest operational event payload |
| `/events/stats`  | GET    | Return recent events with configurable limit  |

### Ingest payload example

```json
{
	"eventType": "policy_deny",
	"source": "express-api",
	"payload": {
		"resource": "service-events",
		"action": "alerts",
		"decision": "deny"
	}
}
```

## 3. Security Enforcement Order

For `POST /events/ingest`, checks are applied in this order:

1. HTTP method and payload guards
2. mTLS identity verification when enabled
3. service assertion verification when configured
4. API key check when configured (`x-ops-key`)

This allows deployments to operate in layered trust mode rather than relying on a single control.

## 4. Environment Variables (Explicit)

| Variable                                                             | Purpose                          |
| -------------------------------------------------------------------- | -------------------------------- |
| `PORT`                                                               | listener port                    |
| `OPS_API_KEY` / `OPS_API_KEY_FILE`                                   | API key for ingest auth          |
| `REDIS_URL`                                                          | Redis host and port              |
| `REDIS_PASSWORD` / `REDIS_PASSWORD_FILE`                             | Redis authentication             |
| `GO_OPS_EVENTS_KEY`                                                  | Redis list key for event storage |
| `GO_OPS_MAX_EVENTS`                                                  | max retained event records       |
| `GO_OPS_TLS_CERT_FILE` + `GO_OPS_TLS_KEY_FILE`                       | TLS server cert/key              |
| `GO_OPS_TLS_CLIENT_CA_FILE`                                          | mTLS client CA                   |
| `GO_OPS_REQUIRE_MTLS`                                                | enforce mTLS client certs        |
| `GO_OPS_ALLOWED_SPIFFE_IDS`                                          | SPIFFE identity allowlist        |
| `GO_OPS_REQUIRE_SERVICE_ASSERTION`                                   | assertion-required mode          |
| `SERVICE_ASSERTION_PUBLIC_KEY` / `SERVICE_ASSERTION_PUBLIC_KEY_FILE` | assertion verification key       |
| `SERVICE_ASSERTION_AUDIENCE`                                         | expected assertion audience      |
| `SERVICE_ASSERTION_ISSUER_ALLOWLIST`                                 | allowed assertion issuers        |
| `GO_OPS_SERVICE_ASSERTION_SCOPE`                                     | expected assertion scope         |

## 5. Local Development

```bash
cd go-ops-service
go run ./...
```

## 6. Docker Execution

From repository root:

```bash
docker compose up --build go_ops
```

## 7. Operational Behavior Notes

- Redis connectivity is verified at startup; startup fails fast on connection errors.
- Request body size is bounded and JSON decoding disallows unknown fields.
- `x-request-id` is set for traceability.
- Events are retained as a bounded list (push + trim) to prevent unbounded growth.

## 8. Quick Verification

Health check:

```bash
curl -sS http://localhost:8083/health
```

Read latest events:

```bash
curl -sS "http://localhost:8083/events/stats?limit=10"
```

## 9. Related Docs

- `express-api/README.md`
- `security/README.md`
- `docs/README.md`
- root `README.md`
