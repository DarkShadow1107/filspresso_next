"""
Filspresso AI Backend
Flask server exposing:
  - Tanka AI endpoints (Semantic / Chemistry modes)
  - IoT coffee machine command endpoints
  - SVG icon saving

Modes for /api/chat:
  - natural_language  →  MiniLM semantic retrieval  (display: "Semantic")
                         CLIP image understanding when an image is attached
  - chemistry         →  MolScribe molecule recognition when an image is attached
                         (display: "Chemistry")
"""

import os
import json
import logging
import base64
from pathlib import Path
from urllib.parse import unquote

from flask import Flask, request, jsonify
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
    "password": os.getenv("DB_PASSWORD", "filspresso_secure_2024"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
}


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


# ---------------------------------------------------------------------------
# Tanka model (single instance, two modes)
# ---------------------------------------------------------------------------

tanka = TankaModel()

# ---------------------------------------------------------------------------
# AI endpoints
# ---------------------------------------------------------------------------


@app.route("/api/ask-coffee", methods=["POST"])
def ask_coffee():
    """Semantic mode: answer a coffee question via pgvector similarity search."""
    try:
        data = request.json or {}
        question = data.get("question", "")
        if not question:
            return jsonify({"error": "question is required"}), 400

        query_embedding = tanka.encode(question)

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT fact, 1 - (embedding <=> %s::vector) AS similarity
            FROM coffee_facts
            ORDER BY embedding <=> %s::vector
            LIMIT 3
            """,
            (query_embedding, query_embedding),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()

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
      - no image + natural_language     →  Phi-4-mini-instruct generative answer
      - no image + chemistry            →  prompt to upload a molecule image
    """
    try:
        # Support both JSON and multipart form-data
        image_file = request.files.get("image")
        if image_file:
            message = request.form.get("message", "")
            mode = request.form.get("mode", "natural_language")
            request_id = request.form.get("request_id", "none")
        else:
            data = request.json
            if not data:
                return jsonify({"error": "No data provided"}), 400
            message = data.get("message", "")
            mode = data.get("mode", "natural_language")
            request_id = data.get("request_id", "none")

        if not TankaModel.is_valid_mode(mode):
            return jsonify({"error": f"Invalid mode. Valid modes: {VALID_MODES}"}), 400

        mode_label = TankaModel.display_name(mode)
        logger.info("Chat [%s / %s] image=%s id=%s", mode_label, mode, bool(image_file), request_id)

        # ---- Image path ----
        if image_file:
            image_bytes = image_file.read()

            if mode == "chemistry":
                # MolScribe: extract molecule structure from image
                mol = tanka.predict_molecule(image_bytes)
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

            return jsonify({
                "status": "success",
                "assistant_response": response,
                "products": products,
                "model": "Tanka",
                "mode": mode_label,
                "request_id": request_id,
            })

        # ---- Text-only path ----
        if not message:
            return jsonify({"error": "message is required"}), 400

        if mode == "natural_language":
            embedding = tanka.encode(message)
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT fact, 1 - (embedding <=> %s::vector) AS similarity
                FROM coffee_facts
                ORDER BY embedding <=> %s::vector
                LIMIT 5
                """,
                (embedding, embedding),
            )
            rows = cur.fetchall()
            cur.close()
            conn.close()

            response = _build_nlp_response(message, rows)

        else:
            # Chemistry mode — text only: prompt user to upload image
            response = (
                "Please upload a molecule image using the camera button "
                "so Tanka can recognise its structure with MolScribe."
            )

        products = _recommend_products(message)

        return jsonify({
            "status": "success",
            "assistant_response": response,
            "products": products,
            "model": "Tanka",
            "mode": mode_label,
            "request_id": request_id,
        })
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
    return jsonify({
        "status": "ok",
        "model": "Tanka",
        "modes": {
            "natural_language": {
                "display": TankaModel.display_name("natural_language"),
                "backend": "MiniLM (all-MiniLM-L6-v2)",
                "loaded": tanka._nlp_model is not None,
            },
            "chemistry": {
                "display": TankaModel.display_name("chemistry"),
                "backend": "MolScribe (swin_base_char_aux_200k)",
                "loaded": tanka._molscribe_model is not None,
            },
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
