"""
Tanka - Filspresso AI Model
A unified model with two modes:
    - natural_language: Lexical coffee retrieval handled in app layer.
                        Display name: "Semantic"
  - chemistry:        Uses MolScribe for organic molecule recognition from images.
                      Display name: "Chemistry"

Coffee helper text answers:
    - Tries local Qwen runtime first when model assets are available.
    - Falls back to MiniLM retrieval-backed response composition in app layer.

Molecule helper text answers:
    - Uses local Qwen runtime for text-only chemistry prompts.
    - Does not fall back to MiniLM.
    - Returns a high-demand unavailability message when Qwen is unavailable.

Image input handling:
  - Any mode + image:        CLIP (ViT-B/32) encodes/understands the image.
  - Chemistry mode + image:  MolScribe extracts the SMILES string from a molecule image.

Models are loaded lazily on first use.
"""

import torch
import re
import json
import shutil
import numpy as np
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Human-readable display names for each mode
MODE_DISPLAY_NAMES = {
    "natural_language": "Semantic",
    "chemistry": "Chemistry",
}

VALID_MODES = list(MODE_DISPLAY_NAMES.keys())

# Default CLIP candidate labels for general image description
_DEFAULT_CLIP_CANDIDATES = [
    "a cup of espresso coffee",
    "a coffee capsule or pod",
    "a coffee machine or espresso machine",
    "a molecule or chemical structure diagram",
    "food or beverage",
    "a person or human",
    "text or document",
    "nature or outdoor landscape",
    "a product or packaging",
    "an unknown or unrecognised object",
]


class TankaModel:
    """
    Tanka is a single AI model with two operating modes.
    Sub-models are loaded lazily on first use and cached in memory.
    """

    def __init__(self):
        self._nlp_model = None         # MiniLM fallback for semantic retrieval
        self._nlp_status = "not_attempted"
        self._nlp_error = ""
        self._clip_model = None        # CLIP ViT-B/32 (image understanding)
        self._clip_preprocess = None
        self._molscribe_model = None   # MolScribe (chemistry mode + image)
        self._qwen_model = None
        self._qwen_tokenizer = None
        self._last_chemistry_text_model = "qwen3-unavailable-chemistry-high-demand"
        self._last_coffee_text_model = "qwen3-fallback-coffee"
        self._qwen_status = "not_attempted"
        self._qwen_error = ""
        self._last_qwen_generation_mode = "thinking"
        self._qwen_model_dir = Path(__file__).parent / "qwen"
        self._qwen_conf_dir = Path(__file__).parent / "conf"
        self._qwen_legacy_model_dir = Path(__file__).parent / "model"
        self._qwen_safetensor_names = (
            "qwen3_06B.safetensors",
            "qwen3_06B_MLX_4_bit.safetensors",
            "model.safetensors",
        )
        self._qwen_safetensor = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # ------------------------------------------------------------------
    # MiniLM semantic fallback (natural-language mode retrieval)
    # ------------------------------------------------------------------

    def _load_nlp(self):
        """Best-effort MiniLM loader used as semantic fallback for retrieval."""
        if self._nlp_model is not None:
            return

        if self._nlp_status in {"load_failed", "unavailable"}:
            return

        try:
            from sentence_transformers import SentenceTransformer

            fine_tuned_path = Path(__file__).parent.parent / "models" / "fine_tuned_minilm"
            if fine_tuned_path.exists():
                logger.info("Tanka [Semantic]: loading fine-tuned MiniLM from %s", fine_tuned_path)
                self._nlp_model = SentenceTransformer(str(fine_tuned_path))
            else:
                logger.info("Tanka [Semantic]: loading base all-MiniLM-L6-v2")
                self._nlp_model = SentenceTransformer("all-MiniLM-L6-v2")

            self._nlp_status = "ready"
            self._nlp_error = ""
        except Exception as exc:
            self._nlp_status = "load_failed"
            self._nlp_error = str(exc)
            logger.warning("Tanka [Semantic]: MiniLM unavailable, lexical fallback enabled (%s)", exc)

    def encode(self, text: str) -> list | None:
        """Encode text to embedding vector using MiniLM when available."""
        self._load_nlp()
        if self._nlp_model is None:
            return None
        try:
            return self._nlp_model.encode(text).tolist()
        except Exception as exc:
            self._nlp_status = "load_failed"
            self._nlp_error = str(exc)
            logger.warning("Tanka [Semantic]: MiniLM encode failed, lexical fallback enabled (%s)", exc)
            return None

    def nlp_status(self) -> dict:
        return {
            "status": self._nlp_status,
            "backend": "MiniLM (all-MiniLM-L6-v2)",
            "loaded": self._nlp_model is not None,
            "error": self._nlp_error,
        }

    # ------------------------------------------------------------------
    # Qwen text runtime (coffee helper text answers)
    # ------------------------------------------------------------------

    def _qwen_dirs(self):
        return [self._qwen_model_dir, self._qwen_legacy_model_dir]

    def _list_qwen_safetensors(self, directory: Path) -> list[Path]:
        if not directory.exists():
            return []

        candidates: list[Path] = []
        for name in self._qwen_safetensor_names:
            preferred = directory / name
            if preferred.exists() and preferred not in candidates:
                candidates.append(preferred)

        for discovered in sorted(directory.glob("*.safetensors")):
            if discovered not in candidates:
                candidates.append(discovered)

        return candidates

    def _copy_if_exists(self, src: Path, dst: Path):
        if src.exists() and src != dst:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    def _prepare_qwen_runtime_dir(self) -> Path | None:
        """
        Build a runtime-ready local Qwen directory.

        - safetensor can come from models/qwen or legacy models/model
        - tokenizer/config can come from models/qwen, models/conf, or models/model
        """
        runtime_dir = self._qwen_model_dir
        runtime_dir.mkdir(parents=True, exist_ok=True)

        safetensor_source = self._resolve_qwen_safetensor_path()
        if safetensor_source is not None:
            safetensor_target = runtime_dir / safetensor_source.name
            if safetensor_source != safetensor_target and not safetensor_target.exists():
                self._copy_if_exists(safetensor_source, safetensor_target)

            # Transformers commonly expects model.safetensors naming.
            canonical_safetensor = runtime_dir / "model.safetensors"
            if safetensor_target.exists() and safetensor_target != canonical_safetensor and not canonical_safetensor.exists():
                self._copy_if_exists(safetensor_target, canonical_safetensor)

        metadata_sources = [runtime_dir, self._qwen_conf_dir, self._qwen_legacy_model_dir]
        metadata_files = [
            "config.json",
            "generation_config.json",
            "tokenizer.json",
            "tokenizer.model",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
            "special_tokens_map.json",
        ]
        for file_name in metadata_files:
            target_file = runtime_dir / file_name
            if target_file.exists():
                continue
            for source_dir in metadata_sources:
                source_file = source_dir / file_name
                if source_file.exists():
                    self._copy_if_exists(source_file, target_file)
                    break

        config_path = runtime_dir / "config.json"
        tokenizer_candidates = [runtime_dir / "tokenizer.json", runtime_dir / "tokenizer.model"]
        runtime_safetensors = self._list_qwen_safetensors(runtime_dir)
        if runtime_safetensors and config_path.exists() and any(p.exists() for p in tokenizer_candidates):
            return runtime_dir

        return None

    def _resolve_qwen_safetensor_path(self) -> Path | None:
        for directory in self._qwen_dirs():
            candidates = self._list_qwen_safetensors(directory)
            if candidates:
                return candidates[0]
        return None

    def _resolve_qwen_runtime_dir(self) -> Path | None:
        for directory in self._qwen_dirs():
            config_path = directory / "config.json"
            tokenizer_candidates = [
                directory / "tokenizer.json",
                directory / "tokenizer.model",
            ]
            safetensors = self._list_qwen_safetensors(directory)
            if safetensors and config_path.exists() and any(p.exists() for p in tokenizer_candidates):
                return directory
        return None

    def _normalize_qwen_config_for_transformers(self, runtime_dir: Path):
        """
        Qwen3 MLX exports may omit quant_method in quantization_config.
        Transformers expects it when quantization_config is present.
        """
        config_path = runtime_dir / "config.json"
        if not config_path.exists():
            return

        try:
            payload = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            return

        quantization = payload.get("quantization")
        quantization_config = payload.get("quantization_config")
        changed = False

        if isinstance(quantization_config, dict) and "quant_method" not in quantization_config:
            quantization_config["quant_method"] = "gptq"
            if isinstance(quantization, dict):
                quantization_config.setdefault("bits", quantization.get("bits", 4))
                quantization_config.setdefault("group_size", quantization.get("group_size", 128))
            else:
                quantization_config.setdefault("bits", 4)
                quantization_config.setdefault("group_size", 128)
            quantization_config.setdefault("desc_act", False)
            quantization_config.setdefault("sym", True)
            payload["quantization_config"] = quantization_config
            changed = True

        if changed:
            config_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def _remove_qwen_quantization_config(self, runtime_dir: Path):
        config_path = runtime_dir / "config.json"
        if not config_path.exists():
            return

        try:
            payload = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            return

        changed = False
        if "quantization_config" in payload:
            payload.pop("quantization_config", None)
            changed = True
        if "quantization" in payload:
            payload.pop("quantization", None)
            changed = True

        if changed:
            config_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

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

    def _sampling_params(self, thinking_enabled: bool) -> dict:
        if thinking_enabled:
            # Qwen3 recommended defaults in thinking mode.
            return {
                "do_sample": True,
                "temperature": 0.6,
                "top_p": 0.95,
                "top_k": 20,
            }

        # Qwen3 recommended defaults in non-thinking mode.
        return {
            "do_sample": True,
            "temperature": 0.7,
            "top_p": 0.8,
            "top_k": 20,
        }

    def _load_qwen(self):
        """Best-effort local Qwen runtime load from model directory."""
        if self._qwen_status in {"ready", "unavailable", "load_failed"}:
            return

        self._qwen_safetensor = self._resolve_qwen_safetensor_path()
        runtime_dir = self._prepare_qwen_runtime_dir() or self._resolve_qwen_runtime_dir()

        if self._qwen_safetensor is None:
            self._qwen_status = "unavailable"
            self._qwen_error = "qwen_safetensor_missing"
            logger.warning(
                "Tanka [Coffee Text]: qwen safetensor file missing in %s or %s",
                self._qwen_model_dir,
                self._qwen_legacy_model_dir,
            )
            return

        if runtime_dir is None:
            self._qwen_status = "unavailable"
            self._qwen_error = "qwen_tokenizer_or_config_missing"
            logger.warning(
                "Tanka [Coffee Text]: qwen tokenizer/config missing in %s or %s; falling back to MiniLM retrieval response",
                self._qwen_model_dir,
                self._qwen_legacy_model_dir,
            )
            return

        self._normalize_qwen_config_for_transformers(runtime_dir)

        def _load_from_runtime(path: Path):
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self._qwen_tokenizer = AutoTokenizer.from_pretrained(
                str(path),
                local_files_only=True,
                trust_remote_code=True,
            )
            self._qwen_model = AutoModelForCausalLM.from_pretrained(
                str(path),
                local_files_only=True,
                trust_remote_code=True,
            ).to(self.device)
            self._qwen_model.eval()

        try:
            logger.info("Tanka [Coffee Text]: loading local Qwen assets from %s", runtime_dir)
            _load_from_runtime(runtime_dir)
            self._qwen_status = "ready"
            self._qwen_error = ""
            self._qwen_model_dir = runtime_dir
        except Exception as exc:
            lowered_error = str(exc).lower()
            quantization_error = any(
                marker in lowered_error
                for marker in ["quant_method", "quantization", "gptq", "quantized model"]
            )
            if quantization_error:
                try:
                    logger.warning(
                        "Tanka [Coffee Text]: retrying Qwen load without quantization config (%s)",
                        exc,
                    )
                    self._remove_qwen_quantization_config(runtime_dir)
                    _load_from_runtime(runtime_dir)
                    self._qwen_status = "ready"
                    self._qwen_error = ""
                    self._qwen_model_dir = runtime_dir
                    return
                except Exception as retry_exc:
                    exc = retry_exc

            self._qwen_status = "load_failed"
            lowered_error = str(exc).lower()
            if "ignore_mismatched_sizes" in lowered_error or "size mismatch" in lowered_error:
                self._qwen_error = "qwen_weight_format_incompatible_with_transformers_mlx_4bit"
            elif "optimum" in lowered_error and "gptq" in lowered_error:
                self._qwen_error = "qwen_gptq_loader_requires_optimum"
            else:
                self._qwen_error = str(exc)
            logger.warning("Tanka [Coffee Text]: qwen load failed, fallback enabled (%s)", exc)

    def _extract_molecule_name(self, prompt: str) -> str:
        text = (prompt or "").strip()
        if not text:
            return "molecule"

        chembl_match = re.search(r"\bCHEMBL\d+\b", text, flags=re.IGNORECASE)
        if chembl_match:
            return chembl_match.group(0).upper()

        normalized = re.sub(r"\s+", " ", text).strip()
        lower = normalized.lower()
        prefixes = [
            "tell me about ",
            "what is ",
            "what's ",
            "show me ",
            "show ",
            "describe ",
            "explain ",
            "molecule of ",
            "structure of ",
        ]

        candidate = normalized
        for prefix in prefixes:
            if lower.startswith(prefix):
                candidate = normalized[len(prefix):]
                break

        candidate = re.sub(r"\b(molecule|structure|in|2d|3d|please)\b", " ", candidate, flags=re.IGNORECASE)
        candidate = re.sub(r"[^a-zA-Z0-9\-\s]", " ", candidate)
        candidate = " ".join(candidate.split())
        return candidate if candidate else "molecule"

    def _chemistry_qwen_unavailable_text(self) -> str:
        return "Qwen 3 Thinking is in high demand right now, we're sorry for unavailability."

    def chemistry_molscribe_unavailable_text(self) -> str:
        return "MolScribe is in high demand right now, we're sorry for unavailability."

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
    ) -> str:
        """Generate coffee-helper text with Qwen when available, otherwise deterministic fallback."""
        cleaned_prompt, soft_override = self._soft_thinking_override(user_prompt)
        hard_thinking_enabled = True if enable_thinking is None else bool(enable_thinking)
        effective_thinking = hard_thinking_enabled
        if hard_thinking_enabled and soft_override is not None:
            effective_thinking = soft_override

        self._last_qwen_generation_mode = "thinking" if effective_thinking else "non-thinking"
        self._load_qwen()

        if self._qwen_status != "ready" or self._qwen_model is None or self._qwen_tokenizer is None:
            self._last_coffee_text_model = (
                "qwen3-fallback-coffee-thinking"
                if effective_thinking
                else "qwen3-fallback-coffee-non-thinking"
            )
            return self._fallback_coffee_text(cleaned_prompt, context_facts=context_facts)

        system_prompt = (
            "You are Kafelot Coffee Helper. Answer clearly and concisely about coffee, espresso, capsules, "
            "flavor profiles, intensity, and brewing. Give practical recommendations when useful."
        )
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

        try:
            if hasattr(self._qwen_tokenizer, "apply_chat_template"):
                prompt = self._qwen_tokenizer.apply_chat_template(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    tokenize=False,
                    add_generation_prompt=True,
                    enable_thinking=effective_thinking,
                )
            else:
                prompt = f"{system_prompt}\nUser: {user_content}\nAssistant:"

            inputs = self._qwen_tokenizer(prompt, return_tensors="pt").to(self.device)
            sampling = self._sampling_params(effective_thinking)
            if hasattr(self._qwen_model, "generation_config") and hasattr(self._qwen_model.generation_config, "min_p"):
                sampling["min_p"] = 0.0

            with torch.no_grad():
                output_ids = self._qwen_model.generate(
                    **inputs,
                    max_new_tokens=max(64, min(max_new_tokens, 32768)),
                    **sampling,
                    pad_token_id=self._qwen_tokenizer.eos_token_id,
                )

            generated_ids = output_ids[0][inputs["input_ids"].shape[1]:]
            text = self._qwen_tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
            answer_only = self._strip_think_block(text)
            self._last_coffee_text_model = "qwen3-local-coffee-thinking" if effective_thinking else "qwen3-local-coffee-non-thinking"
            return answer_only if answer_only else self._fallback_coffee_text(cleaned_prompt, context_facts=context_facts)
        except Exception as exc:
            logger.warning("Tanka [Coffee Text]: qwen generation failed, fallback enabled (%s)", exc)
            self._last_coffee_text_model = (
                "qwen3-fallback-coffee-thinking"
                if effective_thinking
                else "qwen3-fallback-coffee-non-thinking"
            )
            return self._fallback_coffee_text(cleaned_prompt, context_facts=context_facts)

    def generate_chemistry_text(
        self,
        user_prompt: str,
        max_new_tokens: int = 1024,
        enable_thinking: bool | None = None,
    ) -> str:
        """Generate chemistry helper text with Qwen only (no MiniLM fallback)."""
        cleaned_prompt, soft_override = self._soft_thinking_override(user_prompt)
        hard_thinking_enabled = True if enable_thinking is None else bool(enable_thinking)
        effective_thinking = hard_thinking_enabled
        if hard_thinking_enabled and soft_override is not None:
            effective_thinking = soft_override

        self._last_qwen_generation_mode = "thinking" if effective_thinking else "non-thinking"
        self._load_qwen()

        if self._qwen_status != "ready" or self._qwen_model is None or self._qwen_tokenizer is None:
            self._last_chemistry_text_model = "qwen3-unavailable-chemistry-high-demand"
            return self._chemistry_qwen_unavailable_text()

        system_prompt = (
            "You are Kafelot Molecule Helper. Answer chemistry and molecule questions clearly and concisely. "
            "If asked about compounds, provide practical and educational explanations about structure, functional "
            "groups, naming, and behavior in plain language."
        )
        user_content = cleaned_prompt or "Please explain this molecule."

        try:
            if hasattr(self._qwen_tokenizer, "apply_chat_template"):
                prompt = self._qwen_tokenizer.apply_chat_template(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    tokenize=False,
                    add_generation_prompt=True,
                    enable_thinking=effective_thinking,
                )
            else:
                prompt = f"{system_prompt}\nUser: {user_content}\nAssistant:"

            inputs = self._qwen_tokenizer(prompt, return_tensors="pt").to(self.device)
            sampling = self._sampling_params(effective_thinking)
            if hasattr(self._qwen_model, "generation_config") and hasattr(self._qwen_model.generation_config, "min_p"):
                sampling["min_p"] = 0.0

            with torch.no_grad():
                output_ids = self._qwen_model.generate(
                    **inputs,
                    max_new_tokens=max(64, min(max_new_tokens, 32768)),
                    **sampling,
                    pad_token_id=self._qwen_tokenizer.eos_token_id,
                )

            generated_ids = output_ids[0][inputs["input_ids"].shape[1]:]
            text = self._qwen_tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
            answer_only = self._strip_think_block(text)
            if answer_only:
                self._last_chemistry_text_model = (
                    "qwen3-local-chemistry-thinking" if effective_thinking else "qwen3-local-chemistry-non-thinking"
                )
                return answer_only

            self._last_chemistry_text_model = "qwen3-unavailable-chemistry-high-demand"
            return self._chemistry_qwen_unavailable_text()
        except Exception as exc:
            logger.warning("Tanka [Chemistry Text]: qwen generation unavailable (%s)", exc)
            self._last_chemistry_text_model = "qwen3-unavailable-chemistry-high-demand"
            return self._chemistry_qwen_unavailable_text()

    def coffee_text_model_used(self) -> str:
        return self._last_coffee_text_model

    def chemistry_text_model_used(self) -> str:
        return self._last_chemistry_text_model

    def qwen_generation_mode(self) -> str:
        return self._last_qwen_generation_mode

    def qwen_status(self) -> dict:
        resolved_safetensor = self._resolve_qwen_safetensor_path()
        return {
            "status": self._qwen_status,
            "safetensor_detected": resolved_safetensor is not None,
            "safetensor_path": str(resolved_safetensor) if resolved_safetensor is not None else "",
            "model_dir": str(self._qwen_model_dir),
            "conf_dir": str(self._qwen_conf_dir),
            "thinking_default": True,
            "soft_switch_tokens": ["/think", "/no_think"],
            "runtime_note": (
                "Qwen local generation is used for coffee helper mode. When Qwen is unavailable, coffee helper "
                "falls back to MiniLM retrieval-backed response composition in app.py. Molecule helper text uses "
                "Qwen only (no MiniLM fallback), while chemistry image mode uses MolScribe "
                "(swin_base_char_aux_200k)."
            ),
            "recommended_sampling": {
                "thinking": {"temperature": 0.6, "top_p": 0.95, "top_k": 20, "min_p": 0.0},
                "non_thinking": {"temperature": 0.7, "top_p": 0.8, "top_k": 20, "min_p": 0.0},
            },
            "last_mode": self._last_qwen_generation_mode,
            "error": self._qwen_error,
        }

    # ------------------------------------------------------------------
    # CLIP  (image understanding — triggered by any image upload in chat)
    # ------------------------------------------------------------------

    def _load_clip(self):
        """Lazy-load CLIP ViT-B/32 on first use."""
        if self._clip_model is not None:
            return
        import clip  # type: ignore[import-untyped]
        logger.info("Tanka [CLIP]: loading ViT-B/32 on %s", self.device)
        self._clip_model, self._clip_preprocess = clip.load("ViT-B/32", device=self.device)
        self._clip_model.eval()

    def describe_image(self, image_bytes: bytes, candidates: list | None = None) -> dict:
        """
        Use CLIP to classify an image against a set of text candidates.
        Returns the top match and top-3 results with probabilities.
        """
        self._load_clip()
        import clip  # type: ignore[import-untyped]
        from PIL import Image
        import io

        labels = candidates if candidates is not None else _DEFAULT_CLIP_CANDIDATES

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_input = self._clip_preprocess(image).unsqueeze(0).to(self.device)
        text_tokens = clip.tokenize(labels).to(self.device)

        with torch.no_grad():
            logits_per_image, _ = self._clip_model(image_input, text_tokens)
            probs = logits_per_image.softmax(dim=-1).cpu().numpy()[0]

        ranked = sorted(zip(labels, probs.tolist()), key=lambda x: x[1], reverse=True)
        return {
            "top_label": ranked[0][0],
            "top_prob": float(ranked[0][1]),
            "top3": [(label, float(prob)) for label, prob in ranked[:3]],
        }

    # ------------------------------------------------------------------
    # Chemistry Mode  (display: "Chemistry")
    # MolScribe: molecule structure recognition from images
    # ------------------------------------------------------------------

    def _load_molscribe(self):
        """Lazy-load MolScribe on first use."""
        if self._molscribe_model is not None:
            return
        from molscribe import MolScribe  # type: ignore[import-untyped]
        model_path = Path(__file__).parent / "model" / "swin_base_char_aux_200k.pth"
        logger.info("Tanka [Chemistry]: loading MolScribe from %s", model_path)
        self._molscribe_model = MolScribe(str(model_path), device=self.device)

    def predict_molecule(self, image_bytes: bytes) -> dict:
        """
        Recognise a molecule structure from an image (chemistry mode + image).
        Returns SMILES string, molfile, and confidence score.
        """
        self._load_molscribe()
        from PIL import Image
        import io

        image = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        output = self._molscribe_model.predict_image(image)
        return {
            "smiles": output.get("smiles", ""),
            "molfile": output.get("molfile", ""),
            "confidence": float(output.get("confidence", 0.0)),
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def display_name(mode: str) -> str:
        """Return the human-readable display name for a given mode."""
        return MODE_DISPLAY_NAMES.get(mode, mode)

    @staticmethod
    def is_valid_mode(mode: str) -> bool:
        return mode in VALID_MODES
