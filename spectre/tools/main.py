import hashlib
import json
import os
import re
import shutil
import subprocess
import textwrap
import threading
import time
from pathlib import Path
from typing import Any, Literal

import anyio
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from tools.calculator import calculate
from tools.documents import (
    FORMATS,
    get_entry,
    list_documents,
    modify_document,
    read_bytes,
    save_document,
)
from tools.cve import nvd_search, osv_query
from tools.ingestion import duckduckgo_search, fetch_many
from tools.knowledge_store import delete_device_knowledge, lookup_cves, search as knowledge_search_fn, stats as knowledge_stats, upsert_cve, upsert_document
from tools.repository import RepositorySafetyError, build_repository_manifest, validate_github_url
from tools.repository_workspace import (
    RepositoryNotFoundError,
    describe_repository_run,
    list_repository_files,
    prepare_repository,
    read_repository_file,
    repository_context,
    scan_repository,
    search_repository,
)
from tools.vision import SANDBOX_IMAGE_SCRIPT

RESULT_SENTINEL = "__CODESENTRY_RESULT__"

app = FastAPI(title="CodeSentry Tools", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "https://127.0.0.1:8080",
        "https://localhost:8080",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Device-Id"],
)

SANDBOX_URL = os.environ.get("SANDBOX_URL", "http://sandbox:8091")
SANDBOX_TOKEN = os.environ.get("SANDBOX_SERVICE_TOKEN", "")


class SearchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    query: str = Field(min_length=3, max_length=500)
    max_results: int = Field(default=6, ge=1, le=10)


class FetchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    urls: list[str] = Field(min_length=1, max_length=8)
    max_chars: int = Field(default=8000, ge=200, le=20_000)


class ResearchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    query: str = Field(min_length=3, max_length=500)
    max_results: int = Field(default=6, ge=1, le=10)
    fetch_top: int = Field(default=4, ge=1, le=6)
    max_chars: int = Field(default=6000, ge=200, le=20_000)


class CalculatorRequest(BaseModel):
    model_config = {"extra": "forbid"}

    expression: str = Field(min_length=1, max_length=500)


class RepositoryRequest(BaseModel):
    model_config = {"extra": "forbid"}

    url: str = Field(min_length=10, max_length=300)


class RepositoryPrepareRequest(BaseModel):
    model_config = {"extra": "forbid"}

    url: str = Field(min_length=10, max_length=300)
    refresh: bool = False


class RepositoryContextRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")


class RepositoryFilesRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    path_prefix: str | None = Field(default=None, max_length=500)
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0, le=20_000)


class RepositoryFileRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    path: str = Field(min_length=1, max_length=500)
    start_line: int | None = Field(default=None, ge=1)
    end_line: int | None = Field(default=None, ge=1)
    max_chars: int = Field(default=20_000, ge=1, le=100_000)


class RepositorySearchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    query: str = Field(min_length=1, max_length=500)
    path_prefix: str | None = Field(default=None, max_length=500)
    max_results: int = Field(default=50, ge=1, le=100)


class RepositoryScanRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    refresh: bool = False


class RepositoryRunRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    profile: Literal[
        "compile_python",
        "python_script",
        "python_tests",
        "compile_cpp",
        "cpp_script",
        "cpp_tests",
        "compile_all",
    ]
    path: str | None = Field(default=None, max_length=500)
    timeout_seconds: int = Field(default=25, ge=1, le=30)


class DocumentCreateRequest(BaseModel):
    model_config = {"extra": "forbid"}

    filename: str = Field(min_length=3, max_length=160)
    format: str | None = Field(default=None, pattern=r"^(txt|md|docx|pdf|pptx|xlsx)$")
    content: str = Field(min_length=1, max_length=120_000)


class DocumentModifyRequest(BaseModel):
    model_config = {"extra": "forbid"}

    document_id: str = Field(min_length=8, max_length=64)
    content: str = Field(min_length=1, max_length=120_000)


class CodeRunRequest(BaseModel):
    model_config = {"extra": "forbid"}

    code: str = Field(min_length=1, max_length=40_000)
    timeout_seconds: int = Field(default=20, ge=1, le=60)


class TerminalRunRequest(BaseModel):
    model_config = {"extra": "forbid"}

    command: str = Field(min_length=1, max_length=20_000)
    workdir: str | None = Field(default=None, max_length=500)
    chat_id: str = Field(default="", max_length=200)
    timeout_seconds: int = Field(default=20, ge=1, le=30)


class ImageUnderstandRequest(BaseModel):
    model_config = {"extra": "forbid"}

    image_b64: str = Field(min_length=32, max_length=16_000_000)
    mime: str = Field(default="image/png", max_length=64)
    chat_id: str = Field(default="", max_length=200)
    device_id: str = Field(default="", max_length=120)
    filename: str = Field(default="", max_length=160)


_IMAGE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
}


def _safe_asset_name(filename: str, mime: str, counter: int = 0) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", (filename or "image").rsplit("/", 1)[-1])[:80] or "image"
    if "." not in stem:
        stem += _IMAGE_EXTENSIONS.get(mime, ".png")
    if counter:
        stem = f"{counter}_{stem}"
    return stem


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "codesentry-tools"}


@app.post("/api/search")
async def search(payload: SearchRequest) -> dict[str, Any]:
    try:
        results = await duckduckgo_search(payload.query, max_results=payload.max_results)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    return {
        "query": payload.query,
        "results": [
            {"title": item.title, "url": item.url, "snippet": item.snippet} for item in results
        ],
    }


@app.post("/api/fetch")
async def fetch(payload: FetchRequest) -> dict[str, Any]:
    documents = await fetch_many(payload.urls)
    return {
        "fetched": [
            {
                "url": document.canonical_url,
                "title": document.title,
                "text": document.text[: payload.max_chars],
            }
            for document in documents
        ]
    }


@app.post("/api/research")
async def research(payload: ResearchRequest) -> dict[str, Any]:
    try:
        results = await duckduckgo_search(payload.query, max_results=payload.max_results)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    documents = await fetch_many([item.url for item in results[: payload.fetch_top]])
    # Persist to hybrid knowledge DB: global scope for web/CVE knowledge
    saved = 0
    for document in documents:
        try:
            r = await anyio.to_thread.run_sync(
                lambda d=document: upsert_document(
                    scope="global",
                    text=d.text[:12000],
                    title=d.title,
                    url=d.canonical_url,
                    source="research",
                )
            )
            if r.get("saved"):
                saved += 1
        except Exception:
            continue
    return {
        "query": payload.query,
        "results": [
            {"title": item.title, "url": item.url, "snippet": item.snippet} for item in results
        ],
        "fetched": [
            {
                "url": document.canonical_url,
                "title": document.title,
                "text": document.text[: payload.max_chars],
            }
            for document in documents
        ],
        "knowledge_saved": saved,
    }


class KnowledgeSearchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    query: str = Field(min_length=2, max_length=500)
    device_id: str = Field(default="", max_length=120)
    limit: int = Field(default=6, ge=1, le=12)


class KnowledgeSaveRequest(BaseModel):
    model_config = {"extra": "forbid"}

    text: str = Field(min_length=40, max_length=20000)
    title: str = Field(default="", max_length=500)
    url: str = Field(default="", max_length=1000)
    scope: str = Field(default="device", pattern=r"^(global|device)$")
    device_id: str = Field(default="", max_length=120)
    chat_id: str = Field(default="", max_length=200)
    source: str = Field(default="agent", max_length=80)


class CveSearchRequest(BaseModel):
    model_config = {"extra": "forbid"}

    keyword: str = Field(min_length=2, max_length=200)
    enrich: bool = False


@app.post("/api/knowledge/search")
async def knowledge_search(payload: KnowledgeSearchRequest) -> dict[str, Any]:
    try:
        hits = await anyio.to_thread.run_sync(
            lambda: knowledge_search_fn(
                query=payload.query, device_id=payload.device_id, limit=payload.limit
            )
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Knowledge search failed") from exc
    return {"query": payload.query, "hits": hits, "count": len(hits)}


@app.post("/api/knowledge/save")
async def knowledge_save(payload: KnowledgeSaveRequest) -> dict[str, Any]:
    try:
        result = await anyio.to_thread.run_sync(
            lambda: upsert_document(
                scope="global" if payload.scope == "global" else "device",
                text=payload.text,
                title=payload.title,
                url=payload.url,
                device_id=payload.device_id,
                chat_id=payload.chat_id,
                source=payload.source,
            )
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Knowledge save failed") from exc
    return result


@app.post("/api/cve/search")
async def cve_search(payload: CveSearchRequest) -> dict[str, Any]:
    try:
        cached = await anyio.to_thread.run_sync(lambda: lookup_cves(payload.keyword, 10))
    except Exception:
        cached = []
    if cached and not payload.enrich:
        return {"keyword": payload.keyword, "cves": cached, "cached": True}
    nvd = await nvd_search(payload.keyword)
    osv = await osv_query(payload.keyword)
    merged: dict[str, dict[str, Any]] = {c["cve_id"]: c for c in cached if c.get("cve_id")}
    for item in [*nvd, *osv]:
        if item.get("cve_id"):
            merged[item["cve_id"]] = item
            try:
                await anyio.to_thread.run_sync(
                    lambda it=item: upsert_cve(
                        it["cve_id"], it.get("pkg", ""), it.get("severity", ""),
                        it.get("summary", ""), it.get("url", ""),
                    )
                )
            except Exception:
                continue
    # Also persist combined summary to global knowledge
    if merged:
        try:
            summary = "\n".join(
                f"{k}: {v.get('summary','')[:300]}" for k, v in list(merged.items())[:8]
            )
            await anyio.to_thread.run_sync(
                lambda: upsert_document(
                    scope="global", text=f"CVE knowledge for {payload.keyword}:\n{summary}",
                    title=f"CVE {payload.keyword}", url="", source="cve",
                )
            )
        except Exception:
            pass
    return {"keyword": payload.keyword, "cves": list(merged.values())[:12], "cached": False}


@app.get("/api/knowledge/stats")
async def knowledge_statistics() -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(knowledge_stats)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Knowledge stats failed") from exc


@app.delete("/api/knowledge/device")
async def knowledge_device_delete(device_id: str = "", chat_id: str = "") -> dict[str, Any]:
    """Delete user/device-collected knowledge. The shared CVE cache is kept."""
    try:
        return await anyio.to_thread.run_sync(
            lambda: delete_device_knowledge(device_id, chat_id)
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Knowledge delete failed") from exc


class DependencyAuditRequest(BaseModel):
    model_config = {"extra": "forbid"}

    repository_id: str = Field(pattern=r"^repo-[0-9a-f]{64}$")
    max_packages: int = Field(default=10, ge=1, le=20)


def _extract_packages(manifest_files: list[dict[str, Any]], checkout_files: dict[str, str]) -> list[str]:
    """Parse library names out of common dependency manifests (bounded)."""
    packages: list[str] = []
    for path, text in checkout_files.items():
        name = path.rsplit("/", 1)[-1]
        try:
            if name == "requirements.txt":
                for line in text.splitlines()[:200]:
                    line = line.strip()
                    if not line or line.startswith("#") or line.startswith("-"):
                        continue
                    pkg = re.split(r"[=<>~!;\s\[]", line, 1)[0].strip()
                    if pkg and len(pkg) < 100:
                        packages.append(pkg)
            elif name == "package.json":
                data = json.loads(text[:50000])
                for section in ("dependencies", "devDependencies"):
                    deps = data.get(section) or {}
                    if isinstance(deps, dict):
                        packages.extend([str(k)[:100] for k in list(deps)[:60]])
        except (ValueError, AttributeError):
            continue
    seen: list[str] = []
    for pkg in packages:
        if pkg not in seen:
            seen.append(pkg)
    return seen


@app.post("/api/dependency/audit")
async def dependency_audit(payload: DependencyAuditRequest) -> dict[str, Any]:
    """Audit third-party libraries of a prepared repo against OSV + CVE cache."""
    try:
        manifest = await anyio.to_thread.run_sync(
            lambda: list_repository_files(payload.repository_id, None, 500, 0)
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None
    dep_paths = [
        f["path"]
        for f in manifest.get("files", [])
        if f["path"].rsplit("/", 1)[-1] in ("requirements.txt", "package.json")
    ][:6]
    texts: dict[str, str] = {}
    for path in dep_paths:
        try:
            doc = await anyio.to_thread.run_sync(
                lambda p=path: read_repository_file(
                    payload.repository_id, p, 1, 300, 50000
                )
            )
            texts[path] = str(doc.get("content", ""))
        except Exception:
            continue
    packages = _extract_packages(manifest.get("files", []), texts)[: payload.max_packages]

    async def check_one(pkg: str) -> dict[str, Any]:
        try:
            cached = await anyio.to_thread.run_sync(lambda: lookup_cves(pkg, 10))
        except Exception:
            cached = []
        live: list[dict[str, Any]] = []
        try:
            live = await osv_query(pkg, 5)
        except Exception:
            pass
        merged: dict[str, Any] = {c["cve_id"]: c for c in cached if c.get("cve_id")}
        for item in live:
            if item.get("cve_id"):
                merged[item["cve_id"]] = item
                try:
                    await anyio.to_thread.run_sync(
                        lambda it=item: upsert_cve(
                            it["cve_id"], it.get("pkg", ""), it.get("severity", ""),
                            it.get("summary", ""), it.get("url", ""),
                        )
                    )
                except Exception:
                    continue
        return {"package": pkg, "vulns": list(merged.values())[:8], "count": len(merged)}

    results: list[dict[str, Any]] = []
    try:
        async with anyio.create_task_group() as tg:
            async def _append(pkg: str) -> None:
                results.append(await check_one(pkg))

            for pkg in packages:
                tg.start_soon(_append, pkg)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Dependency audit failed") from exc
    results.sort(key=lambda r: -r["count"])
    total = sum(r["count"] for r in results)
    try:
        summary = "\n".join(
            f"{r['package']}: " + ", ".join(v.get("cve_id", "?") for v in r["vulns"][:4])
            for r in results[:10]
            if r["count"]
        )
        if summary:
            await anyio.to_thread.run_sync(
                lambda: upsert_document(
                    scope="global",
                    text=f"Dependency audit for {payload.repository_id}:\n{summary}",
                    title="Dependency audit",
                    source="dependency-audit",
                )
            )
    except Exception:
        pass
    return {
        "repository_id": payload.repository_id,
        "packages_checked": [r["package"] for r in results],
        "total_vulns": total,
        "results": results,
    }


@app.post("/api/calculator")
async def calculator(payload: CalculatorRequest) -> dict[str, Any]:
    return calculate(payload.expression)


@app.post("/api/repository")
async def repository(payload: RepositoryRequest) -> dict[str, Any]:
    try:
        prepared = await anyio.to_thread.run_sync(lambda: prepare_repository(payload.url))
    except RepositorySafetyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:
        raise HTTPException(status_code=502, detail="Repository could not be analyzed") from None
    return {
        "name": prepared["name"],
        "url": str(prepared["url"]).removesuffix(".git"),
        "repository_id": prepared["repository_id"],
        "commit_sha": prepared["commit_sha"],
        "file_count": prepared["file_count"],
        "total_bytes": prepared["total_bytes"],
        "languages": dict(list(prepared["languages"].items())[:10]),
        "dependency_files": prepared["dependency_files"],
        "findings_total": prepared["findings_total"],
        "findings": prepared["findings"][:60],
    }


def _repository_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, RepositoryNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, RepositorySafetyError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=502, detail="Repository operation failed")


@app.post("/api/repository/prepare")
async def repository_prepare(payload: RepositoryPrepareRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(
            lambda: prepare_repository(payload.url, refresh=payload.refresh)
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None


class RepositoryCloneRequest(BaseModel):
    model_config = {"extra": "forbid"}

    url: str = Field(min_length=10, max_length=300)
    chat_id: str = Field(default="default", max_length=200)
    device_id: str = Field(default="", max_length=120)


def _safe_chat_dir(chat_id: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", chat_id or ""):
        return f"chat-{chat_id}"
    digest = hashlib.sha256((chat_id or "default").encode("utf-8")).hexdigest()[:16]
    return f"chat-{digest}"


def _clone_info_path(chat_dir: Path) -> Path:
    return chat_dir / ".clone_info.json"


def _prune_old_chat_sandboxes(root: Path, keep: int = 5, max_age_hours: int = 24) -> None:
    try:
        dirs = sorted(
            (d for d in root.glob("chat-*") if d.is_dir()),
            key=lambda d: d.stat().st_mtime,
            reverse=True,
        )
        now = time.time()
        for old in dirs[keep:]:
            try:
                if now - old.stat().st_mtime > max_age_hours * 3600:
                    shutil.rmtree(old, ignore_errors=True)
            except OSError:
                continue
    except OSError:
        pass


def _split_progress_text(text: str) -> list[str]:
    parts = re.split(r"[\r\n]+", text)
    return [p.strip() for p in parts if p.strip()][-40:]


# Live clone sessions: one leader runs git per (chat, url); followers (the UI
# sandbox shell, a repeated tool call) replay + follow the same live lines.
# Single uvicorn worker => in-process dict is sufficient.
_CLONE_SESSIONS: dict[str, dict[str, Any]] = {}
_CLONE_LOCK = threading.Lock()
_CLONE_TTL = 6 * 3600


def _clone_key(chat_dir: Path, display_url: str) -> str:
    return f"{chat_dir}::{display_url}"


def _prune_sessions() -> None:
    now = time.time()
    for key in [k for k, s in _CLONE_SESSIONS.items() if now - s["started"] > _CLONE_TTL]:
        _CLONE_SESSIONS.pop(key, None)


def _clone_leader_loop(session: dict[str, Any]) -> None:
    """Run git, broadcast live lines into session['lines'], then finalize."""
    from tools.repository_workspace import repository_id_for_url

    canonical_git = session["canonical_git"]
    display_url = session["display_url"]
    chat_dir: Path = session["chat_dir"]
    dest: Path = session["dest"]
    url: str = session["url"]
    try:
        proc = subprocess.Popen(
            ["git", "clone", "--depth", "1", "--progress", canonical_git, str(dest)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            bufsize=1,
            env={
                "GIT_ALLOW_PROTOCOL": "https",
                "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_LFS_SKIP_SMUDGE": "1",
                "GIT_TERMINAL_PROMPT": "0",
                "PATH": os.environ.get("PATH", ""),
            },
        )
        buf = ""
        assert proc.stdout is not None
        try:
            while True:
                chunk = proc.stdout.read(256)
                if not chunk:
                    break
                buf += chunk
                while "\r" in buf or "\n" in buf:
                    idx_r = buf.find("\r") if "\r" in buf else len(buf)
                    idx_n = buf.find("\n") if "\n" in buf else len(buf)
                    idx = min(idx_r, idx_n)
                    line = buf[:idx].strip()
                    buf = buf[idx + 1 :]
                    if line:
                        session["lines"].append(line[-300:])
            proc.wait(timeout=180)
        except Exception as exc:
            proc.kill()
            session["error"] = str(exc)[:300]
            return
        if buf.strip():
            session["lines"].append(buf.strip()[-300:])
        if proc.returncode != 0:
            session["error"] = f"git exited {proc.returncode}"
            return
        rev = subprocess.run(
            ["git", "-C", str(dest), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=15,
        )
        commit_sha = rev.stdout.strip() if rev.returncode == 0 else ""
        try:
            manifest = build_repository_manifest(dest)
        except RepositorySafetyError:
            manifest = {"file_count": 0, "total_bytes": 0, "languages": {}}
        result = {
            "commands": [f"git clone --depth 1 --progress {display_url} {dest}"],
            "url": display_url,
            "repository_id": repository_id_for_url(canonical_git),
            "commit_sha": commit_sha,
            "file_count": manifest["file_count"],
            "total_bytes": manifest["total_bytes"],
            "languages": dict(list(manifest["languages"].items())[:8]),
            "sandbox_dir": str(dest),
            "cached": False,
            "ts": time.time(),
        }
        result["transcript"] = [
            f"Cloning into '{dest}'...",
            *session["lines"],
            f"✓ cloned @ {commit_sha[:7]} · {manifest['file_count']} files",
        ][-40:]
        try:
            _clone_info_path(chat_dir).write_text(json.dumps(result), encoding="utf-8")
        except OSError:
            pass
        session["result"] = result
    finally:
        session["done"] = True
        try:
            _prune_old_chat_sandboxes(
                Path(os.environ.get("REPOSITORY_ROOT", "/srv/tools/repositories"))
            )
        except OSError:
            pass
        # Seed the shared analysis cache so repository_context/files/search/scan
        # work without a second network clone in most cases.
        try:
            prepare_repository(url, refresh=False)
        except Exception:
            pass


def _clone_cached(chat_dir: Path, dest: Path, display_url: str) -> dict[str, Any] | None:
    info_path = _clone_info_path(chat_dir)
    if not info_path.is_file():
        return None
    try:
        info = json.loads(info_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if (
        info.get("url") == display_url
        and dest.is_dir()
        and time.time() - float(info.get("ts", 0)) < _CLONE_TTL
    ):
        return {**info, "cached": True}
    return None


def run_visible_clone(url: str, chat_id: str) -> dict[str, Any]:
    """Real `git clone --depth 1 --progress` into the per-chat sandbox dir.

    Idempotent per chat; concurrent callers follow the in-progress session
    instead of starting a second clone.
    """
    canonical_git = validate_github_url(url)
    display_url = canonical_git.removesuffix(".git")
    root = Path(os.environ.get("REPOSITORY_ROOT", "/srv/tools/repositories"))
    root.mkdir(parents=True, exist_ok=True)
    chat_dir = root / _safe_chat_dir(chat_id or "default")
    dest = chat_dir / "repo"

    cached = _clone_cached(chat_dir, dest, display_url)
    if cached:
        return cached

    with _CLONE_LOCK:
        _prune_sessions()
        key = _clone_key(chat_dir, display_url)
        session = _CLONE_SESSIONS.get(key)
        if session is None or session.get("done"):
            if session is not None:
                _CLONE_SESSIONS.pop(key, None)
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            chat_dir.mkdir(parents=True, exist_ok=True)
            session = {
                "started": time.time(),
                "lines": [],
                "done": False,
                "result": None,
                "error": None,
                "canonical_git": canonical_git,
                "display_url": display_url,
                "chat_dir": chat_dir,
                "dest": dest,
                "url": url,
            }
            _CLONE_SESSIONS[key] = session
            leader = True
        else:
            leader = False

    if leader:
        _clone_leader_loop(session)
    else:
        deadline = time.time() + 200
        while not session["done"] and time.time() < deadline:
            time.sleep(0.25)
        if not session["done"]:
            raise RepositorySafetyError("Clone is still running in another call")

    if session.get("error"):
        raise RepositorySafetyError(f"Clone failed: {session['error'][:300]}")
    result = dict(session["result"] or {})
    if not leader:
        result["cached"] = True
    return result


@app.post("/api/repository/clone")
async def repository_clone(payload: RepositoryCloneRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(
            lambda: run_visible_clone(payload.url, payload.chat_id or "default")
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None


@app.post("/api/repository/clone/stream")
async def repository_clone_stream(payload: RepositoryCloneRequest) -> StreamingResponse:
    """Follow the live clone session (SSE): replays + follows the leader's git
    output line-by-line like an engineer watching a terminal, then final JSON.
    Starts the clone itself if the agent hasn't yet (UI watchdog path)."""
    try:
        canonical_git = validate_github_url(payload.url)
    except Exception as exc:
        raise _repository_http_error(exc) from None
    display_url = canonical_git.removesuffix(".git")
    root = Path(os.environ.get("REPOSITORY_ROOT", "/srv/tools/repositories"))
    root.mkdir(parents=True, exist_ok=True)
    chat_dir = root / _safe_chat_dir(payload.chat_id or "default")
    dest = chat_dir / "repo"
    clone_cmd = f"git clone --depth 1 --progress {display_url} {dest}"

    async def generate() -> Any:
        cached = await anyio.to_thread.run_sync(
            lambda: _clone_cached(chat_dir, dest, display_url)
        )
        if cached:
            yield f"data: {json.dumps({'type': 'command', 'line': clone_cmd})}\n\n"
            yield f"data: {json.dumps({'type': 'line', 'line': 'Reusing per-chat sandbox clone (cached).'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'result': cached})}\n\n"
            return

        import threading as _threading

        with _CLONE_LOCK:
            _prune_sessions()
            key = _clone_key(chat_dir, display_url)
            session = _CLONE_SESSIONS.get(key)
            if session is None or session.get("done"):
                if session is not None:
                    _CLONE_SESSIONS.pop(key, None)
                if dest.exists():
                    shutil.rmtree(dest, ignore_errors=True)
                chat_dir.mkdir(parents=True, exist_ok=True)
                session = {
                    "started": time.time(),
                    "lines": [],
                    "done": False,
                    "result": None,
                    "error": None,
                    "canonical_git": canonical_git,
                    "display_url": display_url,
                    "chat_dir": chat_dir,
                    "dest": dest,
                    "url": payload.url,
                }
                _CLONE_SESSIONS[key] = session
                thread = _threading.Thread(target=_clone_leader_loop, args=(session,), daemon=True)
                thread.start()

        yield f"data: {json.dumps({'type': 'command', 'line': clone_cmd})}\n\n"
        cloning_into = f"Cloning into '{dest}'..."
        yield f"data: {json.dumps({'type': 'line', 'line': cloning_into})}\n\n"
        pos = 0
        deadline = time.time() + 220
        while time.time() < deadline:
            lines = session["lines"][pos:]
            pos += len(lines)
            for line in lines:
                yield f"data: {json.dumps({'type': 'line', 'line': line})}\n\n"
            if session["done"]:
                break
            await anyio.sleep(0.25)
        for line in session["lines"][pos:]:
            yield f"data: {json.dumps({'type': 'line', 'line': line})}\n\n"
        if not session["done"]:
            yield f"data: {json.dumps({'type': 'error', 'line': 'Clone follow timed out'})}\n\n"
        elif session.get("error"):
            yield f"data: {json.dumps({'type': 'error', 'line': str(session['error'])[:300]})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'done', 'result': session['result']})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/repository/context")
async def repository_context_endpoint(payload: RepositoryContextRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(lambda: repository_context(payload.repository_id))
    except Exception as exc:
        raise _repository_http_error(exc) from None


@app.post("/api/repository/files")
async def repository_files(payload: RepositoryFilesRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(
            lambda: list_repository_files(
                payload.repository_id,
                payload.path_prefix,
                payload.limit,
                payload.offset,
            )
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None


@app.post("/api/repository/file")
async def repository_file(payload: RepositoryFileRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(
            lambda: read_repository_file(
                payload.repository_id,
                payload.path,
                payload.start_line,
                payload.end_line,
                payload.max_chars,
            )
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None


@app.post("/api/repository/search")
async def repository_search(payload: RepositorySearchRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(
            lambda: search_repository(
                payload.repository_id,
                payload.query,
                payload.path_prefix,
                payload.max_results,
            )
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None


@app.post("/api/repository/scan")
async def repository_scan(payload: RepositoryScanRequest) -> dict[str, Any]:
    try:
        return await anyio.to_thread.run_sync(
            lambda: scan_repository(payload.repository_id, refresh=payload.refresh)
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None


def _extension_of(filename: str, explicit: str | None) -> str:
    if explicit:
        return explicit.lower().lstrip(".")
    dot = filename.rfind(".")
    if dot >= 0:
        return filename[dot + 1 :].lower()
    raise HTTPException(status_code=422, detail="Provide a format or an extension in the filename")


@app.post("/api/document/create")
async def document_create(payload: DocumentCreateRequest) -> dict[str, Any]:
    fmt = _extension_of(payload.filename, payload.format)
    if fmt not in FORMATS:
        raise HTTPException(
            status_code=422, detail=f"Supported formats: {', '.join(sorted(FORMATS))}"
        )
    try:
        entry = await anyio.to_thread.run_sync(
            lambda: save_document(payload.filename, fmt, payload.content)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return {"document": entry, "download": f"/api/document/{entry['id']}/download"}


@app.post("/api/document/modify")
async def document_modify(payload: DocumentModifyRequest) -> dict[str, Any]:
    try:
        entry = await anyio.to_thread.run_sync(
            lambda: modify_document(payload.document_id, payload.content)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Document not found") from None
    return {"document": entry, "download": f"/api/document/{entry['id']}/download"}


@app.get("/api/document/list")
async def document_list() -> dict[str, Any]:
    return {"documents": list_documents()}


@app.get("/api/document/{document_id}/download")
async def document_download(document_id: str) -> Response:
    entry = get_entry(document_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Document not found")
    blob = await anyio.to_thread.run_sync(lambda: read_bytes(entry))
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{entry["filename"]}"'},
    )


async def _sandbox_execute(
    code: str, input_json: dict[str, Any] | None, timeout_seconds: int
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "code": code,
        "input_json": input_json or {},
        "timeout_seconds": min(max(timeout_seconds, 1), 30),
    }
    headers = {}
    if SANDBOX_TOKEN:
        headers["X-Sandbox-Token"] = SANDBOX_TOKEN
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds + 10) as client:
            response = await client.post(f"{SANDBOX_URL}/v1/execute", json=body, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Sandbox service unavailable") from None
    if response.status_code >= 400:
        try:
            detail = response.json().get("error") or response.json().get("detail")
        except Exception:
            detail = response.text[:300]
        raise HTTPException(
            status_code=response.status_code, detail=f"Sandbox rejected execution: {detail}"
        )
    result = response.json()
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Sandbox returned an invalid response")
    return result


async def _sandbox_repository_execute(payload: RepositoryRunRequest) -> dict[str, Any]:
    body = payload.model_dump(exclude_none=True)
    headers = {"X-Sandbox-Token": SANDBOX_TOKEN} if SANDBOX_TOKEN else {}
    try:
        async with httpx.AsyncClient(timeout=payload.timeout_seconds + 10) as client:
            response = await client.post(
                f"{SANDBOX_URL}/v1/repository/execute", json=body, headers=headers
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Sandbox service unavailable") from None
    if response.status_code >= 400:
        try:
            detail = response.json().get("error") or response.json().get("detail")
        except Exception:
            detail = response.text[:300]
        raise HTTPException(
            status_code=response.status_code, detail=f"Sandbox rejected execution: {detail}"
        )
    result = response.json()
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Sandbox returned an invalid response")
    return result


@app.post("/api/repository/run")
async def repository_run(payload: RepositoryRunRequest) -> dict[str, Any]:
    try:
        descriptor = await anyio.to_thread.run_sync(
            lambda: describe_repository_run(
                payload.repository_id,
                payload.profile,
                payload.path,
                payload.timeout_seconds,
            )
        )
    except Exception as exc:
        raise _repository_http_error(exc) from None
    result = await _sandbox_repository_execute(payload)
    return {
        **result,
        "repository_id": payload.repository_id,
        "profile": payload.profile,
        "path": payload.path,
        "description": descriptor["description"],
    }


def _extract_sandbox_output(result: dict[str, Any]) -> tuple[str, str, bool, dict[str, Any] | None]:
    stdout = str(result.get("stdout") or "")
    stderr = str(result.get("stderr") or "")
    exit_code = result.get("exit_code", result.get("status"))
    ok = exit_code in (None, 0, "success", "completed")
    structured = result.get("output_json")
    if not isinstance(structured, dict):
        structured = None
        for line in stdout.splitlines():
            if line.startswith(RESULT_SENTINEL):
                try:
                    parsed = json.loads(line.removeprefix(RESULT_SENTINEL))
                    structured = parsed if isinstance(parsed, dict) else {"result": parsed}
                except Exception:
                    pass
    return stdout.strip(), stderr.strip(), bool(ok), structured


@app.post("/api/code/run")
async def code_run(payload: CodeRunRequest) -> dict[str, Any]:
    result = await _sandbox_execute(payload.code, {}, payload.timeout_seconds)
    stdout, stderr, ok, structured = _extract_sandbox_output(result)
    if structured == {"result": None}:
        structured = None
    return {
        "ok": ok,
        "result": structured,
        "stdout": stdout[-8000:],
        "stderr": stderr[-4000:],
        "command": "python -I task.py",
    }


async def _sandbox_terminal_execute(command: str, workdir: str | None, timeout_seconds: int) -> dict[str, Any]:
    body: dict[str, Any] = {
        "command": command,
        "workdir": workdir,
        "timeout_seconds": min(max(timeout_seconds, 1), 30),
    }
    headers = {}
    if SANDBOX_TOKEN:
        headers["X-Sandbox-Token"] = SANDBOX_TOKEN
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds + 10) as client:
            response = await client.post(f"{SANDBOX_URL}/v1/execute/terminal", json=body, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Sandbox service unavailable") from None
    if response.status_code >= 400:
        try:
            detail = response.json().get("error") or response.json().get("detail")
        except Exception:
            detail = response.text[:300]
        raise HTTPException(status_code=response.status_code, detail=f"Sandbox rejected terminal: {detail}")
    result = response.json()
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Sandbox returned an invalid response")
    return result


def _resolve_terminal_workdir(workdir: str | None, chat_id: str) -> str | None:
    """Default terminal commands into the per-chat cloned repo when present."""
    if workdir:
        return workdir
    if chat_id:
        candidate = (
            Path(os.environ.get("REPOSITORY_ROOT", "/srv/tools/repositories"))
            / _safe_chat_dir(chat_id)
            / "repo"
        )
        if candidate.is_dir():
            return str(candidate)
    return None


@app.post("/api/terminal/run")
async def terminal_run(payload: TerminalRunRequest) -> dict[str, Any]:
    workdir = _resolve_terminal_workdir(payload.workdir, payload.chat_id or "")
    # Tools and sandbox share the repository volume at different mount points.
    sandbox_workdir = workdir
    repo_root = os.environ.get("REPOSITORY_ROOT", "/srv/tools/repositories")
    if workdir and workdir.startswith(repo_root):
        sandbox_workdir = "/srv/repositories" + workdir[len(repo_root):]
    result = await _sandbox_terminal_execute(payload.command, sandbox_workdir, payload.timeout_seconds)
    stdout = str(result.get("stdout") or "")
    stderr = str(result.get("stderr") or "")
    exit_code = result.get("exit_code", 0)
    ok = exit_code in (0, "0", None, "success")
    lines = [f"ubuntu@sandbox:~$ {payload.command}"]
    for out_line in (stdout.strip().splitlines() or [])[-25:]:
        lines.append(out_line[:300])
    if stderr.strip():
        lines.append(f"[stderr] {stderr.strip().splitlines()[-1][:300]}")
    lines.append(f"[exit code: {exit_code}]")
    return {
        "ok": bool(ok),
        "command": payload.command,
        "workdir": result.get("output_json", {}).get("workdir", workdir or "/tmp")
        if isinstance(result.get("output_json"), dict)
        else (workdir or "/tmp"),
        "stdout": stdout[-8000:],
        "stderr": stderr[-4000:],
        "exit_code": exit_code,
        "transcript": lines[-30:],
    }


@app.post("/api/image/understand")
async def image_understand(payload: ImageUnderstandRequest) -> dict[str, Any]:
    import base64 as _b64

    code = textwrap.dedent(SANDBOX_IMAGE_SCRIPT)
    result = await _sandbox_execute(
        code, {"image_b64": payload.image_b64, "mime": payload.mime}, 45
    )
    _, stderr, ok, structured = _extract_sandbox_output(result)
    if not ok or not structured:
        raise HTTPException(
            status_code=502, detail=f"Image analysis failed: {stderr[:300] or 'no result'}"
        )
    response: dict[str, Any] = {
        "metrics": structured,
        "script_summary": {
            "language": "python",
            "lines": len(code.strip().splitlines()),
            "uses": ["PIL.Image", "ImageStat", "ImageFilter.FIND_EDGES", "pillow_heif (optional)"],
        },
    }
    # Keep the upload as a real file in the per-chat sandbox so the agent can
    # run its own PIL/numpy analysis code against the path (and the user can
    # see that file referenced in the sandbox).
    if payload.chat_id:
        try:
            raw = _b64.b64decode(payload.image_b64, validate=False)
        except Exception:
            raw = b""
        if raw and len(raw) <= 12 * 1024 * 1024:
            root = Path(os.environ.get("REPOSITORY_ROOT", "/srv/tools/repositories"))
            assets = root / _safe_chat_dir(payload.chat_id) / "assets"
            try:
                assets.mkdir(parents=True, exist_ok=True)
                name = _safe_asset_name(payload.filename, payload.mime)
                target = assets / name
                counter = 1
                while target.exists():
                    counter += 1
                    target = assets / _safe_asset_name(payload.filename, payload.mime, counter)
                target.write_bytes(raw)
                rel = f"chat-{_safe_chat_dir(payload.chat_id).removeprefix('chat-')}/assets/{target.name}"
                response["asset_path"] = str(target)
                response["sandbox_path"] = f"/srv/repositories/{rel}"
                response["asset_hint"] = (
                    f"Image saved for code analysis at {response['sandbox_path']} "
                    "(also readable as "
                    f"/srv/tools/repositories/{rel}). Analyze it with Run Python "
                    "(PIL, numpy, os allowed); save figures to /tmp and report metrics."
                )
            except OSError:
                pass
    return response
