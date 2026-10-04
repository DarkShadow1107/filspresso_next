import ast
import asyncio
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, Header, HTTPException, status

from app.core.logging import configure_logging
from app.schemas import (
    RepositoryCheckoutExecutionRequest,
    RepositoryCheckoutExecutionResult,
    RepositoryExecutionRequest,
    RepositoryExecutionResult,
    SandboxRequest,
    SandboxResult,
    TerminalExecutionRequest,
    TerminalExecutionResult,
)

try:
    import resource
except ImportError:  # pragma: no cover - Docker/Linux applies the resource limits.
    resource = None  # type: ignore[assignment]

ALLOWED_IMPORTS = {
    "base64",
    "PIL",
    "collections",
    "datetime",
    "decimal",
    "io",
    "json",
    "math",
    "numpy",
    "os",
    "pillow_heif",
    "pytesseract",
    "statistics",
}

# os is allowed for read-only inspection (walk, listdir, path.*) but never for
# execution, mutation, or environment access. Checked on `os.<attr>` directly.
OS_BLOCKED_ATTRS = {
    "system",
    "popen",
    "spawnl",
    "spawnle",
    "spawnlp",
    "spawnlpe",
    "spawnv",
    "spawnve",
    "spawnvp",
    "spawnvpe",
    "execv",
    "execve",
    "execl",
    "execlp",
    "execle",
    "execlpe",
    "_exit",
    "abort",
    "fork",
    "forkpty",
    "kill",
    "remove",
    "unlink",
    "rmdir",
    "removedirs",
    "mkdir",
    "makedirs",
    "rename",
    "renames",
    "replace",
    "chmod",
    "chown",
    "symlink",
    "link",
    "truncate",
    "open",
    "fdopen",
    "mkfifo",
    "mknod",
    "write",
    "putenv",
    "unsetenv",
    "environ",
}

REPOSITORY_ROOT = Path(os.environ.get("REPOSITORY_ROOT", "/srv/repositories"))
CHECKOUT_ROOT = Path(os.environ.get("CODESENTRY_CHECKOUT_ROOT", "/srv/app/workspaces"))
REPOSITORY_ID_PATTERN = r"^repo-[0-9a-f]{64}$"
_REPOSITORY_ID_RE = re.compile(REPOSITORY_ID_PATTERN)
FORBIDDEN_NAMES = {
    "__import__",
    "breakpoint",
    "compile",
    "eval",
    "exec",
    "exit",
    "getattr",
    "globals",
    "help",
    "input",
    "locals",
    "open",
    "setattr",
    "vars",
    "__builtins__",
}

SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "Exception": Exception,
    "filter": filter,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "print": print,
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}


def validate_code(code: str) -> None:
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid Python: {exc.msg}") from exc
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name.split(".")[0] for alias in node.names]
            if any(name not in ALLOWED_IMPORTS for name in names):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Only allowlisted imports are permitted: "
                        + ", ".join(sorted(ALLOWED_IMPORTS))
                        + ". Use the repository tools (List Repo Files, Read Repo File) "
                        "instead of walking the filesystem yourself."
                    ),
                )
        if isinstance(node, ast.ImportFrom):
            name = (node.module or "").split(".")[0]
            if node.level or name not in ALLOWED_IMPORTS:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Only allowlisted imports are permitted: "
                        + ", ".join(sorted(ALLOWED_IMPORTS))
                        + ". Use the repository tools (List Repo Files, Read Repo File) "
                        "instead of walking the filesystem yourself."
                    ),
                )
        if isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            raise HTTPException(status_code=422, detail=f"Forbidden operation: {node.id}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise HTTPException(status_code=422, detail="Dunder attribute access is prohibited")
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "os"
            and node.attr in OS_BLOCKED_ATTRS
        ):
            raise HTTPException(
                status_code=422,
                detail=f"os.{node.attr} is not permitted in the sandbox (read-only os.walk/listdir/path only)",
            )


def _limits() -> None:
    if resource is None:
        return
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_FSIZE, (256 * 1024, 256 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    # HEIF codecs use a small worker pool while decoding.
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))


def execute(request: SandboxRequest) -> SandboxResult:
    validate_code(request.code)
    if len(json.dumps(request.input_json, separators=(",", ":"))) > 128_000:
        raise HTTPException(status_code=413, detail="Sandbox input exceeds the 128 KB limit")
    with tempfile.TemporaryDirectory(dir="/tmp") as directory:
        workdir = Path(directory)
        (workdir / "input.json").write_text(json.dumps(request.input_json), encoding="utf-8")
        script = "\n".join(
            [
                "import json",
                "import builtins",
                f"ALLOWED_IMPORTS = {sorted(ALLOWED_IMPORTS)!r}",
                "INPUT = json.load(open('input.json', encoding='utf-8'))",
                "def safe_import(name, globals=None, locals=None, fromlist=(), level=0):",
                "    if level or name.split('.', 1)[0] not in ALLOWED_IMPORTS:",
                "        raise ImportError('Import is not allowed')",
                "    return builtins.__import__(name, globals, locals, fromlist, level)",
                f"safe_names = {list(SAFE_BUILTINS)!r}",
                "sandbox_builtins = {name: getattr(builtins, name) for name in safe_names}",
                "sandbox_builtins['__import__'] = safe_import",
                f"code = {request.code!r}",
                "namespace = {'__builtins__': sandbox_builtins, 'INPUT': INPUT}",
                "exec(compile(code, '<sandbox>', 'exec'), namespace, namespace)",
                "with open('result.json', 'w', encoding='utf-8') as result_file:",
                "    json.dump(namespace.get('result'), result_file, separators=(',', ':'))",
            ]
        )
        (workdir / "task.py").write_text(script, encoding="utf-8")
        stdout_path = workdir / "stdout.log"
        stderr_path = workdir / "stderr.log"
        with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
            completed = subprocess.run(
                ["python", "-I", "task.py"],
                cwd=workdir,
                stdout=stdout_file,
                stderr=stderr_file,
                timeout=request.timeout_seconds,
                env={"PATH": os.environ.get("PATH", ""), "PYTHONHASHSEED": "0"},
                preexec_fn=_limits if os.name != "nt" else None,
            )
        stdout = stdout_path.read_text(encoding="utf-8", errors="replace")[-65_536:]
        stderr = stderr_path.read_text(encoding="utf-8", errors="replace")[-4_000:]
        output_json: dict[str, Any] | None = None
        result_file = workdir / "result.json"
        if result_file.exists():
            try:
                parsed = json.loads(result_file.read_text(encoding="utf-8"))
                output_json = parsed if isinstance(parsed, dict) else {"result": parsed}
            except (OSError, json.JSONDecodeError):
                output_json = None
        return SandboxResult(
            stdout=stdout,
            stderr=stderr,
            output_json=output_json,
            exit_code=completed.returncode,
        )


def execute_terminal(request) -> SandboxResult:  # TerminalExecutionRequest
    # Shell execution for Codex-like sandbox – runs bash -c with limits, like Execute Terminal image
    command = str(getattr(request, "command", "") or "").strip()
    if not command:
        raise HTTPException(status_code=422, detail="Terminal command is required")
    if len(command) > 20_000:
        raise HTTPException(status_code=413, detail="Terminal command too long")
    workdir_str = str(getattr(request, "workdir", "") or "").strip() or "/tmp"
    # Confine workdir to /tmp or the shared repository volume (mounted as
    # /srv/tools/repositories in tools, /srv/repositories here).
    try:
        workdir = Path(workdir_str)
        if workdir.is_absolute():
            resolved = workdir.resolve()
            allowed = (
                str(resolved).startswith("/tmp")
                or str(resolved).startswith("/srv/tools/repositories")
                or str(resolved).startswith("/srv/repositories")
            )
            if not allowed:
                workdir = Path("/tmp")
            else:
                workdir = resolved
        else:
            workdir = Path("/tmp") / workdir_str
    except Exception:
        workdir = Path("/tmp")
    workdir.mkdir(parents=True, exist_ok=True)
    timeout = int(getattr(request, "timeout_seconds", 25) or 25)
    timeout = max(1, min(timeout, 30))
    with tempfile.TemporaryDirectory(dir="/tmp") as logdir:
        logpath = Path(logdir)
        stdout_path = logpath / "stdout.log"
        stderr_path = logpath / "stderr.log"
        with stdout_path.open("wb") as out, stderr_path.open("wb") as err:
            completed = subprocess.run(
                ["bash", "-c", command],
                cwd=str(workdir),
                stdout=out,
                stderr=err,
                timeout=timeout,
                env={"PATH": os.environ.get("PATH", ""), "HOME": "/tmp", "PYTHONHASHSEED": "0"},
                preexec_fn=_limits if os.name != "nt" else None,
            )
        stdout = stdout_path.read_text(encoding="utf-8", errors="replace")[-65_536:]
        stderr = stderr_path.read_text(encoding="utf-8", errors="replace")[-4_000:]
        # Also store a temp code file for visibility like Codex (so sandbox shows file)
        try:
            (workdir / ".last_terminal_command.sh").write_text(command, encoding="utf-8")
        except Exception:
            pass
        return SandboxResult(
            stdout=stdout,
            stderr=stderr,
            output_json={"command": command, "workdir": str(workdir)},
            exit_code=completed.returncode,
        )


_REPOSITORY_IGNORED_DIRECTORIES = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    "vendor",
}
_REPOSITORY_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_REPOSITORY_PROFILES = {
    "compile_python",
    "python_script",
    "python_tests",
    "compile_cpp",
    "cpp_script",
    "cpp_tests",
    "compile_all",
}
_CPP_EXTENSIONS = {".cpp", ".cc", ".c", ".cxx", ".h", ".hpp", ".hh"}
_COMPILE_HELPER = """\
import ast
import json
import sys

errors = []
for filename in sys.argv[1:]:
    try:
        with open(filename, encoding="utf-8") as source_file:
            ast.parse(source_file.read(), filename=filename)
    except (OSError, SyntaxError, UnicodeDecodeError) as exc:
        if len(errors) < 100:
            errors.append({"path": filename, "error": str(exc)[:300]})
print(json.dumps({"checked": len(sys.argv) - 1, "errors": errors}, separators=(",", ":")))
sys.exit(1 if errors else 0)
"""
_CPP_COMPILE_HELPER = """\
import json
import subprocess
import sys
errors=[]
checked=0
for f in sys.argv[1:]:
    checked+=1
    r=subprocess.run(["g++","-fsyntax-only",f], capture_output=True, text=True)
    if r.returncode!=0:
        if len(errors)<100:
            errors.append({"path": f, "error": (r.stderr or r.stdout)[:500]})
print(json.dumps({"checked": checked, "errors": errors}, separators=(",", ":")))
sys.exit(1 if errors else 0)
"""


def _repository_relative_path(path: str, *, allow_empty: bool = False) -> str:
    if not isinstance(path, str) or "\x00" in path or "\\" in path:
        raise HTTPException(status_code=422, detail="Repository paths must be relative POSIX paths")
    if not path:
        if allow_empty:
            return ""
        raise HTTPException(status_code=422, detail="Repository path is required")
    if path.startswith("/"):
        raise HTTPException(status_code=422, detail="Absolute repository paths are not allowed")
    parts = path.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise HTTPException(status_code=422, detail="Repository path traversal is not allowed")
    return path


def _repository_json(path: Path, description: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise HTTPException(status_code=422, detail=f"{description} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail=f"{description} is invalid") from None
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail=f"{description} must contain an object")
    return value


def _repository_child(parent: Path, relative: str, *, directory: bool = False) -> Path:
    path = parent / relative
    if path.is_symlink():
        raise HTTPException(status_code=422, detail="Repository contains a symbolic link")
    resolved = path.resolve()
    if not resolved.is_relative_to(parent.resolve()):
        raise HTTPException(status_code=422, detail="Repository path escapes its checkout")
    if directory and not path.is_dir():
        raise HTTPException(status_code=404, detail="Repository checkout is unavailable")
    if not directory and not path.is_file():
        raise HTTPException(status_code=404, detail="Repository file is unavailable")
    return path


def _repository_checkout_files(checkout: Path) -> set[str]:
    if checkout.is_symlink() or not checkout.is_dir():
        raise HTTPException(status_code=422, detail="Repository checkout is missing or unsafe")
    resolved_checkout = checkout.resolve()
    paths: set[str] = set()
    for current, directories, filenames in os.walk(checkout, followlinks=False):
        current_path = Path(current)
        relative_parts = current_path.relative_to(checkout).parts
        if any(part in _REPOSITORY_IGNORED_DIRECTORIES for part in relative_parts):
            directories[:] = []
            continue
        kept_directories: list[str] = []
        for name in sorted(directories):
            directory = current_path / name
            if directory.is_symlink():
                raise HTTPException(status_code=422, detail="Repository contains a symbolic link")
            if not directory.resolve().is_relative_to(resolved_checkout):
                raise HTTPException(status_code=422, detail="Repository path escapes its checkout")
            if name not in _REPOSITORY_IGNORED_DIRECTORIES:
                kept_directories.append(name)
        directories[:] = kept_directories
        for name in sorted(filenames):
            path = current_path / name
            if path.is_symlink():
                raise HTTPException(status_code=422, detail="Repository contains a symbolic link")
            if not path.resolve().is_relative_to(resolved_checkout):
                raise HTTPException(status_code=422, detail="Repository path escapes its checkout")
            if path.is_file():
                paths.add(path.relative_to(checkout).as_posix())
    return paths


def _load_repository_workspace(
    repository_id: str,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], Path]:
    if _REPOSITORY_ID_RE.fullmatch(repository_id) is None:
        raise HTTPException(status_code=422, detail="Invalid repository identifier")
    if REPOSITORY_ROOT.is_symlink():
        raise HTTPException(status_code=422, detail="Repository root must not be a symbolic link")
    root = REPOSITORY_ROOT.resolve()
    workspace = root / repository_id
    if workspace.is_symlink() or not workspace.is_dir():
        raise HTTPException(status_code=404, detail="Prepared repository was not found")
    if not workspace.resolve().is_relative_to(root):
        raise HTTPException(status_code=422, detail="Repository workspace escapes its root")
    metadata = _repository_json(workspace / "metadata.json", "Repository metadata")
    if metadata.get("repository_id") != repository_id:
        raise HTTPException(status_code=422, detail="Repository metadata identifier does not match")
    if metadata.get("checkout_path", "checkout") != "checkout":
        raise HTTPException(status_code=422, detail="Repository checkout path is invalid")
    if metadata.get("manifest_path", "manifest.json") != "manifest.json":
        raise HTTPException(status_code=422, detail="Repository manifest path is invalid")
    checkout = _repository_child(workspace, "checkout", directory=True)
    manifest = _repository_json(workspace / "manifest.json", "Repository manifest")
    if metadata.get("manifest") is not None and metadata.get("manifest") != manifest:
        raise HTTPException(status_code=422, detail="Repository metadata and manifest disagree")
    raw_files = manifest.get("files")
    if not isinstance(raw_files, list) or len(raw_files) > 20_000:
        raise HTTPException(status_code=422, detail="Repository manifest file list is invalid")
    files: list[dict[str, Any]] = []
    seen: set[str] = set()
    total_bytes = 0
    for raw_item in raw_files:
        if not isinstance(raw_item, dict):
            raise HTTPException(status_code=422, detail="Repository manifest entry is invalid")
        relative = _repository_relative_path(str(raw_item.get("path", "")))
        if relative in seen:
            raise HTTPException(
                status_code=422, detail="Repository manifest contains duplicate paths"
            )
        seen.add(relative)
        try:
            size = int(raw_item["size"])
            extension = str(raw_item["extension"])
            sha256 = str(raw_item["sha256"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(
                status_code=422, detail="Repository manifest entry is incomplete"
            ) from None
        if size < 0 or size > 26_214_400 or _REPOSITORY_SHA256_RE.fullmatch(sha256) is None:
            raise HTTPException(status_code=422, detail="Repository manifest entry is invalid")
        expected_extension = Path(relative).suffix.lower() or "[none]"
        if extension != expected_extension:
            raise HTTPException(status_code=422, detail="Repository manifest extension is invalid")
        file_path = _repository_child(checkout, relative)
        if file_path.stat().st_size != size:
            raise HTTPException(status_code=422, detail=f"Repository file changed: {relative}")
        total_bytes += size
        if total_bytes > 262_144_000:
            raise HTTPException(
                status_code=422, detail="Repository exceeds the configured size limit"
            )
        files.append({"path": relative, "size": size, "extension": extension, "sha256": sha256})
    if manifest.get("file_count") != len(files) or manifest.get("total_bytes") != total_bytes:
        raise HTTPException(status_code=422, detail="Repository manifest summary is inconsistent")
    for key in ("file_count", "total_bytes", "languages", "dependency_files"):
        if key in metadata and metadata[key] != manifest.get(key):
            raise HTTPException(
                status_code=422, detail=f"Repository metadata field is inconsistent: {key}"
            )
    if _repository_checkout_files(checkout) != seen:
        raise HTTPException(
            status_code=422, detail="Repository checkout does not match its manifest"
        )
    return metadata, manifest, files, checkout


def _repository_entry_bytes(checkout: Path, entry: dict[str, Any]) -> bytes:
    path = _repository_child(checkout, str(entry["path"]))
    raw = path.read_bytes()
    if len(raw) != int(entry["size"]):
        raise HTTPException(status_code=422, detail=f"Repository file changed: {entry['path']}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != entry["sha256"]:
        raise HTTPException(status_code=422, detail=f"Repository file changed: {entry['path']}")
    return raw


def _repository_entry(files: list[dict[str, Any]], path: str) -> dict[str, Any]:
    relative = _repository_relative_path(path)
    for entry in files:
        if entry["path"] == relative:
            return entry
    raise HTTPException(status_code=422, detail="Repository path is not listed in the manifest")


def _validate_repository_request(
    request: RepositoryExecutionRequest,
) -> tuple[dict[str, Any], list[dict[str, Any]], Path, str | None]:
    if request.profile not in _REPOSITORY_PROFILES:
        raise HTTPException(status_code=422, detail="Unknown repository execution profile")
    metadata, _, files, checkout = _load_repository_workspace(request.repository_id)
    normalized_path: str | None = None
    if request.path is not None:
        normalized_path = _repository_relative_path(request.path)
    if request.profile == "python_script":
        if normalized_path is None:
            raise HTTPException(status_code=422, detail="python_script requires a Python path")
        entry = _repository_entry(files, normalized_path)
        if entry["extension"] != ".py":
            raise HTTPException(status_code=422, detail="python_script only accepts a .py path")
        raw = _repository_entry_bytes(checkout, entry)
        if b"\x00" in raw:
            raise HTTPException(
                status_code=422, detail="python_script does not accept binary content"
            )
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=422, detail="python_script does not accept binary content"
            ) from None
    elif request.profile == "compile_python" and normalized_path is not None:
        entry = _repository_entry(files, normalized_path)
        if entry["extension"] != ".py":
            raise HTTPException(status_code=422, detail="compile_python only accepts a .py path")
        raw = _repository_entry_bytes(checkout, entry)
        if b"\x00" in raw:
            raise HTTPException(
                status_code=422, detail="compile_python does not accept binary content"
            )
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=422, detail="compile_python does not accept binary content"
            ) from None
    elif request.profile in ("compile_cpp", "cpp_script"):
        if request.profile == "cpp_script" and normalized_path is None:
            raise HTTPException(status_code=422, detail="cpp_script requires a C++ path")
        if normalized_path is not None:
            entry = _repository_entry(files, normalized_path)
            if entry["extension"] not in _CPP_EXTENSIONS:
                raise HTTPException(status_code=422, detail="cpp profile only accepts a C/C++ path")
            raw = _repository_entry_bytes(checkout, entry)
            if b"\x00" in raw:
                raise HTTPException(status_code=422, detail="cpp profile does not accept binary content")
    elif request.profile == "compile_all" and normalized_path is not None:
        entry = _repository_entry(files, normalized_path)
        if entry["extension"] not in {".py", *_CPP_EXTENSIONS}:
            raise HTTPException(status_code=422, detail="compile_all only accepts a .py or C/C++ path")
    elif request.profile in ("cpp_tests", "python_tests") and normalized_path is not None:
        test_directory = _repository_child(checkout, normalized_path, directory=True)
        prefix = f"{normalized_path}/"
        if not any(str(entry["path"]).startswith(prefix) for entry in files):
            raise HTTPException(
                status_code=422, detail=f"{request.profile} path is not a repository directory"
            )
        if test_directory.is_symlink():
            raise HTTPException(status_code=422, detail=f"{request.profile} path is a symbolic link")
    elif request.profile not in ("compile_python", "compile_cpp", "compile_all") and normalized_path is not None:
        # generic directory check for other profiles
        prefix = f"{normalized_path}/"
        if not any(str(entry["path"]).startswith(prefix) for entry in files):
            raise HTTPException(status_code=422, detail="path is not a repository directory")
    return metadata, files, checkout, normalized_path


def validate_repository_execution(request: RepositoryExecutionRequest) -> dict[str, Any]:
    """Validate a repository execution request without starting a process."""

    metadata, files, _, normalized_path = _validate_repository_request(request)
    entry = None
    if normalized_path is not None and request.profile != "python_tests":
        entry = _repository_entry(files, normalized_path)
    return {
        "valid": True,
        "repository_id": request.repository_id,
        "profile": request.profile,
        "path": normalized_path,
        "timeout_seconds": request.timeout_seconds,
        "commit_sha": metadata.get("commit_sha", ""),
        "manifest_entry": entry,
    }


def _repository_environment() -> dict[str, str]:
    return {
        "PATH": os.environ.get("PATH", ""),
        "HOME": tempfile.gettempdir(),
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
    }


def _run_repository_process(
    command: list[str], checkout: Path, timeout_seconds: int
) -> tuple[str, str, int]:
    with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
        workdir = Path(directory)
        stdout_path = workdir / "stdout.log"
        stderr_path = workdir / "stderr.log"
        with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
            completed = subprocess.run(
                command,
                cwd=checkout,
                stdout=stdout_file,
                stderr=stderr_file,
                timeout=timeout_seconds,
                env=_repository_environment(),
                preexec_fn=_limits if os.name != "nt" else None,
                shell=False,
            )
        stdout = stdout_path.read_text(encoding="utf-8", errors="replace")[-65_536:]
        stderr = stderr_path.read_text(encoding="utf-8", errors="replace")[-4_000:]
    return stdout, stderr, completed.returncode


def execute_repository(request: RepositoryExecutionRequest) -> RepositoryExecutionResult:
    """Run one fixed repository profile in a bounded child process."""

    metadata, files, checkout, normalized_path = _validate_repository_request(request)
    output_json: dict[str, Any] | None = None
    if request.profile == "compile_python":
        entries = files if normalized_path is None else [_repository_entry(files, normalized_path)]
        entries = [entry for entry in entries if entry["extension"] == ".py"]
        for entry in entries:
            raw = _repository_entry_bytes(checkout, entry)
            if b"\x00" in raw:
                raise HTTPException(
                    status_code=422, detail="compile_python does not accept binary content"
                )
            try:
                raw.decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(
                    status_code=422, detail="compile_python does not accept binary content"
                ) from None
        python_paths = [
            str(entry["path"]) for entry in entries if entry["extension"] == ".py"
        ]
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            helper = Path(directory) / "compile_repository.py"
            helper.write_text(_COMPILE_HELPER, encoding="utf-8")
            stdout, stderr, exit_code = _run_repository_process(
                [sys.executable, "-I", str(helper), *python_paths],
                checkout,
                request.timeout_seconds,
            )
        for line in reversed(stdout.splitlines()):
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and "checked" in parsed:
                output_json = parsed
                break
    elif request.profile == "compile_cpp":
        entries = files if normalized_path is None else [_repository_entry(files, normalized_path)]
        entries = [entry for entry in entries if entry["extension"] in _CPP_EXTENSIONS]
        cpp_paths = [str(entry["path"]) for entry in entries]
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            helper = Path(directory) / "compile_cpp.py"
            helper.write_text(_CPP_COMPILE_HELPER, encoding="utf-8")
            stdout, stderr, exit_code = _run_repository_process(
                [sys.executable, "-I", str(helper), *cpp_paths],
                checkout,
                request.timeout_seconds,
            )
        for line in reversed(stdout.splitlines()):
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and "checked" in parsed:
                output_json = parsed
                break
    elif request.profile == "compile_all":
        py_entries = [e for e in files if e["extension"] == ".py"]
        cpp_entries = [e for e in files if e["extension"] in _CPP_EXTENSIONS]
        if normalized_path is not None:
            # single file mode already validated; just check that single file
            entry = _repository_entry(files, normalized_path)
            if entry["extension"] == ".py":
                py_entries = [entry]
                cpp_entries = []
            else:
                py_entries = []
                cpp_entries = [entry]
        py_paths = [str(e["path"]) for e in py_entries]
        cpp_paths = [str(e["path"]) for e in cpp_entries]
        py_result = {"checked": 0, "errors": []}
        cpp_result = {"checked": 0, "errors": []}
        stdout = ""
        stderr = ""
        exit_code = 0
        if py_paths:
            with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
                helper = Path(directory) / "compile_repository.py"
                helper.write_text(_COMPILE_HELPER, encoding="utf-8")
                s1, e1, c1 = _run_repository_process(
                    [sys.executable, "-I", str(helper), *py_paths],
                    checkout,
                    request.timeout_seconds,
                )
                stdout += s1
                stderr += e1
                exit_code = exit_code or c1
                for line in reversed(s1.splitlines()):
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed, dict) and "checked" in parsed:
                        py_result = parsed
                        break
        if cpp_paths:
            with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
                helper = Path(directory) / "compile_cpp.py"
                helper.write_text(_CPP_COMPILE_HELPER, encoding="utf-8")
                s2, e2, c2 = _run_repository_process(
                    [sys.executable, "-I", str(helper), *cpp_paths],
                    checkout,
                    request.timeout_seconds,
                )
                stdout += ("\n" + s2 if stdout else s2)
                stderr += ("\n" + e2 if stderr else e2)
                exit_code = exit_code or c2
                for line in reversed(s2.splitlines()):
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed, dict) and "checked" in parsed:
                        cpp_result = parsed
                        break
        output_json = {
            "checked_python": py_result.get("checked", 0),
            "checked_cpp": cpp_result.get("checked", 0),
            "checked": py_result.get("checked", 0) + cpp_result.get("checked", 0),
            "errors": (py_result.get("errors", []) or []) + (cpp_result.get("errors", []) or []),
            "python": py_result,
            "cpp": cpp_result,
        }
    elif request.profile == "python_script":
        entry = _repository_entry(files, normalized_path or "")
        _repository_entry_bytes(checkout, entry)
        stdout, stderr, exit_code = _run_repository_process(
            [sys.executable, "-I", f"./{normalized_path or ''}"],
            checkout,
            request.timeout_seconds,
        )
    elif request.profile == "cpp_script":
        entry = _repository_entry(files, normalized_path or "")
        _repository_entry_bytes(checkout, entry)
        # Try syntax-only first, then compile+run if contains main
        stdout, stderr, exit_code = _run_repository_process(
            ["g++", "-fsyntax-only", f"./{normalized_path or ''}"],
            checkout,
            request.timeout_seconds,
        )
        # if syntax ok and file likely executable, attempt compile+run
        if exit_code == 0:
            with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
                bin_path = Path(directory) / "a.out"
                comp_stdout, comp_stderr, comp_code = _run_repository_process(
                    ["g++", "-o", str(bin_path), f"./{normalized_path or ''}"],
                    checkout,
                    request.timeout_seconds,
                )
                if comp_code == 0 and bin_path.exists():
                    run_stdout, run_stderr, run_code = _run_repository_process(
                        [str(bin_path)], checkout, request.timeout_seconds
                    )
                    stdout = comp_stdout + run_stdout
                    stderr = comp_stderr + run_stderr
                    exit_code = run_code
                    output_json = {"compiled": True, "ran": True}
                else:
                    output_json = {"compiled": False, "syntax_ok": True}
                if output_json is None:
                    output_json = {"compiled": comp_code == 0}
    elif request.profile == "cpp_tests":
        start_directory = normalized_path or "."
        # Try ctest first, fallback to make test
        stdout, stderr, exit_code = _run_repository_process(
            ["ctest", "--test-dir", start_directory, "--output-on-failure"],
            checkout,
            request.timeout_seconds,
        )
        if "could not find" in stderr.lower() or "ctest" in stderr.lower() and exit_code != 0:
            stdout2, stderr2, exit2 = _run_repository_process(
                ["make", "-C", start_directory, "test"],
                checkout,
                request.timeout_seconds,
            )
            stdout = stdout + "\n" + stdout2
            stderr = stderr + "\n" + stderr2
            exit_code = exit2 if exit2 != 0 else exit_code
    else:
        start_directory = normalized_path or "."
        stdout, stderr, exit_code = _run_repository_process(
            [
                sys.executable,
                "-I",
                "-m",
                "unittest",
                "discover",
                "-s",
                start_directory,
                "-p",
                "test*.py",
            ],
            checkout,
            request.timeout_seconds,
        )
    result = RepositoryExecutionResult(
        repository_id=request.repository_id,
        profile=request.profile,
        path=normalized_path,
        stdout=stdout,
        stderr=stderr,
        output_json=output_json,
        exit_code=exit_code,
    )
    if request.profile == "compile_python" and result.output_json is None:
        result.output_json = {
            "checked": 0,
            "errors": [{"error": "Syntax checker produced no result"}],
        }
    if metadata.get("commit_sha"):
        # Keep the response tied to the prepared snapshot without exposing paths.
        if result.output_json is None:
            result.output_json = {"commit_sha": metadata["commit_sha"]}
        else:
            result.output_json.setdefault("commit_sha", metadata["commit_sha"])
    return result


def _load_codesentry_checkout(checkout_name: str) -> tuple[Path, list[str]]:
    if CHECKOUT_ROOT.is_symlink() or not CHECKOUT_ROOT.is_dir():
        raise HTTPException(status_code=503, detail="CodeSentry checkout volume is unavailable")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", checkout_name):
        raise HTTPException(status_code=422, detail="Invalid CodeSentry checkout name")
    root = CHECKOUT_ROOT.resolve()
    checkout = root / checkout_name
    if checkout.is_symlink() or not checkout.is_dir():
        raise HTTPException(status_code=404, detail="CodeSentry checkout is unavailable")
    if not checkout.resolve().is_relative_to(root):
        raise HTTPException(status_code=422, detail="CodeSentry checkout escapes its root")

    python_paths: list[str] = []
    total_bytes = 0
    file_count = 0
    resolved_checkout = checkout.resolve()
    for current, directories, filenames in os.walk(checkout, followlinks=False):
        current_path = Path(current)
        if any(
            part in _REPOSITORY_IGNORED_DIRECTORIES
            for part in current_path.relative_to(checkout).parts
        ):
            directories[:] = []
            continue
        for name in directories:
            directory = current_path / name
            if directory.is_symlink() or not directory.resolve().is_relative_to(resolved_checkout):
                raise HTTPException(
                    status_code=422, detail="CodeSentry checkout contains a symbolic link"
                )
        for name in filenames:
            path = current_path / name
            if path.is_symlink() or not path.resolve().is_relative_to(resolved_checkout):
                raise HTTPException(
                    status_code=422, detail="CodeSentry checkout contains a symbolic link"
                )
            if not path.is_file():
                continue
            file_count += 1
            size = path.stat().st_size
            total_bytes += size
            if file_count > 20_000 or total_bytes > 262_144_000 or size > 26_214_400:
                raise HTTPException(
                    status_code=422, detail="CodeSentry checkout exceeds safety limits"
                )
            if path.suffix.lower() == ".py":
                python_paths.append(path.relative_to(checkout).as_posix())
    return checkout, sorted(python_paths)


def execute_codesentry_checkout(
    request: RepositoryCheckoutExecutionRequest,
) -> RepositoryCheckoutExecutionResult:
    checkout, python_paths = _load_codesentry_checkout(request.checkout_name)
    output_json: dict[str, Any] | None = None
    if request.profile == "compile_python":
        with tempfile.TemporaryDirectory(dir=tempfile.gettempdir()) as directory:
            helper = Path(directory) / "compile_repository.py"
            helper.write_text(_COMPILE_HELPER, encoding="utf-8")
            stdout, stderr, exit_code = _run_repository_process(
                [sys.executable, "-I", str(helper), *python_paths],
                checkout,
                request.timeout_seconds,
            )
        for line in reversed(stdout.splitlines()):
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and "checked" in parsed:
                output_json = parsed
                break
        if output_json is None:
            output_json = {"checked": len(python_paths), "errors": [{"error": "No syntax result"}]}
    else:
        stdout, stderr, exit_code = _run_repository_process(
            [
                sys.executable,
                "-I",
                "-m",
                "unittest",
                "discover",
                "-s",
                ".",
                "-p",
                "test*.py",
            ],
            checkout,
            request.timeout_seconds,
        )
    return RepositoryCheckoutExecutionResult(
        checkout_name=request.checkout_name,
        profile=request.profile,
        stdout=stdout,
        stderr=stderr,
        output_json=output_json,
        exit_code=exit_code,
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    yield


app = FastAPI(title="CodeSentry Sandbox", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "network_policy": "container-restricted",
        "execution_timeout_seconds": 30,
    }


@app.post("/v1/execute", response_model=SandboxResult)
async def execute_script(
    request: SandboxRequest,
    sandbox_token: Annotated[str | None, Header(alias="X-Sandbox-Token")] = None,
) -> SandboxResult:
    expected_token = os.environ.get("SANDBOX_SERVICE_TOKEN")
    if os.environ.get("ENVIRONMENT", "development").lower() == "production" and not expected_token:
        raise HTTPException(status_code=503, detail="Sandbox service is not configured")
    if (
        expected_token
        and not sandbox_token
        or (expected_token and not hmac.compare_digest(expected_token, sandbox_token or ""))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sandbox authentication failed",
        )
    try:
        return await asyncio.to_thread(execute, request)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Script exceeded sandbox time limit") from None


@app.post("/v1/execute/terminal", response_model=TerminalExecutionResult)
async def execute_terminal_endpoint(
    request: TerminalExecutionRequest,
    sandbox_token: Annotated[str | None, Header(alias="X-Sandbox-Token")] = None,
) -> TerminalExecutionResult:
    expected_token = os.environ.get("SANDBOX_SERVICE_TOKEN")
    if os.environ.get("ENVIRONMENT", "development").lower() == "production" and not expected_token:
        raise HTTPException(status_code=503, detail="Sandbox service is not configured")
    if (
        expected_token
        and not sandbox_token
        or (expected_token and not hmac.compare_digest(expected_token, sandbox_token or ""))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sandbox authentication failed",
        )
    try:
        result = await asyncio.to_thread(execute_terminal, request)
        return TerminalExecutionResult(
            stdout=result.stdout,
            stderr=result.stderr,
            output_json=result.output_json,
            exit_code=result.exit_code,
            command=request.command,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Terminal exceeded sandbox time limit") from None


@app.post(
    "/v1/repository/execute",
    response_model=RepositoryExecutionResult,
)
@app.post(
    "/v1/repository/run",
    response_model=RepositoryExecutionResult,
    include_in_schema=False,
)
async def execute_repository_profile(
    request: RepositoryExecutionRequest,
    sandbox_token: Annotated[str | None, Header(alias="X-Sandbox-Token")] = None,
) -> RepositoryExecutionResult:
    expected_token = os.environ.get("SANDBOX_SERVICE_TOKEN")
    if os.environ.get("ENVIRONMENT", "development").lower() == "production" and not expected_token:
        raise HTTPException(status_code=503, detail="Sandbox service is not configured")
    if (
        expected_token
        and not sandbox_token
        or (expected_token and not hmac.compare_digest(expected_token, sandbox_token or ""))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sandbox authentication failed",
        )
    try:
        return await asyncio.to_thread(execute_repository, request)
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=408, detail="Repository profile exceeded sandbox time limit"
        ) from None


@app.post(
    "/v1/checkout/execute",
    response_model=RepositoryCheckoutExecutionResult,
)
async def execute_codesentry_checkout_profile(
    request: RepositoryCheckoutExecutionRequest,
    sandbox_token: Annotated[str | None, Header(alias="X-Sandbox-Token")] = None,
) -> RepositoryCheckoutExecutionResult:
    expected_token = os.environ.get("SANDBOX_SERVICE_TOKEN")
    if os.environ.get("ENVIRONMENT", "development").lower() == "production" and not expected_token:
        raise HTTPException(status_code=503, detail="Sandbox service is not configured")
    if (
        expected_token
        and not sandbox_token
        or (expected_token and not hmac.compare_digest(expected_token, sandbox_token or ""))
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sandbox authentication failed",
        )
    try:
        return await asyncio.to_thread(execute_codesentry_checkout, request)
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=408, detail="CodeSentry repository test exceeded sandbox time limit"
        ) from None
