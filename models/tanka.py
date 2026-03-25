"""
Tanka - Filspresso AI Model
A unified model with two modes:
  - natural_language: Uses MiniLM for semantic coffee knowledge retrieval.
                      Display name: "Semantic"
  - chemistry:        Uses MolScribe for organic molecule recognition from images.
                      Display name: "Chemistry"

Image input handling:
  - Any mode + image:        CLIP (ViT-B/32) encodes/understands the image.
  - Chemistry mode + image:  MolScribe extracts the SMILES string from a molecule image.

Models are loaded lazily on first use.
"""

import torch
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
        self._nlp_model = None         # MiniLM (natural_language mode)
        self._clip_model = None        # CLIP ViT-B/32 (image understanding)
        self._clip_preprocess = None
        self._molscribe_model = None   # MolScribe (chemistry mode + image)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # ------------------------------------------------------------------
    # Natural Language Mode  (display: "Semantic")
    # ------------------------------------------------------------------

    def _load_nlp(self):
        """Lazy-load MiniLM on first use."""
        if self._nlp_model is not None:
            return
        from sentence_transformers import SentenceTransformer
        fine_tuned_path = Path(__file__).parent.parent / "models" / "fine_tuned_minilm"
        if fine_tuned_path.exists():
            try:
                logger.info("Tanka [Semantic]: loading fine-tuned MiniLM from %s", fine_tuned_path)
                self._nlp_model = SentenceTransformer(str(fine_tuned_path))
            except Exception as e:
                logger.warning("Tanka [Semantic]: fine-tuned load failed (%s), falling back to base model", e)
                self._nlp_model = SentenceTransformer("all-MiniLM-L6-v2")
        else:
            logger.info("Tanka [Semantic]: loading base all-MiniLM-L6-v2")
            self._nlp_model = SentenceTransformer("all-MiniLM-L6-v2")

    def encode(self, text: str) -> list:
        """Encode text to a 384-dim embedding vector (natural_language mode)."""
        self._load_nlp()
        return self._nlp_model.encode(text).tolist()

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

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
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
