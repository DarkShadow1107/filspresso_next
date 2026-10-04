import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse


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
        if any(part in ignored for part in path.parts) or path.is_symlink() or not path.is_file():
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
        files.append({"path": relative, "size": size, "extension": extension})
    return {
        "file_count": len(files),
        "total_bytes": total_bytes,
        "languages": dict(language_counter.most_common()),
        "dependency_files": dependency_files,
        "truncated": len(files) >= max_files,
    }


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


def static_security_findings(root: Path, *, max_findings: int = 500) -> list[dict[str, object]]:
    ignored = {".git", "node_modules", ".venv", "venv", "dist", "build", "target", "vendor"}
    findings: list[dict[str, object]] = []
    for path in root.rglob("*"):
        if len(findings) >= max_findings:
            break
        if not path.is_file() or path.is_symlink() or any(part in ignored for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "\x00" in text:
            continue
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


def analyze_repository(remote_url: str, workspace_root: Path) -> dict[str, object]:
    validated = validate_github_url(remote_url)
    name = validated.removesuffix(".git").rsplit("/", 1)[-1]
    checkout, commit_sha = clone_repository(validated, workspace_root)
    try:
        manifest = build_repository_manifest(checkout)
        findings = static_security_findings(checkout)
    finally:
        shutil.rmtree(checkout, ignore_errors=True)
    return {
        "name": name,
        "url": f"https://github.com/{validated.removesuffix('.git').rsplit('/', 2)[-2]}/{name}",
        "commit_sha": commit_sha,
        "file_count": manifest["file_count"],
        "total_bytes": manifest["total_bytes"],
        "languages": dict(list(manifest["languages"].items())[:10]),
        "dependency_files": manifest["dependency_files"],
        "findings_total": len(findings),
        "findings": findings[:60],
    }
