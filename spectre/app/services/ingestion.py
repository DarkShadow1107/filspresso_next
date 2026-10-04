import asyncio
import base64
import hashlib
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlencode, urljoin, urlparse, urlunparse
from uuid import UUID

from curl_cffi.requests.exceptions import RequestException
from scrapling.fetchers import AsyncFetcher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import DocumentChunk, Source, SourceVersion

settings = get_settings()
USER_AGENT = "Spectre/0.1 research bot"


class UnsafeUrlError(ValueError):
    pass


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


@dataclass(frozen=True)
class FetchedDocument:
    canonical_url: str
    title: str
    text: str
    content_hash: str
    content_type: str


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrlError("Only absolute HTTP(S) URLs are allowed")
    hostname = parsed.hostname.lower().rstrip(".")
    return urlunparse((parsed.scheme, hostname, parsed.path or "/", "", parsed.query, ""))


def _ensure_public_hostname(hostname: str) -> None:
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeUrlError("Unable to resolve source hostname") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        normalized = ip.ipv4_mapped if isinstance(ip, ipaddress.IPv6Address) else ip
        if normalized is None or not normalized.is_global:
            raise UnsafeUrlError("Only globally routable source addresses are allowed")


async def _ddg_html_search(query: str, count: int) -> list[SearchResult]:
    response = await AsyncFetcher.post(
        "https://html.duckduckgo.com/html/",
        data={"q": query},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
        retries=0,
        follow_redirects=False,
        impersonate=None,
        stealthy_headers=False,
    )
    if response.status == 202:
        raise ValueError(
            "DuckDuckGo anti-bot challenge (HTTP 202): "
            "discovery is unavailable from this network"
        )
    if not 200 <= response.status < 300:
        raise ValueError(f"DuckDuckGo returned HTTP {response.status}")
    results: list[SearchResult] = []
    for node in response.css(".result"):
        href = node.css(".result__a::attr(href)").get()
        if not href:
            continue
        target = urljoin("https://duckduckgo.com", str(href))
        parsed_target = urlparse(target)
        if parsed_target.hostname and parsed_target.hostname.endswith("duckduckgo.com"):
            encoded_url = parse_qs(parsed_target.query).get("uddg", [None])[0]
            if encoded_url:
                target = unquote(encoded_url)
        results.append(
            SearchResult(
                title=str(node.css(".result__a::text").get() or "Untitled result"),
                url=target,
                snippet=str(node.css(".result__snippet::text").get() or ""),
            )
        )
        if len(results) >= count:
            break
    return results


def _unwrap_bing_url(url: str) -> str:
    parsed = urlparse(url)
    encoded = parse_qs(parsed.query).get("u", [None])[0]
    if not encoded or not encoded.startswith("a1"):
        return url
    try:
        payload = encoded[2:]
        decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        return url
    return decoded if urlparse(decoded).scheme in {"http", "https"} else url


async def _bing_search(query: str, count: int) -> list[SearchResult]:
    response = await AsyncFetcher.get(
        f"https://www.bing.com/search?{urlencode({'q': query})}",
        headers={"User-Agent": USER_AGENT},
        timeout=15,
        retries=0,
        follow_redirects=False,
        impersonate=None,
        stealthy_headers=False,
    )
    if not 200 <= response.status < 300:
        raise ValueError(f"Bing returned HTTP {response.status}")
    results: list[SearchResult] = []
    for node in response.css("li.b_algo"):
        href = node.css("h2 a::attr(href)").get()
        if not href:
            continue
        target = _unwrap_bing_url(urljoin("https://www.bing.com", str(href)))
        parsed_target = urlparse(target)
        if parsed_target.scheme not in {"http", "https"} or not parsed_target.hostname:
            continue
        title = re.sub(
            r"\s+", " ", " ".join(map(str, node.css("h2 ::text").getall()))
        ).strip()
        snippet = re.sub(
            r"\s+", " ", " ".join(map(str, node.css("p ::text").getall()))
        ).strip()
        results.append(
            SearchResult(
                title=title or "Untitled result",
                url=target,
                snippet=snippet,
            )
        )
        if len(results) >= count:
            break
    return results


async def duckduckgo_search(query: str, *, max_results: int | None = None) -> list[SearchResult]:
    count = min(max_results or settings.ddg_max_results, settings.ddg_max_results)
    ddg_error: Exception | None = None
    try:
        results = await _ddg_html_search(query, count)
        if results:
            return results
    except (RequestException, ValueError) as exc:
        ddg_error = exc
    try:
        return await _bing_search(query, count)
    except (RequestException, ValueError) as exc:
        if ddg_error is not None:
            raise ValueError(
                f"Search providers unavailable: {ddg_error}; Bing fallback failed: {exc}"
            ) from exc
        raise


async def fetch_public_document(
    url: str, *, redirects_remaining: int = 5, max_bytes: int | None = None
) -> FetchedDocument:
    canonical = canonicalize_url(url)
    parsed = urlparse(canonical)
    _ensure_public_hostname(parsed.hostname or "")
    response_limit = max_bytes if max_bytes is not None else settings.max_upload_bytes
    if response_limit < 1:
        raise ValueError("Maximum source size must be positive")
    # Use Scrapling's standard HTTP client only. Browser/stealth modes are intentionally
    # excluded so this collector does not evade access controls or anti-bot challenges.
    response = await AsyncFetcher.get(
        canonical,
        headers={"User-Agent": USER_AGENT},
        timeout=20,
        retries=0,
        follow_redirects=False,
        impersonate=None,
        stealthy_headers=False,
    )
    if 300 <= response.status < 400:
        location = response.headers.get("location")
        if not location:
            raise ValueError("Redirect without location")
        if redirects_remaining <= 0:
            raise ValueError("Source exceeded redirect limit")
        return await fetch_public_document(
            urljoin(canonical, location),
            redirects_remaining=redirects_remaining - 1,
            max_bytes=response_limit,
        )
    if not 200 <= response.status < 300:
        raise ValueError(f"Source returned HTTP {response.status}")
    content_type = response.headers.get("content-type", "").lower()
    if "html" not in content_type and "text" not in content_type:
        raise ValueError("Only HTML and text web sources are accepted by this collector")
    content_length = response.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > response_limit:
                raise ValueError("Source exceeds maximum configured size")
        except ValueError as exc:
            if str(exc).startswith("Source exceeds"):
                raise
            raise ValueError("Source returned an invalid content length") from exc
    body = bytes(response.body)
    if len(body) > response_limit:
        raise ValueError("Source exceeds maximum configured size")
    if "html" in content_type:
        title = str(response.css("title::text").get() or canonical)
        text_nodes = response.css(
            "body :not(script):not(style):not(noscript):not(svg):not(iframe)::text"
        ).getall()
        text = re.sub(r"\s+", " ", " ".join(map(str, text_nodes))).strip()
    else:
        title = canonical
        text = body.decode("utf-8", errors="replace").strip()
    if len(text) < 80:
        raise ValueError("Source has insufficient extractable text")
    return FetchedDocument(
        canonical_url=canonicalize_url(str(response.url)),
        title=title[:500],
        text=text,
        content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        content_type=content_type,
    )


def chunk_text(text: str, *, chunk_size: int = 1_000, overlap: int = 160) -> list[str]:
    if chunk_size <= overlap:
        raise ValueError("chunk_size must exceed overlap")
    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n{2,}|(?<=\.)\s+(?=[A-Z])", text)
        if paragraph.strip()
    ]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(current) + len(paragraph) + 1 <= chunk_size:
            current = f"{current} {paragraph}".strip()
            continue
        if current:
            chunks.append(current)
        overlap_text = current[-overlap:] if current else ""
        current = f"{overlap_text} {paragraph}".strip()
        while len(current) > chunk_size:
            chunks.append(current[:chunk_size])
            current = current[chunk_size - overlap :]
    if current:
        chunks.append(current)
    return chunks


async def persist_fetched_document(
    db: AsyncSession,
    *,
    organization_id: UUID,
    document: FetchedDocument,
    source_tier: str = "web",
) -> SourceVersion:
    source = await db.scalar(
        select(Source).where(
            Source.organization_id == organization_id,
            Source.canonical_url == document.canonical_url,
        )
    )
    if source is None:
        source = Source(
            organization_id=organization_id,
            canonical_url=document.canonical_url,
            title=document.title,
            source_tier=source_tier,
        )
        db.add(source)
        await db.flush()
    existing = await db.scalar(
        select(SourceVersion).where(
            SourceVersion.source_id == source.id,
            SourceVersion.content_hash == document.content_hash,
        )
    )
    if existing is not None:
        return existing
    version = SourceVersion(
        source_id=source.id,
        content_hash=document.content_hash,
        extracted_text=document.text,
        metadata_json={"title": document.title, "content_type": document.content_type},
    )
    db.add(version)
    await db.flush()
    for ordinal, content in enumerate(chunk_text(document.text)):
        db.add(
            DocumentChunk(
                organization_id=organization_id,
                source_version_id=version.id,
                ordinal=ordinal,
                content=content,
                metadata_json={
                    "chunking": "recursive-1000-160",
                    "source_url": document.canonical_url,
                },
            )
        )
    return version


async def fetch_many(urls: list[str], *, concurrency: int = 3) -> list[FetchedDocument]:
    semaphore = asyncio.Semaphore(concurrency)

    async def guarded(url: str) -> FetchedDocument | None:
        async with semaphore:
            try:
                return await fetch_public_document(url)
            except (RequestException, UnsafeUrlError, ValueError):
                return None

    documents = await asyncio.gather(*(guarded(url) for url in urls))
    return [document for document in documents if document is not None]
