# Filspresso Next — Architecture & Operations Guide (2025)

This section is a fresh, end-to-end guide for contributors. It explains what runs where, how the pieces talk to each other, and how to develop, test, and deploy. The original README is preserved below for historical context.

## Quick links

-   Runbooks: [Local setup](#local-development), [Testing](#testing-and-quality), [Troubleshooting](#troubleshooting)
-   Architecture: [System diagram](#system-architecture), [Services & ports](#services-and-ports), [APIs](#apis)
-   Data & storage: [Product data](#data-and-storage), [AI assets](#ai-models-and-training), [Command queue schema](#commands-table-schema)
-   IoT: [Device loop](#iot-device-flow), [ESP32 sketch](scripts/esp32/esp32_coffeemachine.ino)

## Project snapshot

-   **What**: Coffee e-commerce UI with AI-powered chat and optional IoT brewing
-   **Frontend**: Next.js 15 (App Router, TypeScript, Turbopack) on port 3000
-   **AI/Backend**: Flask service (MiniLM & ResNet-18) on port 5000
-   **Database**: PostgreSQL 16 with `pgvector` and `rdkit` extensions
-   **Data**: JSON product catalogs and ML training corpora stored in-repo; model checkpoints under `python_ai/checkpoints`

## Services and ports

| Service                    | Port (default) | Role                                                                                     | Notes                                                        |
| -------------------------- | -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Next.js App Router         | 3000           | UI, SSR/ISR, route handlers that proxy to AI and external APIs                           | `npm run dev` / `npm run start`                              |
| Python AI (Flask)          | 5000           | Text generation (MiniLM), image classification (ResNet-18), chemistry helpers, IoT        | `python python_ai/app.py`                                    |
| PostgreSQL                 | 5432           | Main database with vector search and molecular informatics                               | `docker compose up -d postgres`                              |
| Express API                | 4000           | Backend API for products, orders, and user accounts                                      | `npm run dev` in `express-api`                               |

## System architecture

```
Browser (React UI)
   |
   | fetch/chat ↔ SSR
   v
Next.js 15 (App Router, TypeScript)
   |  - Route handlers under src/app/api/*
   |  - Static/catalog data under src/data
   |  - Uses env: NEXT_PUBLIC_API_URL, PYTHON_AI_HOST
   |
   | proxy /api/python-chat, /api/python-health → PYTHON_AI_HOST
   v
Flask AI service (python_ai/app.py)
   |  - MiniLM (NLP) & ResNet-18 (Vision) inference
   |  - Chemistry/ChEMBL helpers (RDKit)
   |  - IoT command lifecycle: create → poll → update
   |
   | persistence (PostgreSQL)
   v
PostgreSQL (pgvector + rdkit)
   |
   v
ESP32 accessory (scripts/esp32/esp32_coffeemachine.ino)
   - Polls /api/commands/check/{machine_id}
   - Executes recipe JSON
   - Posts status to /api/commands/update/{id}
```

## Tech stack

-   **Frontend**: Next.js 15.5.4, React 19, TypeScript 5, Tailwind/PostCSS, Turbopack, ESLint 9
-   **AI/Backend**: Flask 3, Flask-CORS, PyTorch 2.7, MiniLM-L6-v2 (NLP), ResNet-18 (Vision), FAISS + sentence-transformers for RAG, RDKit & chembl client for chemistry
-   **Data & Storage**: PostgreSQL 16, JSON catalogs (`src/data`, `python_ai/data`), training corpora (`python_ai/training_data`), model checkpoints (`python_ai/checkpoints`)
-   **Tooling**: npm scripts for Next, Python virtualenv + pip, Docker Compose for PostgreSQL, ESLint for frontend, and pytest-style tests under `python_ai/tests`

## Repository layout (working set)

```
package.json                 Next.js app metadata & scripts
src/                         App Router pages, route handlers, components, styles
  app/api/                   Route handlers (chat, python proxy, subscribe, etc.)
  data/                      Coffee and machine catalog JSON/TS
  components/                UI modules (cart, recommender, payment, account)
python_ai/                   Flask AI + training code
  app.py                     Main Flask server (AI + IoT endpoints)
  requirements.txt           Python deps
  data/                      Consolidated AI data (PDFs, embeddings, training sets)
  checkpoints/               Model checkpoints (gitignored)
  training_data/             Text corpora for fine-tuning
  tests/                     Sample tests for IoT/db/model helpers
scripts/                     Node/utility scripts + ESP32 sketch
public/                      Static assets (fonts, images)
express-api/                 Main Backend API
  data/01_schema.sql         Unified PostgreSQL schema
```

## Runtime configuration

-   `NEXT_PUBLIC_API_URL`: Base URL for external commerce/admin API (default `http://localhost:4000`). Components: cart, admin, weather, machine pages.
-   `PYTHON_AI_HOST`: Base URL for Flask AI service used by `/api/python-chat` and `/api/python-health` (default `http://localhost:5000`).
-   `PYTHON_AI_PORT`: Port the Flask app binds to (default `5000`).
-   `POSTGRES_*`: PostgreSQL connection settings (Host, Port, DB, User, Password).

## Frontend (Next.js App Router)

-   Pages live under `src/app/*` with layouts and shared styles in `src/app/globals.css` and `src/styles/*`.
-   Product data is sourced from `src/data/coffee.ts`, `src/data/machines.ts`, and generated JSON derivatives for fast render.
-   Client features: cart, coffee recommender, subscription forms, payment UI, account pages with pagination, and chat UI.
-   Route handlers (`src/app/api`):
    -   `/api/chat`: Local fallback coffee Q&A using static data and rule-based responses.
    -   `/api/python-chat`: Proxy to Flask `/api/chat` for TinyLlama responses; supports cancellation.
    -   `/api/python-health`: Proxy to Flask `/api/health`.
    -   `/api/subscribe`: Handles subscription form posts (implementation in repo).
    -   `/api/chemistry`, `/api/model`, `/api/pages`: Scoped utilities for content and form handling.
-   Environment-aware fetching: many components default to `http://localhost:4000` via `NEXT_PUBLIC_API_URL`; point this to your own API or mock server.

## Python AI/Flask service

File: `python_ai/app.py`. Responsibilities:

-   TinyLlama-based generation: `/api/generate`, `/api/chat`, `/api/summarize`, `/api/classify`
-   Model management: `/api/models`, `/api/train`, `/api/save-model`, cancellation `/api/cancel/{request_id}`
-   Health: `/api/health`
-   Chemistry helpers (ChEMBL/RDKit): `/api/molecules/search`, `/api/molecule/<chembl_id>` + render/download variants
-   Icon utilities: `/api/icons/<username>.svg`, `/api/icons/save`
-   IoT command lifecycle: `/api/commands/create`, `/api/commands/check/{machine_id}`, `/api/commands/update/{command_id}`
-   Static serving: exposes `public/` when present for icon assets

### Commands table schema

Whether using the in-memory stub (`iot_db.py`) or MariaDB, commands share the same shape:

| Column            | Type               | Notes                                           |
| ----------------- | ------------------ | ----------------------------------------------- |
| `command_id`      | INT                | Primary key / auto-increment                    |
| `machine_id`      | VARCHAR            | Device identifier                               |
| `recipe`          | JSON               | Brew parameters sent to the device              |
| `execute_allowed` | BOOL               | Gate to allow execution when user approves      |
| `meta`            | JSON               | Arbitrary metadata from UI/device               |
| `status`          | VARCHAR            | `pending`, `brewing`, `complete`, `failed`, ... |
| `created_at`      | DATETIME/TIMESTAMP | Server-set creation time                        |

Example MariaDB table (aligns with the stub):

```sql
CREATE TABLE commands (
  command_id INT AUTO_INCREMENT PRIMARY KEY,
  machine_id VARCHAR(255) NOT NULL,
  recipe JSON NOT NULL,
  execute_allowed BOOLEAN DEFAULT TRUE,
  meta JSON,
  status VARCHAR(32) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Data and storage

-   **Catalogs**: `src/data/coffee.ts` and `src/data/machines.ts` (plus generated JSON) drive the storefront and recommendations.
-   **AI input**: `python_ai/training_data/*.txt` corpora for fine-tuning; `python_ai/data/capsule_volumes.json` for recipe sizing.
-   **Model checkpoints**: place under `python_ai/checkpoints/` (ignored by git). `python_ai/models/` holds exported artifacts for TinyLlama variants.
-   **RAG assets**: `python_ai/rag_data/` for chunked coffee knowledge (if generated).
-   **IoT commands**: In-memory dictionary by default (`python_ai/iot_db.py`); swap to MariaDB for persistence.

## AI models and training

-   Entry points: `python_ai/train.py` and `python_ai/trainer.py` (TinyLlama fine-tuning with PEFT/LoRA and 4-bit quantization).
-   Model manager: `python_ai/tinyllama_models.py` handles loading coffee vs chemistry LoRA adapters.
-   Requirements: see `python_ai/requirements.txt` (includes torch, transformers, bitsandbytes, accelerate, sentence-transformers, FAISS, RDKit).
-   RAG: `python_ai/rag_retriever.py` consumes `rag_data/coffee_chunks.json` when present.
-   Chemistry: relies on ChEMBL client and RDKit for molecule lookup, rendering, and property extraction.

### Chemistry data & pipelines

-   **Sources**: ChEMBL (via `chembl-webresource-client`) for molecule metadata and canonical SMILES; coffee/aroma compounds enumerated in `python_ai/download_chembl_data.py`.
-   **Download script**: `python_ai/download_chembl_data.py` pulls ~100+ coffee compounds, 200+ flavor/aroma molecules, roasting byproducts, alkaloids, acids, terpenes, and vitamins. Output is `python_ai/data/chembl-training.json` (generated when run).
-   **Rendering/analysis**: RDKit and ChEMBL data power `/api/molecule*` endpoints (SVG/PDB/SDF/SMILES exports, property lookup) and chemistry mode chat answers.
-   **RAG-ready assets**: Chemistry chunks can be added to `python_ai/rag_data/coffee_chunks.json` for retrieval-augmented answers.

### Datasets (stored in-repo)

-   `python_ai/training_data/coffee_*.jsonl`: Coffee dialogue/training splits (train/val/test) for general coffee chat.
-   `python_ai/training_data/molecules_*.jsonl`: Molecule-focused splits for chemistry mode responses.
-   `python_ai/data/chembl-molecules.json`: Raw molecule dump (ChEMBL-derived).
-   `python_ai/data/capsule_volumes.json`: Brew volumes per capsule, used for recipe generation.
-   Multilingual coffee PDFs under `python_ai/data/coffee_*.pdf` (reference material).

### Frameworks & libraries (chemistry + ML)

-   **Core ML**: PyTorch 2.7, Hugging Face Transformers/PEFT/bitsandbytes/accelerate for TinyLlama fine-tuning and 4-bit inference.
-   **Vector search**: FAISS + sentence-transformers for retrieval.
-   **Chemistry**: RDKit for molecule parsing/rendering; `chembl-webresource-client` for ChEMBL queries; Py3Dmol for 3D visualization; Pillow for image ops.
-   **Data/ETL**: pandas, numpy for dataset prep; scripts under `python_ai/scripts` for RAG/data processing.

## IoT device flow

1. UI (Next) creates a command via Flask `/api/commands/create` with `machine_id` and `recipe` JSON.
2. ESP32 polls `/api/commands/check/{machine_id}` on an interval; receives the oldest `pending` command.
3. Device executes the recipe (servo/stepper actions defined in `scripts/esp32/esp32_coffeemachine.ino`).
4. Device posts status updates to `/api/commands/update/{command_id}` (`brewing`, `complete`, `failed`, etc.).
5. Server/UI can display live status; persistence is in-memory unless MariaDB is enabled.

## Local development

Prereqs: Node 18+ (recommend 20), npm; Python 3.11+; optional Docker for MariaDB; PowerShell on Windows.

1. Install frontend deps

```pwsh
npm install
```

2. Configure environment (create `.env.local` at repo root)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000   # or your mock/real API
PYTHON_AI_HOST=http://localhost:5000
```

3. Install Python deps

```pwsh
python -m venv .venv
./.venv/Scripts/Activate.ps1
pip install -r python_ai/requirements.txt
```

4. Run services

```pwsh
# Terminal 1
npm run dev

# Terminal 2 (from repo root)
python python_ai/app.py

# Optional: start MariaDB for command persistence
docker compose -f python_ai/docker-compose.maria.yml up -d
```

5. Open the app at `http://localhost:3000`.

## APIs

-   **Next route handlers**

    -   `/api/chat`: deterministic coffee FAQ + product suggestions using static data.
    -   `/api/python-chat`: proxies chat payloads to Flask `/api/chat`.
    -   `/api/python-health`: surfaces Flask health.
    -   `/api/subscribe`: subscription form handler.
    -   `/api/chemistry`, `/api/model`, `/api/pages`: utilities for chemistry previews, model info, page data.

-   **Flask endpoints (selection)**
    -   `GET /api/health`: model/device status
    -   `POST /api/generate` | `POST /api/chat` | `POST /api/summarize` | `POST /api/classify`: TinyLlama inference
    -   `POST /api/train`, `POST /api/save-model`: training and persistence hooks
    -   `POST /api/cancel/{request_id}`: cancel long-running generations
    -   `POST /api/commands/create`, `GET /api/commands/check/{machine_id}`, `POST /api/commands/update/{id}`: IoT command lifecycle
    -   Chemistry suite under `/api/molecule*` and `/api/molecules/search`: ChEMBL/RDKit lookups, rendering, and downloads

## Testing and quality

-   Frontend lint: `npm run lint`
-   Python tests: activate venv, then `pytest python_ai/tests` (install `pytest` if not already available)
-   Manual checks: verify `/api/python-health` returns `status: ok`; run a chat request through `/api/python-chat` to ensure the proxy works.

## Deployment notes

-   Build frontend: `npm run build` then `npm run start` on your host or container runtime.
-   Run Flask with a production WSGI server (e.g., `waitress-serve --port=5000 python_ai.app:app`) and ensure `PYTHON_AI_HOST` points to it.
-   Add TLS/HTTPS termination in front of both services; lock down CORS in Flask if exposing publicly.
-   Persist the command queue: enable MariaDB and migrate the `commands` table before attaching devices.

## Troubleshooting

-   Chat returns 502: ensure `python_ai/app.py` is running and `PYTHON_AI_HOST` matches. Check Flask logs for missing model checkpoints.
-   IoT commands never arrive: device must poll the correct `machine_id`; verify commands are created and status is `pending`.
-   Chemistry endpoints fail: install RDKit (via conda) and `chembl-webresource-client` per `requirements.txt`.
-   Port collisions: change `PYTHON_AI_PORT` or Next.js `PORT` envs, and update proxies accordingly.

---

## Legacy README (previous full guide)

# Filspresso Next — Full Project README

This document is a comprehensive guide to the Filspresso Next project (Next.js frontend + Python AI + IoT integration). It combines the app overview, AI model design and training, training data, IoT workflow and device integration (ESP32 + Krups Essenza Mini XN110 guidance), developer instructions, and production recommendations.

## Table of Contents

-   Project overview
-   High-level architecture
-   Technologies used
-   Project structure (detailed)
-   AI: models, data and training
-   IoT: recipes, API endpoints, device workflow
-   ESP32 device example and Krups Essenza integration notes
-   Development: running locally and testing
-   Security & production recommendations
-   Troubleshooting and debugging
-   Appendices: file references, capsule volumes, useful commands

---

## Project overview

> **⚠️ SECURITY WARNING: EDUCATIONAL USE ONLY**
> This project currently uses **plain text storage** for all user data (passwords, credit cards, orders) and has **no encryption**. It is designed for demonstration purposes only. DO NOT use real credentials or payment information.

Filspresso Next is a modern migration of the original Filspresso site into a Next.js (App Router + TypeScript) frontend that integrates with a Python AI service and optional IoT-enabled coffee machines.

**Recent Updates & Architecture Changes:**

-   **JSON-based Storage**: Replaced database dependencies with local JSON files for user data.
    -   `src/data/accounts.json`: User credentials (plain text).
    -   `src/data/user_cards.json`: User payment methods (plain text).
    -   `src/data/orders.json`: Complete order history.
-   **Simplified Backend**: Removed `bcrypt` and complex auth flows in favor of direct file manipulation for transparency and ease of testing.
-   **New API Endpoints**: Added Next.js Route Handlers for managing Cards (`/api/user/cards`) and Orders (`/api/order`).

The system supports three tiers of AI-backed assistants for coffee recommendations:

-   **Tanka (~30M parameters)** — lightweight, conversational assistant for quick recommendations and support
-   **Villanelle (~60M parameters)** — balanced model for technical explanations and troubleshooting
-   **Ode (~90M parameters)** — research-grade model for deep technical, sensory, and sustainability insights

The app can produce personalized brewing recipes which can optionally be delivered to a connected coffee machine (ESP32 or similar) that executes the recipe.

## Feature Breakdown

### 🧠 Kafelot AI System

The core intelligence of Filspresso, powered by the "Kafelot" engine.

-   **Multi-Model Support**: Seamlessly switches between Tanka, Villanelle, and Ode based on query complexity.
-   **Context-Aware Chat**: Remembers conversation history for natural dialogue.
-   **RAG (Retrieval-Augmented Generation)**: Accesses a vector database of coffee knowledge to answer specific questions.
-   **Chemistry Mode**: Visualizes coffee molecules and explains chemical processes (caffeine, lipids, sugars).
-   **IoT Command Generation**: Translates natural language requests ("Make me a strong espresso") into machine-executable JSON commands.

### 👤 Account & Order Management

A fully functional (demonstration) e-commerce user system.

-   **User Profiles**: Create and manage accounts with persistent data.
-   **Wallet System**: Add, view, and remove credit cards (stored in `user_cards.json`).
-   **Order History**: Track past purchases with detailed receipts (stored in `orders.json`).
-   **Shopping Bag**: Persistent cart state with local storage synchronization.
-   **Subscription Management**: Manage recurring coffee deliveries.

### 🔌 IoT Integration

-   **Device Polling**: ESP32 devices poll the server for new brewing tasks.
-   **Real-time Status**: Updates brew status (Heating -> Brewing -> Done) in real-time.
-   **Remote Control**: Trigger brews directly from the web interface.

### End-to-End User Journey

```
Complete User Journey: Browse → AI Recommendation → Purchase → Automated Brew
═══════════════════════════════════════════════════════════════════════════════

  ┌─────────────────────────────────────────────────────────────────────┐
  │                      DISCOVERY PHASE                                │
  └─────────────────────────────────────────────────────────────────────┘
                                 │
                  User visits filspresso.com
                                 │
                  ┌──────────────v──────────────┐
                  │ Home Page                   │
                  │ • Hero section              │
                  │ • Featured products         │
                  │ • AI assistant intro        │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Browse Coffee Catalog       │
                  │ • Filter by type/intensity  │
                  │ • View capsule details      │
                  │ • Read tasting notes        │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Explore Machines            │
                  │ • Compare models            │
                  │ • Check compatibility       │
                  │ • Read specifications       │
                  └──────────────┬──────────────┘
                                 │
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    AI INTERACTION PHASE                             │
  └─────────────────────────────────────────────────────────────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ User asks AI:               │
                  │ "What coffee should I try?" │
                  └──────────────┬──────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ AI Model Selection           │
                  │ ┌─────────┬──────────┬──────┐│
                  │ │ Tanka   │Villanelle│ Ode  ││
                  │ │ (Quick) │(Balanced)│(Deep)││
                  │ └─────────┴──────────┴──────┘│
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ AI analyzes:                 │
                  │ • User preferences           │
                  │ • Previous orders            │
                  │ • Time of day                │
                  │ • Machine compatibility      │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ AI provides:                 │
                  │ • Coffee recommendation      │
                  │ • Brewing parameters         │
                  │ • Tasting notes              │
                  │ • Perfect pairing ideas      │
                  └──────────────┬───────────────┘
                                 │
  ┌─────────────────────────────────────────────────────────────────────┐
  │                      PURCHASE PHASE                                 │
  └─────────────────────────────────────────────────────────────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Add to Cart                 │
                  │ • Recommended capsules      │
                  │ • Optional: Machine         │
                  │ • Accessories               │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Review Cart                 │
                  │ • Quantities                │
                  │ • Subscription options      │
                  │ • Apply promo codes         │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Proceed to Checkout         │
                  │ • Shipping address          │
                  │ • Delivery options          │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Payment                     │
                  │ • Enter card details        │
                  │ • Process Payment           │
                  │ • Order confirmation        │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Order Confirmed             │
                  │ • Order ID: #12345          │
                  │ • Email receipt             │
                  │ • Track delivery            │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ Brew Coffee (Optional)      │
                  │ • Send recipe to machine    │
                  │ • Trigger brew remotely     │
                  └──────────────┬──────────────┘
                                 │
  ┌─────────────────────────────────────────────────────────────────────┐
  │                  IoT BREWING PHASE (Optional)                       │
  └─────────────────────────────────────────────────────────────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ User clicks:                │
                  │ "Brew with my machine"      │
                  └──────────────┬──────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ Backend creates command      │
                  │ POST /api/commands/create    │
                  │ {machine_id, recipe}         │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ ESP32 polls API              │
                  │ GET /api/commands/check      │
                  │ Receives brew command        │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ Pre-flight checks            │
                  │ • Capsule magazine OK        │
                  │ • Water reservoir OK         │
                  │ • Machine ready              │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ Execute brew sequence:       │
                  │ 1. Pick capsule from slot    │
                  │ 2. Insert into machine       │
                  │ 3. Close brew head           │
                  │ 4. Press start button        │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ Machine brews coffee         │
                  │ • Heat water (92°C)          │
                  │ • Pre-infusion (300ms)       │
                  │ • Pump water (40ml)          │
                  │ • ~30-40 seconds             │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ ESP32 posts completion       │
                  │ POST /api/commands/update    │
                  │ {status: "complete"}         │
                  └──────────────┬───────────────┘
                                 │
                                 v
                  ┌──────────────────────────────┐
                  │ User receives notification   │
                  │ "Your coffee is ready! ☕"   │
                  └──────────────┬───────────────┘
                                 │
  ┌─────────────────────────────────────────────────────────────────────┐
  │                      ENJOYMENT PHASE                                │
  └─────────────────────────────────────────────────────────────────────┘
                                 │
                  ┌──────────────v──────────────┐
                  │ User enjoys perfectly       │
                  │ brewed coffee ☕            │
                  │                             │
                  │ • Optimal temperature       │
                  │ • Perfect extraction        │
                  │ • AI-recommended pairing    │
                  └─────────────────────────────┘


Timeline Summary:
═══════════════════════════════════════════════════════════════════════

  Discovery Phase:        2-5 minutes
  AI Interaction:         1-2 minutes
  Purchase Phase:         2-3 minutes
  IoT Brewing Phase:      1-2 minutes (automated)
  ────────────────────────────────────────
  Total Experience:       6-12 minutes

  Result: Perfect cup of AI-recommended, automatically brewed coffee! ☕
```

---

## High-level architecture

```
              ┌──────────────────────────────────────────────────┐
              │               Filspresso Next System             │
              │         AI-Powered Coffee E-Commerce + IoT       │
              └──────────────────────────┬───────────────────────┘
                                         |
                    ┌────────────────────┴───────────────────┐
                    |                                        |
            ┌───────v──────┐                         ┌───────v──────┐
            │  Web Browser │                         │ Mobile Device│
            │   (Client)   │                         │   (Client)   │
            └───────┬──────┘                         └───────┬──────┘
                    |                                        |
                    └────────────────┬───────────────────────┘
                                     |
                            ┌────────v────────┐
                            │   Next.js 15    │
                            │   App Router    │
                            │  (TypeScript)   │
                            └────────┬────────┘
                                     |
                    ┌────────────────┼────────────────┐
                    |                |                |
            ┌───────v─────┐   ┌──────v──────┐   ┌─────v──────┐
            │ Page        │   │ Cart State  │   │  Product   │
            │ Components  │   │ Management  │   │  Catalog   │
            │ (React)     │   │ (Context)   │   │  (JSON)    │
            └───────┬─────┘   └─────────────┘   └──────┬─────┘
                    |                                  |
                    └────────────────┬─────────────────┘
                                     |
                            ┌────────v────────┐
                            │  Flask Backend  │
                            │  (Python 3.11)  │
                            │  Port 5000      │
                            └────────┬────────┘
                                     |
                    ┌────────────────┼────────────────┐
                    |                |                |
            ┌───────v─────┐   ┌──────v──────┐   ┌─────v──────┐
            │ AI Models   │   │  IoT API    │   │  Inference │
            │ (PyTorch)   │   │  Endpoints  │   │   Engine   │
            │             │   │             │   │            │
            │ • Tanka     │   │ • Create    │   │ • Generate │
            │ • Villanelle│   │ • Check     │   │ • Chat     │
            │ • Ode       │   │ • Update    │   │ • Classify │
            └─────┬───────┘   └──────┬──────┘   └────────────┘
                  |                  |
                  |          ┌───────v───────┐
                  |          │  Commands DB  │
                  |          │ SQLite/MariaDB│
                  |          └───────┬───────┘
                  |                  |
          ┌───────v──────────────────v───────┐
          |       Data Storage Layer         |
          ├──────────────────────────────────┤
          │ • User Data (JSON)               │
          │ • Training corpora (.txt)        │
          │ • Model checkpoints (.pt)        │
          │ • Capsule volumes (JSON)         │
          │ • Command history (DB)           │
          └─────────────┬────────────────────┘
                        |
            ┌───────────┴───────────┐
            |                       |
    ┌───────v──────┐         ┌──────v───────┐
    │ ESP32        │         │ Coffee       │
    │ Accessory    │────────→│ Machine      │
    │ (Wi-Fi)      │         │ (Krups       │
    │              │         │  Essenza)    │
    │ • Poll API   │         │              │
    │ • Execute    │         │ • Brew       │
    │ • Update     │         │ • Heat       │
    └──────┬───────┘         └──────────────┘
           |
    ┌──────v───────┐
    │ Actuators &  │
    │ Sensors      │
    │ • Servos     │
    │ • Steppers   │
    │ • Limit SW   │
    │ • Optical    │
    └──────────────┘
```

### Architecture Components1. **Next.js frontend (React)** — user UI, product pages, actions (e.g., "Brew with AI Recommendation")

2. **Backend API (Python Flask for AI microservice shown in repo)** — orchestrates AI calls, stores commands, exposes IoT endpoints
3. **Python AI stack** — transformer-based models (Tanka / Villanelle / Ode) trained on curated coffee domain corpora
4. **IoT device** — ESP32-based coffee accessory (example sketch included). Machine polls backend for commands and executes them.
5. **Database** — training/corpus files (flat .txt for training), and command store (SQLite for testing; production recommend MariaDB/Postgres)

---

## Technologies used

### Frontend Stack

-   **Framework**: Next.js 15.5.4 (App Router with Turbopack)
-   **Language**: TypeScript 5.x (strict mode enabled)
-   **UI Framework**: React 19.1.0
-   **Styling**: Tailwind CSS 4.x with PostCSS
-   **HTTP Client**: Native Fetch API, @emailjs/browser 4.4.1 for contact forms
-   **Build Tools**:
    -   Turbopack (Next.js bundler)
    -   ESLint 9.x with Next.js config
    -   TypeScript compiler with strict settings
-   **Development**: Hot module replacement, fast refresh

### Backend Stack (Python AI Microservice)

-   **Web Framework**: Flask 3.0.0 with Flask-CORS 4.0.0
-   **AI/ML Framework**: PyTorch 2.1.0
-   **LLM & Fine-Tuning**:
    -   **Base Model**: TinyLlama-1.1B-Chat-v1.0
    -   **Fine-Tuning**: PEFT (LoRA), bitsandbytes (4-bit quantization)
    -   **Library**: Hugging Face Transformers 4.35+
-   **RAG (Retrieval-Augmented Generation)**:
    -   **Vector Store**: FAISS (Facebook AI Similarity Search)
    -   **Embeddings**: Sentence-Transformers (`all-MiniLM-L6-v2`)
-   **Data Processing**:
    -   NumPy 1.24.3 (numerical computing)
    -   Pandas 2.1.0 (data manipulation)
    -   scikit-learn 1.3.2 (preprocessing, metrics)
-   **Database**:
    -   SQLite (development, via `iot_db.py`)
    -   MariaDB/MySQL support via pymysql 1.1.0
    -   SQLAlchemy 2.0.19 (optional ORM wrapper for pooling)
-   **Production Server**: Waitress 2.1.2 (WSGI server for production)
-   **Configuration**: python-dotenv 1.0.0 for environment variables
-   **HTTP Client**: requests 2.31.0

### Device/IoT Stack

-   **Microcontroller**: ESP32 (Wi-Fi enabled, Arduino/PlatformIO)
-   **Communication Protocol**: HTTP/HTTPS polling (example); MQTT recommended for production
-   **Language**: C++ (Arduino framework)
-   **Hardware Components** (recommended for accessory):
    -   Servo motors for button pressing
    -   Stepper motors with drivers for capsule handling
    -   Limit switches and optical sensors for feedback
    -   Optoisolated relay/driver boards for safety

### Database & Storage

-   **User Data Engine**: Custom JSON-based File Storage System (NoSQL/No-DB)
    -   Direct file I/O for `accounts.json`, `user_cards.json`, `orders.json`
    -   Zero-dependency, portable, and transparent (for educational visibility)
-   **IoT Commands**: SQLite 3 (embedded) or MariaDB (optional)
-   **Training Data**: Plain text files (.txt format, UTF-8 encoded)
-   **Model Checkpoints**: PyTorch `.pt` files with state dictionaries
-   **Configuration Data**: JSON files (capsule volumes, recipe schemas)

### DevOps & Tooling

-   **Version Control**: Git
-   **Package Managers**:
    -   npm (Node.js/frontend dependencies)
    -   pip (Python dependencies)
-   **Containerization**: Docker with Docker Compose (optional, for MariaDB dev)
-   **Process Management**: Python venv for isolated environments
-   **Linting & Formatting**: ESLint (frontend), Black/Flake8 (Python, optional)

---

## Project structure (complete directory tree)

```
filspresso_next/
├── src/                              # Next.js application source
│   ├── app/                          # App Router pages and API routes
│   │   ├── api/                      # Next.js API routes
│   │   │   ├── chat/                # AI Chat endpoints
│   │   │   ├── chemistry/           # Chemistry molecule endpoints
│   │   │   ├── model/               # AI Model management
│   │   │   ├── order/               # Order processing endpoints
│   │   │   ├── pages/               # Dynamic page data endpoints
│   │   │   ├── python-chat/         # Python AI bridge
│   │   │   ├── python-health/       # Python service health check
│   │   │   ├── subscribe/           # Subscription management
│   │   │   └── user/                # User data endpoints
│   │   │       └── cards/           # Card management
│   │   ├── data/                    # Client-side page content data
│   │   ├── payment/                 # Payment page route
│   │   ├── globals.css              # Global styles (legacy CSS preserved)
│   │   ├── layout.tsx               # Root layout component
│   │   └── page.tsx                 # Root page component
│   ├── components/                   # React components (organized by feature)
│   │   ├── account/                 # Account page components
│   │   ├── coffee/                  # Coffee catalog components
│   │   ├── coffee-machine-animation/ # Interactive machine animation
│   │   ├── home/                    # Home page components
│   │   ├── love-coffee/             # Coffee education components
│   │   ├── machines/                # Machine catalog components
│   │   ├── payment/                 # Payment flow components
│   │   ├── shopping-bag/            # Cart/bag components
│   │   ├── subscription/            # Subscription management components
│   │   ├── Cart.tsx                 # Global cart component
│   │   ├── LayoutChrome.tsx         # App chrome/layout wrapper
│   │   ├── Navbar.tsx               # Navigation bar
│   │   ├── NotificationsProvider.tsx # Toast/notification system
│   │   ├── PaymentForm.tsx          # Payment form component
│   │   └── SubscriptionForm.tsx     # Subscription form component
│   ├── data/                         # Data storage (JSON)
│   │   ├── accounts.json            # User accounts (plain text)
│   │   ├── user_cards.json          # User cards (plain text)
│   │   ├── orders.json              # Order history
│   │   ├── coffee.generated.json    # Coffee product catalog
│   │   ├── coffee.ts                # Coffee data types
│   │   ├── machines.generated.json  # Machine product catalog
│   │   └── machines.ts              # Machine data types
│   ├── hooks/                        # Custom React hooks
│   │   └── useCart.ts               # Cart state management hook
│   ├── lib/                          # Utility libraries
│   │   └── pages.ts                 # Page routing utilities
│   ├── styles/                       # Feature-specific stylesheets
│   │   ├── account.css
│   │   ├── coffee-machine.css
│   │   ├── globals.css
│   │   ├── love-coffee.css
│   │   ├── notifications.css
│   │   ├── payment.css
│   │   ├── shopping-bag.css
│   │   └── subscription.css
│   └── types/                        # TypeScript type definitions
│       └── custom.d.ts
├── public/                           # Static assets
│   ├── images/                       # Product images, backgrounds, logos
│   │   ├── Capsules/                # Capsule product images
│   │   ├── Machines/                # Machine product images
│   │   └── svg/                     # Coffee size/type icons
├── python_ai/                        # Python AI & IoT backend
│   ├── data/                         # Reference data (PDFs, JSONs)
│   │   ├── capsule_volumes.json     # Canonical capsule volume specs
│   │   ├── chembl-molecules.json    # Chemistry database
│   │   └── coffee_*.pdf             # Multilingual coffee knowledge
│   ├── migrations/                   # Database migrations
│   │   └── create_commands_table.sql
│   ├── models/                       # TinyLlama Models
│   │   ├── tinyllama_chem/          # Fine-tuned Chemistry Model
│   │   └── tinyllama_v2/            # Fine-tuned Coffee Model
│   ├── rag_data/                     # RAG Vector Database
│   │   ├── coffee_chunks.json       # Knowledge chunks
│   │   ├── coffee_embeddings.npy    # Vector embeddings
│   │   └── coffee_faiss.index       # FAISS index
│   ├── scripts/                      # Training & Data Scripts
│   │   ├── build_coffee_rag.py      # RAG builder
│   │   ├── finetune_tinyllama_*.py  # Fine-tuning scripts
│   │   └── generate_molecule_*.py   # Data generation
│   ├── training_data/                # Training corpora (JSONL)
│   │   ├── coffee.jsonl             # Coffee instruction datasets
│   │   └── molecules.jsonl          # Molecule datasets
│   ├── app.py                        # Flask microservice (AI + IoT endpoints)
│   ├── iot_db.py                     # IoT command DB helper
│   ├── rag_retriever.py              # RAG Logic
│   ├── tinyllama_models.py           # Model Manager
│   ├── requirements.txt              # Python dependencies
│   └── docker-compose.maria.yml      # Docker Compose for local MariaDB
├── scripts/                          # Utility scripts
│   ├── esp32/                       # ESP32 device integration
│   │   └── esp32_coffeemachine.ino  # Arduino sketch for accessory
│   ├── addCoffeeNotes.mjs           # Script to add coffee notes
│   ├── extractCoffeeData.mjs        # Extract coffee data from sources
│   ├── extractMachinesData.mjs      # Extract machine data from sources
│   └── start_all.bat                # Startup script
├── package.json                      # Node.js dependencies and scripts
├── tsconfig.json                     # TypeScript compiler configuration
├── next.config.ts                    # Next.js configuration
├── tailwind.config.cjs               # Tailwind CSS configuration
├── postcss.config.mjs                # PostCSS configuration
├── eslint.config.mjs                 # ESLint configuration
├── middleware.ts                     # Next.js middleware (routing)
├── global.d.ts                       # Global TypeScript declarations
├── next-env.d.ts                     # Next.js TypeScript declarations
├── LICENSE                           # MIT License
└── README.md                         # This comprehensive documentation
```

### Key Directory Purposes

-   **`src/app/`**: Next.js App Router pages and layouts; uses file-based routing
-   **`src/components/`**: Feature-organized React components; each major page has a dedicated subfolder
-   **`src/data/`**: Product catalog data (coffee capsules and machines) in JSON format
-   **`python_ai/`**: Complete Python AI backend including models, training, inference, and IoT API
-   **`python_ai/training_data/`**: Plain text training corpora for the three coffee AI models
-   **`python_ai/models_checkpoint/`**: Saved PyTorch model weights (`.pt` files)
-   **`scripts/esp32/`**: Device integration example and documentation for ESP32 accessory
-   **`public/images/`**: Product photography and visual assets organized by product type

---

## Data Storage (New Architecture)

The project now uses a file-based storage system located in `src/data/` for all user-related data. This replaces the need for a SQL database for these features.

| File                      | Description                                        | Format          |
| ------------------------- | -------------------------------------------------- | --------------- |
| `accounts.json`           | Stores user accounts and passwords.                | Plain Text JSON |
| `user_cards.json`         | Stores user credit card details mapped by User ID. | Plain Text JSON |
| `orders.json`             | Stores complete order history mapped by User ID.   | Plain Text JSON |
| `coffee.generated.json`   | Coffee product catalog (Static).                   | JSON            |
| `machines.generated.json` | Coffee machine catalog (Static).                   | JSON            |

### Data Structure Examples

**`accounts.json`**

```json
[
	{
		"id": "user_123",
		"email": "user@example.com",
		"password": "plain_text_password",
		"name": "John Doe"
	}
]
```

**`user_cards.json`**

```json
{
	"user_123": [
		{
			"id": "card_456",
			"number": "1234567890123456",
			"expiry": "12/25",
			"cvv": "123",
			"holder": "John Doe"
		}
	]
}
```

**`orders.json`**

```json
{
  "user_123": [
    {
      "id": "order_789",
      "date": "2025-11-20T10:00:00.000Z",
      "items": [...],
      "total": 45.50,
      "status": "confirmed"
    }
  ]
}
```

## AI: models, data and training

### Model architecture (detailed)

The Kafelot AI models are built on an enhanced transformer architecture with coffee-domain specialization. All three models share the same core components but differ in size and feature activation.

#### Core Architecture Components

1. **Enhanced Transformer Layers** (`EnhancedTransformerLayer`)

    - Multi-Query Attention (MQA) with configurable KV heads
    - Rotary Position Embeddings (RoPE) for improved context handling
    - Coffee Domain Attention for specialized knowledge
    - SwiGLU-activated feed-forward networks or Mixture of Experts (MoE)
    - Layer normalization with residual connections

2. **Multi-Query Attention (MQA)** (`MultiQueryAttention`)

    - Shares key/value projections across multiple query heads for efficiency
    - Reduces memory bandwidth and increases inference speed
    - Configurable number of KV heads (2 for lightweight, 4 for quality)
    - Integrated with RoPE for position-aware attention

3. **Rotary Position Embeddings (RoPE)** (`RotaryPositionEmbedding`)

    - Reference: RoFormer (Su et al., 2021)
    - Applies rotation to query and key embeddings based on position
    - Better extrapolation to longer sequences than learned positional embeddings
    - Precomputed cos/sin buffers for efficiency
    - Configurable theta parameter (default: 10000.0)

4. **SwiGLU Activation** (`SwiGLU`, `FeedForwardNetworkSwiGLU`)

    - Reference: GLU Variants Improve Transformer (Shazeer, 2020)
    - Gated Linear Unit variant with Swish/SiLU activation
    - More expressive than ReLU/GELU for language modeling
    - Applied in feed-forward layers: `x * SiLU(gate)`

5. **Coffee Domain Attention** (`CoffeeDomainAttention`)

    - Custom attention mechanism for coffee-specific knowledge
    - Learnable domain embeddings (8 domains by default):
        - Extraction techniques
        - Coffee chemistry
        - Sensory evaluation
        - Sustainability practices
        - Equipment knowledge
        - Regional characteristics
        - Processing methods
        - Brewing science
    - Domain-weighted context blending with hidden states

6. **Mixture of Experts (MoE)** (`MixtureOfExpertsLayer`)

    - Enabled for Villanelle and Ode models
    - Routes tokens to specialized expert networks
    - Learned router selects top-k experts per token
    - Load balancing across experts for efficiency
    - Each expert is a dedicated feed-forward network

7. **Weight Tying**
    - Output projection tied to input embedding matrix
    - Significantly reduces parameter count (embedding weights reused)
    - Common practice in modern language models

#### Model Configurations

| Model          | Parameters | Hidden Size | Layers | Heads | KV Heads | FFN Size | MoE            | Max Context |
| -------------- | ---------- | ----------- | ------ | ----- | -------- | -------- | -------------- | ----------- |
| **Tanka**      | ~30M       | 432         | 7      | 8     | 2        | 1,296    | ❌             | 1,024       |
| **Villanelle** | ~60M       | 592         | 9      | 8     | 2        | 1,776    | ✅ (4 experts) | 1,024       |
| **Ode**        | ~90M       | 776         | 8      | 8     | 4        | 2,328    | ✅ (8 experts) | 1,536       |

#### ModelConfig Dataclass

All models are configured via the `ModelConfig` dataclass in `python_ai/models.py`:

```python
@dataclass
class ModelConfig:
    vocab_size: int = 50000              # Vocabulary size
    max_seq_length: int = 1024           # Maximum sequence length
    hidden_size: int = 768               # Hidden dimension size
    num_layers: int = 12                 # Number of transformer layers
    num_heads: int = 12                  # Number of attention heads
    num_kv_heads: int = 4                # Number of key/value heads (MQA)
    ffn_hidden_size: int = 3072          # Feed-forward hidden size
    dropout_rate: float = 0.1            # General dropout rate
    attention_dropout_rate: float = 0.1  # Attention dropout rate
    layer_norm_eps: float = 1e-6         # Layer norm epsilon
    activation: str = "swiglu"           # Activation function
    use_rope: bool = True                # Enable RoPE
    use_moe: bool = False                # Enable Mixture of Experts
    num_experts: int = 8                 # Number of experts (if MoE)
    num_experts_per_token: int = 2       # Active experts per token
    rope_theta: float = 10000.0          # RoPE frequency base
```

#### Factory Functions

`python_ai/models.py` provides three factory functions:

-   **`create_tanka_model(vocab_size)`** → Tanka (~30M parameters)

    -   Lightweight, conversational assistant
    -   Features: MQA (2 KV heads), RoPE, SwiGLU, Coffee Domain Attention
    -   No MoE (efficiency priority)

-   **`create_villanelle_model(vocab_size)`** → Villanelle (~60M parameters)

    -   Balanced model with technical depth
    -   Features: MQA (2 KV heads), RoPE, SwiGLU, Coffee Domain Attention, MoE (4 experts)
    -   Suitable for detailed explanations and troubleshooting

-   **`create_ode_model(vocab_size)`** → Ode (~90M parameters)
    -   Comprehensive research-grade model
    -   Features: MQA (4 KV heads), RoPE, SwiGLU, Coffee Domain Attention, MoE (8 experts)
    -   Extended context window (1,536 tokens)
    -   Best for deep technical and sensory analysis

These factories return an `AdvancedAIModel` instance and the `ModelConfig` used.

#### Model Architecture Diagram

```
Enhanced Transformer Architecture (AdvancedAIModel)
═══════════════════════════════════════════════════════════════════════

                        Input Token IDs
                        [batch, seq_len]
                              │
                ┌─────────────┴─────────────┐
                │                           │
        ┌───────v──────┐           ┌────────v────────┐
        │ Token        │           │ Positional      │
        │ Embedding    │           │ Embedding       │
        │ [vocab_size, │           │ [max_seq,       │
        │  hidden]     │           │  hidden]        │
        └───────┬──────┘           └────────┬────────┘
                │                           │
                └─────────────┬─────────────┘
                              │
                      ┌───────v────────┐
                      │  Dropout       │
                      │  (p=0.1)       │
                      └───────┬────────┘
                              │
                      ╔═══════v════════╗
                      ║ Enhanced       ║
                      ║ Transformer    ║  ← Repeated N times
                      ║ Layer          ║     (7-9 layers)
                      ╚═══════╤════════╝
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        │  ┌──────────────────v──────────────────┐  │
        │  │  Multi-Query Attention (MQA)        │  │
        │  │  ┌────────────────────────────────┐ │  │
        │  │  │ Query Heads: num_heads         │ │  │
        │  │  │ KV Heads: num_kv_heads (2-4)   │ │  │
        │  │  │                                │ │  │
        │  │  │  ┌─────────────────────┐       │ │  │
        │  │  │  │ Rotary Position     │       │ │  │
        │  │  │  │ Embedding (RoPE)    │       │ │  │
        │  │  │  │ • Rotate Q and K    │       │ │  │
        │  │  │  │ • Better context    │       │ │  │
        │  │  │  └─────────────────────┘       │ │  │
        │  │  │                                │ │  │
        │  │  │ Scores = Q × K^T / √d          │ │  │
        │  │  │ Context = Softmax(Scores) × V  │ │  │
        │  │  └────────────────────────────────┘ │  │
        │  └──────────────────┬──────────────────┘  │
        │                     │                     │
        │  ┌──────────────────v──────────────────┐  │
        │  │  Layer Norm + Residual Connection   │  │
        │  └──────────────────┬──────────────────┘  │
        │                     │                     │
        │  ┌──────────────────v──────────────────┐  │
        │  │  Coffee Domain Attention            │  │
        │  │  • 8 domain embeddings              │  │
        │  │  • Extraction, Chemistry, Sensory   │  │
        │  │  • Sustainability, Equipment, etc.  │  │
        │  └──────────────────┬──────────────────┘  │
        │                     │                     │
        │            ┌────────v────────┐            │
        │            │ MoE Enabled?    │            │
        │            └────┬──────────┬─┘            │
        │                 │          │              │
        │            No   │          │  Yes         │
        │                 │          │              │
        │  ┌──────────────v─┐   ┌──v────────────┐   │
        │  │  SwiGLU FFN    │   │ Mixture of    │   │
        │  │  ┌───────────┐ │   │ Experts (MoE) │   │
        │  │  │ Linear    │ │   │ ┌───────────┐ │   │
        │  │  │ (h→2*ffn) │ │   │ │ Router    │ │   │
        │  │  └─────┬─────┘ │   │ │ (select   │ │   │
        │  │        │       │   │ │  top-k)   │ │   │
        │  │  ┌─────v─────┐ │   │ └─────┬─────┘ │   │
        │  │  │ SwiGLU    │ │   │       │       │   │
        │  │  │ x*σ(gate) │ │   │  ┌────v────┐  │   │
        │  │  └─────┬─────┘ │   │  │Expert 1 │  │   │
        │  │        │       │   │  │Expert 2 │  │   │
        │  │  ┌─────v─────┐ │   │  │  ...    │  │   │
        │  │  │ Linear    │ │   │  │Expert K │  │   │
        │  │  │ (ffn→h)   │ │   │  └────┬────┘  │   │
        │  │  └─────┬─────┘ │   │       │       │   │
        │  │        │       │   │  Weighted sum │   │
        │  └────────┼───────┘   └───────┼───────┘   │
        │           │                   │           │
        │           └─────────┬─────────┘           │
        │                     │                     │
        │  ┌──────────────────v──────────────────┐  │
        │  │  Layer Norm + Residual Connection   │  │
        │  └──────────────────┬──────────────────┘  │
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                      ┌───────v────────┐
                      │  Final Layer   │
                      │  Normalization │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Output Logits  │
                      │ (tied to       │
                      │  embedding)    │
                      │ [batch, seq,   │
                      │  vocab_size]   │
                      └────────────────┘
```

#### Multi-Query Attention (MQA) Detail

```
Multi-Query Attention with Rotary Position Embeddings
══════════════════════════════════════════════════════════════

       Hidden States [batch, seq_len, hidden_size]
                      │
        ┌─────────────┼─────────────┐
        │             │             │
    ┌───v──┐      ┌───v──┐      ┌───v──┐
    │ W_Q  │      │ W_K  │      │ W_V  │
    │      │      │      │      │      │
    │Query │      │ Key  │      │Value │
    │Proj  │      │Proj  │      │Proj  │
    └───┬──┘      └───┬──┘      └───┬──┘
        │             │             │
        │ num_heads   │ num_kv_heads│ num_kv_heads
        │ (e.g., 8)   │ (e.g., 2-4) │ (e.g., 2-4)
        │             │             │
    ┌───v──────┐  ┌───v──────┐      │
    │  Reshape │  │  Reshape │      │
    │  to heads│  │  to heads│      │
    └───┬──────┘  └───┬──────┘      │
        │             │             │
        └──────┬──────┘             │
               │                    │
        ┌──────v──────┐             │
        │ Apply RoPE  │             │
        │ ┌─────────┐ │             │
        │ │ cos/sin │ │             │
        │ │ rotation│ │             │
        │ │ per pos │ │             │
        │ └─────────┘ │             │
        └──────┬──────┘             │
               │                    │
        Q_rot, K_rot                V
               │                    │
        ┌──────v──────┐             │
        │ Expand K, V │             │
        │ to match Q  │             │
        │ heads via   │             │
        │ repeat      │             │
        └──────┬──────┴─────────────┘
               │
        ┌──────v──────────────┐
        │ Attention Scores    │
        │                     │
        │ S = Q × K^T / √d    │
        │                     │
        │ [batch, heads,      │
        │  seq_len, seq_len]  │
        └──────┬──────────────┘
               │
        ┌──────v──────────────┐
        │ Apply Mask          │
        │ (if provided)       │
        └──────┬──────────────┘
               │
        ┌──────v──────────────┐
        │ Softmax(Scores)     │
        │ = Attention Weights │
        └──────┬──────────────┘
               │
        ┌──────v──────────────┐
        │ Dropout (p=0.1)     │
        └──────┬──────────────┘
               │
        ┌──────v──────────────┐
        │ Context             │
        │ = Weights × V       │
        │                     │
        │ [batch, heads,      │
        │  seq_len, head_dim] │
        └──────┬──────────────┘
               │
        ┌──────v──────────────┐
        │ Reshape & Concat    │
        │ heads               │
        └──────┬──────────────┘
               │
        ┌──────v──────────────┐
        │ Output Projection   │
        │ W_O                 │
        └──────┬──────────────┘
               │
               v
        Attention Output
        [batch, seq_len, hidden_size]
```

### Training data

Training data lives as plaintext files under `python_ai/training_data/`:

-   `tanka-training.txt` — conversational and practical scenarios (now expanded to ~17 KB)
-   `villanelle-training.txt` — deeper technical/analytical content (~27 KB)
-   `ode-training.txt` — research-grade and multi-domain content (~42 KB)

Each file contains multi-turn dialogues, troubleshooting trees, sensory lexicon references, and science-backed explanations tailored to each model's persona.

### Training pipeline

Use `python_ai/train.py` to train models locally. The training pipeline uses a `Trainer` class in `python_ai/trainer.py` which handles dataset creation, batching, optimizer setup, checkpointing, and a simple validation loop.

Quick run (example):

```powershell
# from repo root
python python_ai/train.py --model tanka --data python_ai/training_data --epochs 3
```

Notes:

-   Use a GPU-enabled environment for efficient training. The code supports CUDA where available.
-   Tokenizer is in `python_ai/tokenizer.py` (SimpleTokenizer). Replace with a production tokenizer (sentencepiece/BPE) for robust deployments.

#### Training Pipeline Flow

```
Training Pipeline (train.py / trainer.py)
═══════════════════════════════════════════════════════════════════════

  ┌────────────────────────────────────────────────────────────────┐
  │                    Data Preparation Phase                      │
  └────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
        ┌───────v──────┐            ┌───────v───────┐
        │ Training     │            │ Validation   │
        │ Text Files   │            │ Text Files   │
        │ (.txt)       │            │ (.txt)       │
        │              │            │              │
        │ • tanka.txt  │            │ • val.txt    │
        │ • vill.txt   │            │              │
        │ • ode.txt    │            │              │
        └───────┬──────┘            └───────┬──────┘
                │                           │
                └─────────────┬─────────────┘
                              │
                      ┌───────v────────┐
                      │ SimpleTokenizer│
                      │ Build vocab    │
                      │ (30K-50K)      │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ TextDataset    │
                      │ • Tokenize     │
                      │ • Create seqs  │
                      │ • Build labels │
                      └───────┬────────┘
                              │
  ┌────────────────────────────────────────────────────────────────┐
  │                    Training Loop Phase                         │
  └────────────────────────────────────────────────────────────────┘
                              │
                      ┌───────v────────┐
                      │ Create Model   │
                      │ • Tanka (30M)  │
                      │ • Vill (60M)   │
                      │ • Ode (90M)    │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ AdamW Optimizer│
                      │ lr=1e-4        │
                      │ weight_decay   │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ LR Scheduler   │
                      │ (Cosine/Linear)│
                      └───────┬────────┘
                              │
                    ╔═════════v═════════╗
                    ║   Training Epoch  ║
                    ╚═════════╤═════════╝
                              │
                      ┌───────v────────┐
                      │ Batch Loop     │
                      │ for batch in   │
                      │   dataloader   │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Forward Pass   │
                      │ logits = model │
                      │   (input_ids)  │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Compute Loss   │
                      │ CrossEntropy   │
                      │ (logits, tgt)  │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Backward Pass  │
                      │ loss.backward()│
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Gradient Clip  │
                      │ (max_norm=1.0) │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Optimizer Step │
                      │ Update weights │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ LR Scheduler   │
                      │ step()         │
                      └───────┬────────┘
                              │
                              │
  ┌────────────────────────────────────────────────────────────────┐
  │                  Validation & Checkpoint Phase                 │
  └────────────────────────────────────────────────────────────────┘
                              │
                      ┌───────v────────┐
                      │ Validation Loop│
                      │ @torch.no_grad │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Compute        │
                      │ Perplexity     │
                      │ Val Loss       │
                      └───────┬────────┘
                              │
                      ┌───────v────────┐
                      │ Log Metrics    │
                      │ • Train Loss   │
                      │ • Val Loss     │
                      │ • Perplexity   │
                      │ • Learning Rate│
                      └───────┬────────┘
                              │
                    ┌─────────v─────────┐
                    │ Best Model Check? │
                    └─────┬──────────┬──┘
                          │          │
                     Yes  │          │  No
                          │          │
            ┌─────────────v──┐       │
            │ Save Best      │       │
            │ Checkpoint     │       │
            │ • model.pt     │       │
            │ • optimizer    │       │
            │ • scheduler    │       │
            │ • history      │       │
            └─────────────┬──┘       │
                          │          │
                          └────┬─────┘
                               │
                     ┌─────────v─────────┐
                     │ Early Stopping?   │
                     │ (patience=3)      │
                     └─────┬──────────┬──┘
                           │          │
                      Continue        Stop
                           │          │
                           │    ┌─────v─────┐
                           │    │ Training  │
                           │    │ Complete  │
                           │    └───────────┘
                           │
                           └──────→ Next Epoch
```

#### Model Comparison Chart

````
Kafelot AI Models Comparison
═══════════════════════════════════════════════════════════════════════

┌─────────────────┬──────────────────┬──────────────────┬──────────────────┐
│                 │   🌿 TANKA       │  🎻 VILLANELLE  │   🎼 ODE        │
│                 │   Lightweight    │    Balanced      │  Comprehensive   │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Parameters      │  ~28.5M          │   ~64.2M         │   ~97M           │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Hidden Size     │    432           │    592           │    776           │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Num Layers      │     7            │     9            │     8            │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Attention Heads │     8            │     8            │     8            │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ KV Heads (MQA)  │     2            │     2            │     4            │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ FFN Hidden Size │  1,296           │  1,776           │  2,328           │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Max Context     │  1,024 tokens    │  1,024 tokens    │  1,536 tokens    │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ MoE Enabled     │    ❌ No        │   ✅ Yes (4 exp) │   ✅ Yes (8 exp) │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Features        │ • MQA            │ • MQA            │ • MQA            │
│                 │ • RoPE           │ • RoPE           │ • RoPE           │
│                 │ • SwiGLU         │ • SwiGLU         │ • SwiGLU         │
│                 │ • Coffee Domain  │ • Coffee Domain  │ • Coffee Domain  │
│                 │   Attention      │   Attention      │   Attention      │
│                 │                  │ • MoE (light)    │ • MoE (full)     │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Best For        │ • Quick answers  │ • Technical      │ • Deep analysis  │
│                 │ • Chat support   │   explanations   │ • Research       │
│                 │ • Basic queries  │ • Troubleshoot   │ • Sensory eval   │
│                 │ • Fast response  │ • Balance        │ • Sustainability │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Inference Speed │  Fast ⚡⚡⚡   │  Medium ⚡⚡     │  Slower ⚡      │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Memory (GPU)    │  ~200 MB         │  ~350 MB         │  ~450 MB         │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Training Time   │  Shortest        │  Medium          │  Longest         │
│ (per epoch)     │  ~5-10 min       │  ~15-20 min      │  ~25-35 min      │
├─────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Recommended     │ • Web chat       │ • Product pages  │ • Expert system  │
│ Use Cases       │ • Mobile apps    │ • Knowledge base │ • Training tool  │
│                 │ • Quick lookups  │ • Support desk   │ • Research       │
└─────────────────┴──────────────────┴──────────────────┴──────────────────┘

Usage Examples:
  Tanka:      "How do I brew an espresso?"
  Villanelle: "Explain extraction temperature's effect on acidity"
  Ode:        "Compare sustainability impacts of wet vs natural processing"
```---

## IoT: recipes, API endpoints, device workflow

This project includes a minimal IoT workflow enabling the backend to send brewing commands to a Wi-Fi coffee machine.

### Recipe JSON schema

Example recipe:

```json
{
	"volume_ml": 50,
	"temperature_c": 92,
	"pre_infusion_ms": 500,
	"capsule_type": "original",
	"capsule_variant": "espresso"
}
````

-   `volume_ml`: target water volume (ml) — use `python_ai/data/capsule_volumes.json` for canonical capsule volumes
-   `temperature_c`: target brewing temperature (°C) — requires device temperature sensor and PID in production
-   `pre_infusion_ms`: milliseconds to wet puck before full pump
-   `capsule_type`/`capsule_variant`: used for compatibility checks (e.g., Original vs Vertuo)

### API Endpoints (Flask microservice in `python_ai/app.py`)

The Flask backend exposes two categories of endpoints: **AI Inference** and **IoT Command Management**.

#### AI Inference Endpoints

-   **POST `/api/generate`** — Generate text completion

    -   Body: `{ "model": "tanka|villanelle|ode", "prompt": "User prompt...", "max_length": 100, "temperature": 0.8 }`
    -   Returns: `{ "generated_text": "...", "model": "tanka" }`

-   **POST `/api/chat`** — Multi-turn conversational interface

    -   Body: `{ "model": "tanka|villanelle|ode", "messages": [{"role": "user", "content": "..."}], "temperature": 0.7 }`
    -   Returns: `{ "response": "...", "model": "villanelle" }`

-   **POST `/api/summarize`** — Summarize long text

    -   Body: `{ "model": "villanelle|ode", "text": "Long text...", "max_length": 150 }`
    -   Returns: `{ "summary": "...", "model": "ode" }`

-   **POST `/api/classify`** — Text classification (coffee types, brewing methods, etc.)

    -   Body: `{ "model": "tanka|villanelle|ode", "text": "..." }`
    -   Returns: `{ "classification": {...}, "confidence": 0.95 }`

-   **POST `/api/train`** — Trigger training job (dev only)

    -   Body: `{ "model": "tanka|villanelle|ode", "data_path": "...", "epochs": 3 }`
    -   Returns: `{ "status": "training_started", "job_id": "..." }`

-   **POST `/api/save-model`** — Save model checkpoint
    -   Body: `{ "model": "tanka|villanelle|ode", "path": "..." }`
    -   Returns: `{ "status": "saved", "path": "..." }`

#### IoT Command Management Endpoints

-   **POST `/api/commands/create`** — Store a brewing command for a machine

    -   Body:

    ```json
    {
    	"machine_id": "MACHINE_ID_123",
    	"recipe": {
    		"volume_ml": 40,
    		"temperature_c": 92,
    		"pre_infusion_ms": 300,
    		"capsule_type": "original",
    		"capsule_variant": "espresso"
    	},
    	"execute_allowed": true,
    	"meta": { "user_id": 456, "order_id": 789 }
    }
    ```

    -   Returns: `{ "status": "created", "command_id": 123 }`

-   **GET `/api/commands/check/<machine_id>`** — Device polls for pending commands

    -   Returns:
        -   `204 No Content` if no pending commands
        -   `200 OK` with command JSON if pending:
        ```json
        {
          "command_id": 123,
          "recipe": {...},
          "execute_allowed": true,
          "meta": {...},
          "created_at": "2025-10-22T10:30:00Z"
        }
        ```

-   **POST `/api/commands/update/<command_id>`** — Device updates command status
    -   Body:
    ```json
    {
      "status": "brewing" | "complete" | "failed",
      "meta": {
        "started_at": "2025-10-22T10:30:05Z",
        "completed_at": "2025-10-22T10:31:20Z",
        "actual_volume_ml": 41,
        "error": "pump_timeout"
      }
    }
    ```
    -   Returns: `{ "status": "updated", "command_id": 123 }`

#### Database Configuration

The server uses a simple SQLite-based `python_ai/iot_db.py` to record commands for local testing. For production, migrate this to MariaDB/Postgres and add device authentication and rate-limiting.

-   **Environment Variable**: `IOT_USE_SQLALCHEMY=1` enables the optional SQLAlchemy wrapper (`iot_db_sqlalchemy.py`)
-   **SQLAlchemy Mode**: Uses connection pooling and supports MariaDB/MySQL via `IOT_DATABASE_URL` or individual `IOT_DB_*` variables
-   **SQLite Mode**: Zero-config embedded database for development

### Device workflow (ESP32 polling)

```
IoT Command Lifecycle
═════════════════════════════════════════════════════════════════════

  User/Frontend          Flask Backend       Commands DB       ESP32 Device       Coffee Machine
       │                      │                   │                  │                   │
       │                      │                   │                  │                   │
  ┌────┴────┐                 │                   │                  │                   │
  │ User    │                 │                   │                  │                   │
  │ creates │                 │                   │                  │                   │
  │ recipe  │                 │                   │                  │                   │
  └────┬────┘                 │                   │                  │                   │
       │                      │                   │                  │                   │
       │ POST /api/commands/  │                   │                  │                   │
       │ create               │                   │                  │                   │
       ├─────────────────────→│                   │                  │                   │
       │  {machine_id,recipe} │                   │                  │                   │
       │                      │                   │                  │                   │
       │                      │ INSERT command    │                  │                   │
       │                      │ status='pending'  │                  │                   │
       │                      ├──────────────────→│                  │                   │
       │                      │                   │                  │                   │
       │                      │ command_id: 123   │                  │                   │
       │                      │←──────────────────┤                  │                   │
       │                      │                   │                  │                   │
       │ {status: created,    │                   │                  │                   │
       │  command_id: 123}    │                   │                  │                   │
       │←─────────────────────┤                   │                  │                   │
       │                      │                   │                  │                   │
       │                      │                   │                  │                   │
       │                      │                   │ ┌────────────────┴──────────────┐    │
       │                      │                   │ │ Polling Loop (every 5-10s)    │    │
       │                      │                   │ └────────────────┬──────────────┘    │
       │                      │                   │                  │                   │
       │                      │  GET /api/commands│                  │                   │
       │                      │  /check/MACHINE123│                  │                   │
       │                      │←──────────────────┼──────────────────┤                   │
       │                      │                   │                  │                   │
       │                      │ Query pending     │                  │                   │
       │                      ├──────────────────→│                  │                   │
       │                      │                   │                  │                   │
       │                      │ Command data      │                  │                   │
       │                      │←──────────────────┤                  │                   │
       │                      │                   │                  │                   │
       │                      │ 200 OK            │                  │                   │
       │                      │ {cmd_id, recipe}  │                  │                   │
       │                      ├─────────────────────────────────────→│                   │
       │                      │                   │                  │                   │
       │                      │                   │                  │ ┌─────────────┐   │
       │                      │                   │                  │ │ Pre-flight  │   │
       │                      │                   │                  │ │ checks OK   │   │
       │                      │                   │                  │ └─────────────┘   │
       │                      │                   │                  │                   │
       │                      │ POST /update/123  │                  │                   │
       │                      │ {status:brewing}  │                  │                   │
       │                      │←──────────────────┼──────────────────┤                   │
       │                      │                   │                  │                   │
       │                      │ UPDATE status     │                  │                   │
       │                      ├──────────────────→│                  │                   │
       │                      │                   │                  │                   │
       │                      │                   │                  │ Execute sequence  │
       │                      │                   │                  │ 1. Pick capsule   │
       │                      │                   │                  ├──────────────────→│
       │                      │                   │                  │ 2. Insert capsule │
       │                      │                   │                  ├──────────────────→│
       │                      │                   │                  │ 3. Close head     │
       │                      │                   │                  ├──────────────────→│
       │                      │                   │                  │ 4. Press button   │
       │                      │                   │                  ├──────────────────→│
       │                      │                   │                  │                   │
       │                      │                   │                  │   Brew cycle      │
       │                      │                   │                  │   complete        │
       │                      │                   │                  │←──────────────────┤
       │                      │                   │                  │                   │
       │                      │ POST /update/123  │                  │                   │
       │                      │ {status:complete} │                  │                   │
       │                      │←──────────────────┼──────────────────┤                   │
       │                      │                   │                  │                   │
       │                      │ UPDATE status     │                  │                   │
       │                      ├──────────────────→│                  │                   │
       │                      │                   │                  │                   │
       │                      │                   │ ┌────────────────┴──────────────┐    │
       │                      │                   │ │ Continue polling...           │    │
       │                      │                   │ │ (204 No Content if empty)     │    │
       │                      │                   │ └───────────────────────────────┘    │
```

#### Sequence Steps1. Device polls `GET /api/commands/check/<MACHINE_ID>` and receives a pending command.

2. Accessory verifies `execute_allowed` and validates recipe fields.
3. Accessory performs pre-flight checks (sensors, capsule magazine non-empty, latched state clear).
4. Accessory runs an actuator sequence:
    - pick a capsule from the magazine (servo/stepper sequence)
    - insert capsule into the machine's insertion point
    - close/latch the head or press the machine's mechanical lever if required
    - press the start button (short press using servo/linear actuator)
5. Accessory posts `status=brewing` to `/api/commands/update/<command_id>` with start metadata (time, sensor snapshots).
6. Accessory monitors machine (optional) via optical sensor or current draw to detect when brew ends. When complete, post `status=complete` and any brew metrics (duration, detected flow).

This sequence avoids altering the machine's heater or pump and uses the machine's built-in brew cycle.

### Command / recipe schema additions for accessories

To support accessory action sequences the backend command payload may include an `actuator_sequence` or `accessory_instructions` block alongside the recipe. Example:

```json
{
	"command_id": 123,
	"recipe": {
		"volume_ml": 40,
		"temperature_c": 92,
		"pre_infusion_ms": 300,
		"capsule_type": "original",
		"capsule_variant": "espresso"
	},
	"accessory_instructions": {
		"capsule_slot": 2,
		"motor_steps_per_ml": 10,
		"insert_sequence": [
			{ "action": "pick", "params": { "slot": 2 } },
			{ "action": "insert", "params": {} },
			{ "action": "latch", "params": {} },
			{ "action": "press_button", "params": { "duration_ms": 200 } }
		]
	}
}
```

Notes:

-   `motor_steps_per_ml` is accessory-specific calibration (if accessory meters water externally). If using the machine's built-in pump, the accessory need only command mechanical operations and monitor the machine.
-   `insert_sequence` is intentionally simple; devices can interpret this into low-level servo/stepper commands.

### ESP32 sketch responsibilities (practical)

-   Network: connect to Wi‑Fi and poll backend for commands (or use MQTT if configured)
-   Auth: attach device token or mutual TLS client cert for authenticated API calls
-   Safety checks: ensure accessory is in a safe home position before any motion
-   Execute actuator sequence with sensor feedback and timeouts
-   Post lifecycle updates to the backend (`brewing`, `complete`, `failed`) with `meta` containing sensor traces and photos if present

### Calibration and tuning

-   Calibrate actuator travel distances using limit switches. Record positions for pick, insert, latch, and idle.
-   Use current or optical sensors to detect successful capsule seating and brew flow.
-   Add retry logic: if insertion fails (sensor mismatch), retry N times then report failure and set `execute_allowed=false` in the admin UI.

### Example accessory error handling

-   If a pick fails: retry up to 2 times, then mark `failed` with `meta: {"error": "pick_failed"}`
-   If a button press fails: attempt a simulated double-press and report results
-   If sensors disagree (e.g., magazine empty but server thought there were capsules): post `failed` and raise an operator alert

### Security / OTA

-   Use HTTPS and a per-device API key or mTLS. Store keys securely in device flash (encrypted) or use a provisioning flow.
-   Provide OTA updates to the accessory firmware (PlatformIO or custom OTA over HTTPS). Sign firmware images to prevent tampering.

### Why this approach

This accessory-first approach keeps the cheapest path to automation safe and practical for consumer appliances. It reduces legal and safety risk, simplifies development, and enables broad compatibility across many Original-line machines that share similar mechanical interfaces.

---

## Frontend architecture and routing

### Next.js App Router Structure

The frontend uses Next.js 15's App Router with a custom middleware-based routing system. All pages are rendered through a single root route (`/`) with query parameter-based routing.

#### Routing Mechanism (`middleware.ts`)

-   **Pattern**: Rewrite requests like `/coffee` → `/?page=coffee`
-   **Supported pages**: home, account, coffee, machines, payment, subscription, shopping-bag, coffee-machine-animation, love-coffee
-   **Benefits**:
    -   Single root layout component
    -   Consistent page transitions
    -   Simplified state management
    -   Preserved legacy CSS compatibility

#### Page Components

Each page is implemented as a dedicated component in `src/components/<page-name>/`:

```
src/components/
├── home/HomePageContent.tsx              # Landing page with hero and features
├── coffee/CoffeePageContent.tsx          # Coffee catalog with filtering
├── machines/MachinesPageContent.tsx      # Machine catalog with comparisons
├── payment/PaymentPageContent.tsx        # Payment flow
├── subscription/...                      # Subscription management
├── shopping-bag/...                      # Cart and checkout
└── account/AccountPageContent.tsx        # User account management
```

#### Shared Components

-   **`LayoutChrome.tsx`**: Page wrapper with navigation, footer, and notifications
-   **`Navbar.tsx`**: Responsive navigation bar with cart indicator
-   **`Cart.tsx`**: Global cart sidebar with add/remove/checkout actions
-   **`NotificationsProvider.tsx`**: Toast notification system for user feedback

#### State Management

-   **Cart State**: `useCart` hook (React Context + localStorage persistence)
-   **Form State**: React controlled components with validation
-   **Notifications**: Context provider with queue and auto-dismiss

#### Styling Strategy

-   **Global CSS**: `src/styles/globals.css` preserves legacy CSS 1:1 for visual parity
-   **Feature CSS**: Scoped stylesheets per page feature (e.g., `coffee-machine.css`)
-   **Tailwind CSS**: Utility classes for new components and responsive layouts
-   **Approach**: Hybrid CSS (legacy preserved + Tailwind for new features)

#### Data Loading

-   **Product Catalogs**:
    -   Static JSON files (`src/data/coffee.generated.json`, `machines.generated.json`)
    -   Generated by scripts (`scripts/extractCoffeeData.mjs`)
    -   Type-safe via TypeScript interfaces
-   **Dynamic Content**:
    -   API routes under `src/app/api/` for server-side operations
    -   Next.js Server Actions for form submissions
    -   Fetch API for Python AI backend calls

#### TypeScript Configuration

-   **Strict Mode**: Enabled for type safety
-   **Path Aliases**: `@/*` maps to `src/*`
-   **Target**: ES2017 with DOM types
-   **Custom Types**: `src/types/custom.d.ts` for global declarations

#### Frontend Data Flow

```
Frontend Data Flow (Next.js + React)
═══════════════════════════════════════════════════════════════════════

                      User Action
                     (Click, Input)
                           │
                           v
                  ┌────────────────┐
                  │ Page Component │
                  │   (React)      │
                  └────────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          v                v                v
    ┌──────────┐    ┌──────────┐    ┌──────────────┐
    │ useCart  │    │ useState │    │ Notifications│
    │  Hook    │    │ (Local)  │    │   Context    │
    └────┬─────┘    └──────────┘    └──────────────┘
         │
         v
    ┌──────────────┐
    │ localStorage │
    │ Persistence  │
    │ (cart items) │
    └──────────────┘


    Server Communication:
    ════════════════════════════════════════════════

                  Page Component
                        │
                        v
              ┌─────────────────┐
              │ Fetch/API Call  │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │                 │
              v                 v
      ┌───────────────┐  ┌──────────────┐
      │ Next.js API   │  │ Flask API    │
      │ Route         │  │ (Direct)     │
      │ /api/...      │  │ localhost:   │
      │               │  │ 5000         │
      └───────┬───────┘  └──────┬───────┘
              │                 │
              v                 v
      ┌───────────────┐  ┌──────────────┐
      │ Server Action │  │ AI Models    │
      │ (DB/Auth)     │  │ IoT Commands │
      └───────┬───────┘  └──────┬───────┘
              │                 │
              └────────┬────────┘
                       │
                       v
              ┌────────────────┐
              │ JSON Response  │
              └────────┬───────┘
                       │
                       v
              ┌────────────────┐
              │ Update State   │
              │ Re-render UI   │
              └────────────────┘


    State Management Pattern:
    ════════════════════════════════════════════════

      Cart State (Global):
        • React Context API
        • Persisted to localStorage
        • Synced across tabs (storage events)

      Form State (Local):
        • useState hooks
        • Controlled components
        • Client-side validation

      Notifications (Global):
        • Context provider
        • Queue with auto-dismiss
        • Toast UI component


    Example Flow: Add to Cart
    ════════════════════════════════════════════════

      User clicks "Add to Cart"
              │
              v
      Component calls addToCart(item)
              │
              v
      useCart hook updates context state
              │
              v
      ┌───────┴────────┐
      │                │
      v                v
    Update           Save to
    UI state         localStorage
      │                │
      └───────┬────────┘
              v
      Show toast notification
              │
              v
      Update cart badge counter
```

## Development: running locally and testing

This section consolidates practical development steps for the frontend, Python AI & IoT backend, and ESP32 accessory.

1. Frontend (Next.js)

```powershell
npm install
npm run dev
```

2. Python AI & IoT server (venv recommended)

```powershell
# from repo root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r python_ai/requirements.txt
python python_ai/app.py
```

Notes:

-   `python_ai/requirements.txt` should include core dependencies: Flask, PyTorch, SQLAlchemy (optional), pymysql (optional), and testing tools. Adjust for your environment (GPU vs CPU).
-   The Flask microservice listens on port 5000 by default. Use `IOT_USE_SQLALCHEMY=1` to enable the SQLAlchemy DB wrapper in `python_ai/iot_db_sqlalchemy.py`.

3. ESP32 accessory (development)

-   Open `scripts/esp32/esp32_coffeemachine.ino` in Arduino IDE or PlatformIO.
-   Configure Wi‑Fi credentials, server URL, and device token (or set up mTLS if available).
-   Compile and flash to the ESP32.

4. Test a full flow (example)

Create a command using curl (PowerShell example):

```powershell
curl -X POST http://localhost:5000/api/commands/create -H "Content-Type: application/json" -d '{"machine_id":"MACHINE_ID_123","recipe":{"volume_ml":40,"temperature_c":92,"pre_infusion_ms":300,"capsule_type":"original","capsule_variant":"espresso"}}'
```

-   The ESP32 accessory will poll `GET /api/commands/check/<MACHINE_ID>` and execute the command according to the accessory instructions.
-   Monitor the accessory serial console for action logs and POSTs to `/api/commands/update/<command_id>`.

### Express API: disabling rate limiting during local development

The Express API (in `express-api/server.js`) has a global `express-rate-limit` middleware that is applied to `/api/*` endpoints by default. In local development you may hit that limit during heavy testing (hot reloads, repeated login attempts, automated scripts) and see `429 - Too Many Requests`.

Quick / development-friendly options:

-   Node environment check: when `NODE_ENV` is set to `development` the server will skip applying the global rate limiter so you won't hit 429s while testing locally.
-   Explicit disable flag: you can also set `DISABLE_RATE_LIMIT_FOR_DEV=true` to force the server to skip rate limiting regardless of `NODE_ENV`.

Example (set in PowerShell):

```powershell
# skip rate limiting (local dev)
$env:DISABLE_RATE_LIMIT_FOR_DEV = 'true'
npm run start:express
```

Important: this setting is intended for local development and debugging only — do not use it in production.

Recommended production configuration:

-   Use route-specific rules — keep a global limiter but also apply stricter limits to sensitive endpoints such as `/api/auth/login` and `/api/auth/register` (e.g., 5-10 attempts per 15 minutes). This balances protection against brute-force attacks and usability for other API routes.
-   Consider using a persistent store for rate-limiting (Redis) if you run multiple API instances behind a load balancer.

See `express-api/server.js` for the exact environment variable and example implementation.

---

## Security Status

**Current Implementation (Educational/Demo Mode):**

-   **Passwords**: Stored in plain text in `src/data/accounts.json`.
-   **Credit Cards**: Stored in plain text in `src/data/user_cards.json`.
-   **Orders**: Stored in `src/data/orders.json`.
-   **Encryption**: None. `bcrypt` has been removed.
-   **Authentication**: Simple plain-text matching.

**Production Recommendations (If deploying for real use):**

-   Re-enable hashing (e.g., bcrypt) for passwords.
-   Use a secure database (Postgres/MariaDB) instead of JSON files.
-   Tokenize credit card information (PCI-DSS compliance) - never store raw card numbers.
-   Implement proper JWT or Session-based auth.

---

## Troubleshooting & debugging

-   If devices report repeated `failed`, inspect `meta` in DB and drop `execute_allowed` until a human operator verifies.
-   If commands queue, verify device polling interval and network stability.
-   For model inference issues, review `python_ai/inference.py` and the tokenizer.

---

## Appendices

### Capsule volumes

See `python_ai/data/capsule_volumes.json` — includes Original and Vertuo canonical volumes in ml. The backend uses these as guidance. Original-only machines will ignore Vertuo recipes.

### Files of interest

-   `python_ai/models.py` — model architecture and factories
-   `python_ai/trainer.py` — training loop and utilities
-   `python_ai/app.py` — AI & IoT endpoints
-   `python_ai/iot_db.py` — command DB helper (SQLite)
-   `python_ai/training_data/` — training corpora (tanka, villanelle, ode)
-   `scripts/esp32/` — device code and device README

### Additional README sources merged

This `README_FULL.md` now incorporates and consolidates information from:

-   `README.md` (project overview, Next.js quick start)
-   `scripts/esp32/README.md` (ESP32 device integration notes and quick flow)
-   `python_ai/README_IoT.md` (IoT quick reference: endpoints, recipe schema, calibration and production notes)

If you find content missing or want a separate, shorter quick-start README for each subproject (frontend, python_ai, ESP32), tell me and I will split the merged sections into focused README files while keeping `README_FULL.md` as the canonical long-form documentation.

---

## Diagrams Index

This README includes comprehensive visual documentation using **ASCII box-drawing art** for maximum compatibility:

### Architecture Diagrams

1. **High-Level System Architecture** — 4-layer system showing frontend (Next.js/React), backend (Flask/PyTorch), data tier (SQLite/MySQL), and IoT layer (ESP32)
2. **Production Deployment Architecture** — 4-tier production infrastructure: CDN/WAF → Load Balancer → App Tier (3 nodes) → Data Tier with replication

### Process Flow Diagrams

3. **IoT Device Workflow Sequence** — Detailed sequence: User → API → Database → ESP32 → Coffee Machine (full lifecycle with state updates)
4. **ESP32 Accessory State Machine** — 7-state machine (Idle → Picking → Inserting → Brewing → Ejecting → Error → Reset) with 15+ transitions
5. **End-to-End User Journey** — 5-phase journey: Discovery → AI Interaction → Purchase → IoT Brewing → Enjoyment (6-12 minute timeline)

### AI/ML Diagrams

6. **Model Architecture Diagram** — Enhanced Transformer with Input Embedding → 6/12/16 Layers (RoPE + MQA + SwiGLU + Coffee Attention + MoE) → Output Head
7. **Multi-Query Attention with RoPE** — Q/K/V processing flow: Linear projections → RoPE → Grouped heads → Softmax → Output
8. **Training Pipeline Flow** — 3-phase pipeline: Data Preparation → Training Loop (forward/backward/optimize) → Validation/Checkpointing
9. **Model Comparison Chart** — ASCII table comparing Tanka (28.5M), Villanelle (64.2M), Ode (81.8M) specifications

### Frontend Diagrams

10. **Frontend Data Flow** — React patterns: User Actions → State Management (Zustand cart store) → API Communication → Backend
11. **Next.js Routing Architecture** — (Described in text; middleware-based routing with App Router)

### Hardware Diagrams

12. **ESP32 Hardware Architecture** — Complete wiring: 5V/3.3V Power Tree → ESP32 → External Controllers → Actuators/Sensors → Coffee Machine

### Database Diagrams

13. **Database Schema (ER Diagram)** — Commands table (10 fields), indexes, and relationships with users/devices/order_items tables

---

**Format Notes:**  
All diagrams use ASCII box-drawing characters (`┌─┐│└┘├┤┬┴┼`) and render perfectly in:

-   Any text editor or terminal
-   GitHub/GitLab markdown viewers
-   VS Code preview
-   Documentation tools (Sphinx, MkDocs, etc.)

This format matches the style of `python_ai/ARCHITECTURE_DIAGRAMS.md` and ensures compatibility across all platforms without requiring special rendering engines.

---

If you'd like, I can also:

-   Add device authentication headers and update the ESP32 sketch to include an API key
-   Replace polling with MQTT sample and sample broker config
-   Implement MariaDB-backed `iot_db` and a simple admin UI for command management

Tell me which of these you'd like next and I'll implement it.

---

## Database Schema

### Commands Table Structure

```
Database Schema (MariaDB / MySQL / SQLite)
═══════════════════════════════════════════════════════════════════════

┌────────────────────────────────────────────────────────────────────┐
│                       COMMANDS TABLE                               │
├──────────────────┬──────────────┬─────────────┬────────────────────┤
│ Field            │ Type         │ Constraints │ Description        │
├──────────────────┼──────────────┼─────────────┼────────────────────┤
│ command_id       │ INT          │ PK, AUTO    │ Unique ID          │
│ machine_id       │ VARCHAR(255) │ NOT NULL    │ Device identifier  │
│ recipe           │ JSON         │ NOT NULL    │ Brew recipe data   │
│ execute_allowed  │ BOOLEAN      │ DEFAULT 1   │ Safety flag        │
│ status           │ VARCHAR(50)  │ NOT NULL    │ Command state      │
│ meta             │ JSON         │ NULL        │ Additional data    │
│ created_at       │ DATETIME     │ NOT NULL    │ Creation timestamp │
│ updated_at       │ DATETIME     │ ON UPDATE   │ Last update time   │
└──────────────────┴──────────────┴─────────────┴────────────────────┘

Status Values:
  • 'pending'   - Command created, waiting for device
  • 'brewing'   - Device executing brew cycle
  • 'complete'  - Brew finished successfully
  • 'failed'    - Error occurred during execution

Recipe JSON Structure:
  {
    "volume_ml": 40,
    "temperature_c": 92,
    "pre_infusion_ms": 300,
    "capsule_type": "original",
    "capsule_variant": "espresso"
  }

Meta JSON Structure:
  {
    "user_id": 456,
    "order_id": 789,
    "started_at": "2025-10-22T10:30:05Z",
    "completed_at": "2025-10-22T10:31:20Z",
    "actual_volume_ml": 41,
    "error": "pump_timeout"
  }


┌────────────────────────────────────────────────────────────────────┐
│                   COMMAND_HISTORY TABLE (Optional)                 │
├──────────────────┬──────────────┬─────────────┬────────────────────┤
│ Field            │ Type         │ Constraints │ Description        │
├──────────────────┼──────────────┼─────────────┼────────────────────┤
│ history_id       │ INT          │ PK, AUTO    │ History record ID  │
│ command_id       │ INT          │ FK, INDEX   │ Ref to COMMANDS    │
│ old_status       │ VARCHAR(50)  │ NULL        │ Previous status    │
│ new_status       │ VARCHAR(50)  │ NOT NULL    │ New status         │
│ meta_snapshot    │ JSON         │ NULL        │ Meta at change     │
│ changed_at       │ DATETIME     │ NOT NULL    │ Change timestamp   │
└──────────────────┴──────────────┴─────────────┴────────────────────┘


Relationships:
═══════════════════════════════════════════════════════════════════════

  COMMANDS (1) ────────────────────→ (Many) COMMAND_HISTORY
       │                                      │
       │ command_id                           │ command_id (FK)
       │                                      │
       └──────────────────────────────────────┘
               Tracks status changes


Index Recommendations:
═══════════════════════════════════════════════════════════════════════

  PRIMARY:
    • commands.command_id (auto)
    • command_history.history_id (auto)

  COMPOSITE INDEX (for polling):
    • CREATE INDEX idx_machine_status
      ON commands(machine_id, status, created_at);

  STATUS INDEX (for analytics):
    • CREATE INDEX idx_status_created
      ON commands(status, created_at);

  HISTORY FK INDEX:
    • CREATE INDEX idx_history_command
      ON command_history(command_id);
```

#### Commands Table Fields| Field | Type | Description |

| ----------------- | ------------ | ----------------------------------- |
| `command_id` | INT | Primary key, auto-increment |
| `machine_id` | VARCHAR(255) | Unique machine identifier |
| `recipe` | JSON | Recipe payload (volume, temp, etc.) |
| `execute_allowed` | BOOLEAN | Safety flag for execution |
| `status` | VARCHAR(50) | pending, brewing, complete, failed |
| `meta` | JSON | Additional metadata, logs, errors |
| `created_at` | DATETIME | Command creation timestamp |
| `updated_at` | DATETIME | Last status update timestamp |

#### Recommended Indexes

```sql
-- For fast polling queries
CREATE INDEX idx_machine_status ON commands(machine_id, status, created_at);

-- For command history tracking
CREATE INDEX idx_status_created ON commands(status, created_at);
```

---

## Production Deployment Architecture

````
Production Deployment Architecture
═══════════════════════════════════════════════════════════════════════

                            Internet
                                │
                ┌───────────────┴───────────────┐
                │                               │
         End Users                        ESP32 Devices
         (Browsers/Mobile)                (Coffee Machines)
                │                               │
                └───────────────┬───────────────┘
                                │
                    ┌───────────v───────────┐
                    │   CDN / Edge Layer    │
                    ├───────────────────────┤
                    │ • Vercel Edge Network │
                    │ • Static Assets Cache │
                    │ • DDoS Protection     │
                    └───────────┬───────────┘
                                │
                    ┌───────────v───────────┐
                    │   WAF (Firewall)      │
                    ├───────────────────────┤
                    │ • Rate Limiting       │
                    │ • SQL Injection Block │
                    │ • XSS Protection      │
                    └───────────┬───────────┘
                                │
                    ┌───────────v───────────┐
                    │  Load Balancer (LB)   │
                    ├───────────────────────┤
                    │• HTTPS/TLS Termination│
                    │• Health Checks        │
                    │• Session Affinity     │
                    └───────────┬───────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
     ┌───────────v──────────┐         ┌─────────v──────────┐
     │  Next.js App Tier   │         │  Flask AI Tier     │
     ├─────────────────────┤         ├────────────────────┤
     │ ┌─────────────────┐ │         │ ┌────────────────┐ │
     │ │ Next.js Inst. 1 │ │         │ │ Flask Inst. 1  │ │
     │ │ (Container)     │ │────────→│ │ (Container)    │ │
     │ └─────────────────┘ │         │ └────────┬───────┘ │
     │                     │         │          │         │
     │ ┌─────────────────┐ │         │ ┌────────v───────┐ │
     │ │ Next.js Inst. 2 │ │         │ │ Flask Inst. 2  │ │
     │ │ (Container)     │ │────────→│ │ (Container)    │ │
     │ └─────────────────┘ │         │ └────────┬───────┘ │
     │                     │         │          │         │
     │ • SSR/SSG           │         │ • AI Models        │
     │ • API Routes        │         │ • IoT API          │
     │ • State Management  │         │ • Inference        │
     └─────────────────────┘         └──────────┬─────────┘
                                                 │
                                  ┌──────────────┴──────────────┐
                                  │                             │
                    ┌─────────────v──────────┐    ┌────────────v───────────┐
                    │    Data Tier           │    │  Cache Layer           │
                    ├────────────────────────┤    ├────────────────────────┤
                    │ ┌────────────────────┐ │    │ ┌────────────────────┐ │
                    │ │ MariaDB Primary    │ │    │ │ Redis Cluster      │ │
                    │ │ (Read/Write)       │ │    │ │ • Sessions         │ │
                    │ └────────┬───────────┘ │    │ │ • Rate Limits      │ │
                    │          │             │    │ │ • Command Queue    │ │
                    │          │ Replication │    │ └────────────────────┘ │
                    │          v             │    └────────────────────────┘
                    │ ┌────────────────────┐ │
                    │ │ MariaDB Replica(s) │ │
                    │ │ (Read-only)        │ │
                    │ └────────────────────┘ │
                    │                        │
                    │ • Commands DB          │
                    │ • User Data            │
                    │ • Orders               │
                    └────────────────────────┘
                                  │
                    ┌─────────────v──────────┐
                    │ Object Storage (S3)    │
                    ├────────────────────────┤
                    │ • Model Checkpoints    │
                    │   (.pt files)          │
                    │ • Training Data        │
                    │ • Static Assets        │
                    │ • Logs (archived)      │
                    └────────────────────────┘


    ┌─────────────────────────────────────────────────────────────────┐
    │                    Monitoring & Observability                   │
    ├─────────────────────────────────────────────────────────────────┤
    │                                                                 │
    │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐   │
    │  │  Prometheus     │  │    Grafana      │  │ Log Aggregation│   │
    │  │  (Metrics)      │→ │   (Dashboards)  │  │ (ELK/Loki)     │   │
    │  │                 │  │                 │  │                │   │
    │  │ • Request rate  │  │ • System health │  │ • App logs     │   │
    │  │ • Error rate    │  │ • Model metrics │  │ • Access logs  │   │
    │  │ • Latency       │  │ • DB perf       │  │ • Error traces │   │
    │  │ • DB connection │  │ • Alerts        │  │ • Device logs  │   │
    │  └─────────────────┘  └─────────────────┘  └────────────────┘   │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘


Deployment Summary:
═══════════════════════════════════════════════════════════════════════

  Edge Layer:      Vercel CDN + WAF (DDoS, rate limit)
  Load Balancer:   HTTPS/TLS termination, health checks
  App Tier:        2+ Next.js instances, 2+ Flask instances
  Data Tier:       MariaDB primary + replica(s), Redis cache
  Storage:         S3 for model checkpoints and training data
  Monitoring:      Prometheus, Grafana, Log aggregation
  Security:        mTLS for devices, JWT for users, encryption at rest
```---

## Local MariaDB for development (optional but recommended)

If you want to test the IoT flow against a real MariaDB instance (recommended before production), you can run a small MariaDB container locally and point the service at it. The repo includes a sample `docker-compose` and a SQL migration to create the `commands` table.

Files provided:

-   `python_ai/docker-compose.maria.yml` — Docker Compose service to run MariaDB for local development
-   `python_ai/migrations/create_commands_table.sql` — Simple migration to create the `commands` table used by the IoT API
-   `python_ai/.env.example` — Example environment variables for local testing

Quick start (PowerShell):

```powershell
# from repo root
cd python_ai
# copy the example env
copy .env.example .env
docker compose -f docker-compose.maria.yml up -d

# wait a few seconds, then run the migration (use root password from .env)
docker compose -f docker-compose.maria.yml exec mariadb sh -c "mysql -uroot -p\"$env:MYSQL_ROOT_PASSWORD\" < /migrations/create_commands_table.sql"
```

Environment variables to set (use `.env` or export in your shell):

-   `IOT_DB_HOST` — hostname where MariaDB is reachable (e.g., localhost)
-   `IOT_DB_PORT` — port (default 3306)
-   `IOT_DB_USER` — database user (e.g., kafelot)
-   `IOT_DB_PASS` — user password
-   `IOT_DB_NAME` — database name (e.g., kafelot_iot)

After starting MariaDB, point the Python service to it by setting the env vars above or by setting `IOT_DATABASE_URL` to a full SQLAlchemy URL (example below):

```
IOT_DATABASE_URL=mysql+pymysql://kafelot:changeme@127.0.0.1:3306/kafelot_iot?charset=utf8mb4
```

## Switching the Flask app to use SQLAlchemy wrapper

The repo includes two ways to access the commands DB:

-   `python_ai/iot_db.py` — lightweight helper (raw pymysql/sqlite3 calls). Works immediately and matches the earlier Flask endpoints.
-   `python_ai/iot_db_sqlalchemy.py` — optional SQLAlchemy wrapper providing connection pooling and consistent dialect handling.

To use the SQLAlchemy wrapper in `python_ai/app.py`, change the import and initialization lines where the DB is initialized. Example (pseudo):

```python
# old
import python_ai.iot_db as iot_db
iot_db.init_db()

# new
from python_ai import iot_db_sqlalchemy as iot_db
iot_db.init_db()
```

The SQLAlchemy wrapper will read `IOT_DATABASE_URL` or fall back to the `IOT_DB_*` env vars and then to a local SQLite file.

## Automated test for local SQLite (already included)

There is a lightweight test script `python_ai/test_iot_db_sqlalchemy.py` which exercises the SQLAlchemy wrapper using the SQLite fallback. Run it like this from the repo root:

```powershell
#$env:PYTHONPATH must include the repo root so `python_ai` is importable
$env:PYTHONPATH = "$pwd"
python python_ai/test_iot_db_sqlalchemy.py
```

## Production notes and hardening

-   Use strong passwords and do not commit `.env` files to source control. Keep production credentials in a secrets manager.
-   Configure MariaDB with secure settings: remote access limited by firewall, use TLS for server connections if hosts are not co-located, and enable slow query logging for troubleshooting.
-   If you expect heavy device polling, use a connection pool and tune the pool size in SQLAlchemy (via `create_engine(pool_size=..., max_overflow=...)`).
-   Add an index on `(machine_id, status, created_at)` to make polling fast at scale.

## Device authentication patterns

Use one of these patterns depending on your operational requirements:

-   Per-device API keys: issue each device a long random token and verify it on each request. Store token hashes server-side.
-   Mutual TLS (mTLS): devices hold client certificates and present them to the server. Strong, no-token required authentication for fleet-managed devices.
-   JWTs with short lifetimes: useful if devices can request tokens via a provisioning service.

The ESP32 sketch can be updated to include an `Authorization: Bearer <token>` header or an `X-Device-Token: <key>` header; the Flask endpoints should validate this before returning commands.

## Operational runbook (backup & restore)

-   Backup MariaDB regularly with `mysqldump` or logical backups; for larger fleets, consider binary backups and PITR solutions.
-   Monitor the `commands` table growth; purge or archive old `complete`/`failed` rows older than the retention window.
-   Add observability: Prometheus metrics for polling rate, command throughput, and error rates. Export DB connection pool stats.

---

## Merged notes from other READMEs and expanded guidance

This section gathers important, actionable details from the repository's other README files (`README.md`, `scripts/esp32/README.md`) and merges them into a single authoritative reference. It adds more operational and developer guidance to make onboarding and testing straightforward.

### Frontend quick start

The Next.js front-end is a standard `create-next-app` migration. To run it locally:

```powershell
npm install
npm run dev
```

Open http://localhost:3000 to view the app. Development builds are hot-reloaded.

If you plan to deploy to Vercel, follow the standard Next.js deployment flow; the site is compatible with Vercel and other static hosting providers.

### ESP32 & Device integration (expanded)

The `scripts/esp32` folder contains a fully commented Arduino-style sketch showing device polling, JSON parsing, and how to POST status updates. Key production considerations repeated here:

-   Use HTTPS for all device-server communication. The sample sketch is simplified and may use HTTP for local testing.
-   Use token-based authentication or mTLS. Store tokens securely (preferably the device's secure storage or ephemeral tokens provisioned at device startup).
-   Hardware safety: do not modify the machine's mains circuitry unless you're an electrical safety professional. Prefer non-invasive actuators (servos, solenoids) to press the machine's button externally.
-   Calibration: calibrate ms_per_ml for each pump and measure thermal response to avoid overheating. Implement PID control for heater rather than naive on/off with fixed sleeps.
-   Firmware lifecycle: provide OTA updates using PlatformIO or a dedicated update service so devices can receive security patches.

### Developer notes and repository layout

Top-level quick pointers:

-   `src/` — Next.js app (App Router) and React components
-   `python_ai/` — AI and IoT backend (Flask, models, tokenizer, training scripts)
-   `scripts/esp32/` — Device code and device README

Keep the Python components isolated in a virtual environment and install `python_ai/requirements.txt` before running the Flask server.

### How the IoT flow ties to the frontend

1. A user selects an AI-generated recipe in the Next.js UI and asks to send it to a machine.
2. The frontend calls the Flask endpoint `POST /api/commands/create` to store the command for the machine.
3. The device polls `GET /api/commands/check/<MACHINE_ID>` and obtains a pending command.
4. The device updates its status with `POST /api/commands/update/<command_id>` periodically.

This flow is intentionally simple to keep devices dumb and the server authoritative. For larger fleets, migrate to MQTT or long-polling with a persistent connection.

### Security checklist (merged)

-   Enable HTTPS across all services (letsencrypt for small deployments, managed certs for cloud).
-   Use per-device credentials: API key or mTLS certificates.
-   Do not embed long-lived credentials in device firmware. Use short-lived tokens or provisioning.
-   Implement server-side rate-limits and device heartbeat monitoring.
-   Add audit logs for command creation and device acknowledgements.

---

## Changes summary (recent additions)

-   Added optional SQLAlchemy-based IoT DB wrapper: `python_ai/iot_db_sqlalchemy.py` (recommended for production)
-   Added MariaDB Docker Compose for local testing: `python_ai/docker-compose.maria.yml`
-   Added migration SQL: `python_ai/migrations/create_commands_table.sql`
-   Added `.env.example` in `python_ai/` to document env variables and local testing defaults
-   Added integration test `python_ai/test_iot_db_sqlalchemy.py` that validates the SQLAlchemy SQLite fallback path

---
````
