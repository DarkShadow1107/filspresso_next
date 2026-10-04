"""Concurrency gates for llama.cpp generation and rdkit molecule rendering.

Why this exists
---------------
Every llama.cpp container runs without `--parallel`, so each one serves exactly
**one** slot. llama.cpp does not queue: a second concurrent request against a
single-slot server is refused or made to wait by llama.cpp itself, and from the
gateway's point of view that is an opaque 500. Meanwhile the web tier happily
accepts unbounded concurrent requests, so under load the failure surfaces as
intermittent "model unavailable" errors rather than a clean signal.

This module makes the real ceiling explicit:

* one :class:`asyncio.Semaphore` per model service, keyed by resolved base URL,
  sized to that service's actual slot count;
* a **bounded** wait, so a burst queues instead of failing;
* on expiry, a typed :class:`QueueTimeoutError` so the caller can degrade the way
  that endpoint's contract requires (soft-200 for buffered chat, 429 for SSE);
* a separate gate for rdkit, which is CPU/memory-bound and never touches
  llama.cpp;
* warmup on its own low-priority allowance so pre-warming cannot steal the last
  slot from a real user request.

The wait is reported back to the caller (:attr:`GateSlot.waited_seconds`) so the
caller can carve the queue wait *out* of its own generation budget instead of
letting the two stack additively and overrun the upstream HTTP deadline.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Dict, Optional

logger = logging.getLogger(__name__)


def _positive_int_env(name: str, default: int) -> int:
    """Read a positive int from the environment, falling back on nonsense."""
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("%s=%r is not an integer; using %s", name, raw, default)
        return default
    if value < 1:
        logger.warning("%s=%s must be >= 1; using %s", name, value, default)
        return default
    return value


def _non_negative_float_env(name: str, default: float) -> float:
    """Read a non-negative float from the environment."""
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("%s=%r is not a number; using %s", name, raw, default)
        return default
    if value < 0:
        logger.warning("%s=%s must be >= 0; using %s", name, value, default)
        return default
    return value


def _in_use(sem: asyncio.Semaphore, limit: int) -> int:
    """Permits currently held on ``sem``, given the limit it was built with.

    ``asyncio.Semaphore`` exposes no public occupancy counter (``_value`` is the
    only one, and it varies across Python versions), so the limit is threaded in
    explicitly rather than read back off the semaphore. Guarded with getattr so a
    future rename degrades to "unknown" instead of raising inside /api/health.
    """
    value = getattr(sem, "_value", None)
    if value is None:
        return 0
    return max(0, limit - value)


class QueueTimeoutError(Exception):
    """Raised when a bounded wait for a slot expires.

    Callers translate this into whatever their endpoint's contract demands rather
    than letting it surface as a 500.
    """

    def __init__(self, key: str, waited_seconds: float, limit: int):
        self.key = key
        self.waited_seconds = waited_seconds
        self.limit = limit
        super().__init__(
            f"no {key} slot became available within {waited_seconds:.1f}s "
            f"(limit {limit})"
        )


@dataclass
class GateSlot:
    """A held slot, plus how long acquiring it actually took."""

    key: str
    waited_seconds: float = 0.0
    warmup: bool = False


class GenerationGate:
    """A keyed set of semaphores with bounded waiting and priority warmup.

    Semaphores are created lazily and cached per key, because
    :class:`asyncio.Semaphore` binds to the running event loop on first use and
    this module is imported at module scope, before uvicorn starts its loop.
    """

    def __init__(
        self,
        name: str,
        limit: int,
        wait_seconds: float,
        warmup_limit: Optional[int] = None,
    ) -> None:
        self.name = name
        self.limit = limit
        self.wait_seconds = wait_seconds
        self.warmup_limit = warmup_limit or 1

        self._user: Dict[str, asyncio.Semaphore] = {}
        self._warmup: Dict[str, asyncio.Semaphore] = {}
        # Number of user requests currently queued for a key. Tracked explicitly
        # rather than read off asyncio internals (Semaphore._waiters is private),
        # so warmup can decline to start while real traffic is waiting.
        self._user_waiting: Dict[str, int] = {}
        self._peak_in_use: Dict[str, int] = {}
        self._timed_out = 0
        self._peak_waiters = 0
        # asyncio primitives bind to the loop that first awaits them. uvicorn runs
        # one loop for the process lifetime, so this is normally stable, but any
        # second loop in the same process (a test, a one-shot script, a reload)
        # would otherwise raise "is bound to a different event loop". Rebind
        # rather than crash.
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # -- internals ----------------------------------------------------
    def _sync_loop(self) -> None:
        """Drop cached semaphores if the running loop has changed."""
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._loop is None:
            self._loop = running
            return
        if self._loop is not running:
            logger.warning(
                "%s gate: event loop changed; rebuilding semaphores", self.name
            )
            self._loop = running
            self._user.clear()
            self._warmup.clear()
            # Waiter counts describe the old loop's in-flight requests, which no
            # longer exist; carrying them over would deadlock warmup.
            self._user_waiting.clear()

    def _user_sem(self, key: str) -> asyncio.Semaphore:
        self._sync_loop()
        sem = self._user.get(key)
        if sem is None:
            sem = asyncio.Semaphore(self.limit)
            self._user[key] = sem
        return sem

    def _warmup_sem(self, key: str) -> asyncio.Semaphore:
        self._sync_loop()
        sem = self._warmup.get(key)
        if sem is None:
            sem = asyncio.Semaphore(self.warmup_limit)
            self._warmup[key] = sem
        return sem

    def _note_waiter_peak(self, key: str) -> None:
        waiting = self._user_waiting.get(key, 0)
        if waiting > self._peak_waiters:
            self._peak_waiters = waiting

    # -- public API ---------------------------------------------------
    async def acquire(
        self,
        key: str,
        *,
        warmup: bool = False,
        wait_seconds: Optional[float] = None,
    ) -> GateSlot:
        """Acquire a slot, waiting at most ``wait_seconds``.

        Raises :class:`QueueTimeoutError` when the wait expires. On that path no
        slot is held and the caller must not release one.
        """
        budget = self.wait_seconds if wait_seconds is None else max(0.0, float(wait_seconds))
        started = time.monotonic()
        sem = self._warmup_sem(key) if warmup else self._user_sem(key)

        if not warmup:
            self._user_waiting[key] = self._user_waiting.get(key, 0) + 1
            self._note_waiter_peak(key)

        acquired = False
        try:
            if budget <= 0:
                acquired = sem.locked() is False
                if not acquired:
                    raise QueueTimeoutError(key, 0.0, self.warmup_limit if warmup else self.limit)
                waited = 0.0
            else:
                try:
                    # shield() is deliberately NOT used: when the wait times out we
                    # really do want to give the slot up, not keep it queued.
                    await asyncio.wait_for(sem.acquire(), timeout=budget)
                    acquired = True
                except asyncio.TimeoutError:
                    raise QueueTimeoutError(
                        key, time.monotonic() - started,
                        self.warmup_limit if warmup else self.limit,
                    ) from None
                waited = time.monotonic() - started

            # Warmup holds its own semaphore but must still respect the shared
            # single-slot reality: if real traffic is queued or already running,
            # give the slot to them and let warmup retry on the next poll.
            if warmup and not self._may_warmup(key):
                sem.release()
                acquired = False
                raise QueueTimeoutError(key, waited, self.warmup_limit)

            self._peak_in_use[key] = max(
                self._peak_in_use.get(key, 0), _in_use(sem, self.limit)
            )
            return GateSlot(key=key, waited_seconds=waited, warmup=warmup)
        finally:
            if not warmup:
                self._user_waiting[key] = max(0, self._user_waiting.get(key, 1) - 1)
            if not acquired:
                self._timed_out += 1

    def _may_warmup(self, key: str) -> bool:
        """Warmup may start only when no user request is queued or in flight."""
        if self._user_waiting.get(key, 0) > 0:
            return False
        return not self._user_sem(key).locked()

    def release(self, key: str, *, warmup: bool = False) -> None:
        sem = self._warmup_sem(key) if warmup else self._user_sem(key)
        sem.release()

    @asynccontextmanager
    async def slot(
        self,
        key: str,
        *,
        warmup: bool = False,
        wait_seconds: Optional[float] = None,
    ) -> AsyncIterator[GateSlot]:
        """Context manager form; releases on exit, including on exception."""
        held = await self.acquire(key, warmup=warmup, wait_seconds=wait_seconds)
        try:
            yield held
        finally:
            self.release(key, warmup=warmup)

    def snapshot(self) -> dict:
        """Observability payload for /api/health and contract tests."""
        return {
            "name": self.name,
            "limit": self.limit,
            "warmup_limit": self.warmup_limit,
            "wait_seconds": self.wait_seconds,
            "timed_out": self._timed_out,
            "peak_waiters": self._peak_waiters,
            "in_use": {key: _in_use(sem, self.limit) for key, sem in self._user.items()},
            "waiting": dict(self._user_waiting),
            "peak_in_use": dict(self._peak_in_use),
        }


# ---------------------------------------------------------------------------
# Module-level gates
# ---------------------------------------------------------------------------
#
# Keys are resolved base URLs (llama-minilm, llama-lfm, llama-gemma,
# llama-vision-lfm2-vl), not model filenames, so that any two routes aimed at the
# same llama.cpp container contend for the same single slot.

MODEL_GATE = GenerationGate(
    name="llama",
    limit=_positive_int_env("AI_MAX_CONCURRENCY_PER_MODEL", 1),
    wait_seconds=_non_negative_float_env("AI_QUEUE_WAIT_SECONDS", 20.0),
    warmup_limit=_positive_int_env("AI_WARMUP_MAX_CONCURRENCY", 1),
)

MOLECULE_GATE = GenerationGate(
    name="molecule",
    # rdkit 3D embedding is memory-hungry (ETKDGv3 conformer search), so this is
    # deliberately small: it bounds resident memory, not throughput. The work is
    # moved off the event loop, so more than one is safe to run at a time.
    limit=_positive_int_env("AI_MAX_CONCURRENCY_MOLECULE", 2),
    wait_seconds=_non_negative_float_env("AI_MOLECULE_QUEUE_WAIT_SECONDS", 10.0),
    warmup_limit=1,
)


def budget_after_queue_wait(total_seconds: float, waited_seconds: float) -> float:
    """Carve queue wait *out of* a generation budget rather than adding to it.

    Phase D constraint: the queued request must finish inside the same wall-clock
    envelope as before, because the upstream HTTP deadline
    (``PYTHON_CHAT_TIMEOUT_MS``, 330s) is fixed and queue wait is additive. If a
    request sat 18s in the queue it must generate for 300-18s, not 300s, so the
    total stays bounded instead of turning graceful degradation into a hard 504.

    Floored at 5s so a request that waited almost the entire budget still gets a
    real attempt rather than an instant failure.
    """
    remaining = float(total_seconds) - float(waited_seconds)
    return max(5.0, remaining)
