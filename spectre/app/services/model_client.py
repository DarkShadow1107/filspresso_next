from typing import Any

import httpx

from app.core.config import get_settings

settings = get_settings()


async def generate_with_local_model(
    *,
    model: str,
    prompt: str,
    max_tokens: int,
    context_size: int,
    temperature: float = 0.1,
) -> dict[str, Any] | None:
    if model != "granite":
        raise ValueError("Spectre generation is restricted to Granite 4.2")
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                f"{settings.model_runtime_url.rstrip('/')}/completion",
                json={
                    "prompt": prompt,
                    "n_predict": max_tokens,
                    "temperature": temperature,
                    "stop": ["<|im_end|>"],
                    "cache_prompt": False,
                },
            )
            response.raise_for_status()
            payload = response.json()
            text = payload.get("content") if isinstance(payload, dict) else None
            if not isinstance(text, str):
                return None
            prompt_tokens = int(payload.get("tokens_evaluated", 0) or 0)
            completion_tokens = int(payload.get("tokens_predicted", 0) or 0)
            return {
                "model": model,
                "text": text,
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                },
                "context_size": context_size,
            }
    except httpx.HTTPError:
        return None


async def embed_with_minilm(texts: list[str]) -> list[list[float]] | None:
    if not texts:
        return []
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                f"{settings.embedding_runtime_url.rstrip('/')}/v1/embeddings",
                json={"model": "MiniLM-L6-v2", "input": texts},
            )
            response.raise_for_status()
            data = response.json().get("data")
            if not isinstance(data, list) or len(data) != len(texts):
                return None
            vectors: list[list[float]] = []
            for item in data:
                if not isinstance(item, dict):
                    return None
                embedding = item.get("embedding")
                if not isinstance(embedding, list):
                    return None
                if not all(isinstance(value, (int, float)) for value in embedding):
                    return None
                vectors.append([float(value) for value in embedding])
            return vectors
    except httpx.HTTPError:
        return None
