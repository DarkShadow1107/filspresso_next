# PLAN.md — Spectre: Agentic Repository Security Auditor
**GenAI Capstone — production-style application**

> One-liner: an autonomous agent that clones a repository, hunts for vulnerabilities with
> static tools + LLM reasoning, **proves** findings with PoC code executed in an isolated
> local sandbox, accumulates a downloadable security knowledge base, and reports in
> industry formats — running 100% locally on consumer hardware, $0 API cost.

---

## 1. Capstone rubric compliance matrix

| Rubric requirement | How this project satisfies it |
|---|---|
| RAG | DuckDuckGo search → scrape → chunk → embed → `pgvector`; findings-memory reuse across scans; knowledge export |
| Agent or workflow | LangGraph multi-step agent: plan → clone → static scan → LLM triage → PoC generation → sandbox execution → verdict → report |
| Logging | Structured JSON logs + `scan_events` table + per-request token usage from llama-server |
| Evaluation strategy | Golden set of labeled vulnerable code (CWE-tagged) + known-vulnerable repos; precision/recall vs semgrep baseline; ablation with/without RAG |
| Cost analysis | All-local inference: $0 API. Token counters from llama-server → dashboard comparing equivalent API spend (GPT-4o-mini pricing) |
| Deployment (Docker) | Full `docker-compose` stack: llama-server, Postgres+pgvector, Redis, MinIO, Caddy (TLS), API, worker, sandbox-exec, UI |

---

## 2. Hardware reality (what you have)

| Component | Spec | Implication |
|---|---|---|
| CPU | i5-11300H — 4C/8T Tiger Lake, AVX-512 | CPU inference fallback ~8–14 tok/s (3B Q4) |
| RAM | 16 GB DDR4-3200 (~51 GB/s) | Long-context KV cache overflow target; fine for Postgres+Redis+MinIO+containers |
| GPU | RTX 3050 Ti Laptop 4 GB GDDR6, ~192 GB/s | **Display runs on Iris Xe iGPU → ~3.8 GB VRAM fully free for CUDA** |
| OS | Windows 11 + WSL2 | All services run as containers in WSL2. Docker Desktop = WSL2 backend (technically a utility VM — state this honestly in the architecture review; no separate Linux box needed) |
| Storage | (verify free space) | Need ~20 GB: models ~4 GB, images ~10 GB, repos/reports |

---

## 3. Model & context strategy — Granite 4.2 3B, the ONLY generation model

**Why Granite 4.x 3B is the right single model:** hybrid Mamba-2/attention architecture →
recurrent state is fixed-size, only the few attention layers hold growing KV cache.
This is what makes 128K context *physically possible* on 4 GB VRAM + 16 GB RAM.
A classic transformer 3B would need substantial KV memory at 128K even quantized; the hybrid architecture keeps this target feasible here.

### Tiered context profiles (the core decision that replaces "128K always")

| Tier | Context | Placement | Expected perf | Use case |
|---|---|---|---|---|
| **T1 Performance (default)** | 32K–64K | 100% GPU, KV q8_0 | ~35–55 tok/s gen, ~0.8–2K tok/s prefill | Agent loops, triage, live demo |
| **T2 Long context** | 128K | Weights+Mamba on GPU, attention KV tensors on CPU RAM | Benchmark on the target machine | Whole-repo mega-context, capability proof |
| **T3 CPU fallback** | up to 128K | `-ngl 0` | Benchmark on the target machine | Resilience / GPU failure |

### llama.cpp commands

```bash
# T1 — daily driver (also the demo config)
llama-server -m granite-4.2-3B-Q4_K_M.gguf -ngl 99 -fa on \
  -c 65536 --cache-type-k q8_0 --cache-type-v q8_0 \
  --jinja --host 0.0.0.0 --port 8080

# T2 — long context
llama-server -m granite-4.2-3B-Q4_K_M.gguf -ngl 99 -fa on \
  -c 131072 --cache-type-k q8_0 --cache-type-v q8_0 \
  --jinja --host 0.0.0.0 --port 8080

# T3 — CPU-only fallback
llama-server -m granite-4.2-3B-Q4_K_M.gguf -ngl 0 -c 131072 -fa on --jinja
```

**Phase 0 gate (do this first):** llama.cpp prints exact `KV buffer size` at startup —
read bytes/token from the log, fill the table below, tune `-ot` regex against actual
Granite tensor names (visible in the load log), then decide max ctx per tier.

| Measured metric | Target / actual |
|---|---|
| Weights VRAM (Q4_K_M) | ~2.0 GB |
| Mamba recurrent state | < 100 MB |
| Compute buffers (-ub 512 --batch 1024) | 0.3–0.5 GB |
| KV bytes/token (from startup log) | TBD in Phase 0 |
| T1 max ctx that fits 3.8 GB VRAM | TBD (expect 48K–64K) |
| T2 gen tok/s @ 128K | TBD |
| Prefill tok/s @ 64K / 128K | TBD |

**Notes**
- Use a recent llama.cpp CUDA build (`win-cuda-cu12.4-x64`) — hybrid Mamba/Granite support is recent; keep it updated. Verify max native context from the model card / GGUF metadata.
- `-fa on` is mandatory for KV quantization; `-ub 512` shrinks compute buffers at long ctx.
- Power: plugged in, Best Performance mode, PCIe link-state power management OFF, cooling pad for demo day (thermal throttling is the real enemy).

### The "only model" clarification (important)
- **Generation/reasoning: Granite 4.2 3B only.** ✔
- **Embeddings:** MiniLM-L6-v2 GGUF through the local embeddings endpoint, producing 384-dimensional vectors. This is infrastructure, not the agent brain; it runs locally and costs nothing. Without an embedder there is no RAG — the rubric requires RAG.
- **Image understanding:** intentionally out of scope. Spectre uses no vision model; all generation uses Granite 4.2 and all retrieval embeddings use MiniLM.

---

## 4. Stack (exact list)

| Layer | Choice | Why |
|---|---|---|
| LLM serving | llama.cpp `llama-server` (CUDA build), OpenAI-compatible + `--jinja` | Tool calling, GPU offload, $0 |
| Agent orchestration | **LangGraph** (LangChain ecosystem) | Postgres checkpointer, streaming events, rubric-recognizable |
| API | FastAPI + SSE (`asyncio`) | Streams thoughts/tool events to UI |
| Frontend | React + Vite (dark UI), SSE client | Custom thoughts panel ≠ stock chatbot |
| DB | PostgreSQL 16 + **pgvector** | Findings, files, knowledge chunks, events — one store |
| Queue/cache | Redis + arq (or Celery) | Scan jobs, DDG rate-limit cache, dedup |
| Object storage | MinIO | Reports, PoC artifacts, repo snapshots |
| Sandbox | Docker sibling containers via `sandbox-exec` service holding docker.sock; optional gVisor `runsc` | No VM on Linux; WSL2 on Windows; strong isolation flags |
| Static analyzers | semgrep, gitleaks, OSV-Scanner (+bandit for py) | Deterministic base layer; LLM triages results |
| Web/RAG ingestion | `ddgs` (DuckDuckGo) + httpx + trafilatura | Search → extract → chunk → embed; cached in Redis, rate-limited |
| TLS | Caddy reverse proxy, `tls internal` | Automatic HTTPS for UI/MinIO/llama endpoints |
| Logging | structlog JSON → file + `scan_events` table; optional self-hosted Langfuse | Full audit trail, demo evidence |

**docker-compose services:** `llama-server`, `api`, `agent-worker`, `sandbox-exec`, `sandbox` (ephemeral), `postgres`, `redis`, `minio`, `caddy`, `ui`. Networks: `frontend` / `backend` / `sandbox` (isolated, `internal: true`) / `db`.

---

## 5. Agent design

### LangGraph flow

```
[plan] → [retrieve_knowledge (pgvector)] → [web_search DDG] ↘
[clone_repo] → [static_scan (semgrep/gitleaks/osv)] → [llm_triage]
   → [poc_plan] → [sandbox_exec PoC] → [analyze_evidence]
   → [verdict + severity] → [persist_finding] → [report (SARIF/PDF/MD)]
        ↑____________________ loop per finding ______________________|
```

### Tools exposed to the model
`clone_repo`, `list_files`, `read_file`, `search_knowledge`, `web_search`,
`run_static_scan`, `write_poc`, `run_in_sandbox`, `save_finding`, `generate_report`.

### Visible reasoning ("thoughts" UI — like a streaming agent client)
Granite is not a native thinking model, so reasoning is made visible **by protocol**:
1. A lightweight planner prompt emits a step plan before execution.
2. Every tool call is preceded by a one-line rationale (ReAct "Thought:").
3. LangGraph `astream_events` → FastAPI SSE bridge → UI panel.

SSE event schema (frontend renders collapsible Thinking block + tool chips with
spinner → ✓, streaming markdown, exactly like a modern agent chat):

```json
{"type":"phase","name":"cloning_repo","status":"started"}
{"type":"thought","content":"The auth module imports md5 for passwords — checking CWE-328"}
{"type":"tool_call","tool":"run_static_scan","args":{"scanner":"semgrep"}}
{"type":"tool_result","tool":"run_static_scan","status":"ok","summary":"3 findings"}
{"type":"finding","finding":{"title":"...","cwe":"CWE-798","severity":"high","file":"..."}}
{"type":"token","content":"..."}   // streamed report tokens
```

### Data model (Postgres)

```sql
repos(id, url, commit, cloned_at, size_bytes)
files(id, repo_id, path, language, sha256)
findings(id, repo_id, file_id, line_start, source,        -- semgrep|gitleaks|osv|llm
         cwe, severity, title, description, evidence,
         llm_verdict, confidence, poc_artifact_uri,       -- MinIO key
         status, fingerprint UNIQUE)                      -- dedup across rescans
knowledge_chunks(id, source_url, title, text, embedding vector(384), fetched_at)
scan_events(id, repo_id, ts, level, event, payload jsonb) -- logging story
llm_usage(id, ts, prompt_tokens, completion_tokens, tier) -- cost analysis
```

---

## 6. Sandbox security model

- Sibling containers spawned by `sandbox-exec` (the only service holding docker.sock —
  never exposed to the agent process).
- Flags: `--rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges
  --memory 256m --pids-limit 64 --ulimit nofile=64`, tmpfs workdir, **30 s timeout**, PoC
  mounted read-only, stdout/stderr/exit-code captured as evidence → MinIO.
- Dynamic "lab" mode (stretch): ephemeral compose network with the vulnerable service
  running in an isolated container; PoC gets `--network sandbox_net` (still no WAN).
- Stretch hardening: gVisor `runsc` runtime — strong user-space kernel isolation, great
  architecture-review talking point.
- Demo narrative: *"static analysis never executes code; dynamic validation is
  network-isolated, resource-capped, and time-boxed."*

---

## 7. Knowledge / memory subsystem

1. Background job (arq worker): DDG search per topic/CWE → top-N URLs → trafilatura
   extraction → chunk → embed → `knowledge_chunks` (with `source_url`, `fetched_at`).
2. Agent retrieval: hybrid search (pgvector cosine + Postgres FTS) at analysis time —
   the agent cites prior knowledge in triage.
3. Findings-memory: fingerprints + embeddings of past findings resurface on new scans
   (agent "remembers" this repo's history and similar repos).
4. **User-facing download:** `/export/knowledge?format=md|json|zip`,
   `/export/findings?format=sarif|pdf|json` — SARIF is the GitHub code-scanning format
   (industry credibility in one button).

---

## 8. What you HAVE vs what to BUILD/CHANGE

### ✅ Already decided / available
- [x] Hardware benchmarked on paper: 3050 Ti 4 GB free (iGPU display), 16 GB RAM
- [x] Model: Granite 4.2 3B Q4_K_M GGUF, llama.cpp CUDA
- [x] Hybrid Mamba → long context feasible; tiered context strategy defined
- [x] Stack chosen: Postgres+pgvector, Redis, MinIO, Caddy, llama.cpp, LangGraph
- [x] Sandbox approach: Docker sibling containers (no VM on Linux; WSL2 on Windows)
- [x] Findings persistence + fingerprint dedup design
- [x] Thoughts-streaming design (SSE + LangGraph events)
- [x] Rubric mapping complete (RAG/agent/logging/eval/cost/Docker)

### 🔨 To build (in order)
- [ ] Phase 0: compose stack up; **benchmark Granite 3B** (tok/s, KV bytes/token, max ctx per tier) → freeze configs
- [ ] Phase 1: RAG core — clone → chunk (tree-sitter) → embed → pgvector; DDG ingestion job; knowledge export
- [ ] Phase 2: LangGraph agent + tools + SSE thoughts streaming (CLI first, then UI)
- [ ] Phase 3: sandbox-exec + PoC validation + findings persistence + SARIF/PDF export
- [ ] Phase 4: UI polish (thoughts panel, findings dashboard, knowledge manager, downloads)
- [ ] Phase 5: evaluation runs on golden set + cost dashboard + failure-analysis writeup
- [ ] Stretch: gVisor lab mode, GitHub SARIF upload

### 🔁 Decisions changed from your original idea (be ready to defend them)
| Original | Changed to | Reason |
|---|---|---|
| Firejail | Docker sibling containers (+opt. gVisor) | Firejail = SUID-root, long escape history; bad look for a security project |
| 128K context always-on | Tiered T1/T2/T3 profiles | Long context remains a deliberate opt-in; RAG-first workflow keeps the default responsive |
| "Only model" absolute | Granite 4.2 **for generation** + MiniLM for embeddings | Rubric requires RAG; MiniLM supplies the fixed 384-dimensional vectors without adding another generation model |
| LangChain (monolith) | LangGraph | Postgres checkpointer = your persistence story; better streaming |
| llama.cpp built-in web UI | Custom React UI (llama-server backend untouched) | The thoughts panel IS the demo wow-factor |
| No VM, any host | WSL2 accepted on Windows | Firejail is Linux-only; Docker Desktop needs WSL2 — document honestly |

---

## 9. Evaluation strategy (Phase 5)

- **Golden set:** 40–60 functions/snippets labeled with CWE (self-curated from
  SARD/Juliet-style sources) + full repos: OWASP Juice Shop, DVWA, WebGoat, PyGoat.
- **Metrics:** precision, recall, F1 per severity; false-positive rate of
  `static-only` vs `static + LLM triage` (show the delta — that's your agent's value).
- **Ablations:** with/without knowledge RAG; T1 vs T2 context on whole-repo triage.
- **Failure analysis prep** (they WILL ask): hallucinated CVEs, sandbox timeouts,
  DDG rate limits, context overflow handling, dedup collisions — log them as they happen.

## 10. Cost analysis (Phase 5)

- Token usage from llama-server responses → `llm_usage` table → totals per scan/tier.
- Comparison slide: tokens × GPT-4o-mini (and 4o) list prices = "equivalent API spend" vs
  **$0.00**; electricity ≈ 60–90 W × scan-hours (~kWh cents). Hardware already owned.

---

## 11. Roadmap (6 weeks part-time)

| Week | Phase | Exit criteria |
|---|---|---|
| 1 | 0 + 1 | compose up green; benchmarks table frozen; repo→chunks→pgvector working; knowledge export button |
| 2 | 2 | agent scans a repo end-to-end in CLI with visible thoughts |
| 3 | 3 | sandbox executes PoC, evidence stored, finding persisted, SARIF exported |
| 4 | 4 | full UI flow: thoughts panel, dashboard, downloads; Caddy TLS in front |
| 5 | 5 | eval metrics computed; cost dashboard; failure log written |
| 6 | — | 20-min demo rehearsed ×3 (recorded backup), architecture diagram final |

**Time budget warning:** UI polish and evaluation are the two most commonly skipped
phases — protect weeks 4–5 from feature creep.

## 12. 20-minute demo script

| Time | Beat |
|---|---|
| 0–2 | Problem + architecture diagram (rubric mapping in one slide) |
| 2–7 | **Live:** paste repo URL → watch thoughts stream: plan → clone → static scan → triage |
| 7–11 | Sandbox: PoC written & executed network-isolated → evidence shown → finding card |
| 11–14 | Knowledge: ask agent about a CWE → it cites scraped sources; add knowledge via DDG job |
| 14–17 | Dashboard + downloads: SARIF/PDF report, knowledge zip; show findings-memory on rescan |
| 17–19 | Numbers: benchmarks table, precision/recall, $0 cost slide |
| 19–20 | Failure analysis + roadmap. (Backup: recorded run + pre-cloned repo if Wi-Fi dies) |

## 13. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Thermal throttling during live demo | High | Plugged in, performance mode, cooling pad, T1 config, recorded backup |
| 128K prefill too slow to demo live | TBD | Never demo long prefill live — precomputed T2 job + show measured numbers |
| DDG rate-limit mid-demo | Medium | Redis cache + pre-warmed knowledge base |
| GPU driver/CUDA quirk on WSL2 | Medium | T3 CPU fallback config tested in advance |
| Scope creep (image understanding, gVisor) | High | Stretched into Phase 5+ only after Phase 4 exit criteria |
| Hallucinated findings in eval | Medium | Evidence-based triage prompt: verdict requires file+line+citation; sandbox PoC as ground truth |
