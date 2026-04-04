"""
Filspresso AI Backend
Flask server exposing:
  - Tanka AI endpoints (Semantic / Chemistry modes)
  - IoT coffee machine command endpoints
  - SVG icon saving

Modes for /api/chat:
    - natural_language  →  lexical fact retrieval + response composer  (display: "Semantic")
                         CLIP image understanding when an image is attached
  - chemistry         →  MolScribe molecule recognition when an image is attached
                         text-only requests return MolScribe image guidance (display: "Chemistry")
"""

import os
import json
import logging
import base64
import re
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from urllib.parse import unquote

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv
import psycopg2

from models.tanka import TankaModel, MODE_DISPLAY_NAMES, VALID_MODES

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

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Database configuration
# ---------------------------------------------------------------------------

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "filspresso"),
    "user": os.getenv("DB_USER", "filspresso_user"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
}


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


# ---------------------------------------------------------------------------
# Tanka model (single instance, two modes)
# ---------------------------------------------------------------------------

tanka = TankaModel()

QWEN_COFFEE_TIMEOUT_SECONDS = max(
    30,
    int(os.getenv("QWEN_COFFEE_TIMEOUT_SECONDS", "300") or 300),
)
QWEN_CHEMISTRY_TIMEOUT_SECONDS = max(
    30,
    int(os.getenv("QWEN_CHEMISTRY_TIMEOUT_SECONDS", "300") or 300),
)
MOLSCRIBE_CHEMISTRY_TIMEOUT_SECONDS = max(
    30,
    int(os.getenv("MOLSCRIBE_CHEMISTRY_TIMEOUT_SECONDS", "300") or 300),
)
QWEN_COFFEE_MAX_NEW_TOKENS = max(
    64,
    int(os.getenv("QWEN_COFFEE_MAX_NEW_TOKENS", "320") or 320),
)
QWEN_CHEMISTRY_MAX_NEW_TOKENS = max(
    64,
    int(os.getenv("QWEN_CHEMISTRY_MAX_NEW_TOKENS", "384") or 384),
)
QWEN_WARMUP_ON_STARTUP = str(os.getenv("QWEN_WARMUP_ON_STARTUP", "true") or "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
FACT_RETRIEVAL_TIMEOUT_SECONDS = max(
    3,
    int(os.getenv("FACT_RETRIEVAL_TIMEOUT_SECONDS", "8") or 8),
)


def ensure_molecules_schema():
    """Backfill required molecule columns for on-the-fly rendering flow."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS molecules (
                id SERIAL PRIMARY KEY,
                chembl_id VARCHAR(64) UNIQUE,
                name VARCHAR(255),
                smiles TEXT NOT NULL,
                synonyms JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS chembl_id VARCHAR(64)")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS name VARCHAR(255)")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS smiles TEXT")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS synonyms JSONB DEFAULT '[]'::jsonb")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_molecules_chembl_id_unique ON molecules(chembl_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_molecules_name ON molecules(name)")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("ensure-molecules-schema error: %s", exc)
    finally:
        cur.close()
        conn.close()


ensure_molecules_schema()


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


def _run_with_timeout(fn, timeout_seconds: int, *args, **kwargs):
    """
    Execute a callable with a hard timeout.
    Returns: (result, error) where error is None | "timeout" | Exception.
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


def _warmup_minilm_background():
    """Warm MiniLM encoder on startup so first user request does not block on model load."""
    try:
        tanka.encode("espresso warmup")
        logger.info("MiniLM warmup completed")
    except Exception as exc:
        logger.warning("MiniLM warmup failed (%s)", exc)


def _warmup_qwen_background():
    """Best-effort Qwen warmup to reduce first coffee helper timeout risk."""
    warmup_timeout = max(30, min(180, QWEN_COFFEE_TIMEOUT_SECONDS))
    warmup_prompt = "Give one short sentence about espresso aroma. /no_think"
    _, warmup_error = _run_with_timeout(
        tanka.generate_coffee_text,
        warmup_timeout,
        warmup_prompt,
        context_facts=["Espresso aroma is intense and concentrated."],
        max_new_tokens=min(96, QWEN_COFFEE_MAX_NEW_TOKENS),
        enable_thinking=False,
    )

    status = tanka.qwen_status()
    if warmup_error == "timeout":
        logger.warning("Qwen warmup timed out after %ss (status=%s)", warmup_timeout, status.get("status"))
        return

    if isinstance(warmup_error, Exception):
        logger.warning("Qwen warmup failed (%s) status=%s", warmup_error, status.get("status"))
        return

    logger.info("Qwen warmup completed (status=%s)", status.get("status"))


def _warmup_models_background():
    _warmup_minilm_background()
    if QWEN_WARMUP_ON_STARTUP:
        _warmup_qwen_background()


threading.Thread(target=_warmup_models_background, name="model-warmup", daemon=True).start()


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


def _search_facts_with_timeout(message: str, limit: int = 5):
    result, run_error = _run_with_timeout(_search_facts, FACT_RETRIEVAL_TIMEOUT_SECONDS, message, limit=limit)

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


def _build_chemistry_text_response(
    message: str,
    use_qwen: bool | None = None,
    enable_thinking: bool | None = None,
) -> tuple[str, str]:
    if use_qwen is False:
        return (
            "Qwen 3 text chemistry is available only for PRO, MAX, and ULTIMATE subscriptions. "
            "Upload a molecule image to use MolScribe in Molecule Helper.",
            "qwen3-unauthorized-chemistry",
        )

    text, run_error = _run_with_timeout(
        tanka.generate_chemistry_text,
        QWEN_CHEMISTRY_TIMEOUT_SECONDS,
        message,
        max_new_tokens=QWEN_CHEMISTRY_MAX_NEW_TOKENS,
        enable_thinking=enable_thinking,
    )

    if run_error == "timeout":
        logger.warning("Chemistry Qwen timed out after %ss", QWEN_CHEMISTRY_TIMEOUT_SECONDS)
        return tanka._chemistry_qwen_unavailable_text(), "qwen3-timeout-chemistry-high-demand"

    if isinstance(run_error, Exception):
        logger.warning("Chemistry Qwen execution failed (%s)", run_error)
        return tanka._chemistry_qwen_unavailable_text(), "qwen3-unavailable-chemistry-high-demand"

    if not text:
        return tanka._chemistry_qwen_unavailable_text(), "qwen3-unavailable-chemistry-high-demand"

    return text, tanka.chemistry_text_model_used()


def _build_coffee_text_response(
    message: str,
    rows: list,
    retrieval_backend: str,
    enable_thinking: bool | None = None,
) -> tuple[str, str]:
    context_facts = [fact for fact, _score in rows[:5]]
    text, run_error = _run_with_timeout(
        tanka.generate_coffee_text,
        QWEN_COFFEE_TIMEOUT_SECONDS,
        message,
        context_facts=context_facts,
        max_new_tokens=QWEN_COFFEE_MAX_NEW_TOKENS,
        enable_thinking=enable_thinking,
    )

    if run_error == "timeout":
        logger.warning("Coffee Qwen timed out after %ss; using MiniLM fallback", QWEN_COFFEE_TIMEOUT_SECONDS)
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} (Qwen timeout)"

    if isinstance(run_error, Exception):
        logger.warning("Coffee Qwen execution failed; using MiniLM fallback (%s)", run_error)
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} (Qwen error)"

    if not text:
        fallback_text, fallback_model = _build_minilm_text_response(message, rows, retrieval_backend)
        return fallback_text, f"{fallback_model} (Qwen empty)"

    model_used = tanka.coffee_text_model_used()

    # When Qwen is unavailable, use MiniLM retrieval-backed response composition.
    if model_used.startswith("qwen3-fallback-coffee"):
        text = _build_nlp_response(message, rows)
        if retrieval_backend.startswith("MiniLM"):
            model_used = "MiniLM coffee fallback"
        else:
            model_used = f"MiniLM coffee fallback ({retrieval_backend})"

    return text, model_used


def _build_minilm_text_response(message: str, rows: list, retrieval_backend: str) -> tuple[str, str]:
    text = _build_nlp_response(message, rows)
    if retrieval_backend.startswith("MiniLM"):
        return text, "MiniLM semantic retrieval"
    return text, "MiniLM lexical retrieval"

# ---------------------------------------------------------------------------
# AI endpoints
# ---------------------------------------------------------------------------


@app.route("/api/ask-coffee", methods=["POST"])
def ask_coffee():
    """Semantic mode: answer a coffee question via lexical fact retrieval."""
    try:
        data = request.json or {}
        question = data.get("question", "")
        if not question:
            return jsonify({"error": "question is required"}), 400

        rows, retrieval_backend = _search_facts_with_timeout(question, limit=3)

        if not rows:
            return jsonify({
                "answer": "I don't have information about that in my coffee knowledge base.",
                "results": [],
            })

        return jsonify({
            "status": "success",
            "answer": rows[0][0],
            "all_results": [{"fact": r[0], "similarity": float(r[1])} for r in rows],
            "model": "Tanka",
            "model_used": retrieval_backend,
            "mode": TankaModel.display_name("natural_language"),
        })
    except Exception as exc:
        logger.error("ask-coffee error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Main chat endpoint. Accepts JSON or multipart/form-data (when an image is attached).

    JSON body:
      { "message": "...", "mode": "natural_language"|"chemistry", "request_id": "..." }

    Multipart form data (image upload):
      message=<str>  mode=<str>  request_id=<str>  image=<file>

    Routing logic:
      - image present + chemistry mode  →  MolScribe extracts molecule SMILES
      - image present + any mode        →  CLIP describes the image content
    - no image + natural_language     →  lexical coffee facts response
        - no image + chemistry            →  MolScribe image-required guidance
    """
    try:
        # Support both JSON and multipart form-data
        image_file = request.files.get("image")
        if image_file:
            message = request.form.get("message", "")
            mode = request.form.get("mode", "natural_language")
            request_id = request.form.get("request_id", "none")
            enable_thinking = _parse_optional_bool(request.form.get("enable_thinking"))
            use_qwen = _parse_optional_bool(request.form.get("use_qwen"))
        else:
            data = request.json
            if not data:
                return jsonify({"error": "No data provided"}), 400
            message = data.get("message", "")
            mode = data.get("mode", "natural_language")
            request_id = data.get("request_id", "none")
            enable_thinking = _parse_optional_bool(data.get("enable_thinking"))
            use_qwen = _parse_optional_bool(data.get("use_qwen"))

        if not TankaModel.is_valid_mode(mode):
            return jsonify({"error": f"Invalid mode. Valid modes: {VALID_MODES}"}), 400

        mode_label = TankaModel.display_name(mode)
        logger.info("Chat [%s / %s] image=%s id=%s", mode_label, mode, bool(image_file), request_id)

        # ---- Image path ----
        if image_file:
            image_bytes = image_file.read()

            if mode == "chemistry":
                # MolScribe: extract molecule structure from image
                mol, molscribe_error = _run_with_timeout(
                    tanka.predict_molecule,
                    MOLSCRIBE_CHEMISTRY_TIMEOUT_SECONDS,
                    image_bytes,
                )
                if molscribe_error == "timeout":
                    logger.warning(
                        "MolScribe timed out after %ss for chemistry image request",
                        MOLSCRIBE_CHEMISTRY_TIMEOUT_SECONDS,
                    )
                    response = (
                        tanka.chemistry_molscribe_unavailable_text()
                        if hasattr(tanka, "chemistry_molscribe_unavailable_text")
                        else "MolScribe is in high demand right now, we're sorry for unavailability."
                    )
                    model_used = "molscribe-unavailable-high-demand"
                elif isinstance(molscribe_error, Exception):
                    logger.warning("MolScribe unavailable for chemistry image request (%s)", molscribe_error)
                    response = (
                        tanka.chemistry_molscribe_unavailable_text()
                        if hasattr(tanka, "chemistry_molscribe_unavailable_text")
                        else "MolScribe is in high demand right now, we're sorry for unavailability."
                    )
                    model_used = "molscribe-unavailable-high-demand"
                else:
                    if mol["smiles"]:
                        response = (
                            f"Molecule recognised.\n\n"
                            f"**SMILES:** `{mol['smiles']}`\n"
                            f"**Confidence:** {mol['confidence']:.2%}"
                        )
                    else:
                        response = (
                            "MolScribe could not detect a clear molecule structure in the image. "
                            "Please try a cleaner structural diagram."
                        )
                    model_used = "MolScribe (swin_base_char_aux_200k) image recognition"

                products = []
            else:
                # CLIP: describe image content
                result = tanka.describe_image(image_bytes)
                top = result["top_label"]
                top3_lines = "\n".join(
                    f"  {i + 1}. {label} ({prob:.1%})"
                    for i, (label, prob) in enumerate(result["top3"])
                )
                response = (
                    f"I can see: **{top}** ({result['top_prob']:.1%} confidence)\n\n"
                    f"Top matches:\n{top3_lines}"
                )
                products = _recommend_products(top)
                model_used = "CLIP ViT-B/32 image understanding"

            return jsonify({
                "status": "success",
                "assistant_response": response,
                "products": products,
                "model": "Tanka",
                "model_used": model_used,
                "mode": mode_label,
                "request_id": request_id,
            })

        # ---- Text-only path ----
        if not message:
            return jsonify({"error": "message is required"}), 400

        if mode == "natural_language":
            rows, retrieval_backend = _search_facts_with_timeout(message, limit=5)
            if use_qwen is False:
                response, model_used = _build_minilm_text_response(message, rows, retrieval_backend)
            else:
                response, model_used = _build_coffee_text_response(
                    message,
                    rows,
                    retrieval_backend,
                    enable_thinking=enable_thinking,
                )

        else:
            # Chemistry mode (text-only): Qwen 3 response path when authorised.
            # MiniLM is never used in Molecule Helper text flow.
            response, model_used = _build_chemistry_text_response(
                message,
                use_qwen=use_qwen,
                enable_thinking=enable_thinking,
            )

        products = _recommend_products(message)

        payload = {
            "status": "success",
            "assistant_response": response,
            "products": products,
            "model": "Tanka",
            "model_used": model_used,
            "mode": mode_label,
            "request_id": request_id,
        }
        if str(model_used).lower().startswith("qwen3-local"):
            payload["thinking_mode"] = tanka.qwen_generation_mode()

        return jsonify(payload)
    except Exception as exc:
        logger.error("chat error: %s", exc)
        return jsonify({"error": str(exc)}), 500


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


@app.route("/api/molecule/search", methods=["GET"])
def molecule_search():
    query = (request.args.get("q") or "").strip()
    limit = min(max(int(request.args.get("limit", 5)), 1), 20)
    if not query:
        return jsonify({"error": "q is required"}), 400

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
        rows = cur.fetchall()
        return jsonify({
            "status": "success",
            "count": len(rows),
            "molecules": [_row_to_molecule_payload(r) for r in rows],
        })
    except Exception as exc:
        logger.error("molecule-search error: %s", exc)
        return jsonify({"error": str(exc)}), 500
    finally:
        cur.close()
        conn.close()


@app.route("/api/molecule/<identifier>", methods=["GET"])
def molecule_details(identifier):
    try:
        row = _find_molecule_row(identifier)
        if not row:
            return jsonify({"error": "Molecule not found"}), 404
        return jsonify({"status": "success", "molecule": _row_to_molecule_payload(row)})
    except Exception as exc:
        logger.error("molecule-details error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/molecule/render2d/<identifier>", methods=["GET"])
def molecule_render_2d(identifier):
    try:
        from rdkit import Chem
        from rdkit.Chem.Draw import rdMolDraw2D

        width = min(max(int(request.args.get("width", 500)), 180), 1600)
        height = min(max(int(request.args.get("height", 400)), 120), 1200)

        smiles_override = (request.args.get("smiles") or "").strip()
        smiles = smiles_override
        if not smiles:
            row = _find_molecule_row(identifier)
            if not row:
                return jsonify({"error": "Molecule not found"}), 404
            smiles = row[3]

        mol = Chem.MolFromSmiles(smiles or "")
        if mol is None:
            return jsonify({"error": "Invalid SMILES"}), 422

        drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        svg = drawer.GetDrawingText()

        return Response(svg, mimetype="image/svg+xml")
    except Exception as exc:
        logger.error("molecule-render2d error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/molecule/render3d/<identifier>", methods=["GET"])
def molecule_render_3d(identifier):
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
        import py3Dmol

        style = (request.args.get("style") or "stick").lower()
        if style not in {"stick", "line", "sphere"}:
            style = "stick"

        width = min(max(int(request.args.get("width", 760)), 320), 1400)
        height = min(max(int(request.args.get("height", 420)), 240), 900)

        smiles_override = (request.args.get("smiles") or "").strip()
        smiles = smiles_override
        if not smiles:
            row = _find_molecule_row(identifier)
            if not row:
                return jsonify({"error": "Molecule not found"}), 404
            smiles = row[3]

        mol = Chem.MolFromSmiles(smiles or "")
        if mol is None:
            return jsonify({"error": "Invalid SMILES"}), 422

        mol3d = Chem.AddHs(mol)
        embed_status = AllChem.EmbedMolecule(mol3d, AllChem.ETKDGv3())
        if embed_status != 0:
            return jsonify({"error": "Failed to generate 3D coordinates"}), 422
        AllChem.UFFOptimizeMolecule(mol3d)
        mol_block = Chem.MolToMolBlock(mol3d)

        view = py3Dmol.view(width=width, height=height)
        view.addModel(mol_block, "sdf")
        view.setStyle({style: {}})
        view.setBackgroundColor("#111111")
        view.zoomTo()
        html = view._make_html()
        return Response(html, mimetype="text/html")
    except Exception as exc:
        logger.error("molecule-render3d error: %s", exc)
        return jsonify({"error": str(exc)}), 500


# Backward-compatible aliases used by older frontend code paths
@app.route("/api/molecule/svg/<identifier>", methods=["GET"])
def molecule_render_svg_alias(identifier):
    return molecule_render_2d(identifier)


@app.route("/api/molecule/sdf/<identifier>", methods=["GET"])
def molecule_render_sdf_alias(identifier):
    return molecule_render_3d(identifier)


# ---------------------------------------------------------------------------
# Icon endpoint
# ---------------------------------------------------------------------------


@app.route("/api/icons/save", methods=["POST"])
def save_icon():
    """Save a user's generated SVG icon."""
    try:
        req_data = request.json or {}
        username = req_data.get("username")
        svg_content = req_data.get("svg", "")

        if not username or not svg_content:
            return jsonify({"error": "username and svg are required"}), 400

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

        return jsonify({"status": "success", "icon_path": f"/images/icons/{safe_name}.svg"})
    except Exception as exc:
        logger.error("save-icon error: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Cancellation placeholder
# ---------------------------------------------------------------------------


@app.route("/api/cancel/<request_id>", methods=["POST"])
def cancel_request(request_id):
    logger.info("Cancellation requested for %s", request_id)
    return jsonify({"status": "cancelled", "request_id": request_id})


# ---------------------------------------------------------------------------
# IoT machine command endpoints
# ---------------------------------------------------------------------------

try:
    from iot_db import init_db, create_command, get_pending_command, update_command_status
    init_db()
except Exception as exc:
    logger.error("Failed to initialize IoT DB: %s", exc)


@app.route("/api/commands/create", methods=["POST"])
def api_create_command():
    try:
        data = request.json or {}
        machine_id = data.get("machine_id")
        recipe = data.get("recipe")
        execute_allowed = data.get("execute_allowed", True)
        meta = data.get("meta", {})
        if not machine_id or not recipe:
            return jsonify({"error": "machine_id and recipe are required"}), 400
        command_id = create_command(machine_id, recipe, execute_allowed=bool(execute_allowed), meta=meta)
        return jsonify({"status": "created", "command_id": command_id}), 201
    except Exception as exc:
        logger.error("create-command error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/commands/check/<machine_id>", methods=["GET"])
def api_check_commands(machine_id: str):
    try:
        cmd = get_pending_command(machine_id)
        if not cmd:
            return ("", 204)
        return jsonify({
            "command_id": cmd["command_id"],
            "recipe": cmd["recipe"] if cmd["execute_allowed"] else {},
            "execute_allowed": cmd["execute_allowed"],
            "meta": cmd["meta"],
            "created_at": cmd.get("created_at"),
        })
    except Exception as exc:
        logger.error("check-commands error for %s: %s", machine_id, exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/api/commands/update/<int:command_id>", methods=["POST"])
def api_update_command(command_id: int):
    try:
        data = request.json or {}
        status = data.get("status")
        meta = data.get("meta")
        if not status:
            return jsonify({"error": "status is required"}), 400
        ok = update_command_status(command_id, status, meta=meta)
        if not ok:
            return jsonify({"error": "command not found or not updated"}), 404
        return jsonify({"status": "updated", "command_id": command_id})
    except Exception as exc:
        logger.error("update-command error for %s: %s", command_id, exc)
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.route("/api/health", methods=["GET"])
def health():
    qwen_meta = tanka.qwen_status()
    return jsonify({
        "status": "ok",
        "model": "Tanka",
        "modes": {
            "natural_language": {
                "display": TankaModel.display_name("natural_language"),
                "backend": "MiniLM semantic retrieval + lexical fallback",
                "loaded": tanka._nlp_model is not None,
            },
            "chemistry": {
                "display": TankaModel.display_name("chemistry"),
                "backend": "MolScribe (swin_base_char_aux_200k)",
                "loaded": tanka._molscribe_model is not None,
            },
        },
        "semantic_retrieval_model": tanka.nlp_status(),
        "coffee_text_model": qwen_meta,
        "chemistry_text_model": {
            "status": qwen_meta.get("status", "unknown"),
            "backend": "Qwen 3 0.6B local (no MiniLM fallback)",
            "loaded": tanka._qwen_model is not None,
            "error": qwen_meta.get("error", ""),
            "runtime_note": (
                "Chemistry text requests use Qwen 3 when authorised; if Qwen is unavailable, "
                "a high-demand unavailability message is returned. Chemistry image requests use "
                "MolScribe (swin_base_char_aux_200k)."
            ),
        },
        "image_model": {
            "backend": "CLIP (ViT-B/32)",
            "loaded": tanka._clip_model is not None,
        },
        "database": "postgresql",
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.getenv("PYTHON_AI_PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
