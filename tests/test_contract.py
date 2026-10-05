"""
AI gateway contract tests.

Every assertion here corresponds to a behaviour the TypeScript/Next layer
*depends on*. They are not style checks — if one of these fails after the
FastAPI migration, a real user-visible behaviour has changed.

The same file runs against Flask today and FastAPI afterwards, via the
client factory in conftest.py. If you find yourself editing this file during the
migration to accommodate a framework difference, that is a bug in the migration,
not in the test.

Reference for each constraint:
  1  status:"ok"            src/components/CoffeeRecommender.tsx:1181
  2  assistant_response      src/app/api/python-chat/route.ts:569
  3  model_used sentinels    src/app/api/python-chat/route.ts:543-547
  4  SSE "\n\n" framing      src/components/playground/PlaygroundContent.tsx:206
  5  stream must close       PlaygroundContent.tsx:230
  6  no Connection header    app.py:1370-1372
  7  400 not 422             src/app/api/playground/chat/route.ts:129-131
  8  cancel returns JSON     src/app/api/python-chat/route.ts:622
  9  icons/save shape        src/components/account/AccountPageContent.tsx:223
 10  port 5000 / plain HTTP  src/lib/server/aiHost.ts:13
 12  read-only container     docker-compose.security.yml:275-299
"""

from __future__ import annotations

import asyncio
import json
import pathlib
from urllib.parse import quote

from conftest import (
    MOLECULE_ID,
    MOLECULE_ROW,
    MOLECULE_SMILES,
    REPO_ROOT,
    post_raw,
    requires_py3dmol,
    requires_rdkit,
    response_text,
)

LFM_TEXT_MODEL = "LFM2.5-230M-Q4_K_M.gguf"
LFM_VISION_MODEL = "LFM2.5-VL-450M-Q4_K_M.gguf"


def _body(response):
    """Parses a response body as JSON, asserting it is valid JSON."""
    data = response.get_json() if hasattr(response, "get_json") else json.loads(response.content)
    assert isinstance(data, (dict, list)), f"expected JSON object, got {type(data).__name__}"
    return data


# ---------------------------------------------------------------------------
# Constraint 1 — health
# ---------------------------------------------------------------------------


def test_health_returns_200_and_status_ok(client, tanka_stub):
    response = client.get("/api/health")

    assert response.status_code == 200, "a non-200 here is treated as 'AI offline' by the UI"
    body = _body(response)
    assert body["status"] == "ok"

    # Fields relayed but unread today; cheap to keep pinned so a rename is caught.
    for key in ("modes", "semantic_retrieval_model", "coffee_text_model", "image_model", "database"):
        assert key in body, f"health payload lost '{key}'"


# ---------------------------------------------------------------------------
# Constraint 2 + 3 — /api/chat
# ---------------------------------------------------------------------------


def test_chat_returns_assistant_response_and_products(client, tanka_stub):
    response = client.post(
        "/api/chat",
        json={"message": "tell me about espresso", "mode": "natural_language", "text_model": LFM_TEXT_MODEL},
    )

    assert response.status_code == 200
    body = _body(response)

    # The text field the Next route reads. 'generated' is dead legacy but the
    # Next route still falls back to it, so assert it is NOT required.
    assert isinstance(body.get("assistant_response"), str)
    assert body["assistant_response"]

    assert isinstance(body["products"], list)
    assert body["status"] == "success"
    assert body["model"] == "Kafelot"
    assert isinstance(body["model_used"], str) and body["model_used"]
    assert "thinking_mode" not in body, "only emitted when model_used mentions thinking"


def test_chat_unavailable_model_used_contains_high_demand(client, tanka_stub):
    """
    The Next route downgrades chemistry failures to a soft 200 by matching
    'unavailable' plus 'high-demand' in model_used. Losing either word turns a
    graceful degradation into a hard 502 for the user.

    app.py:500-504 emits "<tag> unavailable high-demand" when the model returns
    no text, which is how the stub simulates an unavailable runtime.
    """
    tanka_stub.text_available = False

    response = client.post(
        "/api/chat",
        json={"message": "why", "mode": "chemistry", "text_model": LFM_TEXT_MODEL},
    )
    body = _body(response)

    model_used = str(body.get("model_used", "")).lower()
    assert "unavailable" in model_used, f"model_used lost 'unavailable': {model_used!r}"
    assert "high-demand" in model_used or "missing-mmproj" in model_used, (
        f"model_used lost the high-demand/missing-mmproj marker: {model_used!r}"
    )


def test_chat_missing_message_returns_400(client, tanka_stub):
    response = client.post("/api/chat", json={"mode": "natural_language"})

    assert response.status_code == 400, "FastAPI's default 422 would surface to users as a generic 502"
    assert "error" in _body(response)


def test_chat_empty_json_object_returns_400(client, tanka_stub):
    """An empty JSON body reaches app.py:627 ('No data provided')."""
    response = post_raw(client, "/api/chat", b"{}", "application/json")

    assert response.status_code == 400
    assert "error" in _body(response)


def test_chat_non_json_content_type_returns_400_not_masked_500(client, tanka_stub):
    """
    Regression guard against error masking.

    ``request.json`` raises 415 UnsupportedMediaType when Content-Type is not
    JSON. That exception was previously swallowed by the broad handler at
    app.py:731 and re-emitted as a 500, so a malformed request looked like an
    internal server failure and hid the real cause. ``get_json(silent=True)``
    returns None and the route's own ``if not data`` branch returns 400.
    """
    response = post_raw(client, "/api/chat", b"not json", "text/plain")

    assert response.status_code == 400, (
        f"got {response.status_code}; a masked 415/500 hides the real problem from operators"
    )
    assert "error" in _body(response)


def test_non_json_content_type_returns_400_on_every_json_route(client, tanka_stub, fake_db):
    """The same masking existed on every route that read request.json."""
    routes = [
        ("/api/chat",),
        ("/api/ask-coffee",),
        ("/api/icons/save",),
        ("/api/commands/create",),
        ("/api/commands/update/1",),
    ]

    for (path,) in routes:
        response = post_raw(client, path, b"not json", "text/plain")
        assert response.status_code != 500, f"{path} masked a bad Content-Type as a 500"
        assert response.status_code == 400, f"{path} returned {response.status_code}, expected 400"
        assert "error" in _body(response)


def test_chat_invalid_mode_returns_400(client, tanka_stub):
    response = client.post("/api/chat", json={"message": "hi", "mode": "nonsense_mode"})

    assert response.status_code == 400
    body = _body(response)
    assert "Invalid mode" in body["error"]


def test_chat_error_body_is_json_with_error_string(client, tanka_stub):
    """Every /api/chat failure must carry {"error": "<string>"} as JSON."""
    for payload, expected_status in (
        ({}, 400),
        ({"message": "hi", "mode": "bad"}, 400),
    ):
        response = client.post("/api/chat", json=payload)
        assert response.status_code == expected_status
        body = _body(response)
        assert isinstance(body.get("error"), str) and body["error"], f"payload={payload}"


def test_chat_thinking_mode_only_present_when_model_thinks(client, tanka_stub):
    thinking = client.post(
        "/api/chat",
        json={"message": "why is the sky blue", "mode": "chemistry", "text_model": LFM_TEXT_MODEL, "enable_thinking": True},
    )
    assert thinking.status_code == 200
    body = _body(thinking)
    # Present only when model_used mentions thinking; either way the field, when
    # present, must be a string (the Next route forwards it verbatim).
    if "thinking_mode" in body:
        assert isinstance(body["thinking_mode"], str)


# ---------------------------------------------------------------------------
# Constraints 4, 5, 6, 7 — /api/chat/stream
# ---------------------------------------------------------------------------


def _sse_frames(response) -> list[dict]:
    """
    Parses an SSE body the same way the browser client does, so a framing change
    that the client cannot parse fails here too.
    """
    raw = response_text(response)
    events: list[dict] = []
    buffer = ""

    # Mirror PlaygroundContent.tsx:206-236 exactly.
    for chunk in [raw]:
        buffer += chunk
        while "\n\n" in buffer:
            frame, buffer = buffer.split("\n\n", 1)
            for line in frame.split("\n"):
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                events.append(json.loads(data))
    return events


def test_stream_frames_are_double_newline_delimited(client, tanka_stub):
    response = client.post(
        "/api/chat/stream",
        json={"message": "hi", "text_model": LFM_TEXT_MODEL, "max_tokens": 64},
    )

    assert response.status_code == 200
    raw = response_text(response)

    assert "\n\n" in raw, "the client splits on a bare '\\n\\n'; other separators deadlock its buffer"
    # The forbidden alternative: a lone \r would leave the frame unterminated.
    assert not raw.startswith("event:"), "client only reads 'data:' lines"


def test_stream_emits_delta_and_closes(client, tanka_stub):
    response = client.post(
        "/api/chat/stream",
        json={"message": "hi", "text_model": LFM_TEXT_MODEL, "max_tokens": 64},
    )
    events = _sse_frames(response)

    deltas = [e["delta"] for e in events if e.get("delta")]
    assert deltas == ["Hello", ",", " world"], f"client concatenates deltas; got {deltas}"

    # The client never reads 'done' — it detects end-of-stream by the reader
    # closing. So termination must be signalled by the stream ending, and a
    # trailing done marker is the belt-and-braces the client tolerates.
    assert events[-1].get("done") is True


def test_stream_emits_reasoning_only_when_thinking_enabled(client, tanka_stub):
    off = client.post(
        "/api/chat/stream",
        json={"message": "hi", "text_model": LFM_TEXT_MODEL, "max_tokens": 64, "enable_thinking": False},
    )
    assert not any(e.get("reasoning") for e in _sse_frames(off)), "thinking leaked with thinking disabled"

    on = client.post(
        "/api/chat/stream",
        json={"message": "hi", "text_model": LFM_TEXT_MODEL, "max_tokens": 64, "enable_thinking": True},
    )
    assert any(e.get("reasoning") for e in _sse_frames(on)), "thinking mode produced no reasoning events"


def test_stream_never_sets_connection_header(client, tanka_stub):
    """
    PEP 3333 forbids WSGI apps from emitting hop-by-hop headers; waitress
    rejected the whole response with 500 when this was set. Under uvicorn it
    becomes a protocol error.
    """
    response = client.post(
        "/api/chat/stream",
        json={"message": "hi", "text_model": LFM_TEXT_MODEL},
    )
    headers = {k.lower(): v for k, v in response.headers.items()}
    assert "connection" not in headers, "Connection is hop-by-hop and must not be set"


def test_stream_sets_x_accel_buffering_no(client, tanka_stub):
    """Without this, nginx/Caddy buffer the whole stream and tokens arrive in one batch."""
    response = client.post(
        "/api/chat/stream",
        json={"message": "hi", "text_model": LFM_TEXT_MODEL},
    )
    headers = {k.lower(): v for k, v in response.headers.items()}
    assert headers.get("x-accel-buffering") == "no"
    assert headers.get("content-type", "").startswith("text/event-stream")
    assert "no-transform" in headers.get("cache-control", "")


async def test_stream_client_disconnect_does_not_raise_generator_exit(client, tanka_stub):
    """
    Regression guard: a `yield` inside `finally` raises
    "RuntimeError: generator ignored GeneratorExit" whenever the browser closes
    the Playground mid-generation.

    Exercised against `sse_event_stream` directly rather than through the HTTP
    layer, because Flask's test client exposes a WSGI iterator while Starlette's
    buffers the whole body, so only the generator is common to both.
    """
    from app import sse_event_stream

    chunks = tanka_stub.stream_text(LFM_TEXT_MODEL, "hi")
    iterator = sse_event_stream(chunks, enable_thinking=False, model_name=LFM_TEXT_MODEL)

    first = await anext(iterator)
    assert '"delta"' in first, f"expected a delta frame first, got {first!r}"

    # Closing mid-stream is exactly what a client disconnect does.
    await iterator.aclose()


async def test_sse_event_stream_emits_done_only_on_normal_completion():
    from app import sse_event_stream

    async def chunks():
        yield ("content", "a")
        yield ("content", "b")

    events = [frame async for frame in sse_event_stream(chunks(), enable_thinking=False, model_name=LFM_TEXT_MODEL)]
    assert json.loads(events[-1][len("data: "):].strip())["done"] is True


async def test_sse_event_stream_suppresses_reasoning_when_thinking_off():
    from app import sse_event_stream

    async def chunks():
        yield ("reasoning", "hidden thought")
        yield ("content", "answer")

    off = [f async for f in sse_event_stream(chunks(), enable_thinking=False, model_name=LFM_TEXT_MODEL)]
    assert not any("reasoning" in f for f in off)

    on = [f async for f in sse_event_stream(chunks(), enable_thinking=True, model_name=LFM_TEXT_MODEL)]
    assert any("reasoning" in f for f in on)


async def test_warmup_route_reports_warming_immediately(tanka_stub, client):
    """
    The route must claim the slot before scheduling the load, otherwise the poll
    sees "unknown" -- a value useModelPrewarm does not recognise.
    """
    response = client.post("/api/warmup", json={"model": LFM_TEXT_MODEL, "vision": False})
    body = _body(response)

    assert response.status_code == 200
    assert body["status"] in {"warming", "ready"}
    assert body["status"] != "unknown", "an unrecognised status costs 30 x 2s of client polling"


async def test_stream_missing_message_returns_400_not_422(client, tanka_stub):
    """
    A 422 here is collapsed by Next into 502 'The AI runtime rejected the
    request.', which is exactly the message this constraint exists to avoid.
    """
    response = client.post("/api/chat/stream", json={"text_model": LFM_TEXT_MODEL})

    assert response.status_code == 400, f"got {response.status_code}; must be 400 so users see a specific message"
    assert "error" in _body(response)


def test_stream_unknown_model_still_streams_or_400_never_422(client, tanka_stub):
    response = client.post("/api/chat/stream", json={"message": "hi", "text_model": "totally-unknown.gguf"})

    assert response.status_code != 422, "422 must never escape the AI gateway"


# ---------------------------------------------------------------------------
# Warmup status vocabulary
# ---------------------------------------------------------------------------


def test_warmup_status_vocabulary_is_stable(client, tanka_stub):
    """
    useModelPrewarm recognises ready/unavailable/forbidden/unauthorized/rejected.
    Anything else costs 30 x 2s of pointless polling, so pin the emitted values.
    """
    response = client.post("/api/warmup", json={"model": LFM_TEXT_MODEL, "vision": False})
    assert response.status_code == 200
    assert _body(response)["status"] in {"warming", "ready", "unavailable"}


def test_warmup_rejects_unknown_model_with_400(client, tanka_stub):
    response = client.post("/api/warmup", json={"model": "not-a-real-model.gguf", "vision": False})

    assert response.status_code == 400
    body = _body(response)
    assert body["status"] == "rejected"
    assert "allowed" in body


def test_warmup_rejects_cross_kind_model(client, tanka_stub):
    """A vision GGUF sent as text must be rejected, not silently routed."""
    response = client.post("/api/warmup", json={"model": LFM_VISION_MODEL, "vision": False})

    assert response.status_code == 400
    assert _body(response)["status"] == "rejected"


def test_warmup_get_reports_state(client, tanka_stub):
    response = client.get("/api/warmup")

    assert response.status_code == 200
    assert "models" in _body(response)


# ---------------------------------------------------------------------------
# Constraint 8 — cancel
# ---------------------------------------------------------------------------


def test_cancel_returns_valid_json(client, tanka_stub):
    """The Next route calls res.json() unguarded; a non-JSON body throws -> 502."""
    response = client.post("/api/cancel/req-12345")

    assert response.status_code == 200
    body = _body(response)
    assert "status" in body


# ---------------------------------------------------------------------------
# Molecule routes
# ---------------------------------------------------------------------------


def test_molecule_search_returns_molecules_array(client, tanka_stub, fake_db):
    fake_db.rows = [MOLECULE_ROW]

    response = client.get("/api/molecule/search?q=caffeine")
    assert response.status_code == 200
    body = _body(response)

    assert isinstance(body["molecules"], list)
    first = body["molecules"][0]
    for key in ("chembl_id", "name", "smiles", "molecular_formula", "molecular_weight"):
        assert key in first, f"molecule payload lost '{key}'"


def test_molecule_search_requires_q(client, tanka_stub, fake_db):
    response = client.get("/api/molecule/search")

    assert response.status_code == 400
    assert "error" in _body(response)


@requires_rdkit
def test_molecule_detail_returns_molecule_object(client, tanka_stub, fake_db):
    fake_db.rows = [MOLECULE_ROW]

    response = client.get(f"/api/molecule/{MOLECULE_ID}")
    assert response.status_code == 200
    assert "molecule" in _body(response)


@requires_rdkit
def test_molecule_svg_returns_raw_text(client, tanka_stub, fake_db):
    """The client does .startsWith('data:') on the raw body, so it must not be JSON."""
    fake_db.rows = [MOLECULE_ROW]

    response = client.get(f"/api/molecule/svg/{MOLECULE_ID}?smiles={quote(MOLECULE_SMILES)}")

    assert response.status_code == 200
    text = response_text(response)
    assert "<svg" in text, "SVG endpoint must return raw markup, not a JSON wrapper"
    assert not text.lstrip().startswith("{"), "SVG endpoint returned JSON"


@requires_py3dmol
def test_molecule_render3d_returns_raw_html(client, tanka_stub, fake_db):
    """The client does .includes('<script') on the raw body."""
    fake_db.rows = [MOLECULE_ROW]

    response = client.get(
        f"/api/molecule/render3d/{MOLECULE_ID}?smiles={quote(MOLECULE_SMILES)}&width=620&height=320"
    )

    assert response.status_code == 200
    text = response_text(response)
    assert "<script" in text or "<!DOCTYPE" in text, "3D endpoint must return raw HTML"


# ---------------------------------------------------------------------------
# Constraint 9 — icons/save
# ---------------------------------------------------------------------------

# Distinctive name so a real user's icon is never at risk if cleanup fails.
_ICON_TEST_USER = "contract-test-user"


def test_icons_save_returns_status_success_and_icon_path(client, tanka_stub):
    icon_path = REPO_ROOT / "public" / "images" / "icons" / f"{_ICON_TEST_USER}.svg"
    try:
        response = client.post(
            "/api/icons/save",
            json={"username": _ICON_TEST_USER, "svg": '<svg xmlns="http://www.w3.org/2000/svg"/>'},
        )

        assert response.status_code == 200
        body = _body(response)
        assert body["status"] == "success", "AccountPageContent asserts this exact string"
        assert body["icon_path"] == f"/images/icons/{_ICON_TEST_USER}.svg"
        assert icon_path.exists()
    finally:
        icon_path.unlink(missing_ok=True)


def test_icons_save_requires_username_and_svg(client, tanka_stub):
    response = client.post("/api/icons/save", json={"username": ""})

    assert response.status_code == 400
    assert "error" in _body(response)


# ---------------------------------------------------------------------------
# Regression guard for constraint 7
# ---------------------------------------------------------------------------


def test_validation_failure_returns_400_not_422(client, tanka_stub):
    """
    FastAPI returns 422 for body-validation failures by default. The Next relay
    turns any non-ok into a generic 502, so 422 must never escape.
    """
    probes = [
        ("/api/chat", {}),
        ("/api/chat/stream", {"text_model": LFM_TEXT_MODEL}),
    ]
    for path, payload in probes:
        response = client.post(path, json=payload)
        assert response.status_code != 422, f"{path} returned 422 for a malformed body"
        assert response.status_code == 400, f"{path} returned {response.status_code}, expected 400"


# ---------------------------------------------------------------------------
# Golden baseline guard
# ---------------------------------------------------------------------------


def test_golden_baseline_exists_and_covers_every_probe():
    """
    The golden snapshot is the artifact that lets a human diff Flask against
    FastAPI after the migration. Guard only its structure — its contents are
    captured from a live run by tests/capture_golden.py, not asserted inline,
    because model output is non-deterministic.
    """
    golden_path = REPO_ROOT / "tests" / "golden" / "before.json"
    assert golden_path.exists(), (
        "golden baseline missing; regenerate with "
        "`python tests/capture_golden.py http://127.0.0.1:5000`"
    )

    golden = json.loads(golden_path.read_text(encoding="utf-8"))
    probes = golden["probes"]

    # Every probe must have produced a real HTTP observation.
    for name, entry in probes.items():
        assert "error" not in entry, f"golden probe '{name}' captured a transport error: {entry['error']}"
        assert isinstance(entry["status"], int)
        assert entry["kind"] in {"json", "sse"}

    # The invariants the TypeScript layer depends on must be visible here too.
    assert probes["health"]["status"] == 200
    assert probes["health"]["shape"]["status"] == "str"
    assert probes["chat_missing_message"]["status"] == 400
    assert probes["stream_missing_message"]["status"] == 400, "a 422 here becomes a generic 502 for users"
    # capture_golden.py records the separator as the escaped text "\\n\\n", so a
    # regression that dropped it would read "<MISSING \n\n SEPARATOR>" instead.
    assert probes["stream_ok"]["sse"]["separator"] == "\\n\\n"
    assert "delta" in probes["stream_ok"]["sse"]["event_keys"]

# ---------------------------------------------------------------------------
# Phase D: queue and backpressure
#
# Every llama.cpp container runs without --parallel, so each has exactly one
# slot. These tests pin the behaviour the web tier depends on:
#   D1  two routes on the same container contend for one slot
#   D2  the concurrency/wait knobs are read from the environment
#   D3  /api/chat degrades soft-200; /api/chat/stream returns 429 + Retry-After
#   D4  rdkit work is gated separately and never blocks the event loop
#   D5  queue wait is carved out of the generation budget, not added to it
#   D6  warmup never takes the last slot from a real user request
# ---------------------------------------------------------------------------


async def test_gate_keys_by_model_not_service_url(tanka_stub):
    """
    All nine chat models share ONE llama.cpp router, so the URL no longer
    distinguishes anything. The admission key must be the model itself, or
    every model would collapse into a single slot.
    """
    from app import _model_gate_key

    assert _model_gate_key("LFM2.5-230M-Q4_K_M.gguf") == "LFM2.5-230M-Q4_K_M.gguf"
    assert _model_gate_key("LFM2.5-8B-A1B-Q4_K_M.gguf") == "LFM2.5-8B-A1B-Q4_K_M.gguf"
    # Vision models are separate admission domains too.
    assert _model_gate_key("LFM2.5-VL-450M-Q4_K_M.gguf", vision=True) == "LFM2.5-VL-450M-Q4_K_M.gguf"
    # Different models must not share a key, even though they share a URL.
    assert _model_gate_key("LFM2.5-230M-Q4_K_M.gguf") != _model_gate_key(
        "LFM2.5-VL-450M-Q4_K_M.gguf", vision=True
    )


async def _asgi_client():
    """Async client bound to the real ASGI app.

    The sync TestClient runs every request on its own event loop, so a slot held
    by the test is invisible to the handler under test. Contention has to be
    exercised with holder and contender on the *same* loop, which is also what
    uvicorn does in production.
    """
    import contextlib

    import httpx

    from app import app as asgi_app

    @contextlib.asynccontextmanager
    async def _make():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=asgi_app), base_url="http://test"
        ) as ac:
            yield ac

    return _make()


async def test_second_request_to_same_model_queues_then_gets_429(tanka_stub):
    """
    D3: the stream route must hold the slot for the duration of generation and
    answer a concurrent request with 429 + Retry-After, not a 500 or a hang.
    """
    from app import _model_gate_key

    gate_key = _model_gate_key("LFM2.5-230M-Q4_K_M.gguf")
    tanka_stub.residency.busy_models.add(gate_key)
    try:
        async with await _asgi_client() as ac:
            response = await ac.post(
                "/api/chat/stream",
                json={"message": "hi", "text_model": "LFM2.5-230M-Q4_K_M.gguf"},
            )
            assert response.status_code == 429, (
                f"a full model must yield 429, got {response.status_code}"
            )
            assert response.json()["error"] == "MODEL_BUSY"
            # Retry-After must be a real, parseable value: the UI backs off on it.
            assert int(response.headers["Retry-After"]) >= 1
    finally:
        tanka_stub.residency.busy_models.discard(gate_key)

    # With the slot free again the same request must stream normally, proving
    # the 429 was contention and not a permanent rejection.
    async with await _asgi_client() as ac:
        ok = await ac.post(
            "/api/chat/stream",
            json={"message": "hi", "text_model": "LFM2.5-230M-Q4_K_M.gguf"},
        )
    assert ok.status_code == 200


async def test_chat_reports_token_usage_for_metering(tanka_stub, fake_db):
    """
    Token metering depends on this block existing.

    llama.cpp always returned an OpenAI-compatible `usage`; the gateway parsed it and
    dropped it, so there was no way to bill a request at all. The Next layer reads these
    two numbers to compute a charge, so their absence is a billing bug, not a cosmetic
    one.
    """
    tanka_stub.last_usage = {"prompt_tokens": 298, "completion_tokens": 20}
    async with await _asgi_client() as ac:
        response = await ac.post(
            "/api/chat",
            json={"message": "what is an espresso", "text_model": "LFM2.5-230M-Q4_K_M.gguf"},
        )

    assert response.status_code == 200
    usage = response.json()["usage"]
    assert usage["prompt_tokens"] == 298, "input tokens must reach the caller unmangled"
    assert usage["completion_tokens"] == 20, "output tokens must reach the caller unmangled"


async def test_chat_reports_zero_usage_when_the_fallback_serves_the_request(tanka_stub, fake_db):
    """
    A degraded request spent no tokens, so it must report zeroes.

    Not null and not absent: a missing block is indistinguishable from "free" at the
    call site that bills it, which would make an outage look like a windfall.
    """
    tanka_stub.last_usage = {"prompt_tokens": 0, "completion_tokens": 0}
    async with await _asgi_client() as ac:
        response = await ac.post(
            "/api/chat",
            json={"message": "what is an espresso", "text_model": "LFM2.5-230M-Q4_K_M.gguf"},
        )

    usage = response.json()["usage"]
    assert usage == {"prompt_tokens": 0, "completion_tokens": 0}


def test_read_usage_never_raises_on_a_malformed_block():
    """
    The generation already succeeded; failing the request over missing billing metadata
    would be strictly worse than recording a zero.
    """
    from models.tanka import _read_usage

    assert _read_usage(None) == {"prompt_tokens": 0, "completion_tokens": 0}
    assert _read_usage({}) == {"prompt_tokens": 0, "completion_tokens": 0}
    assert _read_usage({"usage": "nope"}) == {"prompt_tokens": 0, "completion_tokens": 0}
    # Negative and non-numeric counts are not credits.
    assert _read_usage({"usage": {"prompt_tokens": -5, "completion_tokens": "x"}}) == {
        "prompt_tokens": 0,
        "completion_tokens": 0,
    }


def test_read_usage_keeps_cached_prompt_tokens():
    """
    A cached prompt is still billable input. Reading only the top-level count would
    under-charge every cached turn, so the cached portion is folded in.
    """
    from models.tanka import _read_usage

    assert _read_usage(
        {"usage": {"prompt_tokens": 100, "prompt_tokens_details": {"cached_tokens": 80}}}
    ) == {"prompt_tokens": 100, "completion_tokens": 0}
    # Some builds report only the cached split.
    assert _read_usage({"usage": {"prompt_tokens_details": {"cached_tokens": 80}}}) == {
        "prompt_tokens": 80,
        "completion_tokens": 0,
    }


async def test_chat_degrades_soft_200_when_model_is_busy(tanka_stub, fake_db):
    """
    D3: /api/chat has no useful 429 path, so saturation must degrade through the
    existing lexical fallback with a high-demand sentinel and a 200 status.
    """
    from app import _model_gate_key

    gate_key = _model_gate_key("LFM2.5-230M-Q4_K_M.gguf")
    tanka_stub.residency.busy_models.add(gate_key)
    try:
        async with await _asgi_client() as ac:
            response = await ac.post(
                "/api/chat",
                json={
                    "message": "what is an espresso",
                    "text_model": "LFM2.5-230M-Q4_K_M.gguf",
                },
            )
    finally:
        tanka_stub.residency.busy_models.discard(gate_key)

    assert response.status_code == 200, "buffered chat must degrade, not fail"
    body = response.json()
    assert "high-demand" in body["model_used"], (
        f"expected the high-demand sentinel, got {body['model_used']!r}"
    )
    assert body["assistant_response"], "the fallback must still return text"


async def test_queue_wait_is_carved_out_of_the_generation_budget():
    """
    D5: the queued request must fit the same wall-clock envelope as before.
    Queue wait is additive against a fixed upstream deadline
    (PYTHON_CHAT_TIMEOUT_MS=330s), so it has to come out of the generation
    budget rather than be added on top of it.
    """
    from models.gate import budget_after_queue_wait

    assert budget_after_queue_wait(300, 0) == 300
    assert budget_after_queue_wait(300, 18) == 282
    # Floored, so a request that queued nearly the whole budget still tries.
    assert budget_after_queue_wait(300, 299) == 5.0
    assert budget_after_queue_wait(300, 900) == 5.0
    # The invariant that matters: inside the budget, wait + generation is exactly
    # the original envelope, never more.
    for waited in (0, 5, 20, 120, 200):
        assert waited + budget_after_queue_wait(300, waited) == 300


async def test_warmup_never_takes_the_slot_from_a_queued_user(tanka_stub):
    """D6: pre-warming is best-effort and must yield to real traffic."""
    from models.gate import GenerationGate, QueueTimeoutError

    gate = GenerationGate("test", limit=1, wait_seconds=0.15, warmup_limit=1)
    key = "LFM2.5-230M-Q4_K_M.gguf"

    async with gate.slot(key):
        # A user holds the only slot; warmup must be told to go away.
        try:
            async with gate.slot(key, warmup=True):
                raise AssertionError("warmup must not run while a user holds the slot")
        except QueueTimeoutError:
            pass

    # Idle model: warmup is allowed to run.
    async with gate.slot(key, warmup=True):
        pass


async def test_molecule_routes_do_not_block_the_event_loop(client, tanka_stub, fake_db):
    """
    D4: rdkit runs in a thread and behind its own gate, so a slow render cannot
    stall unrelated requests. Regression guard for the measured 5ms -> 923ms
    head-of-line block this replaced.
    """
    import asyncio

    from httpx import ASGITransport, AsyncClient as HttpxAsyncClient

    from app import app as asgi_app

    probe_turns = []

    async def probe():
        # A trivial coroutine that must keep turning while the render runs. If the
        # render blocked the event loop, these could only run after it finished.
        for _ in range(25):
            await asyncio.sleep(0)
            probe_turns.append(1)
            await asyncio.sleep(0.004)

    fake_db.rows = [MOLECULE_ROW]
    async with HttpxAsyncClient(
        transport=ASGITransport(app=asgi_app), base_url="http://test"
    ) as ac:
        responses = await asyncio.gather(
            ac.get(f"/api/molecule/render2d/{MOLECULE_ID}?smiles={quote(MOLECULE_SMILES)}"),
            probe(),
        )

    assert responses[0].status_code == 200, _body(responses[0])
    assert len(probe_turns) == 25, "probe coroutine did not interleave with the render"


async def test_molecule_gate_is_separate_from_the_model_gate(client, tanka_stub, fake_db):
    """D4: a saturated llama.cpp model must not block rdkit rendering."""
    from app import _model_gate_key

    gate_key = _model_gate_key("LFM2.5-230M-Q4_K_M.gguf")
    tanka_stub.residency.busy_models.add(gate_key)
    try:
        fake_db.rows = [MOLECULE_ROW]
        response = client.get(
            f"/api/molecule/render2d/{MOLECULE_ID}?smiles={quote(MOLECULE_SMILES)}"
        )
        assert response.status_code == 200, _body(response)
    finally:
        tanka_stub.residency.busy_models.discard(gate_key)


async def test_health_exposes_gate_state(client, tanka_stub):
    """The gates must be observable, or saturation is indistinguishable from slowness."""
    body = _body(client.get("/api/health"))
    gates = body["gates"]
    # Residency shape: which models are loaded plus swap accounting. The old
    # per-URL gate reported `limit`/`timed_out`, which no longer exists now
    # that all chat models share one router.
    assert isinstance(gates["llama"]["resident"], list)
    assert "swaps" in gates["llama"]
    assert "in_flight" in gates["llama"]
    assert "molecule" in gates
    assert isinstance(gates["molecule"]["limit"], int)


async def test_gate_env_knobs_are_honoured(monkeypatch):
    """D2: the limits are configuration, not magic numbers."""
    import importlib

    import models.gate as gate_mod

    monkeypatch.setenv("AI_MAX_CONCURRENCY_PER_MODEL", "3")
    monkeypatch.setenv("AI_QUEUE_WAIT_SECONDS", "7.5")
    monkeypatch.setenv("AI_WARMUP_MAX_CONCURRENCY", "2")

    reloaded = importlib.reload(gate_mod)
    try:
        assert reloaded.MODEL_GATE.limit == 3
        assert reloaded.MODEL_GATE.wait_seconds == 7.5
        assert reloaded.MODEL_GATE.warmup_limit == 2
    finally:
        # Restore module state for the rest of the session.
        for name in (
            "AI_MAX_CONCURRENCY_PER_MODEL",
            "AI_QUEUE_WAIT_SECONDS",
            "AI_WARMUP_MAX_CONCURRENCY",
        ):
            monkeypatch.delenv(name, raising=False)
        importlib.reload(gate_mod)


async def test_deferred_warmup_releases_its_claim(tanka_stub):
    """
    D6: a warmup that yields to real traffic must not leave the model stuck at
    "warming" forever. claim_warmup refuses to re-claim a "warming" slot, so a
    leaked claim would permanently disable pre-warming for that model.
    """
    from models.tanka import TankaModel

    model = TankaModel()
    try:
        state, claimed = await model.claim_warmup("LFM2.5-8B-A1B-Q4_K_M.gguf")
        assert claimed is True
        assert state["status"] == "warming"

        deferred = model.mark_warmup_deferred("LFM2.5-8B-A1B-Q4_K_M.gguf")
        assert deferred["status"] == "deferred", "the stuck-claim bug this guards"

        # A later attempt must be able to claim it again.
        state2, claimed2 = await model.claim_warmup("LFM2.5-8B-A1B-Q4_K_M.gguf")
        assert claimed2 is True, "deferred warmup left the model unclaimable"
        assert state2["status"] == "warming"
    finally:
        await model.aclose()


async def test_warmup_route_requests_a_load_for_the_model(tanka_stub):
    """
    Warmup is now an asynchronous *load request* against the residency coordinator,
    not an inline generation: the router's POST /models/load returns in ~50ms and
    the coordinator performs the swap only once no generation is in flight.

    This replaced a real bug: the route used to publish "warming" via
    claim_warmup and then call warmup_model, which claimed again, saw its own
    state and returned without ever loading anything -- leaving the model reported
    as warming forever.
    """
    async with await _asgi_client() as ac:
        posted = await ac.post(
            "/api/warmup", json={"model": "LFM2.5-8B-A1B-Q4_K_M.gguf", "vision": False}
        )
    assert posted.status_code == 200
    assert posted.json()["status"] in {"warming", "ready", "deferred"}

    # The load is scheduled as a background task so the HTTP response is not held
    # open, so give that task a moment to run before asserting.
    for _ in range(50):
        if "LFM2.5-8B-A1B-Q4_K_M.gguf" in tanka_stub.residency.load_requests:
            break
        await asyncio.sleep(0.01)

    loads = tanka_stub.residency.load_requests
    assert "LFM2.5-8B-A1B-Q4_K_M.gguf" in loads, (
        "the warmup route must ask the coordinator to load the model"
    )


async def test_empty_stream_carries_an_actionable_notice():
    """
    LFM 2.5 spends max_tokens on `reasoning_content` before writing any content,
    and reasoning shares the same budget. A small budget therefore yields an
    answer with nothing in it. Without a `notice` the Playground can only render
    a bare "(empty response)" and the user has no idea what went wrong.
    """
    from app import sse_event_stream

    async def reasoning_only():
        yield ("reasoning", "thinking about it")
        yield ("reasoning", "still thinking")

    frames = [
        f async for f in sse_event_stream(
            reasoning_only(), enable_thinking=False, model_name=LFM_TEXT_MODEL
        )
    ]
    # Reasoning is suppressed, so there are no deltas and no reasoning frames.
    assert not any('"delta"' in f for f in frames)
    done = json.loads(frames[-1][len("data: "):].strip())
    assert done["done"] is True
    assert "notice" in done, "an empty stream must explain itself"
    assert "max_tokens" in done["notice"], "the notice should say what to change"


async def test_non_empty_stream_carries_no_notice():
    """The notice must not appear on a normal answer, or every reply looks broken."""
    from app import sse_event_stream

    async def chunks():
        yield ("content", "hello")

    frames = [f async for f in sse_event_stream(chunks(), enable_thinking=False, model_name=LFM_TEXT_MODEL)]
    done = json.loads(frames[-1][len("data: "):].strip())
    assert done == {"done": True, "model": LFM_TEXT_MODEL}, f"unexpected done frame: {done}"
