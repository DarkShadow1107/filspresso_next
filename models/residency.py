"""Model residency coordination for the single-server llama.cpp router.

Why this exists
---------------
The chat models are served by ONE llama.cpp router with ``--models-max 1``: a
request for a different model LRU-evicts the current one. That has two
consequences the old per-URL gate could not express:

1. **Requests for different models must be mutually exclusive.** Evicting a model
   mid-generation destroys the in-flight request's context, so a 230M stream must
   not be interrupted because someone asked for the 8B.
2. **Requests for the *same* model may run concurrently**, up to that model's slot
   count. The server is started with ``-np 4``; LFM2.5-230M is allowed 4
   concurrent users and every other model 1.

So admission is a two-part rule: one *active model* at a time, with N concurrent
requests inside it. :class:`GenerationGate` cannot model that because its limit is
fixed per key, and all nine models now share one key.

Loading is handled asynchronously (the "option b" flow). ``POST /models/load`` on
the router returns in ~50 ms, so a request for a model that is not resident is
answered with ``loading`` immediately and the load proceeds in the background once
the current model finishes generating. No HTTP connection is held open for the
multi-minute load that the 8B needs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Dict, Optional, Set

import httpx

logger = logging.getLogger(__name__)


def router_model_id(model_name: str) -> str:
    """Map a GGUF filename to the router's model id.

    The router identifies a model by its *preset name*, which is the filename
    without the .gguf suffix: "LFM2.5-230M-Q4_K_M.gguf" is addressed as
    "LFM2.5-230M-Q4_K_M". Sending the filename gets a 404 "File Not Found" from
    POST /models/load and a routing miss on chat completions.
    """
    name = (model_name or "").strip()
    if name.lower().endswith(".gguf"):
        name = name[: -len(".gguf")]
    return name


def _is_already_running(response) -> bool:
    """True when the router refused a load because the model is already up.

    Matched on the message rather than the bare 400: a 400 can also mean a genuinely
    bad request (an unknown model name returns 404, but a malformed one returns 400), and
    only this specific message means "your view of the world is stale".
    """
    try:
        payload = response.json()
    except Exception:
        return "already running" in (response.text or "").lower()
    error = payload.get("error") if isinstance(payload, dict) else None
    message = ""
    if isinstance(error, dict):
        message = str(error.get("message") or "")
    elif isinstance(error, str):
        message = error
    return "already running" in message.lower()


@dataclass
class GateSlot:
    """A held admission slot, plus how long acquiring it actually took."""

    key: str
    waited_seconds: float = 0.0
    limit: int = 1



def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("%s=%r is not an integer; using %s", name, raw, default)
        return default
    return value if value >= 1 else default


# Measured on this host: slot-level latency is ~0.2-0.8s, so 4 slots genuinely
# serve 4 users. Bigger models are slower per token, so 1 slot each.
DEFAULT_MODEL_CONCURRENCY: Dict[str, int] = {}
DEFAULT_230M_MODEL = "LFM2.5-230M-Q4_K_M.gguf"


def concurrency_for_model(model_name: str) -> int:
    """How many requests may run concurrently for one model.

    Overridable per model via ``AI_MODEL_CONCURRENCY_<KEY>`` where <KEY> is the
    model filename with non-alphanumerics replaced by underscores, e.g.
    ``AI_MODEL_CONCURRENCY_LFM2_5_230M_Q4_K_M_GGUF=4``.
    """
    slug = "".join(ch if ch.isalnum() else "_" for ch in model_name).upper()
    override = os.getenv("AI_MODEL_CONCURRENCY_%s" % slug)
    if override:
        try:
            value = int(override.strip())
            if value >= 1:
                return value
        except (TypeError, ValueError):
            pass

    default_small = _int_env("AI_MODEL_CONCURRENCY_DEFAULT_SMALL", 4)
    default_large = _int_env("AI_MODEL_CONCURRENCY_DEFAULT_LARGE", 1)
    fast = os.getenv("AI_FAST_MODEL", DEFAULT_230M_MODEL).strip()
    return default_small if model_name == fast else default_large


# Rough load times measured on this host, used only to seed the progress estimate
# shown while loading. The authoritative signal is the router's own /models
# status; these just let the bar move instead of sitting at 0%.
_ESTIMATED_LOAD_SECONDS: Dict[str, float] = {}
DEFAULT_LOAD_ESTIMATE_SMALL = 15.0
DEFAULT_LOAD_ESTIMATE_LARGE = 45.0


def estimated_load_seconds(model_name: str) -> float:
    if model_name in _ESTIMATED_LOAD_SECONDS:
        return _ESTIMATED_LOAD_SECONDS[model_name]
    fast = os.getenv("AI_FAST_MODEL", DEFAULT_230M_MODEL).strip()
    return (
        DEFAULT_LOAD_ESTIMATE_SMALL
        if model_name == fast
        else DEFAULT_LOAD_ESTIMATE_LARGE
    )


class ModelResidencyCoordinator:
    """Owns which model is resident and who may generate against it."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient()

        self._cond = asyncio.Condition()
        self.active_model: Optional[str] = None
        self.in_flight: Dict[str, int] = {}
        self.resident: Set[str] = set()
        self.loading: Dict[str, float] = {}
        self.failed: Dict[str, str] = {}
        self.pending_load: Optional[str] = None
        self.last_error: str = ""
        self.swaps = 0
        self.load_events = 0

        self._swap_task: Optional[asyncio.Task] = None

    # -- router introspection ------------------------------------------
    async def refresh_residency(self) -> Dict[str, str]:
        """Ask the router which models are loaded / loading / unloaded."""
        try:
            response = await self._client.get(
                "%s/models" % self.base_url, timeout=10.0
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            self.last_error = "residency check failed: %s" % exc
            logger.warning(self.last_error)
            return {}

        statuses: Dict[str, str] = {}
        loaded: Set[str] = set()
        loading: Dict[str, float] = {}
        now = time.monotonic()
        for entry in payload.get("data") or []:
            # Router reports preset names; re-attach the suffix so the rest of the
            # gateway keeps working in GGUF filenames.
            name = str(entry.get("id") or "")
            if not name:
                continue
            if not name.lower().endswith(".gguf"):
                name = name + ".gguf"
            status = str((entry.get("status") or {}).get("value") or "")
            statuses[name] = status
            if status == "loaded":
                loaded.add(name)
            elif status == "loading":
                loading[name] = now

        async with self._cond:
            self.resident = loaded
            # Keep first-seen start times so the progress estimate is stable.
            for name in loading:
                self.loading.setdefault(name, now)
            for name in list(self.loading):
                if name not in loading:
                    self.loading.pop(name, None)
        return statuses

    def is_resident(self, model_name: str) -> bool:
        return model_name in self.resident

    def status_for(self, model_name: str) -> dict:
        """Load state for one model, including a progress estimate for the UI."""
        now = time.monotonic()
        if model_name in self.resident:
            return {"status": "loaded", "progress": 100}
        started = self.loading.get(model_name)
        if started is not None:
            elapsed = now - started
            estimate = estimated_load_seconds(model_name)
            # Cap at 95: the bar must not read "done" before the router agrees.
            progress = min(95, int((elapsed / estimate) * 100)) if estimate > 0 else 0
            return {
                "status": "loading",
                "progress": progress,
                "elapsed_seconds": round(elapsed, 1),
                "estimated_seconds": round(estimate, 1),
            }
        if model_name in self.failed:
            return {"status": "unavailable", "error": self.failed[model_name]}
        return {"status": "not_loaded", "progress": 0}

    # -- loading -------------------------------------------------------
    async def request_load(self, model_name: str) -> dict:
        """Ensure ``model_name`` is being loaded. Returns its current status.

        Never blocks on the load itself -- that is the whole point. The swap only
        executes once no generation is in flight, so a load request cannot evict a
        model that is currently streaming.
        """
        if model_name in self.resident:
            return self.status_for(model_name)

        async with self._cond:
            if model_name in self.loading or self.pending_load == model_name:
                return self.status_for(model_name)
            if self.pending_load and self.pending_load != model_name:
                # Another model is queued; this one replaces it.
                logger.info(
                    "Load request for %s supersedes queued load of %s",
                    model_name,
                    self.pending_load,
                )
            self.pending_load = model_name
            self.failed.pop(model_name, None)
            self.load_events += 1
            if self._swap_task is None or self._swap_task.done():
                self._swap_task = asyncio.create_task(
                    self._swap_worker(), name="model-swap"
                )
            return self.status_for(model_name)

    async def _swap_worker(self) -> None:
        """Perform one queued load, but only when the GPU is free of generations."""
        try:
            while True:
                async with self._cond:
                    while True:
                        target = self.pending_load
                        busy = sum(self.in_flight.values())
                        if target is None:
                            return
                        if target in self.resident:
                            self.pending_load = None
                            return
                        if busy == 0:
                            break
                        await self._cond.wait()

                    self.pending_load = None
                    self.loading[target] = time.monotonic()

                if self.active_model and self.active_model != target:
                    self.swaps += 1
                    logger.info(
                        "Swapping model: %s -> %s", self.active_model, target
                    )
                started = time.monotonic()
                try:
                    response = await self._client.post(
                        "%s/models/load" % self.base_url,
                        json={"model": router_model_id(target)},
                        timeout=15.0,
                    )
                    # "model is already running" is success, not failure.
                    #
                    # The router answers 400 {"message":"model is already running"} when
                    # the model is loaded but this coordinator's view is stale. Treating
                    # that as an error was a hard deadlock: `resident` is only refreshed
                    # by /api/model-status polling and after a *successful* load, so a
                    # stale view made every request call request_load(), the worker got
                    # 400, marked the model failed, and never refreshed -- leaving
                    # `resident` permanently empty. Observed as the 230M reporting
                    # "busy for 20.0s (limit 4)" forever while the router had it loaded.
                    if response.status_code == 400 and _is_already_running(response):
                        logger.info(
                            "%s is already resident at the router; adopting that view",
                            target,
                        )
                        await self.refresh_residency()
                        async with self._cond:
                            self.loading.pop(target, None)
                            self.active_model = target
                            self.failed.pop(target, None)
                            self._cond.notify_all()
                        break
                    response.raise_for_status()
                except Exception as exc:
                    async with self._cond:
                        self.loading.pop(target, None)
                        self.failed[target] = "could not start load: %s" % exc
                    logger.warning("Failed to start load for %s: %s", target, exc)
                    return

                # Poll the router until it reports loaded, or give up.
                deadline = time.monotonic() + max(
                    60.0, estimated_load_seconds(target) * 6
                )
                while time.monotonic() < deadline:
                    await self.refresh_residency()
                    if target in self.resident:
                        took = time.monotonic() - started
                        _ESTIMATED_LOAD_SECONDS[target] = max(1.0, took)
                        async with self._cond:
                            self.loading.pop(target, None)
                            self.active_model = target
                            self.failed.pop(target, None)
                            self._cond.notify_all()
                        logger.info("Model %s resident after %.1fs", target, took)
                        break
                    await asyncio.sleep(1.0)
                else:
                    async with self._cond:
                        self.loading.pop(target, None)
                        self.failed[target] = "timed out loading"
                    logger.warning("Timed out loading %s", target)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Model swap worker stopped: %s", exc)

    # -- admission -----------------------------------------------------
    async def acquire(self, model_name: str, wait_seconds: Optional[float] = None):
        """Admit a generation request for ``model_name``.

        Waits until the model is resident *and* fewer than its slot count are
        already running. Different models therefore never overlap, which is what
        stops a swap from killing an in-flight stream.
        """
        budget = (
            _int_env("AI_QUEUE_WAIT_SECONDS", 20)
            if wait_seconds is None
            else max(0.0, float(wait_seconds))
        )
        started = time.monotonic()
        limit = concurrency_for_model(model_name)
        deadline = started + budget

        if model_name not in self.resident:
            await self.request_load(model_name)

        while True:
            async with self._cond:
                if model_name in self.resident:
                    current = self.in_flight.get(model_name, 0)
                    if current < limit:
                        self.in_flight[model_name] = current + 1
                        self.active_model = model_name
                        waited = time.monotonic() - started
                        return limit, waited
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ModelBusyError(
                        model_name,
                        time.monotonic() - started,
                        limit,
                        self.status_for(model_name),
                    )
                try:
                    await asyncio.wait_for(self._cond.wait(), timeout=remaining)
                except asyncio.TimeoutError:
                    raise ModelBusyError(
                        model_name,
                        time.monotonic() - started,
                        limit,
                        self.status_for(model_name),
                    ) from None

    async def release(self, model_name: str) -> None:
        async with self._cond:
            current = self.in_flight.get(model_name, 0)
            if current <= 1:
                self.in_flight.pop(model_name, None)
            else:
                self.in_flight[model_name] = current - 1
            self._cond.notify_all()

    @asynccontextmanager
    async def slot(self, model_name: str, wait_seconds: Optional[float] = None):
        """Context-manager form of :meth:`acquire`.

        Yields a :class:`GateSlot` so callers can carve the queue wait out of their
        generation budget exactly as they did with the old per-URL gate.
        """
        limit, waited = await self.acquire(model_name, wait_seconds=wait_seconds)
        try:
            yield GateSlot(key=model_name, waited_seconds=waited, limit=limit)
        finally:
            await self.release(model_name)

    def snapshot(self) -> dict:
        return {
            "resident": sorted(self.resident),
            "active": self.active_model or "",
            "in_flight": dict(self.in_flight),
            "loading": sorted(self.loading),
            "pending_load": self.pending_load or "",
            "swaps": self.swaps,
            "load_events": self.load_events,
            "last_error": self.last_error,
        }

    async def aclose(self) -> None:
        if self._swap_task and not self._swap_task.done():
            self._swap_task.cancel()
            try:
                await self._swap_task
            except (asyncio.CancelledError, Exception):
                pass
        await self._client.aclose()


class ModelBusyError(Exception):
    """Admission timed out. Carries the load state so callers can explain it."""

    def __init__(
        self,
        model_name: str,
        waited_seconds: float,
        limit: int,
        load_state: Optional[dict] = None,
    ) -> None:
        self.model_name = model_name
        self.waited_seconds = waited_seconds
        self.limit = limit
        self.load_state = load_state or {"status": "not_loaded", "progress": 0}
        super().__init__(
            "model %s was busy for %.1fs (limit %d)" % (model_name, waited_seconds, limit)
        )
