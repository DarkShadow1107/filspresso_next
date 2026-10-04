import asyncio
import gc
from enum import StrEnum
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()


class ModelName(StrEnum):
    GRANITE = "granite"
    MINILM = "minilm"


MODEL_FILES = {
    ModelName.GRANITE: "granite-4.2-3b-Q4_0.gguf",
    ModelName.MINILM: "MiniLM-L6-v2.gguf",
}


class GenerationRequest(BaseModel):
    model: ModelName
    prompt: str = Field(min_length=1, max_length=130_000)
    max_tokens: int = Field(default=512, ge=1, le=8_192)
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    context_size: int = Field(default=65_536, ge=32_768, le=131_072)


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=128)


class SingleModelRuntime:
    """Serial GGUF executor that explicitly releases one model before loading the next."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._backend: Any | None = None
        self.active_model: ModelName | None = None
        self.context_size: int | None = None

    async def _unload(self) -> None:
        backend, self._backend = self._backend, None
        self.active_model = None
        self.context_size = None
        if backend is not None:
            close = getattr(backend, "close", None)
            if callable(close):
                close()
            del backend
        gc.collect()

    def _model_path(self, model: ModelName) -> Path:
        path = settings.model_dir / MODEL_FILES[model]
        if not path.exists():
            raise HTTPException(status_code=503, detail=f"Configured model is missing: {path.name}")
        return path

    async def _load(self, model: ModelName, context_size: int) -> Any:
        if (
            self.active_model == model
            and self.context_size == context_size
            and self._backend is not None
        ):
            return self._backend
        await self._unload()
        try:
            from llama_cpp import Llama
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Local GGUF inference is disabled. "
                    "Install the local-models dependency in model-runtime."
                ),
            ) from exc
        self._backend = Llama(
            model_path=str(self._model_path(model)),
            n_ctx=context_size,
            n_gpu_layers=-1 if model == ModelName.MINILM else settings.model_gpu_layers,
            embedding=model == ModelName.MINILM,
            verbose=False,
        )
        self.active_model = model
        self.context_size = context_size
        return self._backend

    async def generate(self, request: GenerationRequest) -> dict[str, Any]:
        if request.model != ModelName.GRANITE:
            raise HTTPException(
                status_code=422,
                detail="Granite 4.2 is the only generation model currently enabled",
            )
        async with self._lock:
            backend = await self._load(request.model, request.context_size)
            result = backend.create_completion(
                prompt=request.prompt,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                stop=["<|im_end|>"],
            )
            return {
                "model": request.model,
                "text": result["choices"][0]["text"],
                "usage": result.get("usage", {}),
                "context_size": request.context_size,
            }

    async def embed(self, request: EmbeddingRequest) -> dict[str, Any]:
        async with self._lock:
            backend = await self._load(ModelName.MINILM, 2_048)
            vectors = [
                backend.create_embedding(text)["data"][0]["embedding"] for text in request.texts
            ]
            return {"model": ModelName.MINILM, "vectors": vectors}

    async def state(self) -> dict[str, Any]:
        return {
            "active_model": self.active_model,
            "context_size": self.context_size,
            "strict_single_model": True,
            "configured_models": {model.value: filename for model, filename in MODEL_FILES.items()},
        }


runtime = SingleModelRuntime()
app = FastAPI(title="Spectre Model Runtime", version="0.1.0")


@app.on_event("startup")
async def startup() -> None:
    configure_logging()


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", **await runtime.state()}


@app.post("/v1/generate")
async def generate(request: GenerationRequest) -> dict[str, Any]:
    return await runtime.generate(request)


@app.post("/v1/embed")
async def embed(request: EmbeddingRequest) -> dict[str, Any]:
    return await runtime.embed(request)
