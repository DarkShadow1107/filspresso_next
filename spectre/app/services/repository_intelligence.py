"""Deterministic repository metadata and public security-intelligence correlation.

Repository files are parsed as data only.  This module never imports, installs, or
executes repository code; execution remains behind the restricted sandbox profiles.
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

MAX_DEPENDENCIES = 40
MAX_QUERY_DEPENDENCIES = 4
MAX_SECURITY_QUERIES = 8

_DEPENDENCY_FILES = {
    "Cargo.lock",
    "Gemfile.lock",
    "Pipfile.lock",
    "go.mod",
    "package-lock.json",
    "package.json",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pom.xml",
    "pyproject.toml",
    "requirements.txt",
    "yarn.lock",
}
_CVE_RE = re.compile(r"\bCVE-\d{4}-\d{4,7}\b", re.IGNORECASE)
_GHSA_RE = re.compile(r"\bGHSA-[A-Za-z0-9-]{4,}\b", re.IGNORECASE)
_SECURITY_TERMS_RE = re.compile(
    r"\b(?:vulnerabilit(?:y|ies)|security advisory|exploit|remote code execution|"
    r"arbitrary code|privilege escalation|injection|malicious|patch(?:ed|es)?|"
    r"fixed|affected versions?)\b",
    re.IGNORECASE,
)
_PACKAGE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")


def _package(name: object, version: object = "", *, source: str) -> dict[str, str] | None:
    value = str(name or "").strip()
    match = _PACKAGE_NAME_RE.match(value)
    if match is None:
        return None
    package_name = match.group(0)
    if package_name.lower() in {"python", "node", "ruby", "go", "rust"}:
        return None
    return {
        "name": package_name,
        "version": str(version or "").strip()[:160],
        "source": source,
    }


def _requirements(text: str, source: str) -> list[dict[str, str]]:
    dependencies: list[dict[str, str]] = []
    for line in text.splitlines():
        value = line.strip()
        if not value or value.startswith(('-', '#')):
            continue
        candidate = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        match = _PACKAGE_NAME_RE.match(candidate)
        if match is not None:
            item = _package(match.group(0), candidate[len(match.group(0)) :], source=source)
            if item is not None:
                dependencies.append(item)
    return dependencies


def _pyproject(text: str, source: str) -> list[dict[str, str]]:
    try:
        document = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return _requirements(text, source)

    dependencies: list[dict[str, str]] = []
    project = document.get("project") if isinstance(document, dict) else None
    if isinstance(project, dict):
        for value in project.get("dependencies", []):
            if isinstance(value, str):
                match = _PACKAGE_NAME_RE.match(value.strip())
                if match is not None:
                    item = _package(
                        match.group(0), value[len(match.group(0)) :], source=source
                    )
                    if item is not None:
                        dependencies.append(item)
        optional = project.get("optional-dependencies", {})
        if isinstance(optional, dict):
            for values in optional.values():
                if isinstance(values, list):
                    for value in values:
                        if isinstance(value, str):
                            match = _PACKAGE_NAME_RE.match(value.strip())
                            if match is not None:
                                item = _package(
                                    match.group(0),
                                    value[len(match.group(0)) :],
                                    source=source,
                                )
                                if item is not None:
                                    dependencies.append(item)

    poetry = document.get("tool", {}).get("poetry", {}) if isinstance(document, dict) else {}
    poetry_dependencies = poetry.get("dependencies", {}) if isinstance(poetry, dict) else {}
    if isinstance(poetry_dependencies, dict):
        for name, version in poetry_dependencies.items():
            item = _package(name, version, source=source)
            if item is not None:
                dependencies.append(item)
    return dependencies


def _package_json(text: str, source: str) -> list[dict[str, str]]:
    try:
        document = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(document, dict):
        return []
    dependencies: list[dict[str, str]] = []
    for section in (
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ):
        values = document.get(section)
        if not isinstance(values, dict):
            continue
        for name, version in values.items():
            item = _package(name, version, source=source)
            if item is not None:
                dependencies.append(item)
    return dependencies


def _go_mod(text: str, source: str) -> list[dict[str, str]]:
    dependencies: list[dict[str, str]] = []
    in_require_block = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("require ("):
            in_require_block = True
            continue
        if in_require_block and line == ")":
            in_require_block = False
            continue
        if line.startswith("require "):
            line = line.removeprefix("require ").strip()
        if not in_require_block and not raw_line.lstrip().startswith("require "):
            continue
        parts = line.split()
        if len(parts) >= 2:
            item = _package(parts[0], parts[1], source=source)
            if item is not None:
                dependencies.append(item)
    return dependencies


def _cargo_lock(text: str, source: str) -> list[dict[str, str]]:
    dependencies: list[dict[str, str]] = []
    current_name = ""
    for line in text.splitlines():
        name_match = re.match(r'\s*name\s*=\s*"([^"]+)"', line)
        if name_match:
            current_name = name_match.group(1)
            continue
        version_match = re.match(r'\s*version\s*=\s*"([^"]+)"', line)
        if version_match and current_name:
            item = _package(current_name, version_match.group(1), source=source)
            if item is not None:
                dependencies.append(item)
            current_name = ""
    return dependencies


def _generic_lock(text: str, source: str) -> list[dict[str, str]]:
    dependencies: list[dict[str, str]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(('#', '"', '<')):
            continue
        match = re.match(r"([A-Za-z0-9][A-Za-z0-9_.-]{0,127})[ =:@]+([^\s,]+)", line)
        if match:
            item = _package(match.group(1), match.group(2), source=source)
            if item is not None:
                dependencies.append(item)
    return dependencies


def parse_dependency_file(path: str, text: str) -> list[dict[str, str]]:
    """Extract names and declared versions without evaluating project metadata."""

    name = Path(path).name
    if name == "requirements.txt":
        return _requirements(text, path)
    if name == "pyproject.toml":
        return _pyproject(text, path)
    if name in {"package.json", "package-lock.json"}:
        return _package_json(text, path)
    if name == "go.mod":
        return _go_mod(text, path)
    if name == "Cargo.lock":
        return _cargo_lock(text, path)
    if name in {
        "poetry.lock",
        "Pipfile.lock",
        "Gemfile.lock",
        "yarn.lock",
        "pnpm-lock.yaml",
    }:
        return _generic_lock(text, path)
    if name == "pom.xml":
        return [
            item
            for item in (
                _package(value, "", source=path)
                for value in re.findall(r"<artifactId>\s*([^<\s]+)\s*</artifactId>", text)
            )
            if item is not None
        ]
    return []


def build_dependency_profile(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    dependencies: list[dict[str, str]] = []
    dependency_files = [
        str(path)
        for path in manifest.get("dependency_files", [])
        if Path(str(path)).name in _DEPENDENCY_FILES
    ]
    for relative in dependency_files:
        path = root / relative
        try:
            raw = path.read_bytes()
            if len(raw) > 512_000 or b"\x00" in raw:
                continue
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        dependencies.extend(parse_dependency_file(relative, text))

    unique: dict[tuple[str, str], dict[str, str]] = {}
    for item in dependencies:
        key = (item["name"].casefold(), item["version"])
        unique.setdefault(key, item)
    return {
        "dependency_files": sorted(set(dependency_files)),
        "dependencies": list(unique.values())[:MAX_DEPENDENCIES],
        "languages": dict(manifest.get("languages") or {}),
    }


def _repository_label(repository_url: str | None, repository_name: str) -> str:
    if repository_url:
        path = urlparse(repository_url).path.strip("/").removesuffix(".git")
        if path:
            return path
    return repository_name.strip() or "repository"


def build_security_queries(
    *,
    repository_url: str | None,
    repository_name: str,
    question: str,
    dependencies: list[dict[str, str]],
) -> list[str]:
    label = _repository_label(repository_url, repository_name)
    queries = [
        f'"{label}" security advisory CVE vulnerability',
        f'"{label}" GitHub issue discussion security vulnerability',
        f'"{label}" recent security patch release',
        f'"{label}" {question.strip()[:180]} security',
    ]
    for dependency in dependencies[:MAX_QUERY_DEPENDENCIES]:
        name = dependency.get("name", "").strip()
        version = dependency.get("version", "").strip()
        if not name:
            continue
        version_hint = f" {version}" if version and len(version) < 40 else ""
        queries.append(f'"{name}"{version_hint} security advisory CVE')
    unique: list[str] = []
    seen: set[str] = set()
    for query in queries:
        normalized = re.sub(r"\s+", " ", query).strip()
        if normalized.casefold() not in seen:
            seen.add(normalized.casefold())
            unique.append(normalized)
    return unique[:MAX_SECURITY_QUERIES]


def source_tier_for_url(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().rstrip(".")
    if host in {"nvd.nist.gov", "osv.dev", "cve.org", "www.cve.org"}:
        return "security_advisory"
    if host == "github.com" or host.endswith(".github.com"):
        return "github_thread"
    return "security_research"


def _mentions(term: str, text: str) -> bool:
    return bool(
        re.search(
            rf"(?<![A-Za-z0-9_.-]){re.escape(term)}(?![A-Za-z0-9_.-])",
            text,
            re.IGNORECASE,
        )
    )


def correlate_web_evidence(
    *,
    text: str,
    title: str,
    url: str,
    dependencies: list[dict[str, str]],
    repository_name: str,
) -> dict[str, Any] | None:
    """Return a small, source-linked match; never return full untrusted page text."""

    corpus = f"{title}\n{text}"
    identifiers = sorted(
        {value.upper() for value in (*_CVE_RE.findall(corpus), *_GHSA_RE.findall(corpus))}
    )
    matched_dependencies = [
        item["name"]
        for item in dependencies
        if _mentions(item["name"], corpus)
    ]
    repository_mentioned = bool(
        repository_name and _mentions(repository_name, corpus)
    )
    security_signals = sorted(set(_SECURITY_TERMS_RE.findall(corpus)), key=str.casefold)
    score = len(identifiers) * 3 + len(matched_dependencies) * 2 + len(security_signals)
    if repository_mentioned:
        score += 2
    if score < 2:
        return None
    excerpt = re.sub(r"\s+", " ", text).strip()[:700]
    return {
        "url": url,
        "title": title[:500],
        "source_tier": source_tier_for_url(url),
        "identifiers": identifiers[:20],
        "matched_dependencies": sorted(set(matched_dependencies), key=str.casefold)[:20],
        "repository_mentioned": repository_mentioned,
        "security_signals": security_signals[:20],
        "relevance": min(score, 100),
        "evidence_excerpt": excerpt,
    }
