"""Persistent, bounded workspaces for attached GitHub repositories.

The checkout is untrusted input.  This module therefore treats the manifest as
an allow-list rather than trusting paths supplied by an API client.  Repository
source returned to a model is also redacted for common credential formats.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from tools.repository import (
    _SECURITY_RULES,
    RepositorySafetyError,
    clone_repository,
    validate_github_url,
)

DEFAULT_REPOSITORY_ROOT = Path("/srv/tools/repositories")
REPOSITORY_ROOT = DEFAULT_REPOSITORY_ROOT

# These match the limits already used by the repository ingestion code.
MAX_FILES = 20_000
MAX_TOTAL_BYTES = 262_144_000  # 250 MiB
MAX_FILE_BYTES = 26_214_400  # 25 MiB
MAX_FINDINGS = 500

MAX_CONTEXT_CHARS = 32_000
MAX_CONTEXT_TREE_ENTRIES = 2_000
MAX_CONTEXT_TREE_CHARS = 16_000
MAX_INLINE_FILE_BYTES = 16_384
MAX_INLINE_SOURCE_CHARS = 24_000

_IGNORED_DIRECTORIES = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    "vendor",
}
_REPOSITORY_ID_RE = re.compile(r"^repo-[0-9a-f]{64}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_SECRET_NAME = (
    r"[A-Za-z0-9_-]*(?:password|passwd|secret|api[_-]?key|token|access[_-]?key|"
    r"client[_-]?secret|private[_-]?key)[A-Za-z0-9_-]*"
)
_SECRET_ASSIGNMENT_RE = re.compile(
    rf"(?i)(?P<prefix>\b{_SECRET_NAME}\b\s*[:=]\s*)"
    r"(?P<quote>[\"'])(?P<value>[^\"'\r\n]{8,})(?P=quote)"
)
_UNQUOTED_SECRET_RE = re.compile(
    rf"(?i)(?P<prefix>\b{_SECRET_NAME}\b\s*[:=]\s*)"
    r"(?P<value>[A-Za-z0-9_./+\-=]{8,})"
)
_BEARER_RE = re.compile(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}")
_TOKEN_RE = re.compile(
    r"\b(?:ghp_|github_pat_|glpat-|xox[baprs]-|sk-[A-Za-z0-9_-]{8,})"
    r"[A-Za-z0-9._-]{8,}"
)
_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN ([A-Z ]*PRIVATE KEY)-----.+?-----END \1-----", re.DOTALL
)
_LOCK = threading.RLock()


class RepositoryNotFoundError(RepositorySafetyError):
    """Raised when a requested prepared repository does not exist."""


def repository_root(
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> Path:
    """Return the configured persistent root without trusting caller paths."""

    if root is not None and repository_root_path is not None:
        raise ValueError("Pass only one repository root")
    if root is not None:
        return Path(root)
    if repository_root_path is not None:
        return Path(repository_root_path)
    return Path(os.environ.get("REPOSITORY_ROOT", str(REPOSITORY_ROOT)))


def repository_id_for_url(remote_url: str) -> str:
    """Return the stable identifier for a validated, canonical GitHub URL."""

    canonical = validate_github_url(remote_url)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"repo-{digest}"


def validate_repository_id(repository_id: str) -> str:
    if not isinstance(repository_id, str) or _REPOSITORY_ID_RE.fullmatch(repository_id) is None:
        raise RepositorySafetyError("Invalid repository identifier")
    return repository_id


def validate_repository_path(path: str, *, allow_empty: bool = False) -> str:
    """Validate a repository-relative POSIX path and return its normalized form."""

    if not isinstance(path, str) or "\x00" in path or "\\" in path:
        raise RepositorySafetyError("Repository paths must be relative POSIX paths")
    if not path:
        if allow_empty:
            return ""
        raise RepositorySafetyError("Repository path is required")
    if path.startswith("/"):
        raise RepositorySafetyError("Absolute repository paths are not allowed")
    parts = path.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise RepositorySafetyError("Repository path traversal is not allowed")
    normalized = PurePosixPath(path).as_posix()
    if normalized != path:
        raise RepositorySafetyError("Repository path is not canonical")
    return normalized


def _safe_root(
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> Path:
    configured = repository_root(root, repository_root_path=repository_root_path)
    if configured.exists() and configured.is_symlink():
        raise RepositorySafetyError("Repository root must not be a symbolic link")
    configured.mkdir(parents=True, exist_ok=True)
    resolved = configured.resolve()
    if not resolved.is_dir():
        raise RepositorySafetyError("Repository root is not a directory")
    return resolved


def _safe_repository_directory(root: Path, repository_id: str, *, missing_ok: bool = False) -> Path:
    validate_repository_id(repository_id)
    candidate = root / repository_id
    if not candidate.resolve().is_relative_to(root):
        raise RepositorySafetyError("Repository path escapes the repository root")
    if candidate.is_symlink():
        raise RepositorySafetyError("Repository workspace must not be a symbolic link")
    if not candidate.exists():
        if missing_ok:
            return candidate
        raise RepositoryNotFoundError("Prepared repository was not found")
    if not candidate.is_dir():
        raise RepositorySafetyError("Repository workspace is not a directory")
    return candidate


def _safe_child(parent: Path, relative: str, *, directory: bool = False) -> Path:
    path = parent / relative
    if path.is_symlink():
        raise RepositorySafetyError("Repository metadata or checkout contains a symbolic link")
    resolved_parent = parent.resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(resolved_parent):
        raise RepositorySafetyError("Repository path escapes its workspace")
    if directory and not path.is_dir():
        raise RepositoryNotFoundError("Repository checkout is not available")
    if not directory and not path.is_file():
        raise RepositoryNotFoundError("Repository file is not available")
    return path


def _iter_checkout_files(root: Path) -> Iterator[Path]:
    """Yield non-ignored regular files in stable order, rejecting symlinks."""

    if not root.is_dir() or root.is_symlink():
        raise RepositorySafetyError("Repository checkout is not a regular directory")
    resolved_root = root.resolve()
    for current, directories, filenames in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative_parts = current_path.relative_to(root).parts
        if any(part in _IGNORED_DIRECTORIES for part in relative_parts):
            directories[:] = []
            continue
        kept_directories: list[str] = []
        for name in sorted(directories):
            directory = current_path / name
            if directory.is_symlink():
                raise RepositorySafetyError(
                    f"Repository contains a symbolic link: {directory.relative_to(root).as_posix()}"
                )
            resolved_directory = directory.resolve()
            if not resolved_directory.is_relative_to(resolved_root):
                raise RepositorySafetyError("Repository contains a path outside its checkout")
            if name not in _IGNORED_DIRECTORIES:
                kept_directories.append(name)
        directories[:] = kept_directories
        for name in sorted(filenames):
            path = current_path / name
            if path.is_symlink():
                raise RepositorySafetyError(
                    f"Repository contains a symbolic link: {path.relative_to(root).as_posix()}"
                )
            resolved_path = path.resolve()
            if not resolved_path.is_relative_to(resolved_root):
                raise RepositorySafetyError("Repository contains a path outside its checkout")
            if path.is_file():
                yield path


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1_048_576), b""):
            digest.update(block)
    return digest.hexdigest()


def build_bounded_manifest(root: Path) -> dict[str, Any]:
    """Build a complete, deterministic manifest for a prepared checkout."""

    files: list[dict[str, Any]] = []
    language_counts: dict[str, int] = {}
    dependency_files: list[str] = []
    total_bytes = 0
    dependency_names = {
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "requirements.txt",
        "poetry.lock",
        "pyproject.toml",
        "Pipfile.lock",
        "go.mod",
        "Cargo.lock",
        "pom.xml",
        "Gemfile.lock",
    }

    for path in _iter_checkout_files(root):
        if len(files) >= MAX_FILES:
            raise RepositorySafetyError("Repository contains too many files")
        relative = path.relative_to(root).as_posix()
        validate_repository_path(relative)
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise RepositorySafetyError("Repository contains an oversized file")
        if total_bytes + size > MAX_TOTAL_BYTES:
            raise RepositorySafetyError("Repository exceeds the configured size limit")
        extension = path.suffix.lower() or "[none]"
        language_counts[extension] = language_counts.get(extension, 0) + 1
        total_bytes += size
        if path.name in dependency_names:
            dependency_files.append(relative)
        files.append(
            {
                "path": relative,
                "size": size,
                "extension": extension,
                "sha256": _file_hash(path),
            }
        )

    languages = dict(sorted(language_counts.items(), key=lambda item: (-item[1], item[0])))
    return {
        "file_count": len(files),
        "total_bytes": total_bytes,
        "languages": languages,
        "dependency_files": sorted(dependency_files),
        "truncated": False,
        "files": files,
    }


def _redact_text(text: str) -> str:
    def replace_quoted(match: re.Match[str]) -> str:
        return f'{match.group("prefix")}{match.group("quote")}[REDACTED]{match.group("quote")}'

    def replace_unquoted(match: re.Match[str]) -> str:
        return f'{match.group("prefix")}[REDACTED]'

    text = _PRIVATE_KEY_RE.sub(
        "-----BEGIN PRIVATE KEY-----[REDACTED]-----END PRIVATE KEY-----", text
    )
    text = _SECRET_ASSIGNMENT_RE.sub(replace_quoted, text)
    text = _UNQUOTED_SECRET_RE.sub(replace_unquoted, text)
    text = _BEARER_RE.sub(r"\1[REDACTED]", text)
    return _TOKEN_RE.sub("[REDACTED]", text)


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_value(item) for key, item in value.items()}
    return value


def _static_findings(root: Path) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for path in _iter_checkout_files(root):
        if len(findings) >= MAX_FINDINGS:
            break
        try:
            raw = path.read_bytes()
        except OSError:
            continue
        if b"\x00" in raw:
            continue
        text = raw.decode("utf-8", errors="ignore")
        lines = text.splitlines()
        relative = path.relative_to(root).as_posix()
        for rule_id, severity, title, pattern in _SECURITY_RULES:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                evidence = lines[line - 1].strip()[:240] if lines else ""
                findings.append(
                    {
                        "rule_id": rule_id,
                        "severity": severity,
                        "title": title,
                        "path": relative,
                        "line": line,
                        "evidence": _redact_text(evidence),
                    }
                )
                if len(findings) >= MAX_FINDINGS:
                    break
            if len(findings) >= MAX_FINDINGS:
                break
    return findings


def _json_load(path: Path, description: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise RepositorySafetyError(f"{description} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RepositorySafetyError(f"{description} is invalid") from exc
    if not isinstance(value, dict):
        raise RepositorySafetyError(f"{description} must contain an object")
    return value


def _validate_manifest(root: Path, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    raw_files = manifest.get("files")
    if not isinstance(raw_files, list) or len(raw_files) > MAX_FILES:
        raise RepositorySafetyError("Repository manifest has an invalid file list")
    files: list[dict[str, Any]] = []
    seen: set[str] = set()
    total_bytes = 0
    for raw_item in raw_files:
        if not isinstance(raw_item, dict):
            raise RepositorySafetyError("Repository manifest contains an invalid file entry")
        relative = validate_repository_path(str(raw_item.get("path", "")))
        if relative in seen:
            raise RepositorySafetyError("Repository manifest contains duplicate paths")
        seen.add(relative)
        try:
            size = int(raw_item["size"])
            extension = str(raw_item["extension"])
            sha256 = str(raw_item["sha256"])
        except (KeyError, TypeError, ValueError) as exc:
            raise RepositorySafetyError(
                "Repository manifest contains an incomplete file entry"
            ) from exc
        if size < 0 or size > MAX_FILE_BYTES or _SHA256_RE.fullmatch(sha256) is None:
            raise RepositorySafetyError("Repository manifest contains an invalid file entry")
        expected_extension = Path(relative).suffix.lower() or "[none]"
        if extension != expected_extension:
            raise RepositorySafetyError("Repository manifest extension does not match its path")
        checkout_file = _safe_child(root, relative)
        if checkout_file.stat().st_size != size:
            raise RepositorySafetyError(f"Repository file changed: {relative}")
        total_bytes += size
        if total_bytes > MAX_TOTAL_BYTES:
            raise RepositorySafetyError("Repository exceeds the configured size limit")
        files.append({"path": relative, "size": size, "extension": extension, "sha256": sha256})

    actual_paths = {
        path.relative_to(root).as_posix() for path in _iter_checkout_files(root)
    }
    if actual_paths != seen:
        raise RepositorySafetyError("Repository checkout does not match its manifest")
    if manifest.get("file_count") != len(files) or manifest.get("total_bytes") != total_bytes:
        raise RepositorySafetyError("Repository manifest summary is inconsistent")
    if not isinstance(manifest.get("languages"), dict) or not isinstance(
        manifest.get("dependency_files"), list
    ):
        raise RepositorySafetyError("Repository manifest summary is invalid")
    return files


def _load_repository(
    repository_id: str,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], Path]:
    safe_root = _safe_root(root, repository_root_path=repository_root_path)
    workspace = _safe_repository_directory(safe_root, repository_id)
    metadata = _json_load(workspace / "metadata.json", "Repository metadata")
    if metadata.get("repository_id") != repository_id:
        raise RepositorySafetyError("Repository metadata identifier does not match its path")
    url = metadata.get("url")
    if not isinstance(url, str):
        raise RepositorySafetyError("Repository metadata has no URL")
    canonical_url = validate_github_url(url)
    if repository_id_for_url(canonical_url) != repository_id:
        raise RepositorySafetyError("Repository metadata URL does not match its identifier")
    metadata["url"] = canonical_url
    checkout = _safe_child(workspace, "checkout", directory=True)
    manifest = _json_load(workspace / "manifest.json", "Repository manifest")
    if metadata.get("manifest") is not None and metadata.get("manifest") != manifest:
        raise RepositorySafetyError("Repository metadata and manifest disagree")
    files = _validate_manifest(checkout, manifest)
    raw_findings = metadata.get("findings", [])
    if not isinstance(raw_findings, list):
        raise RepositorySafetyError("Repository findings are invalid")
    for key in ("file_count", "total_bytes", "languages", "dependency_files"):
        if key in metadata and metadata[key] != manifest[key]:
            raise RepositorySafetyError(f"Repository metadata field is inconsistent: {key}")
    if "findings_total" in metadata and metadata["findings_total"] != len(raw_findings):
        raise RepositorySafetyError("Repository findings summary is inconsistent")
    known_paths = {str(item["path"]) for item in files}
    findings: list[dict[str, Any]] = []
    for item in raw_findings[:MAX_FINDINGS]:
        if not isinstance(item, dict):
            continue
        finding = _redact_value(dict(item))
        if finding.get("path") not in known_paths:
            continue
        if isinstance(finding.get("evidence"), str):
            finding["evidence"] = str(finding["evidence"])[:240]
        findings.append(finding)
    return metadata, manifest, findings, checkout


def _public_metadata(
    metadata: dict[str, Any], manifest: dict[str, Any], findings: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "repository_id": metadata["repository_id"],
        "url": metadata["url"],
        "name": metadata.get("name", ""),
        "commit_sha": metadata.get("commit_sha", ""),
        "prepared_at": metadata.get("prepared_at"),
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "languages": manifest["languages"],
        "dependency_files": manifest["dependency_files"],
        "findings_total": len(findings),
    }


def _response(
    metadata: dict[str, Any], manifest: dict[str, Any], findings: list[dict[str, Any]]
) -> dict[str, Any]:
    result = _public_metadata(metadata, manifest, findings)
    result["manifest"] = manifest
    result["findings"] = findings
    return result


def _write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _prepare_metadata(
    repository_id: str,
    url: str,
    checkout: Path,
    commit_sha: str,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    manifest = build_bounded_manifest(checkout)
    findings = _static_findings(checkout)
    name = url.removesuffix(".git").rsplit("/", 1)[-1]
    metadata: dict[str, Any] = {
        "repository_id": repository_id,
        "url": url,
        "name": name,
        "commit_sha": str(commit_sha).strip(),
        "prepared_at": datetime.now(UTC).isoformat(),
        "checkout_path": "checkout",
        "manifest_path": "manifest.json",
        "manifest": manifest,
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "languages": manifest["languages"],
        "dependency_files": manifest["dependency_files"],
        "findings_total": len(findings),
        "findings": findings,
    }
    if not metadata["commit_sha"]:
        raise RepositorySafetyError("Repository commit SHA is missing")
    return metadata, manifest, findings


def _install_prepared_workspace(
    root: Path,
    repository_id: str,
    checkout: Path,
    metadata: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    workspace = _safe_repository_directory(root, repository_id, missing_ok=True)
    if workspace.exists() and workspace.is_symlink():
        raise RepositorySafetyError("Repository workspace must not be a symbolic link")
    stage = Path(tempfile.mkdtemp(prefix=f".{repository_id}.", dir=root))
    old_workspace: Path | None = None
    try:
        staged_checkout = stage / "checkout"
        shutil.move(str(checkout), str(staged_checkout))
        _write_json(stage / "manifest.json", manifest)
        _write_json(stage / "metadata.json", metadata)
        if workspace.exists():
            old_workspace = root / f".{repository_id}.old"
            if old_workspace.exists() or old_workspace.is_symlink():
                shutil.rmtree(old_workspace, ignore_errors=True)
            workspace.rename(old_workspace)
        stage.rename(workspace)
        if old_workspace is not None:
            shutil.rmtree(old_workspace, ignore_errors=True)
    except Exception:
        if workspace.exists() and old_workspace is not None and not old_workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
        if old_workspace is not None and old_workspace.exists() and not workspace.exists():
            old_workspace.rename(workspace)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)


def prepare_repository(
    remote_url: str,
    refresh: bool = False,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    """Prepare or reuse a shallow checkout and return its bounded metadata."""

    canonical_url = validate_github_url(remote_url)
    repository_id = repository_id_for_url(canonical_url)
    safe_root = _safe_root(root, repository_root_path=repository_root_path)
    with _LOCK:
        workspace = _safe_repository_directory(safe_root, repository_id, missing_ok=True)
        if workspace.exists() and not refresh:
            metadata, manifest, findings, _ = _load_repository(
                repository_id, safe_root, repository_root_path=None
            )
            if metadata.get("url") != canonical_url:
                raise RepositorySafetyError("Prepared repository URL does not match the request")
            return _response(metadata, manifest, findings)

        stage = Path(tempfile.mkdtemp(prefix=f".{repository_id}.clone.", dir=safe_root))
        cloned_checkout: Path | None = None
        try:
            cloned_checkout, commit_sha = clone_repository(canonical_url, stage)
            checkout = stage / "checkout"
            if cloned_checkout != checkout:
                cloned_checkout.rename(checkout)
            metadata, manifest, findings = _prepare_metadata(
                repository_id, canonical_url, checkout, commit_sha
            )
            _install_prepared_workspace(safe_root, repository_id, checkout, metadata, manifest)
        except Exception:
            shutil.rmtree(stage, ignore_errors=True)
            raise
        finally:
            shutil.rmtree(stage, ignore_errors=True)
        metadata, manifest, findings, _ = _load_repository(repository_id, safe_root)
        return _response(metadata, manifest, findings)


def _manifest_entry(files: list[dict[str, Any]], path: str) -> dict[str, Any]:
    relative = validate_repository_path(path)
    for item in files:
        if item["path"] == relative:
            return item
    raise RepositoryNotFoundError("Repository file was not found in the manifest")


def _validated_file_bytes(checkout: Path, entry: dict[str, Any]) -> bytes:
    path = _safe_child(checkout, str(entry["path"]))
    raw = path.read_bytes()
    if len(raw) != int(entry["size"]) or _file_hash(path) != entry["sha256"]:
        raise RepositorySafetyError(f"Repository file changed: {entry['path']}")
    return raw


def list_repository_files(
    repository_id: str,
    path_prefix: str | None = None,
    limit: int = 100,
    offset: int = 0,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    if limit < 1 or limit > 500 or offset < 0:
        raise RepositorySafetyError("File listing bounds are invalid")
    prefix = validate_repository_path(path_prefix or "", allow_empty=True)
    _, manifest, _, _ = _load_repository(
        repository_id, root, repository_root_path=repository_root_path
    )
    files = [
        dict(item)
        for item in manifest["files"]
        if not prefix or item["path"].startswith(prefix)
    ]
    page = files[offset : offset + limit]
    return {
        "repository_id": repository_id,
        "path_prefix": prefix or None,
        "files": page,
        "total": len(files),
        "offset": offset,
        "limit": limit,
    }


def read_repository_file(
    repository_id: str,
    path: str,
    start_line: int | None = None,
    end_line: int | None = None,
    max_chars: int = 20_000,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    if max_chars < 1 or max_chars > 100_000:
        raise RepositorySafetyError("File read character bound is invalid")
    if start_line is not None and start_line < 1:
        raise RepositorySafetyError("start_line must be at least 1")
    if end_line is not None and end_line < 1:
        raise RepositorySafetyError("end_line must be at least 1")
    if start_line is not None and end_line is not None and end_line < start_line:
        raise RepositorySafetyError("end_line must not precede start_line")
    _, manifest, _, checkout = _load_repository(
        repository_id, root, repository_root_path=repository_root_path
    )
    entry = _manifest_entry(list(manifest["files"]), path)
    raw = _validated_file_bytes(checkout, entry)
    if b"\x00" in raw:
        raise RepositorySafetyError("Binary repository files cannot be read as text")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RepositorySafetyError("Binary repository files cannot be read as text") from exc
    lines = text.splitlines()
    first = (start_line or 1) - 1
    last = end_line if end_line is not None else len(lines)
    selected = "\n".join(lines[first:last])
    redacted = _redact_text(selected)
    truncated = len(redacted) > max_chars
    return {
        "repository_id": repository_id,
        "path": entry["path"],
        "content": redacted[:max_chars],
        "start_line": start_line or 1,
        "end_line": min(last, len(lines)),
        "line_count": len(lines),
        "size": entry["size"],
        "sha256": entry["sha256"],
        "truncated": truncated,
    }


def search_repository(
    repository_id: str,
    query: str,
    path_prefix: str | None = None,
    max_results: int = 50,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    if not isinstance(query, str) or not query or len(query) > 500:
        raise RepositorySafetyError("Search query is invalid")
    if max_results < 1 or max_results > 100:
        raise RepositorySafetyError("Search result bound is invalid")
    prefix = validate_repository_path(path_prefix or "", allow_empty=True)
    _, manifest, _, checkout = _load_repository(
        repository_id, root, repository_root_path=repository_root_path
    )
    results: list[dict[str, Any]] = []
    folded_query = query.casefold()
    for raw_entry in manifest["files"]:
        entry = dict(raw_entry)
        relative = str(entry["path"])
        if prefix and not relative.startswith(prefix):
            continue
        try:
            raw = _validated_file_bytes(checkout, entry)
            if b"\x00" in raw:
                continue
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            if folded_query in line.casefold():
                results.append(
                    {
                        "path": relative,
                        "line": line_number,
                        "text": _redact_text(line)[:1_000],
                    }
                )
                if len(results) >= max_results:
                    return {
                        "repository_id": repository_id,
                        "query": query,
                        "path_prefix": prefix or None,
                        "results": results,
                        "total": len(results),
                        "truncated": True,
                    }
    return {
        "repository_id": repository_id,
        "query": query,
        "path_prefix": prefix or None,
        "results": results,
        "total": len(results),
        "truncated": False,
    }


def repository_context(
    repository_id: str,
    max_chars: int = MAX_CONTEXT_CHARS,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    if max_chars < 1 or max_chars > 100_000:
        raise RepositorySafetyError("Context character bound is invalid")
    metadata, manifest, findings, checkout = _load_repository(
        repository_id, root, repository_root_path=repository_root_path
    )
    tree: list[dict[str, Any]] = []
    tree_chars = 0
    for raw_entry in manifest["files"]:
        if len(tree) >= MAX_CONTEXT_TREE_ENTRIES:
            break
        entry = {
            "path": raw_entry["path"],
            "size": raw_entry["size"],
            "extension": raw_entry["extension"],
        }
        entry_chars = len(json.dumps(entry, separators=(",", ":")))
        if tree_chars + entry_chars > MAX_CONTEXT_TREE_CHARS:
            break
        tree.append(entry)
        tree_chars += entry_chars

    inline_source: dict[str, str] = {}
    source_chars = 0
    for raw_entry in manifest["files"]:
        if int(raw_entry["size"]) > MAX_INLINE_FILE_BYTES:
            continue
        try:
            raw = _validated_file_bytes(checkout, raw_entry)
            if b"\x00" in raw:
                continue
            text = _redact_text(raw.decode("utf-8"))
        except UnicodeDecodeError:
            continue
        cost = len(text) + len(str(raw_entry["path"])) + 1
        if source_chars + cost > min(max_chars, MAX_INLINE_SOURCE_CHARS):
            continue
        inline_source[str(raw_entry["path"])] = text
        source_chars += cost

    return {
        "metadata": _public_metadata(metadata, manifest, findings),
        "file_tree": tree,
        "tree_truncated": len(tree) < len(manifest["files"]),
        "findings": findings[:60],
        "inline_source": inline_source,
        "inline_source_chars": source_chars,
        "source_budget": min(max_chars, MAX_INLINE_SOURCE_CHARS),
        "retrieval": {
            "file_endpoint": "/api/repository/file",
            "large_files_are_retrievable": True,
        },
    }


def scan_repository(
    repository_id: str,
    refresh: bool = False,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    """Return deterministic static findings, optionally rebuilding the scan."""

    safe_root = _safe_root(root, repository_root_path=repository_root_path)
    with _LOCK:
        metadata, manifest, findings, checkout = _load_repository(
            repository_id, safe_root, repository_root_path=None
        )
        if refresh:
            metadata, manifest, findings = _prepare_metadata(
                repository_id, str(metadata["url"]), checkout, str(metadata["commit_sha"])
            )
            workspace = _safe_repository_directory(safe_root, repository_id)
            _write_json(workspace / "manifest.json", manifest)
            _write_json(workspace / "metadata.json", metadata)
        return {
            "repository_id": repository_id,
            "commit_sha": metadata["commit_sha"],
            "manifest": manifest,
            "findings_total": len(findings),
            "findings": findings,
        }


_PROFILES = {
    "compile_python",
    "python_script",
    "python_tests",
    "compile_cpp",
    "cpp_script",
    "cpp_tests",
    "compile_all",
}
_CPP_EXTENSIONS = {".cpp", ".cc", ".c", ".cxx", ".h", ".hpp", ".hh"}


def validate_repository_run(
    repository_id: str,
    profile: str,
    path: str | None = None,
    timeout_seconds: int = 25,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    """Validate a fixed repository execution profile without executing it."""

    if profile not in _PROFILES:
        raise RepositorySafetyError("Unknown repository execution profile")
    if timeout_seconds < 1 or timeout_seconds > 30:
        raise RepositorySafetyError("Repository execution timeout is outside the sandbox limit")
    metadata, manifest, _, checkout = _load_repository(
        repository_id, root, repository_root_path=repository_root_path
    )
    files = list(manifest["files"])
    manifest_entry: dict[str, Any] | None = None
    normalized_path: str | None = None
    if path is not None:
        normalized_path = validate_repository_path(path)

    if profile == "python_script":
        if normalized_path is None:
            raise RepositorySafetyError("python_script requires a manifest-listed Python path")
        manifest_entry = _manifest_entry(files, normalized_path)
        if manifest_entry["extension"] != ".py":
            raise RepositorySafetyError("python_script only accepts a .py manifest entry")
        raw = _validated_file_bytes(checkout, manifest_entry)
        if b"\x00" in raw:
            raise RepositorySafetyError("python_script does not accept binary content")
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RepositorySafetyError("python_script does not accept binary content") from exc
    elif profile == "compile_python":
        if normalized_path is not None:
            manifest_entry = _manifest_entry(files, normalized_path)
            if manifest_entry["extension"] != ".py":
                raise RepositorySafetyError("compile_python only accepts a .py manifest entry")
            raw = _validated_file_bytes(checkout, manifest_entry)
            if b"\x00" in raw:
                raise RepositorySafetyError("compile_python does not accept binary content")
            try:
                raw.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise RepositorySafetyError(
                    "compile_python does not accept binary content"
                ) from exc
    elif profile in ("compile_cpp", "cpp_script"):
        if profile == "cpp_script" and normalized_path is None:
            raise RepositorySafetyError("cpp_script requires a manifest-listed C++ path")
        if normalized_path is not None:
            manifest_entry = _manifest_entry(files, normalized_path)
            if manifest_entry["extension"] not in _CPP_EXTENSIONS:
                raise RepositorySafetyError("cpp profile only accepts a C/C++ manifest entry")
            raw = _validated_file_bytes(checkout, manifest_entry)
            if b"\x00" in raw:
                raise RepositorySafetyError("cpp profile does not accept binary content")
    elif profile in ("cpp_tests", "python_tests") and normalized_path is not None:
        # A test start directory is useful, but it must be an existing directory
        # represented by at least one manifest path; arbitrary filesystem paths
        # are never passed to the subprocess.
        prefix = f"{normalized_path}/"
        if not any(str(item["path"]).startswith(prefix) for item in files):
            raise RepositorySafetyError(f"{profile} path is not a repository directory")
    elif profile == "compile_all" and normalized_path is not None:
        manifest_entry = _manifest_entry(files, normalized_path)
        if manifest_entry["extension"] not in {".py", *_CPP_EXTENSIONS}:
            raise RepositorySafetyError("compile_all only accepts a .py or C/C++ manifest entry")
    elif normalized_path is not None:
        prefix = f"{normalized_path}/"
        if not any(str(item["path"]).startswith(prefix) for item in files):
            raise RepositorySafetyError("path is not a repository directory")

    return {
        "valid": True,
        "repository_id": repository_id,
        "profile": profile,
        "path": normalized_path,
        "timeout_seconds": timeout_seconds,
        "commit_sha": metadata["commit_sha"],
        "manifest_entry": manifest_entry,
    }


def describe_repository_run(
    repository_id: str,
    profile: str,
    path: str | None = None,
    timeout_seconds: int = 25,
    root: Path | str | None = None,
    *,
    repository_root_path: Path | str | None = None,
) -> dict[str, Any]:
    """Describe the fixed command a sandbox may run after validation."""

    descriptor = validate_repository_run(
        repository_id,
        profile,
        path,
        timeout_seconds,
        root,
        repository_root_path=repository_root_path,
    )
    if profile == "python_script":
        command = ["python", "-I", f"./{path}"]
        description = "Run one manifest-listed Python script in the restricted sandbox"
    elif profile == "compile_python":
        command = ["python", "-I", "<fixed-syntax-checker>"]
        description = "Parse manifest-listed Python files without executing repository code"
    elif profile == "cpp_script":
        command = ["g++", "-fsyntax-only", f"./{path}"]
        description = "Syntax-check one manifest-listed C++ file in the restricted sandbox"
    elif profile == "compile_cpp":
        command = ["g++", "-fsyntax-only", "<cpp-files>"]
        description = "Syntax-check manifest-listed C++ files without executing repository code"
    elif profile == "cpp_tests":
        command = ["ctest", "--test-dir", f"./{path}" if path else "."]
        description = "Run CTest discovery in the read-only repository checkout"
    elif profile == "compile_all":
        command = ["python", "-I", "<python-checker> ; g++ -fsyntax-only <cpp-files>"]
        description = "Parse both Python and C++ files without executing repository code"
    else:
        command = ["python", "-I", "-m", "unittest", "discover"]
        description = "Run unittest discovery in the read-only repository checkout"
    return {**descriptor, "command": command, "description": description}


# Short aliases make the validation helpers convenient to import from callers
# that use "run" rather than "repository run" terminology.
validate_profiled_repository_run = validate_repository_run
describe_profiled_repository_run = describe_repository_run
get_repository_root = repository_root
build_repository_manifest = build_bounded_manifest
