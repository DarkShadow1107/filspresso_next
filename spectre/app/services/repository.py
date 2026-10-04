import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from app.core.config import get_settings


class RepositorySafetyError(ValueError):
    pass


def validate_github_url(remote_url: str) -> str:
    parsed = urlparse(remote_url)
    if parsed.scheme != "https" or parsed.hostname not in {"github.com", "www.github.com"}:
        raise RepositorySafetyError("Only HTTPS GitHub repository URLs are accepted")
    path_parts = [part for part in parsed.path.strip("/").split("/") if part]
    if len(path_parts) == 2 and path_parts[1].endswith(".git"):
        path_parts[1] = path_parts[1][:-4]
    if len(path_parts) != 2 or any(
        not part.replace("-", "").replace("_", "").isalnum() for part in path_parts
    ):
        raise RepositorySafetyError("Repository URL must be https://github.com/owner/repository")
    return f"https://github.com/{path_parts[0]}/{path_parts[1]}.git"


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1_048_576), b""):
            digest.update(block)
    return digest.hexdigest()


def build_repository_manifest(
    root: Path,
    *,
    max_files: int = 20_000,
    max_total_bytes: int = 262_144_000,
    max_file_bytes: int = 26_214_400,
) -> dict[str, object]:
    if not root.is_dir():
        raise RepositorySafetyError("Repository root is missing")
    ignored = {".git", "node_modules", ".venv", "venv", "dist", "build", "target", "vendor"}
    files: list[dict[str, object]] = []
    language_counter: Counter[str] = Counter()
    total_bytes = 0
    dependency_files: list[str] = []
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        if any(part in ignored for part in path.parts):
            continue
        if path.is_symlink():
            raise RepositorySafetyError(
                f"Repository contains a symbolic link: {path.relative_to(root)}"
            )
        if not path.is_file():
            continue
        if not path.resolve().is_relative_to(resolved_root):
            raise RepositorySafetyError("Repository contains a path outside its checkout")
        if len(files) >= max_files:
            raise RepositorySafetyError("Repository contains too many files")
        relative = path.relative_to(root).as_posix()
        size = path.stat().st_size
        if size > max_file_bytes:
            raise RepositorySafetyError("Repository contains an oversized file")
        if total_bytes + size > max_total_bytes:
            raise RepositorySafetyError("Repository exceeds the configured size limit")
        extension = path.suffix.lower() or "[none]"
        language_counter[extension] += 1
        total_bytes += size
        if path.name in {
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
        }:
            dependency_files.append(relative)
        files.append(
            {
                "path": relative,
                "size": size,
                "extension": extension,
                "sha256": _file_hash(path),
            }
        )
    return {
        "file_count": len(files),
        "total_bytes": total_bytes,
        "languages": dict(language_counter.most_common()),
        "dependency_files": dependency_files,
        "truncated": len(files) >= max_files,
        "files": files,
    }


def create_work_shards(
    manifest: dict[str, object], *, target_bytes: int = 2_000_000
) -> list[dict[str, object]]:
    files = list(manifest.get("files", []))
    buckets: dict[str, list[dict[str, object]]] = {}
    for item in files:
        file_item = dict(item)
        directory = (
            str(file_item["path"]).rsplit("/", 1)[0] if "/" in str(file_item["path"]) else "."
        )
        buckets.setdefault(directory, []).append(file_item)
    shards: list[dict[str, object]] = []
    for directory, items in buckets.items():
        current: list[dict[str, object]] = []
        size = 0
        for item in items:
            item_size = int(item["size"])
            if current and size + item_size > target_bytes:
                shards.append({"scope": directory, "files": current, "total_bytes": size})
                current, size = [], 0
            current.append(item)
            size += item_size
        if current:
            shards.append({"scope": directory, "files": current, "total_bytes": size})
    return shards


def clone_repository(remote_url: str, destination_root: Path) -> tuple[Path, str]:
    validated_url = validate_github_url(remote_url)
    destination_root.mkdir(parents=True, exist_ok=True)
    checkout = Path(tempfile.mkdtemp(prefix="repo-", dir=destination_root))
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", "--no-tags", validated_url, str(checkout)],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
            start_new_session=os.name != "nt",
            env={
                "GIT_ALLOW_PROTOCOL": "https",
                "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_LFS_SKIP_SMUDGE": "1",
                "GIT_TERMINAL_PROMPT": "0",
                "PATH": os.environ.get("PATH", ""),
            },
        )
        result = subprocess.run(
            ["git", "-C", str(checkout), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return checkout, result.stdout.strip()
    except Exception:
        shutil.rmtree(checkout, ignore_errors=True)
        raise


def static_security_plan(root: Path) -> dict[str, object]:
    """Return available static scanner commands without executing repository code."""
    scanners = {
        "osv_scanner": [
            "osv-scanner",
            "scan",
            "source",
            "-r",
            "--allow-no-lockfiles",
            str(root),
            "--format",
            "json",
        ],
        "trivy": [
            "trivy",
            "fs",
            "--scanners",
            "vuln,secret,misconfig",
            "--format",
            "json",
            str(root),
        ],
        "semgrep": [
            "semgrep",
            "scan",
            "--config",
            "p/default",
            "--json",
            "--metrics",
            "off",
            str(root),
        ],
        "gitleaks": [
            "gitleaks",
            "detect",
            "--source",
            str(root),
            "--report-format",
            "json",
            "--no-git",
        ],
        "syft": ["syft", f"dir:{root}", "-o", "cyclonedx-json"],
    }
    return {
        name: {"available": shutil.which(command[0]) is not None, "command": command}
        for name, command in scanners.items()
    }


_SECURITY_RULES: tuple[tuple[str, str, str, re.Pattern[str]], ...] = (
    (
        "hardcoded-secret",
        "high",
        "Possible hardcoded credential or API token",
        re.compile(r"(?i)(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
    ),
    (
        "dynamic-code",
        "high",
        "Dynamic code execution can turn untrusted input into code",
        re.compile(r"\b(eval|exec)\s*\("),
    ),
    (
        "shell-execution",
        "high",
        "Shell execution requires strict argument validation",
        re.compile(r"\b(subprocess\.(run|Popen|call|check_output)|os\.system)\s*\("),
    ),
    (
        "weak-hash",
        "medium",
        "MD5 or SHA-1 is not suitable for passwords or security signatures",
        re.compile(r"\bhashlib\.(md5|sha1)\s*\("),
    ),
    (
        "tls-verification-disabled",
        "high",
        "TLS certificate verification is disabled",
        re.compile(r"\b(verify\s*=\s*False|CERT_NONE)\b"),
    ),
    (
        "unsafe-yaml",
        "high",
        "YAML loading without a safe loader can construct arbitrary objects",
        re.compile(r"\byaml\.load\s*\("),
    ),
    (
        "dangerous-html",
        "medium",
        "Raw HTML rendering can introduce cross-site scripting",
        re.compile(r"dangerouslySetInnerHTML|innerHTML\s*="),
    ),
)


def static_security_findings(
    root: Path, *, max_findings: int = 500, max_file_bytes: int | None = None
) -> list[dict[str, object]]:
    """Find common high-signal patterns without importing or executing repository code."""
    ignored = {".git", "node_modules", ".venv", "venv", "dist", "build", "target", "vendor"}
    findings: list[dict[str, object]] = []
    file_limit = max_file_bytes or get_settings().max_repository_file_bytes
    for path in root.rglob("*"):
        if len(findings) >= max_findings:
            break
        if any(part in ignored for part in path.parts):
            continue
        if path.is_symlink():
            continue
        if not path.is_file():
            continue
        try:
            raw = path.read_bytes()[: file_limit + 1]
        except OSError:
            continue
        if len(raw) > file_limit or b"\x00" in raw:
            continue
        text = raw.decode("utf-8", errors="ignore")
        relative = path.relative_to(root).as_posix()
        for rule_id, severity, title, pattern in _SECURITY_RULES:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                findings.append(
                    {
                        "rule_id": rule_id,
                        "severity": severity,
                        "title": title,
                        "path": relative,
                        "line": line,
                        "evidence": text.splitlines()[line - 1].strip()[:240],
                    }
                )
                if len(findings) >= max_findings:
                    break
            if len(findings) >= max_findings:
                break
    return findings


def write_manifest(path: Path, manifest: dict[str, object]) -> None:
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
