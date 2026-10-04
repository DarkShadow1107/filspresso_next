# CodeSentry

CodeSentry is a local-only defensive repository security auditor. It clones authorized
GitHub repositories, snapshots source files, runs bounded static analyzers, uses Granite
4.2 for evidence-based triage, uses MiniLM for 384-dimensional retrieval embeddings,
and produces reviewable findings and reports. Repository code is never executed by the
scanner.

## Local Stack

The existing Docker Compose stack is retained:

| Service | Purpose |
| --- | --- |
| `api` | FastAPI repository, scan, finding, PoC, event, and report API |
| `worker` / `scheduler` | Celery scan orchestration and durable jobs |
| `postgres` | Tenant-scoped application data and pgvector |
| `redis` | Celery broker/backend and rate limiting |
| `minio` | Private snapshots, scanner output, PoC evidence, and reports |
| `llama-ui` | Prebuilt CUDA llama-server for Granite 4.2 generation and the local chat UI |
| `embedding-runtime` | Prebuilt CUDA llama-server for MiniLM embeddings |
| `sandbox` | Restricted offline PoC execution service |
| `caddy` | Loopback HTTPS edge proxy |

Only Granite 4.2 is available for generation. MiniLM is reserved for embeddings. LFM
2.5, Qwen, and vision-model inference are not used.

## Run

Copy `.env.example` to `.env`, set local secrets, and run:

```powershell
docker compose up --build
```

Open `https://127.0.0.1:8080`. The API is available under `/api/v1` and the CodeSentry
scan endpoints start at:

```text
POST /api/v1/organizations/{organization_id}/repositories/{repository_id}/scans
GET  /api/v1/organizations/{organization_id}/scans/{scan_id}/events/stream
GET  /api/v1/organizations/{organization_id}/scans/{scan_id}/findings
GET  /api/v1/organizations/{organization_id}/scans/{scan_id}/reports
```

Scans return `incomplete` when an external scanner is unavailable or fails. A clean
result is never inferred from a missing scanner.

## Safety

Only analyze repositories you own or are authorized to inspect. Repository content,
scanner output, and web content are untrusted data. Static scanners never execute repository
code. Model-requested repository runs are limited to fixed Python profiles in a read-only,
resource-bounded sandbox; CodeSentry PoCs still require reviewer approval.
