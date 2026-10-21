"""
Tanka - Filspresso AI Model

Runtime facade for text and vision inference through llama.cpp-compatible
OpenAI endpoints. The public API remains compatible with app.py.
"""

import base64
import asyncio
import json
import logging
import os
import re
import struct
import time
import zlib
from typing import Any

import httpx

from models.residency import ModelResidencyCoordinator, router_model_id

logger = logging.getLogger(__name__)

TEXT_MODEL_230M = "LFM2.5-230M-Q4_K_M.gguf"
TEXT_MODEL_350M = "LFM2.5-350M-Q8_0.gguf"
TEXT_MODEL_1_2B_INSTRUCT = "LFM2.5-1.2B-Instruct-Q4_K_M.gguf"
TEXT_MODEL_1_2B_THINKING = "LFM2.5-1.2B-Thinking-Q4_K_M.gguf"
TEXT_MODEL_2_6B = "LFM2.5-2.6B-Q4_0.gguf"
TEXT_MODEL_8B = "LFM2.5-8B-A1B-Q4_K_M.gguf"

VISION_MODEL_450M = "LFM2.5-VL-450M-Q4_K_M.gguf"
VISION_MODEL_3B = "LFM2.5-VL-3B-Q4_K_M.gguf"

AUDIO_MODEL_1_5B = "LFM2.5-Audio-1.5B-Q4_0.gguf"

# Still loaded, but only as the internal coffee_facts retrieval embedder. It is
# not offered as a chat model: LFM2.5 230M replaced it for the Free plan.
TEXT_MODEL_MINILM = "MiniLM-L6-v2.gguf"

# The context the Kafelot chat runs with.
#
# The models are served with 128K and the Playground uses all of it. The coffee
# chat is a different surface -- a question, five retrieved facts and an answer
# -- and it is capped at 32K so the answer's share of the context is predictable
# and the two surfaces do not end up sharing one number.
KAFELOT_CHAT_CONTEXT_TOKENS = 32_768

# Characters per token, used to estimate how large a prompt is.
#
# Deliberately pessimistic: over-estimating a prompt truncates it early, which
# is the safe direction, while under-estimating would let a request past the
# cap it is supposed to be under.
_CHARS_PER_TOKEN = 3


def _estimate_tokens(text: str) -> int:
    """Roughly how many tokens ``text`` is worth."""
    return max(0, len(text or "") // _CHARS_PER_TOKEN)

# A warmup request only has to be big enough for the vision preprocessor to
# accept it. A 1x1 PNG reliably aborts the mmproj graph inside llama.cpp, so
# the smallest safe side is used instead.
WARMUP_VISION_PNG_SIZE = 64


def _base_url(env_name: str, default: str) -> str:
    """Read one llama.cpp endpoint from the environment."""
    return (os.getenv(env_name, default) or "").strip()


def _build_solid_png(size: int, rgb: tuple[int, int, int] = (128, 128, 128)) -> bytes:
    """Build a dependency-free solid-colour PNG used to trigger model load."""
    width = max(1, int(size))
    height = max(1, int(size))
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )

TEXT_MODEL_TAGS = {
    TEXT_MODEL_230M: "LFM 2.5 230M access",
    TEXT_MODEL_350M: "LFM 2.5 350M access",
    TEXT_MODEL_1_2B_INSTRUCT: "LFM 2.5 1.2B Instruct access",
    TEXT_MODEL_1_2B_THINKING: "LFM 2.5 1.2B Thinking access",
    TEXT_MODEL_2_6B: "LFM 2.5 2.6B access",
    TEXT_MODEL_8B: "LFM 2.5 8B A1B access",
}

VISION_MODEL_TAGS = {
    VISION_MODEL_450M: "LFM 2.5 VL 450M access",
    VISION_MODEL_3B: "LFM 2.5 VL 3B access",
}

AUDIO_MODEL_TAGS = {
    AUDIO_MODEL_1_5B: "LFM 2.5 Audio 1.5B access",
}

MODE_DISPLAY_NAMES = {
    "natural_language": "Semantic",
    "chemistry": "Chemistry",
}

VALID_MODES = list(MODE_DISPLAY_NAMES.keys())


def _model_unavailable_error(model_name: str, base_url: str, exc: Exception) -> Exception:
    """Translate a transport failure into a message that is actionable for a user.

    Without this a model whose llama.cpp service is not running surfaced the raw
    resolver error verbatim -- "[Errno -5] No address associated with hostname" --
    which tells the reader nothing. The heavy models (2.6B, 8B, VL 3B) live
    behind the `large` compose profile, so "service not started" is an expected
    state rather than an outage, and the message says so.
    """
    host = base_url.replace("http://", "").replace("https://", "").split("/")[0]
    if isinstance(exc, httpx.ConnectError):
        return RuntimeError(
            f"Model {model_name} is not currently served at {host}. "
            "Its llama.cpp service may not be running; start it with "
            "`docker compose --profile large up -d`."
        )
    return exc


def _read_usage(body: Any) -> dict[str, int]:
    """Pull token counts out of an OpenAI-compatible completion body.

    Returns zeroes when the block is absent or malformed rather than raising: the
    generation already succeeded, and failing the request because the billing metadata
    was missing would be a worse outcome than recording a zero.

    A cached prompt is still billable input here, so `prompt_tokens_details.cached_tokens`
    is folded in rather than discarded -- reading only the top-level count would
    under-charge every cached turn.
    """
    zero = {"prompt_tokens": 0, "completion_tokens": 0}
    if not isinstance(body, dict):
        return zero
    usage = body.get("usage")
    if not isinstance(usage, dict):
        return zero

    def _count(value: Any) -> int:
        try:
            n = int(value)
        except (TypeError, ValueError):
            return 0
        return n if n > 0 else 0

    details = usage.get("prompt_tokens_details")
    cached = _count(details.get("cached_tokens")) if isinstance(details, dict) else 0
    prompt = _count(usage.get("prompt_tokens"))
    if prompt == 0 and cached:
        prompt = cached

    return {"prompt_tokens": prompt, "completion_tokens": _count(usage.get("completion_tokens"))}


class TankaModel:
    """
    Tanka runtime facade.

    - Text generation: llama.cpp/OpenAI-compatible endpoint
    - Vision generation: llama.cpp/OpenAI-compatible endpoint
    - Lexical fallback remains available in app.py when runtime is unavailable
    """

    def __init__(self):
        # Legacy local embedding/image runtimes were removed from this service.
        self._nlp_status = "removed"
        self._nlp_error = "legacy-minilm-clip-molscribe-removed"

        # Kept for health payload compatibility.
        self._qwen_model = None
        self._qwen_tokenizer = None
        self._qwen_status = "not_attempted"
        self._qwen_error = ""

        self._last_chemistry_text_model = "llama.cpp-unavailable-chemistry-high-demand"
        self._last_coffee_text_model = "llama.cpp-fallback-coffee"
        self._last_qwen_generation_mode = "non-thinking"
        self._last_vision_model = ""

        # Token counts for the most recent generation, for billing.
        #
        # llama.cpp returns a standard OpenAI-compatible `usage` block and it was being
        # parsed and thrown away, so there was no way to meter a request even in
        # principle. This is the only place the gateway learns what a generation cost, so
        # it is cleared before every generation and set from that response.
        self._last_usage = {"prompt_tokens": 0, "completion_tokens": 0}

        self._llama_base_url = (os.getenv("LLAMA_CPP_BASE_URL", "http://llama-cpp:8080") or "").strip()
        self._llama_timeout_seconds = max(15, int(os.getenv("LLAMA_CPP_TIMEOUT_SECONDS", "180") or 180))
        self._llama_api_key = (os.getenv("LLAMA_CPP_API_KEY", "") or "").strip()
        self._health_base_url = self._llama_base_url

        self._default_text_model = (
            os.getenv("LLAMA_CPP_MODEL", TEXT_MODEL_230M) or TEXT_MODEL_230M
        ).strip()
        self._default_vision_model = (
            os.getenv("LLAMA_CPP_VISION_MODEL", VISION_MODEL_450M) or VISION_MODEL_450M
        ).strip()
        self._default_audio_model = (
            os.getenv("LLAMA_CPP_AUDIO_MODEL", AUDIO_MODEL_1_5B) or AUDIO_MODEL_1_5B
        ).strip()

        # Per-model endpoints let us run dedicated llama.cpp containers for each
        # GGUF. Every llama.cpp service has exactly one slot, so this mapping is
        # also what the concurrency gate keys on: two models pointed at the same
        # URL would contend for the same single slot.
        # Every chat GGUF is served by the SAME llama.cpp router, which keeps one
        # model resident at a time (--models-max 1) and swaps on demand. That means
        # one endpoint for all nine, and -- critically -- that the concurrency gate
        # can no longer key on the URL: nine models behind one URL would collapse
        # into a single slot. Admission is keyed on the MODEL instead, via
        # models/residency.py.
        #
        # MiniLM is the one exception: it is the coffee_facts retrieval embedder,
        # not a chat model, and it stays resident on its own server so the semantic
        # retrieval path never triggers a swap.
        chat_base_url = _base_url("LLAMA_CPP_CHAT_BASE_URL", "http://llama-lfm:8080")
        self._model_base_urls = {
            TEXT_MODEL_230M: chat_base_url,
            TEXT_MODEL_350M: chat_base_url,
            TEXT_MODEL_1_2B_INSTRUCT: chat_base_url,
            TEXT_MODEL_1_2B_THINKING: chat_base_url,
            TEXT_MODEL_2_6B: chat_base_url,
            TEXT_MODEL_8B: chat_base_url,
            VISION_MODEL_450M: chat_base_url,
            VISION_MODEL_3B: chat_base_url,
            AUDIO_MODEL_1_5B: chat_base_url,
            TEXT_MODEL_MINILM: _base_url("LLAMA_CPP_MINILM_BASE_URL", "http://llama-minilm:8080"),
        }
        self._text_model_base_urls = {
            name: url for name, url in self._model_base_urls.items() if name in TEXT_MODEL_TAGS
        }
        self._vision_model_base_urls = {
            name: url for name, url in self._model_base_urls.items() if name in VISION_MODEL_TAGS
        }
        self._audio_model_base_urls = {
            name: url for name, url in self._model_base_urls.items() if name in AUDIO_MODEL_TAGS
        }

        # One pooled client for the whole process. httpx opens its pool
        # lazily, so constructing it here is safe; aclose() releases it at
        # shutdown.
        self._client = httpx.AsyncClient()

        # Residency coordinator for the shared chat router. Owns which model is
        # loaded, drives asynchronous swaps, and admits generation requests with a
        # per-model concurrency limit. See models/residency.py for why this is not
        # a plain per-URL semaphore.
        self.residency = ModelResidencyCoordinator(
            _base_url("LLAMA_CPP_CHAT_BASE_URL", "http://llama-lfm:8080")
        )

        # Per-model load state for the /api/warmup endpoint. llama.cpp only
        # reports the server via /v1/models, so residency is only knowable by
        # issuing a request, which is exactly what warmup_model does.
        self._warmup_lock = asyncio.Lock()
        self._warmup_state: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Lexical fallback compatibility
    # ------------------------------------------------------------------

    def _load_nlp(self):
        # Legacy sentence-transformers runtime is intentionally removed.
        self._nlp_status = "removed"
        self._nlp_error = "legacy-minilm-clip-molscribe-removed"

    def encode(self, text: str) -> list | None:
        _ = text
        self._load_nlp()
        return None

    def nlp_status(self) -> dict:
        return {
            "status": self._nlp_status,
            "backend": "Lexical fallback (legacy MiniLM embedding runtime removed)",
            "loaded": False,
            "error": self._nlp_error,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _soft_thinking_override(self, prompt: str) -> tuple[str, bool | None]:
        text = (prompt or "").strip()
        if not text:
            return "", None

        directives = list(re.finditer(r"(?i)(/no_think|/think)", text))
        if not directives:
            return text, None

        last_directive = directives[-1].group(1).lower()
        override = last_directive == "/think"
        cleaned = re.sub(r"(?i)\s*(/no_think|/think)\s*", " ", text)
        cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
        return cleaned or text, override

    def _strip_think_block(self, text: str) -> str:
        if not text:
            return ""

        full = text.strip()
        lower = full.lower()
        if "</think>" in lower:
            match = re.search(r"</think>", full, flags=re.IGNORECASE)
            if match:
                return full[match.end():].strip()

        if "<think>" in lower and "</think>" not in lower:
            return re.sub(r"(?is)<think>.*$", "", full).strip()

        return full

    def _request_timeout(self) -> httpx.Timeout:
        """Connect/read timeout for a blocking-shaped llama.cpp call."""
        return httpx.Timeout(float(self._llama_timeout_seconds))

    async def aclose(self) -> None:
        """Release the pooled HTTP client and the residency coordinator."""
        await self.residency.aclose()
        await self._client.aclose()

    @property
    def last_usage(self) -> dict[str, int]:
        """Token counts for the most recent generation. Zeroes when unavailable.

        Read immediately after a generate call. Reset per request, so a caller that
        forgets to read it gets zeroes rather than someone else's numbers.
        """
        return dict(self._last_usage)

    def _llama_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._llama_api_key:
            headers["Authorization"] = f"Bearer {self._llama_api_key}"
        return headers

    def _resolve_model_base_url(self, model_name: str, vision: bool = False, audio: bool = False) -> str:
        """Resolve a GGUF to the llama.cpp service hosting it.

        `vision`/`audio` only disambiguate the caller's intent for logging; the
        lookup itself is a single table, because a GGUF name is globally unique
        across the lineup.
        """
        del vision, audio  # kept for call-site clarity
        table = self._model_base_urls
        if model_name in table and table[model_name]:
            return table[model_name]

        lowered = (model_name or "").strip().lower()
        for key, value in table.items():
            if key.lower() == lowered and value:
                return value

        return self._llama_base_url

    def service_key(self, model_name: str, vision: bool = False) -> str:
        """Admission key for a model.

        This used to be the host:port of the llama.cpp service, which was unique
        per model when each model had its own container. All nine chat models now
        share one router, so the URL no longer identifies anything: keying on it
        would put every model behind one semaphore and serialise the whole
        lineup. The model filename is the correct key, and
        models/residency.py adds the rule that only one *distinct* model may be
        in use at a time, because a swap evicts the resident model.
        """
        del vision
        return (model_name or "").strip() or self._default_text_model

    def _llama_chat_url(self, base_url: str | None = None) -> str:
        base = (base_url or self._llama_base_url).rstrip("/")
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        return f"{base}/v1/chat/completions"

    def _llama_models_url(self, base_url: str | None = None) -> str:
        base = (base_url or self._llama_base_url).rstrip("/")
        if base.endswith("/v1"):
            return f"{base}/models"
        return f"{base}/v1/models"

    def _resolve_text_model_name(self, model_name: str | None) -> str:
        candidate = (model_name or "").strip()
        return candidate or self._default_text_model

    def _resolve_vision_model_name(self, model_name: str | None) -> str:
        candidate = (model_name or "").strip()
        return candidate or self._default_vision_model

    def _text_model_tag(self, model_name: str, thinking: bool = False) -> str:
        """Display tag for a text model.

        Thinking is a separate GGUF (LFM2.5-1.2B-Thinking) rather than a flag on
        a larger model, so the tag comes from the model identity. The `thinking`
        argument is still honoured because LFM 2.5 emits `reasoning_content` even
        when reasoning is switched off, and the UI labels what the user sees.
        """
        tag = TEXT_MODEL_TAGS.get(model_name, "Kafelot text access")
        if model_name == TEXT_MODEL_1_2B_THINKING:
            return f"{tag} (thinking)"
        if thinking and model_name == TEXT_MODEL_2_6B:
            return "LFM 2.5 2.6B access (thinking)"
        return tag

    def _vision_model_tag(self, model_name: str) -> str:
        return VISION_MODEL_TAGS.get(model_name, "Kafelot vision access")

    def _audio_model_tag(self, model_name: str) -> str:
        return AUDIO_MODEL_TAGS.get(model_name, "Kafelot audio access")

    # ------------------------------------------------------------------
    # Runtime health + OpenAI-compatible calls
    # ------------------------------------------------------------------

    async def _load_qwen(self):
        """
        Compatibility wrapper.
        We keep qwen_* naming in status fields to avoid changing app.py contracts.
        """
        try:
            self._health_base_url = self._resolve_model_base_url(self._default_text_model, vision=False)
            response = await self._client.get(
                self._llama_models_url(self._health_base_url),
                timeout=httpx.Timeout(min(8, self._llama_timeout_seconds)),
                headers=self._llama_headers(),
            )
            response.raise_for_status()
            self._qwen_status = "ready"
            self._qwen_error = ""
            self._qwen_model = "llama.cpp"
            self._qwen_tokenizer = "server-side"
        except Exception as exc:
            self._qwen_status = "unavailable"
            self._qwen_error = str(exc)
            self._qwen_model = None
            self._qwen_tokenizer = None

    async def _llama_generate_text(
         self,
         model_name: str,
         system_prompt: str,
         user_prompt: str,
         max_new_tokens: int,
         thinking_enabled: bool,
       ) -> str:
        # Cleared before the call, so a failure leaves zeroes rather than the previous
        # request's numbers -- which would bill the wrong exchange.
        self._last_usage = {"prompt_tokens": 0, "completion_tokens": 0}
        # The Kafelot chat runs with 32K of context.
        #
        # The models themselves are served with 128K, and the Playground uses all
        # of it. This surface is a coffee helper: a question, five retrieved facts
        # and an answer. Capping it at 32K keeps the answer's share of the context
        # predictable, and stops the two surfaces from sharing one number.
        prompt_tokens = _estimate_tokens(system_prompt) + _estimate_tokens(user_prompt)
        if prompt_tokens >= KAFELOT_CHAT_CONTEXT_TOKENS:
            # The prompt alone is over the cap. The question is at the end of it, so
            # the end is what is kept.
            keep = KAFELOT_CHAT_CONTEXT_TOKENS * _CHARS_PER_TOKEN
            user_prompt = user_prompt[-keep:]
            prompt_tokens = _estimate_tokens(system_prompt) + _estimate_tokens(user_prompt)
        reply_budget = max(64, KAFELOT_CHAT_CONTEXT_TOKENS - prompt_tokens)
        payload = {
            "model": router_model_id(model_name),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max(64, min(max_new_tokens, reply_budget, 8192)),
            "temperature": 0.45 if thinking_enabled else 0.65,
            "top_p": 0.9,
            "stream": False,
            # LFM 2.5 reasons by default, and without this it will spend the whole
            # token budget thinking and return an empty `content`, which the caller
            # would then discard as an error. `reasoning: off` is the per-request
            # switch; `chat_template_kwargs.enable_thinking` does not work here
            # because it leaves the <think> block inline in the content.
            "reasoning": "on" if thinking_enabled else "off",
        }
        base_url = self._resolve_model_base_url(model_name, vision=False)

        response = await self._client.post(
            self._llama_chat_url(base_url),
            json=payload,
            headers=self._llama_headers(),
            timeout=self._request_timeout(),
        )
        if response.status_code >= 400:
            detail = ""
            try:
                error_body = response.json()
                if isinstance(error_body, dict):
                    nested_error = error_body.get("error")
                    if isinstance(nested_error, dict):
                        detail = str(nested_error.get("message") or nested_error.get("type") or "").strip()
                    else:
                        detail = str(error_body.get("message") or "").strip()
            except Exception:
                detail = (response.text or "").strip()

            if detail:
                raise RuntimeError(f"llama.cpp text request failed: {detail}")
            response.raise_for_status()

        body: dict[str, Any] = response.json()
        self._last_usage = _read_usage(body)
        choices = body.get("choices")
        if not choices:
            raise RuntimeError("llama.cpp returned no choices")

        message = choices[0].get("message") or {}
        content = (message.get("content") or "").strip()
        if not content:
            # Some builds emit the whole answer as reasoning even when asked not to.
            # Better to surface that than to fail the request outright.
            content = (message.get("reasoning_content") or "").strip()
        if not content:
            raise RuntimeError("llama.cpp returned empty content")

        return self._strip_think_block(content)

    async def _llama_generate_vision_text(
        self,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        image_bytes: bytes,
        max_new_tokens: int = 512,
    ) -> str:
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        image_url = f"data:image/png;base64,{image_b64}"

        # Same reason as the text path: zeroes on failure, never the previous request's.
        self._last_usage = {"prompt_tokens": 0, "completion_tokens": 0}
        payload = {
            "model": router_model_id(model_name),
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                },
            ],
            "max_tokens": max(96, min(max_new_tokens, 2048)),
            "temperature": 0.25,
            "top_p": 0.9,
            "stream": False,
            # Image description is a short task; thinking would eat the budget.
            "reasoning": "off",
        }
        base_url = self._resolve_model_base_url(model_name, vision=True)

        response = await self._client.post(
            self._llama_chat_url(base_url),
            json=payload,
            headers=self._llama_headers(),
            timeout=self._request_timeout(),
        )
        if response.status_code >= 400:
            detail = ""
            try:
                error_body = response.json()
                if isinstance(error_body, dict):
                    nested_error = error_body.get("error")
                    if isinstance(nested_error, dict):
                        detail = str(nested_error.get("message") or nested_error.get("type") or "").strip()
                    else:
                        detail = str(error_body.get("message") or "").strip()
            except Exception:
                detail = (response.text or "").strip()

            if detail:
                raise RuntimeError(f"llama.cpp vision request failed: {detail}")
            response.raise_for_status()

        body: dict[str, Any] = response.json()
        self._last_usage = _read_usage(body)
        choices = body.get("choices")
        if not choices:
            raise RuntimeError("llama.cpp vision request returned no choices")

        message = choices[0].get("message") or {}
        content = (message.get("content") or "").strip()
        if not content:
            raise RuntimeError("llama.cpp vision request returned empty content")

        return self._strip_think_block(content)

    # ------------------------------------------------------------------
    # Streaming text generation (model playground)
    # ------------------------------------------------------------------

    async def stream_text(
        self,
        model_name: str,
        user_prompt: str,
        system_prompt: str | None = None,
        max_new_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.95,
        thinking_enabled: bool = False,
    ):
        """
        Yield ``(channel, text)`` pairs from llama.cpp's SSE endpoint.

        ``channel`` is ``"content"`` for the answer and ``"reasoning"`` for the
        model's thinking. Both are always yielded because LFM 2.5 emits its
        thinking into ``reasoning_content`` even when ``reasoning`` is ``off``;
        the caller decides whether to show it.

        Reasoning tokens count against ``max_new_tokens``, so a very small budget
        can be consumed entirely by thinking and leave ``content`` empty. Callers
        should use a realistic default (the Playground uses 512).
        """
        selected_model = self._resolve_text_model_name(model_name)
        base_url = self._resolve_model_base_url(selected_model, vision=False)

        messages: list[dict[str, str]] = []
        if system_prompt and system_prompt.strip():
            messages.append({"role": "system", "content": system_prompt.strip()})
        messages.append({"role": "user", "content": user_prompt})

        payload = {
            "model": router_model_id(selected_model),
            "messages": messages,
            # The Playground's reply-length steps are the context levels, and the
            # models are served with a 128K window, so a reply may be as long as
            # the top of the ladder. This used to stop at 8192, which silently
            # truncated a customer who asked for 16K.
            "max_tokens": max(1, min(int(max_new_tokens), 131_072)),
            "temperature": max(0.0, min(float(temperature), 2.0)),
            "top_p": max(0.0, min(float(top_p), 1.0)),
            "stream": True,
            # Ask for the usage block on the final frame. Without this a streamed
            # generation reports no token counts at all, so the Playground could not be
            # billed for work it had already done -- the buffered path had exactly this bug.
            "stream_options": {"include_usage": True},
            # Without this LFM 2.5 spends the whole budget thinking and emits an
            # empty content stream; `reasoning: off` is the working per-request
            # switch (chat_template_kwargs.enable_thinking does not work here).
            "reasoning": "on" if thinking_enabled else "off",
        }

        # A streaming response must not be killed by a whole-request read
        # timeout, so use a (connect, read) pair: generous connect, and a read
        # timeout long enough to cover a slow first token.
        timeout = httpx.Timeout(15.0, read=float(self._llama_timeout_seconds))

        # httpx has no `stream=True` kwarg; streaming is a context manager that
        # owns the response lifetime. This also means the connection is released
        # on early exit (client disconnect / generator close) without an explicit
        # close().
        try:
            async with self._client.stream(
                "POST",
                self._llama_chat_url(base_url),
                json=payload,
                headers=self._llama_headers(),
                timeout=timeout,
            ) as response:
                if response.status_code >= 400:
                    detail = await response.aread()
                    raise RuntimeError(
                        f"llama.cpp stream request failed: HTTP {response.status_code} {detail[:200]!r}"
                    )

                async for raw_line in response.aiter_lines():
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else str(raw_line)
                    if not line.startswith("data:"):
                        continue

                    data = line[5:].strip()
                    if data == "[DONE]":
                        break

                    try:
                        event = json.loads(data)
                    except ValueError:
                        continue

                    # The usage frame arrives last and carries no choices, so it has to be
                    # read before the choices check below would discard it. Yielded as its
                    # own channel rather than stashed on self: the buffered path keeps
                    # `last_usage` as instance state, which is fine for one request at a
                    # time but wrong the moment two streams interleave, and streams are
                    # exactly where that happens.
                    if isinstance(event.get("usage"), dict):
                        usage = _read_usage(event)
                        if usage["prompt_tokens"] or usage["completion_tokens"]:
                            yield ("usage", usage)

                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {})

                    # LFM 2.5 routes its thinking through `reasoning_content` even
                    # when `reasoning` is "off", so both channels must be read.
                    content = delta.get("content")
                    if content:
                        yield ("content", str(content))

                    reasoning = delta.get("reasoning_content")
                    if reasoning:
                        yield ("reasoning", str(reasoning))

        # ------------------------------------------------------------------
        except httpx.HTTPError as exc:
            # A model whose llama.cpp service is not running (the heavy models
            # sit behind the `large` compose profile) must not surface a raw
            # resolver error to the user.
            raise _model_unavailable_error(selected_model, base_url, exc) from exc

        # Text generation paths
        # ------------------------------------------------------------------

    def _chemistry_qwen_unavailable_text(self) -> str:
        return "Text chemistry is in high demand right now, we're sorry for unavailability."

    def chemistry_molscribe_unavailable_text(self) -> str:
        return "Molecule vision runtime is temporarily unavailable."

    def _fallback_coffee_text(self, user_prompt: str, context_facts: list[str] | None = None) -> str:
        facts = [f.strip() for f in (context_facts or []) if isinstance(f, str) and f.strip()]
        if facts:
            return (
                f"Here's what I can tell you about '{user_prompt.strip() or 'coffee'}':\n\n"
                f"{facts[0]}"
            )

        return (
            "I can help with coffee questions about capsules, brewing methods, roast levels, and flavor profiles. "
            "Ask for a recommendation and tell me if you prefer stronger, milder, fruity, or sweet notes."
        )

    async def generate_coffee_text(
        self,
        user_prompt: str,
        context_facts: list[str] | None = None,
        max_new_tokens: int = 768,
        enable_thinking: bool | None = None,
        text_model_name: str | None = None,
    ) -> str:
        cleaned_prompt, soft_override = self._soft_thinking_override(user_prompt)
        hard_thinking_enabled = True if enable_thinking is None else bool(enable_thinking)
        effective_thinking = hard_thinking_enabled
        if hard_thinking_enabled and soft_override is not None:
            effective_thinking = soft_override

        selected_model = self._resolve_text_model_name(text_model_name)
        self._last_qwen_generation_mode = "thinking" if effective_thinking else "non-thinking"
        selected_tag = self._text_model_tag(selected_model, effective_thinking)

        await self._load_qwen()
        if self._qwen_status != "ready":
            self._last_coffee_text_model = f"{selected_tag} (fallback)"
            return self._fallback_coffee_text(cleaned_prompt, context_facts=context_facts)

        facts = [f.strip() for f in (context_facts or []) if isinstance(f, str) and f.strip()]
        user_content = cleaned_prompt
        if facts:
            facts_block = "\n".join(f"- {fact}" for fact in facts[:5])
            user_content = (
                f"User question: {cleaned_prompt}\n\n"
                "Coffee knowledge context:\n"
                f"{facts_block}\n\n"
                "Use the context when relevant, but keep the answer natural and concise."
            )

        system_prompt = (
            "You are Kafelot Coffee Helper. Answer clearly and concisely about coffee, espresso, capsules, "
            "flavor profiles, intensity, and brewing. Give practical recommendations when useful."
        )

        try:
            text = await self._llama_generate_text(
                model_name=selected_model,
                system_prompt=system_prompt,
                user_prompt=user_content,
                max_new_tokens=max_new_tokens,
                thinking_enabled=effective_thinking,
            )
            self._last_coffee_text_model = selected_tag
            return text if text else self._fallback_coffee_text(cleaned_prompt, context_facts=context_facts)
        except Exception as exc:
            logger.warning("Tanka [Coffee Text]: llama.cpp generation failed for %s (%s)", selected_model, exc)
            self._last_coffee_text_model = f"{selected_tag} (fallback)"
            return self._fallback_coffee_text(cleaned_prompt, context_facts=context_facts)

    async def generate_chemistry_text(
        self,
        user_prompt: str,
        max_new_tokens: int = 1024,
        enable_thinking: bool | None = None,
        text_model_name: str | None = None,
    ) -> str:
        cleaned_prompt, soft_override = self._soft_thinking_override(user_prompt)
        hard_thinking_enabled = True if enable_thinking is None else bool(enable_thinking)
        effective_thinking = hard_thinking_enabled
        if hard_thinking_enabled and soft_override is not None:
            effective_thinking = soft_override

        selected_model = self._resolve_text_model_name(text_model_name)
        self._last_qwen_generation_mode = "thinking" if effective_thinking else "non-thinking"
        selected_tag = self._text_model_tag(selected_model, effective_thinking)

        await self._load_qwen()
        if self._qwen_status != "ready":
            self._last_chemistry_text_model = f"{selected_tag} unavailable"
            return self._chemistry_qwen_unavailable_text()

        system_prompt = (
            "You are Kafelot Molecule Helper. Answer chemistry and molecule questions clearly and concisely. "
            "If asked about compounds, provide practical and educational explanations about structure, functional "
            "groups, naming, and behavior in plain language."
        )
        user_content = cleaned_prompt or "Please explain this molecule."

        try:
            text = await self._llama_generate_text(
                model_name=selected_model,
                system_prompt=system_prompt,
                user_prompt=user_content,
                max_new_tokens=max_new_tokens,
                thinking_enabled=effective_thinking,
            )
            if text:
                self._last_chemistry_text_model = selected_tag
                return text

            self._last_chemistry_text_model = f"{selected_tag} unavailable"
            return self._chemistry_qwen_unavailable_text()
        except Exception as exc:
            logger.warning("Tanka [Chemistry Text]: llama.cpp generation failed for %s (%s)", selected_model, exc)
            self._last_chemistry_text_model = f"{selected_tag} unavailable"
            return self._chemistry_qwen_unavailable_text()

    # ------------------------------------------------------------------
    # Vision generation path
    # ------------------------------------------------------------------

    async def describe_image(
        self,
        image_bytes: bytes,
        candidates: list | None = None,
        vision_model_name: str | None = None,
        user_prompt: str | None = None,
        chemistry_mode: bool = False,
    ) -> dict:
        _ = candidates
        selected_vision_model = self._resolve_vision_model_name(vision_model_name)
        selected_vision_tag = self._vision_model_tag(selected_vision_model)
        await self._load_qwen()

        if self._qwen_status != "ready":
            raise RuntimeError("Vision runtime unavailable")

        if chemistry_mode:
            system_prompt = (
                "You are Kafelot Molecule Vision Helper. Analyze the uploaded chemistry image and provide a concise, "
                "practical explanation. If a molecule is visible, suggest likely identity or class and mention confidence "
                "qualitatively. Avoid claiming certainty when unclear."
            )
            prompt = (user_prompt or "Analyze this chemistry image and explain what is visible.").strip()
        else:
            system_prompt = (
                "You are Kafelot Vision Helper. Describe the uploaded image in concise practical terms, especially for "
                "coffee products, capsules, machines, or brewing context when relevant."
            )
            prompt = (user_prompt or "Describe this image clearly.").strip()

        try:
            text = await self._llama_generate_vision_text(
                model_name=selected_vision_model,
                system_prompt=system_prompt,
                user_prompt=prompt,
                image_bytes=image_bytes,
                max_new_tokens=512,
            )
            self._last_vision_model = selected_vision_model
            return {
                "text": text,
                "model_used": selected_vision_tag,
            }
        except Exception:
            raise

    def predict_molecule(self, image_bytes: bytes) -> dict:
        _ = image_bytes
        raise RuntimeError("Legacy MolScribe runtime is disabled; use vision model analysis instead")

    # ------------------------------------------------------------------
    # Status helpers
    # ------------------------------------------------------------------

    def coffee_text_model_used(self) -> str:
        return self._last_coffee_text_model

    def chemistry_text_model_used(self) -> str:
        return self._last_chemistry_text_model

    def qwen_generation_mode(self) -> str:
        return self._last_qwen_generation_mode

    # ------------------------------------------------------------------
    # Per-model warmup
    # ------------------------------------------------------------------

    @staticmethod
    def _warmup_key(model_name: str, vision: bool) -> str:
        return f"{'vision' if vision else 'text'}:{(model_name or '').strip()}"

    async def claim_warmup(self, model_name: str, vision: bool = False) -> tuple[dict[str, Any], bool]:
        """
        Reserve a slot for a load without performing it.

        Returns ``(state, claimed)``. ``claimed`` is False when a load is already
        in flight for this slot, which is how concurrent warmups are deduplicated.

        The route awaits this *before* scheduling the load task. Previously the
        load ran on a thread, so by the time the route read the state back the
        thread had usually set "warming"; with create_task the task has not run at
        all yet and the poll would have observed "unknown", a value the
        Playground hook does not recognise -- costing 30 x 2s of pointless polling.
        """
        resolved = self._resolve_warmup_model(model_name, vision)
        key = self._warmup_key(resolved, vision)

        async with self._warmup_lock:
            previous = self._warmup_state.get(key)
            if previous and previous.get("status") == "warming":
                return dict(previous), False

            self._warmup_state[key] = {
                "status": "warming",
                "model": router_model_id(resolved),
                "vision": bool(vision),
                "base_url": self._resolve_model_base_url(resolved, vision=vision),
                "started_at": time.time(),
                "ready_at": None,
                "duration_ms": None,
                "error": "",
            }
            return dict(self._warmup_state[key]), True

    def _resolve_warmup_model(self, model_name: str, vision: bool) -> str:
        resolved = (model_name or "").strip()
        if not resolved:
            return self._default_vision_model if vision else self._default_text_model
        return resolved

    async def warmup_model(
        self,
        model_name: str,
        vision: bool = False,
        claimed: bool = False,
    ) -> dict[str, Any]:
        """
        Force a model into a llama.cpp slot with the smallest possible request.

        Returns a state dict whose status is one of
        ``warming`` | ``ready`` | ``unavailable`` | ``deferred``.

        Pass ``claimed=True`` when the caller has already called
        :meth:`claim_warmup` to publish a "warming" state to pollers. Without it
        this method claims the slot itself for idempotency, and would then see its
        own "warming" state and return without ever issuing the load -- leaving the
        model reported as warming forever.
        """
        resolved = self._resolve_warmup_model(model_name, vision)
        key = self._warmup_key(resolved, vision)

        if claimed:
            state = self.warmup_status(resolved, vision=vision) or {}
        else:
            # Idempotent: a load already in flight for this slot is not stacked.
            state, did_claim = await self.claim_warmup(resolved, vision=vision)
            if not did_claim:
                return state

        try:
            await self._issue_warmup_request(resolved, vision=vision)
        except Exception as exc:
            logger.warning("Warmup failed for %s: %s", key, exc)
            async with self._warmup_lock:
                self._warmup_state[key] = {
                    **self._warmup_state[key],
                    "status": "unavailable",
                    "ready_at": time.time(),
                    "duration_ms": int((time.time() - state["started_at"]) * 1000),
                    "error": str(exc),
                }
            return dict(self._warmup_state[key])

        finished = time.time()
        async with self._warmup_lock:
            self._warmup_state[key] = {
                **self._warmup_state[key],
                "status": "ready",
                "ready_at": finished,
                "duration_ms": int((finished - state["started_at"]) * 1000),
                "error": "",
            }
        logger.info("Warmup completed for %s", key)
        return dict(self._warmup_state[key])

    async def _issue_warmup_request(self, model_name: str, vision: bool) -> None:
        base_url = self._resolve_model_base_url(model_name, vision=vision)

        if vision:
            image_url = "data:image/png;base64," + base64.b64encode(_build_solid_png(WARMUP_VISION_PNG_SIZE)).decode("ascii")
            content: Any = [
                {"type": "text", "text": "warmup"},
                {"type": "image_url", "image_url": {"url": image_url}},
            ]
        else:
            content = "warmup"

        payload = {
            "model": router_model_id(model_name),
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 1,
            "temperature": 0.0,
            "stream": False,
            "reasoning": "off",
        }

        # A cold load can take a while on CPU-offloaded models, so allow more
        # than the interactive timeout but still fail in bounded time.
        response = await self._client.post(
            self._llama_chat_url(base_url),
            json=payload,
            headers=self._llama_headers(),
            timeout=self._request_timeout(),
        )
        if response.status_code >= 400:
            raise RuntimeError(f"llama.cpp warmup request failed with HTTP {response.status_code}")

    def mark_warmup_deferred(self, model_name: str, vision: bool = False) -> dict[str, Any]:
        """Release a claimed warmup slot that was yielded to real traffic.

        Without this the entry stays at "warming" forever: claim_warmup refuses to
        re-claim a "warming" slot, so one deferred pre-warm would permanently stop
        that model from ever being warmed again. "deferred" is a terminal, honest
        state that useModelPrewarm settles on quietly.
        """
        resolved = self._resolve_warmup_model(model_name, vision)
        key = self._warmup_key(resolved, vision)
        previous = self._warmup_state.get(key)
        if previous and previous.get("status") == "warming":
            self._warmup_state[key] = {
                **previous,
                "status": "deferred",
                "ready_at": None,
                "duration_ms": None,
                "error": "",
            }
        return dict(self._warmup_state.get(key) or {})

    def warmup_status(self, model_name: str | None = None, vision: bool = False) -> dict[str, Any]:
        """
        Report known warmup state without issuing a request.

        Deliberately not locked and not async. This method performs no I/O and
        contains no await points, so there is nothing for an asyncio.Lock to
        serialise: on a single event loop a plain dict read cannot interleave
        with a writer. It stays sync so the GET /api/warmup poll path does not
        have to be async for no benefit.
        """
        if model_name:
            key = self._warmup_key(model_name, vision)
            state = self._warmup_state.get(key)
            return dict(state) if state else {"status": "unknown", "model": router_model_id(model_name), "vision": bool(vision)}

        return {
            "models": {key: dict(value) for key, value in self._warmup_state.items()},
        }

    async def qwen_status(self) -> dict:
        await self._load_qwen()
        return {
            "status": self._qwen_status,
            "backend": "llama.cpp server",
            "base_url": self._health_base_url,
            "default_text_model": self._default_text_model,
            "default_vision_model": self._default_vision_model,
            "text_model_endpoints": self._text_model_base_urls,
            "vision_model_endpoints": self._vision_model_base_urls,
            "loaded": self._qwen_status == "ready",
            "thinking_default": True,
            "soft_switch_tokens": ["/think", "/no_think"],
            "last_mode": self._last_qwen_generation_mode,
            "last_vision_model": self._last_vision_model,
            "error": self._qwen_error,
        }

    @staticmethod
    def display_name(mode: str) -> str:
        return MODE_DISPLAY_NAMES.get(mode, mode)

    @staticmethod
    def is_valid_mode(mode: str) -> bool:
        return mode in VALID_MODES
