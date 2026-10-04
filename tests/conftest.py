"""
Shared test configuration for the AI gateway contract suite.

The whole point of this suite is that the *same* assertions run against both the
current Flask app and the future FastAPI app, so a migration cannot silently
change the wire contract that the TypeScript layer depends on.

That means two things:

1. Environment is pinned BEFORE ``app`` is imported, because ``app.py`` starts a
   model-warmup thread and reads config at module scope.
2. ``tanka`` is stubbed so no GPU, model file or llama.cpp container is needed.
   Every test becomes deterministic and fast.

The client is obtained through :func:`make_client`, which supports both Flask's
``app.test_client()`` and Starlette's ``TestClient`` so this file does not change
during the migration.
"""

from __future__ import annotations

import os
import pathlib
import sys
from datetime import datetime

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

# Must be set before importing app: app.py evaluates these at module scope and
# spawns a warmup thread at import time (app.py:352).
os.environ.setdefault("LLAMA_CPP_WARMUP_ON_STARTUP", "false")
os.environ.setdefault("SECURITY_LEDGER_ARCHIVE_ENABLED", "false")
# Point at an unreachable AI host so nothing tries to reach a real llama.cpp.
os.environ.setdefault("PYTHON_AI_HOST", "http://127.0.0.1:1")

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import app as app_module  # noqa: E402  (import order is deliberate)


class FakeResidency:
    """Stand-in for models/residency.py.ModelResidencyCoordinator.

    Every model is reported resident so admission succeeds immediately, unless a
    test sets ``busy_models`` to make a model look contended.
    """

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.busy_models: set[str] = set()
        self.in_flight: dict[str, int] = {}
        self.loaded: set[str] = set()
        self.load_requests: list[str] = []
        self.slot_waits: dict[str, float] = {}

    def _limit(self, model_name: str) -> int:
        return 4 if model_name == "LFM2.5-230M-Q4_K_M.gguf" else 1

    async def acquire(self, model_name, wait_seconds=None):
        self.calls.append(("acquire", (model_name,), {}))
        if model_name in self.busy_models:
            from models.residency import ModelBusyError

            raise ModelBusyError(model_name, 0.0, self._limit(model_name))
        self.in_flight[model_name] = self.in_flight.get(model_name, 0) + 1
        self.loaded.add(model_name)
        return self._limit(model_name), self.slot_waits.get(model_name, 0.0)

    async def release(self, model_name):
        self.calls.append(("release", (model_name,), {}))
        current = self.in_flight.get(model_name, 0)
        if current <= 1:
            self.in_flight.pop(model_name, None)
        else:
            self.in_flight[model_name] = current - 1

    async def request_load(self, model_name):
        self.calls.append(("request_load", (model_name,), {}))
        self.load_requests.append(model_name)
        self.loaded.add(model_name)
        return {"status": "loaded", "progress": 100}

    def status_for(self, model_name):
        return (
            {"status": "loaded", "progress": 100}
            if model_name in self.loaded
            else {"status": "not_loaded", "progress": 0}
        )

    def is_resident(self, model_name):
        return model_name in self.loaded

    async def refresh_residency(self):
        return {name: "loaded" for name in self.loaded}

    def snapshot(self):
        return {
            "resident": sorted(self.loaded),
            "active": next(iter(sorted(self.loaded)), ""),
            "in_flight": dict(self.in_flight),
            "loading": [],
            "pending_load": "",
            "swaps": 0,
            "load_events": len(self.load_requests),
            "last_error": "",
        }

    async def aclose(self):
        return None

    def slot(self, model_name, wait_seconds=None):
        return _FakeSlot(self, model_name)

    @property
    def wait_seconds(self):
        return 20.0


class _FakeSlot:
    def __init__(self, residency, model_name):
        self._residency = residency
        self._model = model_name

    async def __aenter__(self):
        self._limit, self._waited = await self._residency.acquire(self._model)
        from models.residency import GateSlot

        return GateSlot(key=self._model, waited_seconds=self._waited, limit=self._limit)

    async def __aexit__(self, *exc_info):
        await self._residency.release(self._model)
        return False


class FakeTanka:
    """
    Stand-in for :class:`models.tanka.TankaModel`.

    Records what was asked for so tests can assert on routing, and returns
    deterministic values so response-shape assertions are stable.
    """

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        # Flip these to force the "unavailable" branches.
        self.text_available = True
        self.vision_available = True
        self.warmup_state: dict = {}
        # The chat models now share one llama.cpp router, so admission is
        # coordinated per model rather than per service URL.
        self.residency = FakeResidency()
        # Concurrency-gate key resolution (models/tanka.py::service_key). Distinct
        # services so tests can assert that two models on *different* llama.cpp
        # containers do not contend, while the same container does.
        self.text_services = {
            "MiniLM-L6-v2.gguf": "llama-minilm:8080",
            "LFM2.5-230M-Q4_K_M.gguf": "llama-lfm-230m:8080",
            "LFM2.5-2.6B-Q4_0.gguf": "llama-lfm-2-6b:8080",
        }
        self.vision_services = {"LFM2.5-VL-450M-Q4_K_M.gguf": "llama-lfm-vl-450m:8080"}

    def service_key(self, model_name, vision: bool = False):
        """Mirror of TankaModel.service_key.

        All chat models share one llama.cpp router now, so the admission key is the
        model itself rather than the service URL.
        """
        del vision
        return (model_name or "").strip() or "LFM2.5-230M-Q4_K_M.gguf"

    # ---- generation -------------------------------------------------
    # NOTE the return shapes mirror models/tanka.py exactly:
    #   generate_*_text -> str (model_used comes from a separate accessor)
    #   describe_image   -> (text, model_used)
    # app.py decides the `model_used` sentinel, not the model facade, so the
    # "unavailable high-demand" marker is produced by returning empty text.
    #
    # These are coroutines because tanka is async (Phase C). `stream_text` is an
    # async *generator*, so it is not awaited at the call site.
    async def generate_coffee_text(self, *args, **kwargs):
        self.calls.append(("generate_coffee_text", args, kwargs))
        if not self.text_available:
            return ""
        return "Espresso is a concentrated coffee extraction."

    async def generate_chemistry_text(self, *args, **kwargs):
        self.calls.append(("generate_chemistry_text", args, kwargs))
        if not self.text_available:
            return ""
        return "Carbon is C."

    async def describe_image(self, image_bytes, *args, **kwargs):
        self.calls.append(("describe_image", (image_bytes,), kwargs))
        if not self.vision_available:
            return "", "LFM 2 Vision unavailable high-demand"
        return "A cup of coffee.", "LFM 2 Vision access"

    def predict_molecule(self, image_bytes, *args, **kwargs):
        self.calls.append(("predict_molecule", (image_bytes,), kwargs))
        return {}

    def _chemistry_qwen_unavailable_text(self):
        return "Text chemistry is in high demand right now, we're sorry for unavailability."

    def chemistry_molscribe_unavailable_text(self):
        return "Molecule vision runtime is temporarily unavailable."

    # ---- streaming --------------------------------------------------
    async def stream_text(self, model_name, user_prompt, **kwargs):
        """
        Async generator mirroring the real one: yields ``(channel, text)`` tuples,
        which is the contract the SSE layer depends on.
        """
        self.calls.append(("stream_text", (model_name, user_prompt), kwargs))

        if kwargs.get("thinking_enabled"):
            yield ("reasoning", "thinking about it")
        for token in ("Hello", ",", " world"):
            yield ("content", token)

    # ---- warmup -----------------------------------------------------
    async def claim_warmup(self, model_name, vision=False):
        """Mirrors TankaModel.claim_warmup: reserve the slot, report if claimed."""
        key = model_name
        previous = self.warmup_state.get(key)
        if previous and previous.get("status") == "warming":
            return dict(previous), False
        state = {
            "status": "warming",
            "model": model_name,
            "vision": vision,
            "duration_ms": None,
            "error": "",
        }
        self.warmup_state[key] = state
        return dict(state), True

    async def warmup_model(self, model_name, vision=False, *args, **kwargs):
        self.calls.append(("warmup_model", (model_name,), {"vision": vision}))
        state = {
            "status": "ready",
            "model": model_name,
            "vision": vision,
            "duration_ms": 12,
            "error": "",
        }
        self.warmup_state[model_name] = state
        return dict(state)

    def warmup_status(self, model_name=None, vision=False):
        if model_name:
            return dict(
                self.warmup_state.get(
                    model_name,
                    {"status": "unknown", "model": model_name, "vision": vision},
                )
            )
        return {"models": {k: dict(v) for k, v in self.warmup_state.items()}}

    # ---- status / metadata ------------------------------------------
    async def aclose(self) -> None:
        """The stub owns no HTTP client."""
        return None

    def encode(self, text):
        return None

    def nlp_status(self):
        return {"status": "removed", "error": "legacy-minilm-clip-molscribe-removed"}

    async def qwen_status(self):
        return {
            "status": "ready" if self.text_available else "unavailable",
            "backend": "llama.cpp server",
            "base_url": "http://llama-lfm-230m:8080",
            "default_text_model": "LFM2.5-230M-Q4_K_M.gguf",
            "default_vision_model": "LFM2.5-VL-450M-Q4_K_M.gguf",
            "text_model_endpoints": {},
            "vision_model_endpoints": {},
            "loaded": self.text_available,
            "thinking_default": True,
            "soft_switch_tokens": ["/think", "/no_think"],
            "last_mode": "non-thinking",
            "last_vision_model": "",
            "error": "" if self.text_available else "connection refused",
        }

    def coffee_text_model_used(self):
        if not self.text_available:
            return "MiniLM coffee fallback"
        return "LFM 2.5 access"

    def chemistry_text_model_used(self):
        if not self.text_available:
            return "LFM 2.5 access (fallback)"
        return "LFM 2.5 access"

    def qwen_generation_mode(self):
        return "non-thinking"

    @staticmethod
    def display_name(mode):
        return {"natural_language": "Semantic", "chemistry": "Chemistry"}.get(mode, mode)

    @staticmethod
    def is_valid_mode(mode):
        return mode in {"natural_language", "chemistry"}


@pytest.fixture()
def tanka_stub(monkeypatch):
    """Replaces the real model facade for the duration of a test."""
    fake = FakeTanka()
    monkeypatch.setattr(app_module, "tanka", fake)
    return fake


def make_client():
    """
    Returns a test client for whichever app object ``app`` exposes.

    Keeps the assertion file framework-agnostic, which is what lets the same
    suite run green before and after the FastAPI migration.
    """
    flask = getattr(app_module, "app", None)

    # FastAPI/Starlette app: use TestClient (sync interface).
    if flask is not None and hasattr(flask, "router") and type(flask).__name__ == "FastAPI":
        from fastapi.testclient import TestClient

        return TestClient(flask)

    # Flask app.
    if flask is not None and hasattr(flask, "test_client"):
        flask.config.update(TESTING=True)
        return flask.test_client()

    raise RuntimeError("app.app is neither a Flask nor a FastAPI application")


def response_text(response) -> str:
    """Raw response body as text, for both Flask and Starlette responses."""
    getter = getattr(response, "get_data", None)
    if callable(getter):
        return getter(as_text=True)
    return response.text


def post_raw(client, path: str, body: bytes, content_type: str):
    """
    POST a non-JSON body.

    Flask's test client takes ``data=`` + ``content_type=``; Starlette's is
    httpx-backed and wants ``content=`` plus an explicit header. Tests that
    exercise the bad-Content-Type paths must not care which is underneath.
    """
    if hasattr(client, "get_data") or hasattr(client, "application"):
        return client.post(path, data=body, content_type=content_type)
    return client.post(path, content=body, headers={"content-type": content_type})


@pytest.fixture()
def client():
    return make_client()


# ---------------------------------------------------------------------------
# Fake database
# ---------------------------------------------------------------------------


class FakeCursor:
    """Records executed SQL and replays canned rows."""

    def __init__(self, rows):
        self._rows = rows
        self.executed: list[tuple] = []
        self.closed = False

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FakeConnection:
    def __init__(self, rows):
        self._rows = rows
        self.cursors: list[FakeCursor] = []
        self.closed = False
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        cursor = FakeCursor(self._rows)
        self.cursors.append(cursor)
        return cursor

    def close(self):
        self.closed = True

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


@pytest.fixture()
def fake_db(monkeypatch):
    """
    Replaces ``app.get_db_connection`` so DB-backed routes work without Postgres.

    Rows are supplied per test via ``db.rows``. Any query the code issues returns
    those rows, which is enough to assert response *shape* — the point of this
    suite is the wire contract, not query correctness.
    """
    state = FakeDbState()
    monkeypatch.setattr(app_module, "get_db_connection", lambda: state.new_connection())
    return state


class FakeDbState:
    def __init__(self) -> None:
        self.rows: list = []
        self.connections: list[FakeConnection] = []

    def new_connection(self) -> FakeConnection:
        conn = FakeConnection(self.rows)
        self.connections.append(conn)
        return conn

    @property
    def executed_sql(self) -> list[str]:
        return [sql for conn in self.connections for cursor in conn.cursors for sql, _ in cursor.executed]


# psycopg2's default row factory returns plain tuples, and
# _row_to_molecule_payload unpacks positionally (app.py:1010):
#   mol_id, chembl_id, name, smiles, synonyms, created_at = row
# So the fixture MUST be a tuple in this exact order. created_at is a real
# datetime because the same function calls .isoformat() on it.
MOLECULE_ROW = (
    1,
    "CHEMBL25",
    "Caffeine",
    "Cn1cnc2c1c(=O)n(C)c(=O)n2C",
    "Caffeine, 1,3,7-Trimethylxanthine",
    datetime(2026, 1, 1, 0, 0, 0),
)
MOLECULE_SMILES = MOLECULE_ROW[3]
MOLECULE_ID = MOLECULE_ROW[1]


def _module_available(name: str) -> bool:
    try:
        __import__(name)
    except ImportError:
        return False
    return True


# The molecule routes import these lazily inside the handler, so a missing
# module shows up as a 500 rather than a collection error.
requires_rdkit = pytest.mark.skipif(
    not _module_available("rdkit"),
    reason="molecule routes need rdkit (a runtime dep, not a dev dep)",
)
requires_py3dmol = pytest.mark.skipif(
    not (_module_available("rdkit") and _module_available("py3Dmol")),
    reason="render3d needs py3Dmol in addition to rdkit",
)

