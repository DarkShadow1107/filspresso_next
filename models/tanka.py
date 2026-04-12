"""
Tanka - Filspresso AI Model

Runtime facade for text and vision inference through llama.cpp-compatible
OpenAI endpoints. The public API remains compatible with app.py.
"""

import base64
import logging
import os
import re
from typing import Any

import requests

logger = logging.getLogger(__name__)

TEXT_MODEL_MINILM = "MiniLM-L6-v2.gguf"
TEXT_MODEL_QWEN = "Qwen3-0.6B-Q8_0.gguf"
TEXT_MODEL_GEMMA = "Gemma3-1B-it-Q4_0.gguf"

VISION_MODEL_QWEN3_VL = "Qwen3-VL-2B-Q4_0.gguf"

TEXT_MODEL_TAGS = {
    TEXT_MODEL_MINILM: "MiniLM V2 access",
    TEXT_MODEL_QWEN: "Qwen 3 access",
    TEXT_MODEL_GEMMA: "Gemma 3 access",
}

VISION_MODEL_TAGS = {
    VISION_MODEL_QWEN3_VL: "Qwen 3 Vision access",
}

MODE_DISPLAY_NAMES = {
    "natural_language": "Semantic",
    "chemistry": "Chemistry",
}

VALID_MODES = list(MODE_DISPLAY_NAMES.keys())


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

        self._llama_base_url = (os.getenv("LLAMA_CPP_BASE_URL", "http://llama-cpp:8080") or "").strip()
        self._llama_timeout_seconds = max(15, int(os.getenv("LLAMA_CPP_TIMEOUT_SECONDS", "180") or 180))
        self._llama_api_key = (os.getenv("LLAMA_CPP_API_KEY", "") or "").strip()
        self._health_base_url = self._llama_base_url

        self._default_text_model = (
            os.getenv("LLAMA_CPP_MODEL", TEXT_MODEL_QWEN) or TEXT_MODEL_QWEN
        ).strip()
        self._default_vision_model = (
            os.getenv("LLAMA_CPP_VISION_MODEL", VISION_MODEL_QWEN3_VL) or VISION_MODEL_QWEN3_VL
        ).strip()

        # Per-model endpoints let us run dedicated llama.cpp containers for each GGUF.
        self._text_model_base_urls = {
            TEXT_MODEL_MINILM: (os.getenv("LLAMA_CPP_MINILM_BASE_URL", "http://llama-minilm:8080") or "").strip(),
            TEXT_MODEL_QWEN: (os.getenv("LLAMA_CPP_QWEN_BASE_URL", "http://llama-qwen:8080") or "").strip(),
            TEXT_MODEL_GEMMA: (os.getenv("LLAMA_CPP_GEMMA_BASE_URL", "http://llama-gemma:8080") or "").strip(),
        }
        self._vision_model_base_urls = {
            VISION_MODEL_QWEN3_VL: (os.getenv("LLAMA_CPP_QWEN3_VL_BASE_URL", "http://llama-vision-qwen3-vl:8080") or "").strip(),
        }

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

    def _llama_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._llama_api_key:
            headers["Authorization"] = f"Bearer {self._llama_api_key}"
        return headers

    def _resolve_model_base_url(self, model_name: str, vision: bool = False) -> str:
        table = self._vision_model_base_urls if vision else self._text_model_base_urls
        if model_name in table and table[model_name]:
            return table[model_name]

        lowered = (model_name or "").strip().lower()
        for key, value in table.items():
            if key.lower() == lowered and value:
                return value

        return self._llama_base_url

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
        tag = TEXT_MODEL_TAGS.get(model_name, "Kafelot text access")
        if model_name == TEXT_MODEL_QWEN and thinking:
            return "Qwen 3 Thinking access"
        return tag

    def _vision_model_tag(self, model_name: str) -> str:
        return VISION_MODEL_TAGS.get(model_name, "Kafelot vision access")

    # ------------------------------------------------------------------
    # Runtime health + OpenAI-compatible calls
    # ------------------------------------------------------------------

    def _load_qwen(self):
        """
        Compatibility wrapper.
        We keep qwen_* naming in status fields to avoid changing app.py contracts.
        """
        try:
            self._health_base_url = self._resolve_model_base_url(self._default_text_model, vision=False)
            response = requests.get(
                self._llama_models_url(self._health_base_url),
                timeout=min(8, self._llama_timeout_seconds),
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

    def _llama_generate_text(
        self,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        max_new_tokens: int,
        thinking_enabled: bool,
    ) -> str:
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max(64, min(max_new_tokens, 8192)),
            "temperature": 0.45 if thinking_enabled else 0.65,
            "top_p": 0.9,
            "stream": False,
        }
        base_url = self._resolve_model_base_url(model_name, vision=False)

        response = requests.post(
            self._llama_chat_url(base_url),
            json=payload,
            headers=self._llama_headers(),
            timeout=self._llama_timeout_seconds,
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
        choices = body.get("choices")
        if not choices:
            raise RuntimeError("llama.cpp returned no choices")

        message = choices[0].get("message") or {}
        content = (message.get("content") or "").strip()
        if not content:
            raise RuntimeError("llama.cpp returned empty content")

        return self._strip_think_block(content)

    def _llama_generate_vision_text(
        self,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        image_bytes: bytes,
        max_new_tokens: int = 512,
    ) -> str:
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        image_url = f"data:image/png;base64,{image_b64}"

        payload = {
            "model": model_name,
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
        }
        base_url = self._resolve_model_base_url(model_name, vision=True)

        response = requests.post(
            self._llama_chat_url(base_url),
            json=payload,
            headers=self._llama_headers(),
            timeout=self._llama_timeout_seconds,
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
        choices = body.get("choices")
        if not choices:
            raise RuntimeError("llama.cpp vision request returned no choices")

        message = choices[0].get("message") or {}
        content = (message.get("content") or "").strip()
        if not content:
            raise RuntimeError("llama.cpp vision request returned empty content")

        return self._strip_think_block(content)

    # ------------------------------------------------------------------
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

    def generate_coffee_text(
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

        self._load_qwen()
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
            text = self._llama_generate_text(
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

    def generate_chemistry_text(
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

        self._load_qwen()
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
            text = self._llama_generate_text(
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

    def describe_image(
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
        self._load_qwen()

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
            text = self._llama_generate_vision_text(
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

    def qwen_status(self) -> dict:
        self._load_qwen()
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
