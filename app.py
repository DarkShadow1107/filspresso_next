"""
Filspresso AI Backend

FastAPI (uvicorn) gateway exposing:
    - Kafelot AI endpoints (Semantic / Chemistry modes)
  - IoT coffee machine command endpoints
  - SVG icon saving
  - Molecule search / 2D / 3D rendering (RDKit, gated and off the event loop)

Generation concurrency is bounded by models/gate.py: each llama.cpp container
runs without --parallel and therefore has exactly one slot, so requests queue
for a bounded wait and then degrade (soft-200 for buffered chat, 429 for SSE)
rather than piling into the model.

Modes for /api/chat:
    - natural_language  →  selected llama.cpp text model + lexical retrieval fallback (display: "Semantic")
    - chemistry         →  selected llama.cpp text model for chemistry helper (display: "Chemistry")
    - image upload      →  selected vision model (LFM 2 VL by subscription)
"""

import os
import json
import logging
import base64
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool
from contextlib import asynccontextmanager, suppress
import asyncio

from dotenv import load_dotenv
import psycopg2

from models.tanka import TankaModel, MODE_DISPLAY_NAMES, VALID_MODES
from models.gate import MOLECULE_GATE, QueueTimeoutError, budget_after_queue_wait
from models.residency import ModelBusyError

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent / ".env.local"
load_dotenv(dotenv_path=env_path)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def read_env_or_file(name: str, default: str | None = None, required: bool = False) -> str | None:
    value = (os.getenv(name) or "").strip()
    if value:
        if ("/" in value or "\\" in value or value.startswith("./")) and not value.startswith("-----BEGIN"):
            try:
                if Path(value).exists():
                    with open(value, "r", encoding="utf-8") as handle:
                        loaded = (handle.read() or "").strip()
                        if loaded:
                            return loaded
            except Exception:
                pass
        return value

    file_path = (os.getenv(f"{name}_FILE") or "").strip()
    if file_path:
        try:
            with open(file_path, "r", encoding="utf-8") as handle:
                loaded = (handle.read() or "").strip()
                if loaded:
                    os.environ[name] = loaded
                    return loaded
                raise ValueError(f"{name}_FILE points to an empty file")
        except Exception as exc:
            raise RuntimeError(f"Failed to read {name}_FILE ({file_path}): {exc}") from exc

    if required:
        raise RuntimeError(f"{name} (or {name}_FILE) is required")

    return default


def env_bool(name: str, default: bool = False) -> bool:
    value = (os.getenv(name) or "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Lifespan
#
# Replaces the import-time warmup thread. It ran before the server bound its
# socket, so a slow model load delayed readiness for every health probe. As an
# asyncio task it is scheduled on the loop, so startup is never blocked and the
# task can be cancelled cleanly on shutdown.
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI):
    warmup_task = asyncio.create_task(_warmup_models_background())
    try:
        yield
    finally:
        warmup_task.cancel()
        with suppress(asyncio.CancelledError):
            await warmup_task
        await tanka.aclose()


app = FastAPI(lifespan=lifespan)

cors_origin_raw = os.getenv("CORS_ORIGIN", "http://localhost:3000")
cors_origins = [origin.strip() for origin in cors_origin_raw.split(",") if origin.strip()]
if not cors_origins:
    cors_origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if "*" in cors_origins else cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response helpers
#
# These replace the Flask conveniences the routes used to rely on. Two are
# contract-critical, not stylistic:
#
#   read_json  - Flask's request.json raised 415 on a non-JSON Content-Type and
#                the broad except handler masked that as a 500. Returning {} keeps
#                each route's own "no data" 400 path reachable.
#   json_response - Starlette does not unpack a `(body, status)` tuple return, so
#                the former `return jsonify(x), 400` sites are folded here.
# ---------------------------------------------------------------------------


async def read_json(request) -> dict:
    """
    Reads a JSON body without ever raising.

    Returns {} when the body is absent, malformed, or not declared as JSON.
    """
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


async def read_json_or_form(request) -> dict:
    """JSON body if present, otherwise form fields. Never raises."""
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        return await read_json(request)
    try:
        form = await request.form()
    except Exception:
        return {}
    return dict(form)


async def read_files(request) -> dict:
    """
    Uploaded files keyed by field name.

    Starlette has no `request.files`; uploads arrive on the parsed form, so the
    entries that carry a filename are filtered out. Never raises, so a
    non-multipart body simply yields {} instead of a 500.
    """
    try:
        form = await request.form()
    except Exception:
        return {}
    return {key: value for key, value in form.multi_items() if hasattr(value, "filename")}


def json_response(payload, status_code: int = 200, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code, headers=headers or {})


# Strong references to in-flight warmup tasks. asyncio only keeps weak ones, so
# without this a scheduled load could be garbage-collected before completing.
warmup_tasks: dict[str, "asyncio.Task[None]"] = {}


# ---------------------------------------------------------------------------
# Database configuration
# ---------------------------------------------------------------------------

STRICT_SERVICE_DB_CREDENTIALS = env_bool("STRICT_SERVICE_DB_CREDENTIALS", False)
AI_SCHEMA_BOOTSTRAP_ENABLED = env_bool("AI_SCHEMA_BOOTSTRAP_ENABLED", not STRICT_SERVICE_DB_CREDENTIALS)
ROOT_DB_USER = (os.getenv("DB_USER") or "filspresso_user").strip() or "filspresso_user"
AI_DB_USER = (os.getenv("AI_DB_USER") or "").strip()
EFFECTIVE_AI_DB_USER = AI_DB_USER or ROOT_DB_USER

AI_DB_PASSWORD = read_env_or_file("AI_DB_PASSWORD", required=False)
if not AI_DB_PASSWORD:
    AI_DB_PASSWORD = read_env_or_file("DB_PASSWORD", required=True)

if STRICT_SERVICE_DB_CREDENTIALS:
    if not AI_DB_USER:
        raise RuntimeError("STRICT_SERVICE_DB_CREDENTIALS=true requires AI_DB_USER")
    if AI_DB_USER == ROOT_DB_USER:
        raise RuntimeError("STRICT_SERVICE_DB_CREDENTIALS=true requires AI_DB_USER to differ from DB_USER")
    if not read_env_or_file("AI_DB_PASSWORD", required=False):
        raise RuntimeError(
            "STRICT_SERVICE_DB_CREDENTIALS=true requires AI_DB_PASSWORD or AI_DB_PASSWORD_FILE"
        )

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "filspresso"),
    "user": EFFECTIVE_AI_DB_USER,
    "password": AI_DB_PASSWORD,
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
}


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


# ---------------------------------------------------------------------------
# Kafelot model (single instance, two modes)
# ---------------------------------------------------------------------------

tanka = TankaModel()

TEXT_COFFEE_TIMEOUT_SECONDS = max(
    30,
    int(
        os.getenv(
            "LLAMA_COFFEE_TIMEOUT_SECONDS",
            os.getenv("LFM_COFFEE_TIMEOUT_SECONDS", "300"),
        )
        or 300
    ),
)
TEXT_CHEMISTRY_TIMEOUT_SECONDS = max(
    30,
    int(
        os.getenv(
            "LLAMA_CHEMISTRY_TIMEOUT_SECONDS",
            os.getenv("LFM_CHEMISTRY_TIMEOUT_SECONDS", "300"),
        )
        or 300
    ),
)
MOLECULE_IMAGE_TIMEOUT_SECONDS = max(
    30,
    int(
        os.getenv(
            "MOLECULE_IMAGE_TIMEOUT_SECONDS",
            os.getenv("MOLSCRIBE_CHEMISTRY_TIMEOUT_SECONDS", "300"),
        )
        or 300
    ),
)
TEXT_COFFEE_MAX_NEW_TOKENS = max(
    64,
    int(
        os.getenv(
            "LLAMA_COFFEE_MAX_NEW_TOKENS",
            os.getenv("LFM_COFFEE_MAX_NEW_TOKENS", "320"),
        )
        or 320
    ),
)
TEXT_CHEMISTRY_MAX_NEW_TOKENS = max(
    64,
    int(
        os.getenv(
            "LLAMA_CHEMISTRY_MAX_NEW_TOKENS",
            os.getenv("LFM_CHEMISTRY_MAX_NEW_TOKENS", "384"),
        )
        or 384
    ),
)
TEXT_WARMUP_ON_STARTUP = str(
    os.getenv(
        "LLAMA_CPP_WARMUP_ON_STARTUP",
        os.getenv("LFM_WARMUP_ON_STARTUP", "true"),
    )
    or "true"
).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
FACT_RETRIEVAL_TIMEOUT_SECONDS = max(
    3,
    int(os.getenv("FACT_RETRIEVAL_TIMEOUT_SECONDS", "8") or 8),
)

# Model names, tags and the per-model endpoint table all live in models/tanka.py.
# They used to be duplicated here, which is how the gateway and the llama.cpp
# containers ended up disagreeing about which GGUF a model key meant.

# Bounded admission wait, shared with models/residency.py. A request that cannot
# be admitted in this window degrades (soft-200 for buffered chat, 429 + Retry-After
# for SSE) rather than queueing indefinitely. Note this now also covers waiting for
# a model swap, so it is deliberately short: loading is handled asynchronously and
# reported as progress rather than by holding the request open.
try:
    AI_QUEUE_WAIT_SECONDS = max(
        0.0, float(os.getenv("AI_QUEUE_WAIT_SECONDS", "20") or 20)
    )
except (TypeError, ValueError):
    AI_QUEUE_WAIT_SECONDS = 20.0

from models.tanka import (  # noqa: E402  (kept next to the other model imports)
    AUDIO_MODEL_1_5B,
    AUDIO_MODEL_TAGS,
    TEXT_MODEL_1_2B_INSTRUCT,
    TEXT_MODEL_1_2B_THINKING,
    TEXT_MODEL_230M,
    TEXT_MODEL_2_6B,
    TEXT_MODEL_350M,
    TEXT_MODEL_8B,
    TEXT_MODEL_MINILM,
    TEXT_MODEL_TAGS,
    VISION_MODEL_3B,
    VISION_MODEL_450M,
    VISION_MODEL_TAGS,
)


def _slug_model_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name or "model").strip().lower()).strip("-") or "model"


def _text_model_tag(model_name: str, thinking: bool = False) -> str:
    """Display tag for a text model, built from the shared tag table.

    Thinking is its own GGUF rather than a flag on a bigger model, so the base tag
    comes from the model identity.
    """
    selected = (model_name or "").strip()
    tag = TEXT_MODEL_TAGS.get(selected, "Kafelot text access")
    if selected == TEXT_MODEL_1_2B_THINKING:
        return f"{tag} (thinking)"
    if thinking and selected == TEXT_MODEL_2_6B:
        return "LFM 2.5 2.6B access (thinking)"
    return tag


def _model_gate_key(model_name: str, vision: bool = False) -> str:
    """Admission key for a model.

    Now the model filename, not the service URL: all nine chat models share one
    llama.cpp router, so the URL no longer distinguishes anything.
    """
    return tanka.service_key(model_name, vision=vision)


def _vision_model_tag(model_name: str) -> str:
    return VISION_MODEL_TAGS.get((model_name or "").strip(), "Kafelot vision access")


# Columns the molecule lookup path depends on. `molecule mol` and its GIST index
# come from the rdkit extension and are declared in nestjs-backend/data/schema.sql.
# How long /api/health will wait for the llama.cpp router before reporting it busy.
# Must stay comfortably under the compose healthcheck timeout (10s) so a busy router
# can never accumulate into a container restart.
HEALTH_ROUTER_WAIT_SECONDS = float(os.getenv("HEALTH_ROUTER_WAIT_SECONDS", "2.0"))


MOLECULES_REQUIRED_COLUMNS = (
    "id",
    "name",
    "smiles",
    "molecule",
    "chembl_id",
    "synonyms",
    "created_at",
)


def verify_molecules_schema():
    """Confirm the owner-managed molecules schema is present, without touching DDL.

    This function intentionally runs no DDL. The AI service connects as the
    least-privilege AI_DB_USER role, which is granted SELECT on this table and
    nothing more (see nestjs-backend/src/database/ensureAppSchema.ts). PostgreSQL
    requires table ownership to execute ALTER TABLE even when ADD COLUMN IF NOT
    EXISTS makes the statement semantically a no-op, so the DDL that used to run
    here always failed with "must be owner of table molecules".

    Schema ownership belongs to nestjs-backend/data/schema.sql and the
    ensureAppSchema.ts backstop, both of which run as the owner role. This
    function only reports, so that a genuinely missing schema surfaces as one
    actionable error instead of a silent no-op.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'molecules'
                """
            )
            present = {row[0] for row in cur.fetchall()}
        conn.rollback()
    except Exception as exc:
        logger.error("molecules schema verification failed (cannot read information_schema): %s", exc)
        return
    finally:
        conn.close()

    if not present:
        logger.error(
            "molecules table is missing. Apply nestjs-backend/data/schema.sql "
            "(or start filspresso_backend so ensureAppSchema.ts creates it). "
            "Molecule lookups will fail until it exists."
        )
        return

    missing = [column for column in MOLECULES_REQUIRED_COLUMNS if column not in present]
    if missing:
        logger.error(
            "molecules table is missing column(s) %s. Apply "
            "nestjs-backend/data/schema.sql as the owner role; the AI service "
            "cannot ALTER this table by design.",
            ", ".join(missing),
        )
        return

    logger.info("molecules schema verified (%d columns present)", len(present))


if AI_SCHEMA_BOOTSTRAP_ENABLED:
    verify_molecules_schema()
else:
    logger.info("AI schema verification disabled (AI_SCHEMA_BOOTSTRAP_ENABLED=false); relying on managed migrations")


def _parse_optional_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None

    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return None


def _run_with_timeout_sync(fn, timeout_seconds: int, *args, **kwargs):
    """
    Execute a synchronous callable with a hard timeout, in a worker thread.
    Returns: (result, error) where error is None | "timeout" | Exception.

    Only used by the sync helpers (fact retrieval, coffee/chemistry builders).
    Route handlers use the async version below.
    """
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn, *args, **kwargs)
    try:
        return future.result(timeout=max(1, int(timeout_seconds))), None
    except FuturesTimeoutError:
        future.cancel()
        return None, "timeout"
    except Exception as exc:
        return None, exc
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


async def _run_with_timeout(fn, timeout_seconds: int, *args, **kwargs):
    """
    Await a coroutine with a hard timeout.

    Returns: (result, error) where error is None | "timeout" | Exception.

    `tanka` is now fully async (httpx), so there is no thread pool on this path:
    a cancelled coroutine releases its connection immediately, which the old
    ThreadPoolExecutor path could not do -- a timeout there left the worker thread
    and its llama.cpp request running to completion.
    """
    timeout = max(1, int(timeout_seconds))
    try:
        return await asyncio.wait_for(fn(*args, **kwargs), timeout=timeout), None
    except asyncio.TimeoutError:
        return None, "timeout"
    except Exception as exc:
        return None, exc


def _warmup_minilm_background():
    """Warm MiniLM encoder on startup so first user request does not block on model load."""
    try:
        tanka.encode("espresso warmup")
        logger.info("MiniLM warmup completed")
    except Exception as exc:
        logger.warning("MiniLM warmup failed (%s)", exc)


async def _warmup_text_model():
    """Pre-load the default fast model so the first real request is warm.

    There is no longer a "low priority slot" to contend for. Loading *is* the
    warmup, it is asynchronous (the router's POST /models/load returns in ~50ms),
    and the coordinator refuses to swap while a generation is in flight, so a
    pre-load can never interrupt a user request. MiniLM needs no warmup at all: it
    lives on its own always-resident server.
    """
    fast_model = os.getenv("AI_FAST_MODEL", TEXT_MODEL_230M).strip() or TEXT_MODEL_230M
    state = await tanka.residency.request_load(fast_model)
    if state.get("status") == "loaded":
        logger.info("Startup warmup: %s already resident", fast_model)
        return
    logger.info("Startup warmup: %s is loading in the background", fast_model)


async def _warmup_models_background():
    _warmup_minilm_background()
    if TEXT_WARMUP_ON_STARTUP:
        await _warmup_text_model()


def _search_facts_without_vectors(message: str, limit: int = 5):
    tokens = [
        token
        for token in re.findall(r"[a-z0-9]{3,}", (message or "").lower())
        if token
        not in {
            "the",
            "and",
            "with",
            "from",
            "that",
            "this",
            "about",
            "coffee",
            "show",
            "tell",
            "what",
            "where",
        }
    ]

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        candidates = []
        if tokens:
            like_patterns = [f"%{token}%" for token in tokens[:8]]
            cur.execute(
                """
                SELECT fact
                FROM coffee_facts
                WHERE fact ILIKE ANY(%s)
                LIMIT 120
                """,
                (like_patterns,),
            )
            candidates = [row[0] for row in cur.fetchall()]

        if not candidates:
            cur.execute("SELECT fact FROM coffee_facts LIMIT %s", (limit,))
            return [(fact, 0.2) for (fact,) in cur.fetchall()]

        token_set = set(tokens)
        scored = []
        for fact in candidates:
            lower_fact = (fact or "").lower()
            overlap = sum(1 for token in token_set if token in lower_fact)
            score = min(0.95, 0.3 + (overlap / max(1, len(token_set))))
            scored.append((fact, score))

        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:limit]
    finally:
        cur.close()
        conn.close()


def _search_facts_with_minilm(message: str, limit: int = 5):
    """MiniLM + pgvector semantic retrieval path (best-effort)."""
    embedding = tanka.encode(message)
    if embedding is None:
        return []

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT fact, 1 - (embedding <=> %s::vector) AS similarity
            FROM coffee_facts
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (embedding, embedding, limit),
        )
        rows = cur.fetchall()
        return [(fact, float(similarity)) for fact, similarity in rows]
    except Exception as exc:
        logger.warning("MiniLM retrieval unavailable, lexical fallback enabled (%s)", exc)
        return []
    finally:
        cur.close()
        conn.close()


def _search_facts(message: str, limit: int = 5):
    """Semantic-first retrieval with lexical fallback."""
    semantic_rows = _search_facts_with_minilm(message, limit=limit)
    if semantic_rows:
        return semantic_rows, "MiniLM semantic retrieval"

    return _search_facts_without_vectors(message, limit=limit), "Lexical fallback retrieval"


async def _search_facts_with_timeout(message: str, limit: int = 5):
    result, run_error = await _run_with_timeout(
        run_in_threadpool,
        FACT_RETRIEVAL_TIMEOUT_SECONDS,
        _search_facts,
        message,
        limit=limit,
    )

    if run_error == "timeout":
        logger.warning(
            "Semantic retrieval timed out after %ss; switching to lexical fallback",
            FACT_RETRIEVAL_TIMEOUT_SECONDS,
        )
        return _search_facts_without_vectors(message, limit=limit), "Lexical fallback retrieval (semantic timeout)"

    if isinstance(run_error, Exception):
        logger.warning("Semantic retrieval failed (%s); switching to lexical fallback", run_error)
        return _search_facts_without_vectors(message, limit=limit), "Lexical fallback retrieval (semantic error)"

    if isinstance(result, tuple) and len(result) == 2:
        return result

    return _search_facts_without_vectors(message, limit=limit), "Lexical fallback retrieval"


async def _build_chemistry_text_response(
    message: str,
    text_model: str,
    enable_thinking: bool | None = None,
) -> tuple[str, str]:
    selected_text_model = (text_model or TEXT_MODEL_MINILM).strip()
    selected_text_tag = _text_model_tag(selected_text_model, bool(enable_thinking))

    gate_key = _model_gate_key(selected_text_model, vision=False)
    try:
        async with tanka.residency.slot(gate_key) as held:
            # Queue wait is carved out of the generation budget so the total stays
            # inside the upstream PYTHON_CHAT_TIMEOUT_MS envelope instead of
            # overrunning it and turning degradation into a hard 504.
            generation_budget = budget_after_queue_wait(
                TEXT_CHEMISTRY_TIMEOUT_SECONDS, held.waited_seconds
            )
            text, run_error = await _run_with_timeout(
                tanka.generate_chemistry_text,
                generation_budget,
                message,
                max_new_tokens=TEXT_CHEMISTRY_MAX_NEW_TOKENS,
                enable_thinking=enable_thinking,
                text_model_name=selected_text_model,
            )
    except ModelBusyError as exc:
        logger.warning("Chemistry text rejected: %s", exc)
        return (
            tanka._chemistry_qwen_unavailable_text(),
            f"{selected_text_tag} unavailable high-demand",
        )

    if run_error == "timeout":
        logger.warning("Chemistry text runtime timed out after %ss", TEXT_CHEMISTRY_TIMEOUT_SECONDS)
        return (
            tanka._chemistry_qwen_unavailable_text(),
            f"{selected_text_tag} unavailable high-demand",
        )

    if isinstance(run_error, Exception):
        logger.warning("Chemistry text runtime execution failed (%s)", run_error)
        return (
            tanka._chemistry_qwen_unavailable_text(),
            f"{selected_text_tag} unavailable high-demand",
        )

    if not text:
        return (
            tanka._chemistry_qwen_unavailable_text(),
            f"{selected_text_tag} unavailable high-demand",
        )

    return text, tanka.chemistry_text_model_used()


async def _build_coffee_text_response(
    message: str,
    rows: list,
    retrieval_backend: str,
    text_model: str,
    enable_thinking: bool | None = None,
) -> tuple[str, str]:
    selected_text_model = (text_model or TEXT_MODEL_MINILM).strip()
    selected_text_tag = _text_model_tag(selected_text_model, bool(enable_thinking))
    context_facts = [fact for fact, _score in rows[:5]]

    # Buffered chat has no way to surface a 429 usefully: the browser already
    # renders this payload shape. So when every llama.cpp slot is busy we wait a
    # bounded time and then degrade through the existing lexical fallback with the
    # high-demand sentinel, which is exactly what a runtime timeout already does.
    gate_key = _model_gate_key(selected_text_model, vision=False)
    try:
        async with tanka.residency.slot(gate_key) as held:
            generation_budget = budget_after_queue_wait(
                TEXT_COFFEE_TIMEOUT_SECONDS, held.waited_seconds
            )
            if held.waited_seconds >= 1:
                logger.info(
                    "Coffee text queued %.1fs for %s; generation budget %ss",
                    held.waited_seconds,
                    gate_key,
                    generation_budget,
                )
            text, run_error = await _run_with_timeout(
                tanka.generate_coffee_text,
                generation_budget,
                message,
                context_facts=context_facts,
                max_new_tokens=TEXT_COFFEE_MAX_NEW_TOKENS,
                enable_thinking=enable_thinking,
                text_model_name=selected_text_model,
            )
    except ModelBusyError as exc:
        logger.warning("Coffee text rejected: %s", exc)
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} ({selected_text_tag} high-demand)"

    if run_error == "timeout":
        logger.warning("Coffee text runtime timed out after %ss; using lexical fallback", TEXT_COFFEE_TIMEOUT_SECONDS)
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} ({selected_text_tag} timeout)"

    if isinstance(run_error, Exception):
        logger.warning("Coffee text runtime execution failed; using lexical fallback (%s)", run_error)
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} ({selected_text_tag} error)"

    if not text:
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} ({selected_text_tag} empty)"

    model_used = tanka.coffee_text_model_used()

    # When text runtime is unavailable, use lexical retrieval-backed response composition.
    if "fallback" in str(model_used).lower():
        text = _build_nlp_response(message, rows)
        if retrieval_backend.startswith("MiniLM"):
            model_used = f"MiniLM coffee fallback ({selected_text_tag})"
        else:
            model_used = f"MiniLM coffee fallback ({retrieval_backend}; {selected_text_tag})"

    return text, model_used


def _build_minilm_text_response(message: str, rows: list, retrieval_backend: str) -> tuple[str, str]:
    text = _build_nlp_response(message, rows)
    if retrieval_backend.startswith("MiniLM"):
        return text, "MiniLM semantic retrieval"
    return text, "MiniLM lexical retrieval"

# ---------------------------------------------------------------------------
# AI endpoints
# ---------------------------------------------------------------------------


@app.post("/api/ask-coffee")
async def ask_coffee(request: Request):
    """Semantic mode: answer a coffee question via lexical fact retrieval."""
    try:
        data = await read_json(request)
        question = data.get("question", "")
        if not question:
            return json_response({"error": "question is required"}, 400)

        rows, retrieval_backend = await _search_facts_with_timeout(question, limit=3)

        if not rows:
            return json_response({
                "answer": "I don't have information about that in my coffee knowledge base.",
                "results": [],
            })

        return json_response({
            "status": "success",
            "answer": rows[0][0],
            "all_results": [{"fact": r[0], "similarity": float(r[1])} for r in rows],
            "model": "Kafelot",
            "model_used": retrieval_backend,
            "mode": TankaModel.display_name("natural_language"),
        })
    except Exception as exc:
        logger.error("ask-coffee error: %s", exc)
        return json_response({"error": str(exc)}, 500)


@app.post("/api/chat")
async def chat(request: Request):
    """
    Main chat endpoint. Accepts JSON or multipart/form-data (when an image is attached).

    JSON body:
      { "message": "...", "mode": "natural_language"|"chemistry", "request_id": "..." }

    Multipart form data (image upload):
      message=<str>  mode=<str>  request_id=<str>  image=<file>

    Routing logic:
            - image present + chemistry mode  →  selected vision model chemistry analysis
            - image present + any mode        →  selected vision model general analysis
        - no image + natural_language     →  selected text model + lexical retrieval fallback
            - no image + chemistry            →  selected text model chemistry helper
    """
    try:
        # Support both JSON and multipart form-data
        image_file = (await read_files(request)).get("image")
        if image_file:
            form = await request.form()
            message = form.get("message", "")
            mode = form.get("mode", "natural_language")
            request_id = form.get("request_id", "none")
            enable_thinking = _parse_optional_bool(form.get("enable_thinking"))
            text_model = (form.get("text_model") or TEXT_MODEL_MINILM).strip()
            vision_model = (form.get("vision_model") or VISION_MODEL_450M).strip()
        else:
            data = await read_json(request)
            if not data:
                return json_response({"error": "No data provided"}, 400)
            message = data.get("message", "")
            mode = data.get("mode", "natural_language")
            request_id = data.get("request_id", "none")
            enable_thinking = _parse_optional_bool(data.get("enable_thinking"))
            text_model = str(data.get("text_model") or TEXT_MODEL_MINILM).strip()
            vision_model = str(data.get("vision_model") or VISION_MODEL_450M).strip()

        if not TankaModel.is_valid_mode(mode):
            return json_response({"error": f"Invalid mode. Valid modes: {VALID_MODES}"}, 400)

        mode_label = TankaModel.display_name(mode)
        logger.info("Chat [%s / %s] image=%s id=%s", mode_label, mode, bool(image_file), request_id)

        # ---- Image path ----
        if image_file:
            image_bytes = image_file.read()
            selected_vision_tag = _vision_model_tag(vision_model)

            # Vision runs on its own single-slot container, so it gets its own
            # gate key; a busy vision model must not block text chat and vice versa.
            vision_gate_key = _model_gate_key(vision_model, vision=True)
            try:
                async with tanka.residency.slot(vision_gate_key) as held:
                    vision_budget = budget_after_queue_wait(
                        MOLECULE_IMAGE_TIMEOUT_SECONDS, held.waited_seconds
                    )
                    vision_result, vision_error = await _run_with_timeout(
                        tanka.describe_image,
                        vision_budget,
                        image_bytes,
                        vision_model_name=vision_model,
                        user_prompt=message,
                        chemistry_mode=(mode == "chemistry"),
                    )
            except ModelBusyError as exc:
                logger.warning("Vision rejected: %s", exc)
                vision_result = ""
                vision_error = exc

            if isinstance(vision_error, ModelBusyError):
                response = f"{selected_vision_tag} runtime is in high demand right now, we're sorry for unavailability."
                model_used = f"{selected_vision_tag} unavailable high-demand"
            elif vision_error == "timeout":
                logger.warning(
                    "Vision runtime timed out after %ss for %s image request",
                    MOLECULE_IMAGE_TIMEOUT_SECONDS,
                    mode,
                )
                response = f"{selected_vision_tag} runtime is in high demand right now, we're sorry for unavailability."
                model_used = f"{selected_vision_tag} unavailable high-demand"
            elif isinstance(vision_error, Exception):
                logger.warning("Vision runtime unavailable for %s image request (%s)", mode, vision_error)
                error_text = str(vision_error).lower()
                if "mmproj" in error_text or "image input is not supported" in error_text:
                    response = (
                        f"{selected_vision_tag} runtime is currently unavailable in this deployment because "
                        "a required vision projector file (mmproj) is missing."
                    )
                    model_used = f"{selected_vision_tag} unavailable missing-mmproj"
                else:
                    response = f"{selected_vision_tag} runtime is in high demand right now, we're sorry for unavailability."
                    model_used = f"{selected_vision_tag} unavailable high-demand"
            else:
                response = str((vision_result or {}).get("text") or "I could not analyse this image.")
                model_used = str((vision_result or {}).get("model_used") or selected_vision_tag)

            products = [] if mode == "chemistry" else _recommend_products(message or response)

            return json_response({
                "status": "success",
                "assistant_response": response,
                "products": products,
                "model": "Kafelot",
                "model_used": model_used,
                "text_model": text_model,
                "vision_model": vision_model,
                "mode": mode_label,
                "request_id": request_id,
            })

        # ---- Text-only path ----
        if not message:
            return json_response({"error": "message is required"}, 400)

        if mode == "natural_language":
            rows, retrieval_backend = await _search_facts_with_timeout(message, limit=5)
            response, model_used = await _build_coffee_text_response(
                message,
                rows,
                retrieval_backend,
                text_model=text_model,
                enable_thinking=enable_thinking,
            )

        else:
            response, model_used = await _build_chemistry_text_response(
                message,
                text_model=text_model,
                enable_thinking=enable_thinking,
            )

        products = _recommend_products(message)

        payload = {
            "status": "success",
            "assistant_response": response,
            "products": products,
            "model": "Kafelot",
            "model_used": model_used,
            "text_model": text_model,
            "mode": mode_label,
            "request_id": request_id,
            # Token counts for this exchange, so the caller can meter it. llama.cpp
            # always returned a usage block; it was being discarded, which made billing
            # impossible rather than merely unimplemented. Zeros when the response came
            # from the lexical fallback, where no tokens were spent.
            "usage": tanka.last_usage,
        }
        model_used_lower = str(model_used).lower()
        if "thinking" in model_used_lower:
            payload["thinking_mode"] = tanka.qwen_generation_mode()

        return json_response(payload)
    except Exception as exc:
        logger.error("chat error: %s", exc)
        return json_response({"error": str(exc)}, 500)


def _build_nlp_response(message: str, rows: list) -> str:
    """
    Build a contextual response from retrieved coffee facts.
    Uses question topic and intent to frame the answer around what was asked.
    """
    import hashlib

    msg = message.lower().strip()

    # Stable variant per unique message — same question always gives same answer
    variant = int(hashlib.md5(message.encode()).hexdigest(), 16) % 3

    # ── Greetings ──────────────────────────────────────────────────────────
    greetings = ["hi", "hello", "hey", "good morning", "good afternoon",
                 "good evening", "howdy", "hiya", "sup"]
    if any(msg == g or msg.startswith(g + " ") or msg.startswith(g + ",") for g in greetings):
        greeting_variants = [
            "Hello! I'm Kafelot, your coffee pilot explorer. Ask me anything about coffee capsules, brewing methods, flavor profiles, or Nespresso recommendations!",
            "Hey there! I'm Kafelot — your dedicated coffee AI. What would you like to know about espresso, capsules, or brewing?",
            "Hi! Kafelot here, ready to explore coffee with you. Ask about roast levels, flavor notes, capsule types, or brewing tips!",
        ]
        return greeting_variants[variant]

    # ── No knowledge base rows ─────────────────────────────────────────────
    if not rows:
        no_result_variants = [
            "I'm your dedicated coffee AI! Try asking me about brewing methods, capsule recommendations, flavor profiles, or roast levels.",
            "I specialise in coffee knowledge — try asking about espresso, lungo, capsules, or aroma notes!",
            "Hmm, nothing matched that. Ask me about Nespresso capsules, brewing tips, or coffee intensity!",
        ]
        return no_result_variants[variant]

    best_fact, best_score = rows[0]

    # ── Off-topic: similarity too low ──────────────────────────────────────
    if best_score < 0.25:
        off_topic = [
            "That's a bit outside my coffee expertise! I specialise in coffee, espresso, capsules, and brewing. Is there something coffee-related I can help with?",
            "Interesting question — but I'm Kafelot, a coffee-focused AI! I can tell you about roasting, brewing methods, capsule types, or flavors. What would you like to explore?",
            "I'm best when talking coffee! Ask me about your next espresso, lungo, the right intensity, or your favourite flavor notes.",
        ]
        return off_topic[variant]

    # ── Intent detection ───────────────────────────────────────────────────
    how_words     = ["how", "method", "prepare", "brew", "make", "way to", "steps", "technique"]
    why_words     = ["why", "reason", "because", "explain", "what makes"]
    compare_words = ["vs", "versus", "difference", "compare", "better than", "compared to"]
    rec_words     = ["recommend", "suggest", "best", "should i", "ideal", "which one",
                     "what capsule", "looking for", "want", "prefer", "morning", "afternoon", "evening"]
    what_words    = ["what is", "what are", "tell me about", "describe", "define"]

    has_how     = any(w in msg for w in how_words)
    has_why     = any(w in msg for w in why_words)
    has_compare = any(w in msg for w in compare_words)
    has_rec     = any(w in msg for w in rec_words)
    has_what    = any(w in msg for w in what_words)

    # ── Extract primary coffee topic from question ─────────────────────────
    coffee_keywords = [
        "espresso", "lungo", "cappuccino", "latte", "macchiato", "americano",
        "flat white", "cold brew", "ristretto", "cortado", "turkish",
        "arabica", "robusta", "light roast", "dark roast", "medium roast",
        "brewing", "capsule", "caffeine", "intensity", "vertuo", "nespresso",
        "french press", "pour over", "moka", "aeropress", "siphon",
        "acidity", "body", "aroma", "crema", "grind", "roast", "origin",
    ]
    topic = next((kw for kw in coffee_keywords if kw in msg), "")

    # ── Build contextual response around the question ──────────────────────
    if best_score < 0.35:
        intros = [
            "Here's the closest thing I know on that:",
            "This may be relevant to what you're asking:",
            "Based on my coffee knowledge:",
        ]
        result = f"{intros[variant]}\n\n{best_fact}"

    elif has_compare:
        prefixes = [
            f"To compare: {best_fact}",
            f"Here's the key difference: {best_fact}",
            f"When comparing these: {best_fact}",
        ]
        result = prefixes[variant]

    elif has_rec:
        if topic:
            rec_intros = [
                f"For a {topic} experience: {best_fact}",
                f"Looking for {topic}? {best_fact}",
                f"If you want {topic}: {best_fact}",
            ]
        elif best_score > 0.5:
            rec_intros = [
                f"My recommendation: {best_fact}",
                f"For your needs — {best_fact}",
                f"I'd suggest: {best_fact}",
            ]
        else:
            rec_intros = [
                f"Here's a suggestion: {best_fact}",
                f"You might enjoy: {best_fact}",
                f"Something to consider: {best_fact}",
            ]
        result = rec_intros[variant]

    elif has_how:
        how_intros = [
            f"Here's how it works: {best_fact}",
            f"To answer that — {best_fact}",
            f"On the process: {best_fact}",
        ]
        result = how_intros[variant]

    elif has_why:
        why_intros = [
            f"The reason is: {best_fact}",
            f"In short — {best_fact}",
            f"Here's why: {best_fact}",
        ]
        result = why_intros[variant]

    elif has_what and topic:
        what_intros = [
            f"About {topic}: {best_fact}",
            f"{topic.capitalize()}: {best_fact}",
            f"On {topic} — {best_fact}",
        ]
        result = what_intros[variant]

    elif topic and topic in best_fact.lower():
        # Question mentions a coffee term that also appears in the matched fact
        direct = [
            f"{best_fact}",
            f"Regarding {topic}: {best_fact}",
            f"On {topic} — {best_fact}",
        ]
        result = direct[variant]

    else:
        general = [
            f"{best_fact}",
            f"Great question! {best_fact}",
            f"Here's what I know: {best_fact}",
        ]
        result = general[variant]

    # ── Optionally combine a second distinct fact ──────────────────────────
    if len(rows) >= 2:
        second_fact, second_score = rows[1]
        words_a = set(best_fact.lower().split())
        words_b = set(second_fact.lower().split())
        overlap = len(words_a & words_b) / max(len(words_a | words_b), 1)
        connectors = ["Also worth knowing: ", "Additionally: ", "You might also find this helpful: "]
        connector = connectors[variant]
        if second_score > 0.38 and overlap < 0.45 and second_fact != best_fact:
            return f"{result}\n\n{connector}{second_fact}"

    return result


def _recommend_products(message: str) -> list:
    """Return product recommendations based on keywords in the message."""
    msg = message.lower()
    if "intense" in msg or "strong" in msg:
        return [
            {
                "id": "ispirazione-napoli",
                "name": "Ispirazione Napoli",
                "image": "/images/Capsules/Original/Ispirazione Italiana/Ispirazione Napoli.webp",
                "description": "Deeply dark and creamy coffee with cocoa notes.",
            },
            {
                "id": "kazaar",
                "name": "Kazaar",
                "image": "/images/Capsules/Original/Ispirazione Italiana/Kazaar.avif",
                "description": "Exceptionally intense and syrupy with woody and spicy notes.",
            },
        ]
    if "mild" in msg or "smooth" in msg:
        return [
            {
                "id": "volluto",
                "name": "Volluto",
                "image": "/images/Capsules/Original/Espresso/Volluto.avif",
                "description": "Sweet and light with cereal and fruity notes.",
            }
        ]
    if "vitamin" in msg or "vivida" in msg:
        return [
            {
                "id": "vivida",
                "name": "Vivida",
                "image": "/images/Capsules/Vertuo/Coffee+/Vivida.avif",
                "description": "Smooth blend with Vitamin B12.",
            }
        ]
    return []


# ---------------------------------------------------------------------------
# Molecule endpoints (DB + on-the-fly rendering from SMILES)
# ---------------------------------------------------------------------------


def _parse_synonyms(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if str(v).strip()]
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return []
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if str(x).strip()]
        except Exception:
            pass
        return [v]
    return []


def _find_molecule_row(identifier: str):
    """Find molecule by chembl_id first, then exact name, then exact smiles."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, chembl_id, name, smiles, synonyms, created_at
            FROM molecules
            WHERE UPPER(chembl_id) = UPPER(%s)
            LIMIT 1
            """,
            (identifier,),
        )
        row = cur.fetchone()
        if row:
            return row

        cur.execute(
            """
            SELECT id, chembl_id, name, smiles, synonyms, created_at
            FROM molecules
            WHERE LOWER(name) = LOWER(%s)
            LIMIT 1
            """,
            (identifier,),
        )
        row = cur.fetchone()
        if row:
            return row

        cur.execute(
            """
            SELECT id, chembl_id, name, smiles, synonyms, created_at
            FROM molecules
            WHERE smiles = %s
            LIMIT 1
            """,
            (identifier,),
        )
        return cur.fetchone()
    finally:
        cur.close()
        conn.close()


class MoleculeRenderError(Exception):
    """A molecule could not be rendered, carrying the HTTP status to return."""

    def __init__(self, message: str, status_code: int = 422):
        self.status_code = status_code
        super().__init__(message)


def _render_molecule_2d_sync(smiles: str, width: int, height: int) -> str:
    """Blocking rdkit 2D draw. Must be called via asyncio.to_thread.

    rdkit's C++ drawing code is CPU-bound and does not cooperate with the event
    loop: running it inline in an `async def` route stalls every other request,
    including in-flight SSE streams. Measured on this service: a single render3d
    pushed an unrelated /api/health response from 5ms to 923ms.
    """
    from rdkit import Chem
    from rdkit.Chem.Draw import rdMolDraw2D

    mol = Chem.MolFromSmiles(smiles or "")
    if mol is None:
        raise MoleculeRenderError("Invalid SMILES", 422)

    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def _render_molecule_3d_sync(smiles: str, style: str, width: int, height: int) -> str:
    """Blocking rdkit 3D conformer embed. Must be called via asyncio.to_thread.

    ETKDGv3 embedding plus UFF optimisation is the most expensive thing this
    service does and the most memory-hungry, which is why it gets its own
    semaphore: the limit bounds resident conformers, not throughput.
    """
    from rdkit import Chem
    from rdkit.Chem import AllChem
    import py3Dmol

    mol = Chem.MolFromSmiles(smiles or "")
    if mol is None:
        raise MoleculeRenderError("Invalid SMILES", 422)

    mol3d = Chem.AddHs(mol)
    embed_status = AllChem.EmbedMolecule(mol3d, AllChem.ETKDGv3())
    if embed_status != 0:
        raise MoleculeRenderError("Failed to generate 3D coordinates", 422)
    AllChem.UFFOptimizeMolecule(mol3d)
    mol_block = Chem.MolToMolBlock(mol3d)

    view = py3Dmol.view(width=width, height=height)
    view.addModel(mol_block, "sdf")
    view.setStyle({style: {}})
    view.setBackgroundColor("#111111")
    view.zoomTo()
    return view._make_html()


async def _resolve_molecule_smiles(identifier: str, override: str) -> str | None:
    """Resolve a `?smiles=` override or look the identifier up off the event loop."""
    override = (override or "").strip()
    if override:
        return override
    row = await asyncio.to_thread(_find_molecule_row, identifier)
    if not row:
        return None
    return row[3]


async def _run_molecule_render(fn, *args):
    """Gate + offload one rdkit render, mapping failures to HTTP status."""
    try:
        async with MOLECULE_GATE.slot("rdkit"):
            return await asyncio.to_thread(fn, *args)
    except ModelBusyError as exc:
        raise MoleculeRenderError(f"Molecule renderer is busy: {exc}", 503) from exc


def _row_to_molecule_payload(row):
    from rdkit import Chem
    from rdkit.Chem import rdMolDescriptors

    mol_id, chembl_id, name, smiles, synonyms, created_at = row
    synonyms_list = _parse_synonyms(synonyms)

    mol = Chem.MolFromSmiles(smiles or "")
    molecular_formula = rdMolDescriptors.CalcMolFormula(mol) if mol else None
    molecular_weight = float(rdMolDescriptors.CalcExactMolWt(mol)) if mol else None

    return {
        "id": mol_id,
        "chembl_id": chembl_id,
        "name": name,
        "smiles": smiles,
        "synonyms": synonyms_list,
        "molecular_formula": molecular_formula,
        "molecular_weight": molecular_weight,
        "created_at": created_at.isoformat() if created_at else None,
    }


def _search_molecules_sync(query: str, limit: int):
    """Run the molecule search entirely off the event loop.

    Only the *connection* used to be offloaded, so `cur.execute` and `fetchall`
    -- the part that actually talks to Postgres -- still ran inline and blocked
    every concurrent request.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        like_query = f"%{query}%"
        cur.execute(
            """
            SELECT id, chembl_id, name, smiles, synonyms, created_at
            FROM molecules
            WHERE UPPER(chembl_id) = UPPER(%s)
               OR name ILIKE %s
               OR smiles ILIKE %s
               OR CAST(synonyms AS TEXT) ILIKE %s
            ORDER BY
                CASE WHEN UPPER(chembl_id) = UPPER(%s) THEN 0 ELSE 1 END,
                CASE WHEN LOWER(name) = LOWER(%s) THEN 0 ELSE 1 END,
                created_at DESC
            LIMIT %s
            """,
            (query, like_query, like_query, like_query, query, query, limit),
        )
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.get("/api/molecule/search")
async def molecule_search(request: Request):
    query = (request.query_params.get("q") or "").strip()
    limit = min(max(int(request.query_params.get("limit", 5)), 1), 20)
    if not query:
        return json_response({"error": "q is required"}, 400)

    try:
        rows = await asyncio.to_thread(_search_molecules_sync, query, limit)
        return json_response({
            "status": "success",
            "count": len(rows),
            "molecules": [_row_to_molecule_payload(r) for r in rows],
        })
    except Exception as exc:
        logger.error("molecule-search error: %s", exc)
        return json_response({"error": str(exc)}, 500)


@app.get("/api/molecule/{identifier}")
async def molecule_details(identifier: str,request: Request):
    try:
        # Sync psycopg2 lookup, moved off the loop so it cannot stall a stream.
        row = await asyncio.to_thread(_find_molecule_row, identifier)
        if not row:
            return json_response({"error": "Molecule not found"}, 404)
        return json_response({"status": "success", "molecule": _row_to_molecule_payload(row)})
    except Exception as exc:
        logger.error("molecule-details error: %s", exc)
        return json_response({"error": str(exc)}, 500)


@app.get("/api/molecule/render2d/{identifier}")
async def molecule_render_2d(identifier: str,request: Request):
    try:
        width = min(max(int(request.query_params.get("width", 500)), 180), 1600)
        height = min(max(int(request.query_params.get("height", 400)), 120), 1200)

        smiles = await _resolve_molecule_smiles(identifier, request.query_params.get("smiles") or "")
        if not smiles:
            return json_response({"error": "Molecule not found"}, 404)

        svg = await _run_molecule_render(_render_molecule_2d_sync, smiles, width, height)
        return Response(content=svg, media_type="image/svg+xml")
    except MoleculeRenderError as exc:
        return json_response({"error": str(exc)}, exc.status_code)
    except Exception as exc:
        logger.error("molecule-render2d error: %s", exc)
        return json_response({"error": str(exc)}, 500)


@app.get("/api/molecule/render3d/{identifier}")
async def molecule_render_3d(identifier: str,request: Request):
    try:
        style = (request.query_params.get("style") or "stick").lower()
        if style not in {"stick", "line", "sphere"}:
            style = "stick"

        width = min(max(int(request.query_params.get("width", 760)), 320), 1400)
        height = min(max(int(request.query_params.get("height", 420)), 240), 900)

        smiles = await _resolve_molecule_smiles(identifier, request.query_params.get("smiles") or "")
        if not smiles:
            return json_response({"error": "Molecule not found"}, 404)

        html = await _run_molecule_render(_render_molecule_3d_sync, smiles, style, width, height)
        return Response(content=html, media_type="text/html")
    except MoleculeRenderError as exc:
        return json_response({"error": str(exc)}, exc.status_code)
    except Exception as exc:
        logger.error("molecule-render3d error: %s", exc)
        return json_response({"error": str(exc)}, 500)


# Backward-compatible aliases used by older frontend code paths
@app.get("/api/molecule/svg/{identifier}")
async def molecule_render_svg_alias(identifier: str, request: Request):
    return await molecule_render_2d(identifier, request)


@app.get("/api/molecule/sdf/{identifier}")
async def molecule_render_sdf_alias(identifier: str, request: Request):
    return await molecule_render_3d(identifier, request)


# ---------------------------------------------------------------------------
# Icon endpoint
# ---------------------------------------------------------------------------


@app.post("/api/icons/save")
async def save_icon(request: Request):
    """Save a user's generated SVG icon."""
    try:
        req_data = await read_json(request)
        username = req_data.get("username")
        svg_content = req_data.get("svg", "")

        if not username or not svg_content:
            return json_response({"error": "username and svg are required"}, 400)

        icon_dir = Path(__file__).parent / "public" / "images" / "icons"
        icon_dir.mkdir(parents=True, exist_ok=True)

        if svg_content.startswith("data:"):
            if "," in svg_content:
                header, encoded = svg_content.split(",", 1)
                if "base64" in header:
                    svg_content = base64.b64decode(encoded).decode("utf-8")
                else:
                    svg_content = unquote(encoded)

        svg_content = svg_content.strip().strip('"').strip("'")
        safe_name = username.lower()
        file_path = icon_dir / f"{safe_name}.svg"
        file_path.write_text(svg_content, encoding="utf-8")

        return json_response({"status": "success", "icon_path": f"/images/icons/{safe_name}.svg"})
    except Exception as exc:
        logger.error("save-icon error: %s", exc)
        return json_response({"error": str(exc)}, 500)


# ---------------------------------------------------------------------------
# Cancellation placeholder
# ---------------------------------------------------------------------------


@app.post("/api/cancel/{request_id}")
async def cancel_request(request_id: str,request: Request):
    logger.info("Cancellation requested for %s", request_id)
    return json_response({"status": "cancelled", "request_id": request_id})


# ---------------------------------------------------------------------------
# IoT machine command endpoints
# ---------------------------------------------------------------------------

try:
    from iot_db import init_db, create_command, get_pending_command, update_command_status
    init_db()
except Exception as exc:
    logger.error("Failed to initialize IoT DB: %s", exc)


@app.post("/api/commands/create")
async def api_create_command(request: Request):
    try:
        data = await read_json(request)
        machine_id = data.get("machine_id")
        recipe = data.get("recipe")
        execute_allowed = data.get("execute_allowed", True)
        meta = data.get("meta", {})
        if not machine_id or not recipe:
            return json_response({"error": "machine_id and recipe are required"}, 400)
        command_id = create_command(machine_id, recipe, execute_allowed=bool(execute_allowed), meta=meta)
        return json_response({"status": "created", "command_id": command_id}, 201)
    except Exception as exc:
        logger.error("create-command error: %s", exc)
        return json_response({"error": str(exc)}, 500)


@app.get("/api/commands/check/{machine_id}")
async def api_check_commands(machine_id: str,request: Request):
    try:
        cmd = get_pending_command(machine_id)
        if not cmd:
            # Flask's ("", 204) no-content idiom has no Starlette equivalent;
            # a 204 must carry no body.
            return Response(status_code=204)
        return json_response({
            "command_id": cmd["command_id"],
            "recipe": cmd["recipe"] if cmd["execute_allowed"] else {},
            "execute_allowed": cmd["execute_allowed"],
            "meta": cmd["meta"],
            "created_at": cmd.get("created_at"),
        })
    except Exception as exc:
        logger.error("check-commands error for %s: %s", machine_id, exc)
        return json_response({"error": str(exc)}, 500)


@app.post("/api/commands/update/{command_id}")
async def api_update_command(command_id: int,request: Request):
    try:
        data = await read_json(request)
        status = data.get("status")
        meta = data.get("meta")
        if not status:
            return json_response({"error": "status is required"}, 400)
        ok = update_command_status(command_id, status, meta=meta)
        if not ok:
            return json_response({"error": "command not found or not updated"}, 404)
        return json_response({"status": "updated", "command_id": command_id})
    except Exception as exc:
        logger.error("update-command error for %s: %s", command_id, exc)
        return json_response({"error": str(exc)}, 500)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


async def sse_event_stream(chunks, enable_thinking: bool, model_name: str):
    """
    Formats `(channel, text)` chunks from `tanka.stream_text` as SSE frames.

    `chunks` is an async generator, so this is an async generator too.

    Lives at module scope rather than inside the route so the disconnect
    behaviour can be tested directly: a client that goes away mid-generation
    throws GeneratorExit (delivered as CancelledError to the task awaiting this
    generator), and it must unwind cleanly.

    The `done` frame is emitted on the normal path only. A `yield` inside a
    `finally` is illegal - the finally block would try to yield while the
    generator is being closed, producing
    "RuntimeError: generator ignored GeneratorExit" on every disconnect.

    A stream that produced no content at all carries a `notice` on the `done`
    frame. LFM 2.5 spends `max_tokens` on `reasoning_content` before writing any
    content, and reasoning shares the same budget, so a small budget yields an
    answer with nothing in it. Without the notice the browser renders an empty
    assistant bubble and the user has no idea why.
    """
    content_chunks = 0
    reasoning_chunks = 0
    try:
        async for channel, text in chunks:
            # LFM 2.5 emits thinking into `reasoning_content` regardless of the
            # reasoning switch, so hide it unless thinking was requested.
            if channel == "reasoning":
                reasoning_chunks += 1
                if not enable_thinking:
                    continue
                yield f"data: {json.dumps({'reasoning': text})}\n\n"
                continue
            content_chunks += 1
            yield f"data: {json.dumps({'delta': text})}\n\n"

        done: dict = {"done": True, "model": model_name}
        if content_chunks == 0:
            if reasoning_chunks:
                done["notice"] = (
                    "The model used the whole token budget thinking and produced no "
                    "answer. Try a larger max_tokens, or turn Thinking on."
                )
            else:
                done["notice"] = (
                    "The model returned an empty response. Try rephrasing, or raise max_tokens."
                )
            logger.warning(
                "Playground stream produced no content for %s (reasoning_chunks=%d)",
                model_name,
                reasoning_chunks,
            )
        yield f"data: {json.dumps(done)}\n\n"
    except GeneratorExit:
        # Consumer is gone (browser closed the Playground mid-generation).
        # Nothing can be delivered, so just unwind and let llama.cpp drop the
        # connection. GeneratorExit derives from BaseException, so this clause
        # documents intent rather than intercepting anything.
        raise
    except Exception as exc:
        # str(exc) can be empty (httpx stream errors frequently are), which made
        # this failure undiagnosable from the logs alone. Always include the type.
        logger.warning(
            "Playground stream failed for %s: %s: %s",
            model_name,
            type(exc).__name__,
            exc or "(no message)",
        )
        yield f"data: {json.dumps({'error': str(exc)[:300] or type(exc).__name__})}\n\n"


@app.post("/api/chat/stream")
async def chat_stream(request: Request):
    """
    Model playground endpoint: streams raw model output as Server-Sent Events.

    Unlike /api/chat this bypasses the coffee RAG pipeline and the lexical
    fallback entirely -- it is a direct, parameterised conversation with the
    selected GGUF so the playground can expose temperature, max tokens, system
    prompt and a thinking toggle.

    JSON body:
      {
        "message": "...",
        "system_prompt": "optional",
        "text_model": "LFM2.5-2.6B-Q4_0.gguf",
        "temperature": 0.7,
        "max_tokens": 512,
        "enable_thinking": false
      }

    Events: `data: {"delta": "..."}` per token, then
            `data: {"done": true, "model": "..."}`.
    """
    data = await read_json(request)
    if not data:
        return json_response({"error": "No data provided"}, 400)

    message = str(data.get("message") or "").strip()
    if not message:
        return json_response({"error": "message is required"}, 400)

    text_model = str(data.get("text_model") or TEXT_MODEL_230M).strip()
    known_text_models = {name.lower(): name for name in TEXT_MODEL_TAGS}
    text_model = known_text_models.get(text_model.lower(), text_model)

    try:
        temperature = float(data.get("temperature", 0.7))
    except (TypeError, ValueError):
        temperature = 0.7

    try:
        max_tokens = int(data.get("max_tokens", 512))
    except (TypeError, ValueError):
        max_tokens = 512

    enable_thinking = _parse_optional_bool(data.get("enable_thinking")) or False
    system_prompt = data.get("system_prompt") or ""
    request_id = str(data.get("request_id") or "none")

    logger.info(
        "Playground stream model=%s thinking=%s temperature=%.2f id=%s",
        text_model,
        enable_thinking,
        temperature,
        request_id,
    )

    # Acquire the llama.cpp slot BEFORE the response starts. Acquiring inside the
    # SSE generator would already have sent a 200 + headers, so a full queue could
    # only be reported as an in-band error frame; here it is a real 429 the browser
    # and the Playground UI both understand.
    gate_key = _model_gate_key(text_model, vision=False)
    try:
        _limit, _waited = await tanka.residency.acquire(gate_key)
    except ModelBusyError as exc:
        retry_after = max(1, int(AI_QUEUE_WAIT_SECONDS - exc.waited_seconds) or 1)
        logger.warning("Playground stream rejected model=%s id=%s: %s", text_model, request_id, exc)
        return json_response(
            {
                "error": "MODEL_BUSY",
                "message": "That model is at capacity. Please retry shortly.",
                "model": text_model,
                "retry_after": retry_after,
            },
            429,
            headers={"Retry-After": str(retry_after)},
        )

    if _waited >= 1:
        logger.info(
            "Playground stream queued %.1fs for %s id=%s",
            _waited,
            gate_key,
            request_id,
        )

    async def _gated_stream():
        # Release the slot on normal completion *and* on client disconnect, which
        # arrives here as a cancellation and previously leaked generation slots.
        try:
            async for frame in sse_event_stream(
                tanka.stream_text(
                    text_model,
                    message,
                    system_prompt=system_prompt,
                    max_new_tokens=max_tokens,
                    temperature=temperature,
                    thinking_enabled=enable_thinking,
                ),
                enable_thinking=enable_thinking,
                model_name=text_model,
            ):
                yield frame
        finally:
            await tanka.residency.release(gate_key)

    response = StreamingResponse(_gated_stream(), media_type="text/event-stream")
    response.headers["Cache-Control"] = "no-cache, no-transform"
    # Tells nginx/Caddy not to buffer the stream. `Connection` is deliberately
    # never set: it is hop-by-hop, so each hop in the chain (Caddy -> Next ->
    # uvicorn) manages it itself and echoing it back corrupts the connection.
    response.headers["X-Accel-Buffering"] = "no"
    return response


@app.post("/api/warmup")
async def warmup(request: Request):
    """
    Pre-load a model into its llama.cpp slot so the first real user request
    does not pay the cold-load latency.

    JSON body:
      { "model": "LFM2.5-2.6B-Q4_0.gguf", "vision": false }

    The load runs on a background thread and this returns as soon as it is
    scheduled, so callers poll GET /api/warmup?model=... for the result.
    """
    data = await read_json_or_form(request)
    requested_model = str((data or {}).get("model") or "").strip()
    vision = _parse_optional_bool((data or {}).get("vision")) or False

    allowed = VISION_MODEL_TAGS if vision else TEXT_MODEL_TAGS
    selected = requested_model or (VISION_MODEL_450M if vision else TEXT_MODEL_230M)

    known = {name.lower() for name in allowed}
    if selected.lower() not in known:
        return json_response({
                "status": "rejected",
                "model": selected,
                "vision": vision,
                "error": f"unknown {'vision' if vision else 'text'} model",
                "allowed": sorted(allowed),
            }, 400)

    # Claim the slot synchronously so the poll observes "warming" immediately.
    # create_task alone would leave the state "unknown", which useModelPrewarm
    # does not recognise, costing 30 x 2s of pointless polling.
    claimed_state, claimed = await tanka.claim_warmup(selected, vision=vision)
    if claimed_state.get("status") == "ready" or not claimed:
        # Already resident, or a load is already in flight for this slot.
        return json_response(claimed_state)

    # Schedule the load on the loop. The task holds a strong reference so it is
    # not garbage-collected mid-flight, and it releases its llama.cpp connection
    # promptly if the client disconnects.
    #
    # The load itself runs behind the gate's *warmup* allowance, which declines to
    # start while any real user request is queued or in flight on this model. A
    # prewarm must never consume the last slot ahead of a paying user; if the
    # allowance is contended the warmup reports "warming" and the background task
    # simply gives up, and the client's poll observes that.
    gate_key = _model_gate_key(selected, vision=vision)

    async def _run_low_priority_warmup():
        """Kick off (or confirm) the load. Never blocks the HTTP response.

        The coordinator queues the swap and only performs it once no generation is
        in flight, so a pre-warm cannot evict a model that is currently streaming.
        """
        try:
            state = await tanka.residency.request_load(selected)
            logger.info(
                "Warmup for %s: %s", selected, state.get("status")
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Warmup task for %s failed: %s", selected, exc)

    warmup_tasks[selected] = asyncio.create_task(
        _run_low_priority_warmup(),
        name=f"warmup-{'vision' if vision else 'text'}:{selected}",
    )

    return json_response(tanka.warmup_status(selected, vision=vision) or {"status": "warming", "model": selected})


@app.get("/api/warmup")
async def warmup_status(request: Request):
    """Report warmup state for one model, or for every model when omitted."""
    model = (request.query_params.get("model") or "").strip()
    vision = _parse_optional_bool(request.query_params.get("vision")) or False

    if model:
        return json_response(tanka.warmup_status(model, vision=vision))
    return json_response(tanka.warmup_status())


@app.get("/api/model-status")
async def model_status(request: Request):
    """
    Load state for the chat models, including a progress estimate while loading.

    This is what the Playground polls to drive its loading bar. Only one model is
    resident at a time (the router runs with --models-max 1), so switching models
    means unloading the current one first -- which is why the UI has to show
    progress rather than a spinner.

    `progress` is derived from elapsed time against the *measured* duration of the
    last load of that model, capped at 95 so it never claims completion before the
    router agrees. The authoritative signal is the router's own /models status.

    Accepts `?load=<model>` to request a load as a side effect, which is the
    "option b" flow: kick the load off, return immediately, poll this endpoint.
    """
    requested = (request.query_params.get("load") or "").strip()
    if requested:
        await tanka.residency.request_load(requested)

    # Refresh from the router so a swap performed by another worker is reflected.
    await tanka.residency.refresh_residency()

    model = (request.query_params.get("model") or "").strip()
    vision = _parse_optional_bool(request.query_params.get("vision")) or False

    if model:
        return json_response({
            "model": model,
            **tanka.residency.status_for(model),
        })

    models = {}
    for name in list(TEXT_MODEL_TAGS) + list(VISION_MODEL_TAGS) + list(AUDIO_MODEL_TAGS):
        models[name] = tanka.residency.status_for(name)

    return json_response({
        "models": models,
        "residency": tanka.residency.snapshot(),
    })


@app.get("/api/health")
async def health(request: Request):
    # Bounded hard, because this URL is the container healthcheck
    # (`wget -qO- http://localhost:5000/api/health`, timeout 10s, retries 5) and it is
    # also where the gate's own observability lives.
    #
    # `qwen_status()` awaits the llama.cpp router's /models endpoint over the *shared*
    # httpx pool. When four generations are in flight that pool is busy, the router is
    # busy, and the call can sit far past its own 8s timeout. Measured: with six
    # concurrent chat requests, 71 of 71 health probes timed out client-side after 15s.
    # Two consequences, both bad. Docker eventually marks the container unhealthy and
    # restarts it mid-generation; and `gates.llama.in_flight` is unreadable exactly
    # while it would be interesting, so a saturated model is indistinguishable from an
    # idle one.
    #
    # So the router is asked with a short leash and is allowed to fail. A busy router is
    # not an unhealthy service -- it is a service doing its job -- and the gate snapshot
    # below is served either way.
    try:
        qwen_meta = await asyncio.wait_for(tanka.qwen_status(), timeout=HEALTH_ROUTER_WAIT_SECONDS)
    except asyncio.TimeoutError:
        qwen_meta = {
            "status": "busy",
            "error": f"llama.cpp router did not answer within {HEALTH_ROUTER_WAIT_SECONDS}s",
        }
    except Exception as exc:  # a broken router must not fail liveness either
        qwen_meta = {"status": "unavailable", "error": str(exc)}

    return json_response({
        "status": "ok",
        "model": "Kafelot",
        "modes": {
            "natural_language": {
                "display": TankaModel.display_name("natural_language"),
                "backend": "multi-model llama.cpp text generation + lexical retrieval fallback",
                "loaded": qwen_meta.get("status") == "ready",
            },
            "chemistry": {
                "display": TankaModel.display_name("chemistry"),
                "backend": "multi-model llama.cpp chemistry helper",
                "loaded": qwen_meta.get("status") == "ready",
            },
        },
        "semantic_retrieval_model": tanka.nlp_status(),
        "coffee_text_model": qwen_meta,
        "chemistry_text_model": {
            "status": qwen_meta.get("status", "unknown"),
            "backend": "llama.cpp server",
            "loaded": qwen_meta.get("status") == "ready",
            "error": qwen_meta.get("error", ""),
            "runtime_note": (
                "Chemistry text requests use subscription-selected GGUF models "
                "(MiniLM-L6-v2, LFM2.5-2.6B, LFM2.5-2.6B Thinking, Gemma3-1B)."
            ),
        },
        "image_model": {
            "backend": "subscription-selected vision GGUF model (LFM2-VL)",
            "loaded": qwen_meta.get("status") == "ready",
            "default_model": qwen_meta.get("default_vision_model", VISION_MODEL_450M),
        },
        "database": "postgresql",
        # Backpressure visibility: which llama.cpp slot is busy, how many requests
        # are queued behind it, and how often the bounded wait has expired. Without
        # this a saturated model is indistinguishable from a slow one in the logs.
        "gates": {
            "llama": tanka.residency.snapshot(),
            "molecule": MOLECULE_GATE.snapshot(),
        },
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Matches the container CMD in Dockerfile.ai. `app.run(...)` is a Flask API and
    # no longer exists on the FastAPI instance, so running this file directly used
    # to crash with AttributeError instead of starting a server.
    import uvicorn  # imported here so the module stays importable without uvicorn

    port = int(os.getenv("PYTHON_AI_PORT", 5000))
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        # Single worker on purpose: the in-process generation gates and warmup
        # state are per-process, so extra workers would each allow their own
        # limit and oversubscribe every single-slot llama.cpp container.
        workers=1,
        log_level=os.getenv("UVICORN_LOG_LEVEL", "info"),
    )
