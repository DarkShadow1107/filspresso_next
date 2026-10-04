import base64
from typing import Any

import pytest

from app.services import ingestion as app_ingestion
from tools import ingestion as tool_ingestion


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "module",
    [app_ingestion, tool_ingestion],
    ids=["app", "tools"],
)
async def test_search_falls_back_to_bing(monkeypatch: pytest.MonkeyPatch, module: Any) -> None:
    async def unavailable(*args: object, **kwargs: object) -> list[object]:
        raise ValueError("DuckDuckGo challenge")

    async def bing_search(query: str, count: int) -> list[object]:
        assert query == "fallback query"
        assert count == 1
        return [module.SearchResult("Fallback", "https://example.com", "A result")]

    monkeypatch.setattr(module, "_ddg_html_search", unavailable)
    if hasattr(module, "_ddg_lite_search"):
        monkeypatch.setattr(module, "_ddg_lite_search", unavailable)
    monkeypatch.setattr(module, "_bing_search", bing_search)

    results = await module.duckduckgo_search("fallback query", max_results=1)

    assert results[0].title == "Fallback"
    assert results[0].url == "https://example.com"


def test_bing_redirect_url_is_unwrapped() -> None:
    target = "https://example.com/article"
    encoded = base64.urlsafe_b64encode(target.encode()).decode().rstrip("=")

    assert (
        app_ingestion._unwrap_bing_url(f"https://www.bing.com/ck/a?u=a1{encoded}")
        == target
    )
