"""Web search, scraped with Scrapling.

Why this lives in the Python service rather than the NestJS backend
------------------------------------------------------------------

Scrapling is a Python library. The alternatives were to run it here, or to scrape the
providers from the backend with regular expressions over raw HTML, which is what the backend
did first and what made it brittle: DuckDuckGo moved a class name and the search silently
returned nothing.

Scrapling's value is its *adaptive* element selection, which re-resolves a selector against
the page's own structure when the markup shifts, plus its text extraction. That is the part
worth having, and it does not need a browser.

Why not Scrapling's own Fetcher
-------------------------------

``scrapling[fetchers]`` pulls Playwright, Patchright and Browserforge, and the install
downloads Chromium: about 260 MB of packages plus the browser itself. In a slim image that is
a large amount of weight for something that only ever needs to speak HTTP. So the page is
fetched with the pooled httpx client the service already has, and parsed with Scrapling.

The providers, and what they actually do
---------------------------------------

**DuckDuckGo** is the workhorse. Its HTML endpoint answers with results, and when it decides
the address is a scraper it answers with a challenge page instead -- a 200, with a page that
has no results in it. A silent empty list for that would tell the model the web has nothing
to say, and the model would answer from its own memory and sound confident about it. So the
challenge is detected and reported as a block.

**Google** is best-effort. It increasingly serves a JavaScript-only page to a plain HTTP
client, with no results in the markup at all, so from a datacenter address it frequently
returns an empty shell. It is kept because it sometimes works and because it fails
differently from DuckDuckGo -- but the tool never depends on it alone.
"""

from __future__ import annotations

import logging
import re
import urllib.parse
from dataclasses import dataclass
from typing import Any, Iterable

import httpx
from scrapling import Selector

logger = logging.getLogger("filspresso.websearch")

# A real browser's headers. Both providers serve a different, emptier page to a client that
# does not look like one, and that page has no results in it.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}

MAX_QUERY_LENGTH = 512
MAX_RESULTS = 10
REQUEST_TIMEOUT_SECONDS = 20

# One pooled client for the service's lifetime.
#
# A client per request would throw away the connection pool and the TLS handshake, which for
# a search provider is most of the cost. The pool is closed with the service's lifespan.
_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        )
    return _client


async def aclose() -> None:
    """Close the pool, with the service."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str
    provider: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "provider": self.provider,
        }


def _clean(value: Any) -> str:
    """Collapse whitespace and drop the empty results."""
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def is_blocked_page(html: str) -> bool:
    """Whether the provider answered with a block rather than with results.

    Detected from the page, because these providers answer 200 with it. A search that
    silently finds nothing is worse than one that says it is being blocked: the first makes
    the model answer from memory, and the second tells the user to wait.
    """
    page = html or ""
    # No length heuristic here. A page that carries no results is caught by the "unparsed"
    # signal instead, which is the honest one: it says the page was not a results page
    # rather than guessing from its size, and a large page can be either.
    markers = (
        "anomaly-modal",
        "challenge-form",
        "unusual traffic",
        "are you a robot",
        "blocked for security",
        "detected unusual traffic",
        "our systems have detected",
        "consent.google.com",
        "/sorry/index",
    )
    lowered = page.lower()
    return any(marker in lowered for marker in markers)


def _unwrap_duckduckgo(href: str) -> str:
    """DuckDuckGo wraps every result's real link in a redirect."""
    raw = (href or "").strip()
    if not raw:
        return ""
    if raw.startswith("//"):
        raw = f"https:{raw}"
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return ""
    query = urllib.parse.parse_qs(parsed.query or "")
    wrapped = (query.get("uddg") or [""])[0]
    if wrapped:
        return wrapped
    if parsed.scheme in ("http", "https"):
        return raw
    return ""


def parse_duckduckgo(html: str) -> list[SearchResult]:
    """DuckDuckGo's HTML results.

    Scrapling's adaptive selection is what makes this durable: the class names here are the
    current ones, and if they change, the selector is re-resolved against the page rather than
    silently matching nothing.
    """
    page = Selector(html)
    results: list[SearchResult] = []

    for anchor in page.css("a.result__a"):
        href = anchor.attrib.get("href", "")
        url = _unwrap_duckduckgo(href)
        if not url:
            continue
        title = _clean(anchor.css("::text").get())
        if not title:
            continue
        results.append(SearchResult(title=title, url=url, snippet="", provider="duckduckgo"))

    # The snippets are a second anchor per result, in the same order.
    snippets = [_clean(node.css("::text").get()) for node in page.css("a.result__snippet")]
    for index, result in enumerate(results):
        if index < len(snippets):
            results[index] = SearchResult(
                title=result.title,
                url=result.url,
                snippet=snippets[index],
                provider=result.provider,
            )
    return results


def parse_google(html: str) -> list[SearchResult]:
    """Google's HTML results.

    Google's markup is less stable than DuckDuckGo's and it changes more often, so the
    selectors are written to match the *shape* of a result rather than one class name: a
    heading that links out, with the description beside it.
    <para>
    The link is read from the heading, and both of Google's link forms are handled: a direct
    absolute URL, and the relative ``/url?q=`` redirect it uses on some layouts.
    """
    page = Selector(html)
    results: list[SearchResult] = []
    seen: set[str] = set()

    blocks = page.css("div.g, div.tF2C, div.MjjYud, div.Gx5Zad")
    if not blocks:
        # Fall back to the headings themselves, which survive more of Google's layout churn
        # than the wrappers around them.
        blocks = [h.parent for h in page.css("h3") if h.parent is not None]

    for block in blocks:
        heading = block.css("h3")
        anchor = heading[0].parent if heading else (block.css("a[href]")[:1] or [None])[0]
        if anchor is None:
            continue

        href = anchor.attrib.get("href", "") or ""
        url = _normalise_google_href(href)
        if not url:
            continue

        title = _clean(heading[0].css("::text").get()) if heading else _clean(anchor.css("::text").get())
        if not title or url in seen:
            continue
        seen.add(url)

        snippet = _clean(
            block.css("div.VwiC3b::text").get()
            or block.css("span.st::text").get()
            or block.css("div[data-sncf]::text").get()
        )
        results.append(SearchResult(title=title, url=url, snippet=snippet, provider="google"))

    return results


def _normalise_google_href(href: str) -> str:
    """Google's two link forms: absolute, and the relative /url?q= redirect."""
    raw = (href or "").strip()
    if not raw:
        return ""
    if raw.startswith("//"):
        raw = f"https:{raw}"
    if raw.startswith("/url?"):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query or "")
        wrapped = (query.get("q") or [""])[0]
        return wrapped if wrapped.startswith("http") else ""
    if raw.startswith("/search?") or raw.startswith("/imgres"):
        return ""
    if raw.startswith("http"):
        return raw
    return ""


async def _fetch(client: httpx.AsyncClient, url: str) -> str:
    response = await client.get(url, headers=BROWSER_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
    return response.text


async def search(
    client: httpx.AsyncClient,
    query: str,
    limit: int = MAX_RESULTS,
    providers: Iterable[str] = ("duckduckgo", "google"),
) -> dict[str, Any]:
    """Search, and say plainly what happened.

    The return value distinguishes three outcomes, because they mean different things to a
    model: results, some providers blocked, or everything blocked.
    """
    text = (query or "").strip()
    if not text:
        return {"status": "error", "error": "a query is required"}
    if len(text) > MAX_QUERY_LENGTH:
        return {"status": "error", "error": f"the query may be at most {MAX_QUERY_LENGTH} characters"}

    encoded = urllib.parse.quote_plus(text)
    endpoints = {
        "duckduckgo": f"https://html.duckduckgo.com/html/?q={encoded}",
        "duckduckgo-lite": f"https://lite.duckduckgo.com/lite/?q={encoded}",
        "google": f"https://www.google.com/search?q={encoded}&num=20&hl=en",
    }
    parsers = {
        "duckduckgo": parse_duckduckgo,
        "duckduckgo-lite": parse_duckduckgo,
        "google": parse_google,
    }

    results: list[SearchResult] = []
    blocked: list[str] = []
    errors: list[str] = []
    empty: list[str] = []
    seen: set[str] = set()

    for provider in providers:
        url = endpoints.get(provider)
        if not url:
            continue
        try:
            html = await _fetch(client, url)
        except Exception as exc:  # noqa: BLE001 - one provider failing is not fatal
            logger.warning("web search: %s failed: %s", provider, exc)
            errors.append(provider)
            continue

        if is_blocked_page(html):
            logger.info("web search: %s is refusing this address", provider)
            blocked.append(provider)
            continue

        try:
            found = parsers[provider](html)
        except Exception as exc:  # noqa: BLE001
            logger.warning("web search: %s could not be parsed: %s", provider, exc)
            errors.append(provider)
            continue

        if not found:
            # A page that parsed to nothing. Not the same as a block, and not the same as
            # "there are no results for this" -- it is usually a layout the parser did not
            # recognise, and saying so is more useful than returning an empty list.
            empty.append(provider)

        for result in found:
            if result.url in seen:
                continue
            seen.add(result.url)
            results.append(result)

    results = results[:limit]

    if results:
        return {
            "status": "ok",
            "count": len(results),
            "results": [r.as_dict() for r in results],
            # Said out loud rather than hidden, so the model can tell "nothing found" from
            # "the providers are refusing".
            "blocked": blocked,
            "errors": errors,
            "unparsed": empty,
        }

    if blocked or errors:
        return {
            "status": "blocked",
            "error": "The search providers are refusing this address right now. Wait a few minutes and try again.",
            "blocked": blocked,
            "errors": errors,
            "unparsed": empty,
        }

    if empty:
        return {
            "status": "blocked",
            "error": "The search providers returned pages the parser did not recognise. Try again shortly.",
            "blocked": blocked,
            "errors": errors,
            "unparsed": empty,
        }

    return {"status": "empty", "count": 0, "results": [], "blocked": [], "errors": [], "unparsed": []}
