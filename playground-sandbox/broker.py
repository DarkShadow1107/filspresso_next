"""Authenticated control plane for disposable Docker workspaces.

Deploy on a dedicated/rootless sandbox Docker engine. Daemon access is privileged;
the workload never receives its socket, network, secrets or host bind mounts.
"""
from __future__ import annotations

import contextlib
import hmac
import json
import os
import re
import threading
import time
import uuid
from functools import lru_cache

import docker
from docker.errors import DockerException, NotFound
from docker.types import LogConfig, Ulimit
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool

LABEL = "filspresso.playground.sandbox"
MAX_FILE = 256 * 1024
MAX_OUTPUT = 1024 * 1024
MAX_WORKSPACES = 8
IDLE_SECONDS = 15 * 60
MAX_LIFETIME = 60 * 60
_lock = threading.RLock()
_touched: dict[str, float] = {}
_busy: set[str] = set()
_removed: dict[str, float] = {}
_discarded: dict[str, tuple[str, str, float]] = {}
_removals: dict[str, threading.Event] = {}
_baselines: dict[str, frozenset[str]] = {}
BROKER_EPOCH = str(uuid.uuid4())
_stopping = threading.Event()


@lru_cache(maxsize=1)
def engine():
    return docker.from_env(timeout=15)


def namespace() -> str:
    value = os.environ.get("PLAYGROUND_SANDBOX_NAMESPACE", "")
    if value and not re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", value):
        raise RuntimeError("Invalid sandbox broker namespace")
    return value


def scoped_containers():
    # Preserve existing unnamespaced workspaces, but never count/reap a different broker's
    # namespace. Smoke tests use their own scope even on a shared development engine.
    scope = namespace()
    return [container for container in engine().containers.list(all=True, filters={"label": f"{LABEL}=1"})
            if container.labels.get("filspresso.namespace", "") == scope]


def process_ids(container) -> frozenset[str]:
    snapshot = container.top(ps_args="-eo pid")
    if snapshot.get("Titles") != ["PID"]:
        raise DockerException("Cannot verify workload process identities")
    rows = snapshot.get("Processes", [])
    if not rows or any(len(row) != 1 or not str(row[0]).isdigit() for row in rows):
        raise DockerException("Invalid workload process snapshot")
    return frozenset(str(row[0]) for row in rows)


def quiescent(container) -> bool:
    """Freeze *all* workload tasks before checking for descendants, including setsid children.

    A running-process snapshot alone can race a fork. While frozen, only the original init/
    idle process identities may remain. Any extra/missing task discards the whole workload.
    This is daemon control, never a privileged shell or a kill command on the app host.
    """
    identity = container.labels.get("filspresso.id", "")
    baseline = _baselines.get(identity)
    if not baseline:
        remove(container)
        return False
    container.pause()
    if process_ids(container) != baseline:
        remove(container)
        return False
    container.unpause()
    return True


@contextlib.contextmanager
def operation(identity: str):
    with _lock:
        if identity in _busy:
            raise HTTPException(409, "Wait for the current sandbox operation to finish")
        if identity in _removed:
            raise HTTPException(404, "Sandbox was stopped")
        _busy.add(identity)
    try:
        yield
    finally:
        with _lock:
            _busy.discard(identity)


def sandbox_id(value: str) -> str:
    try:
        parsed = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "Invalid sandbox ID") from None
    if parsed != value:
        raise HTTPException(400, "Invalid sandbox ID")
    return parsed


def safe_path(value: str) -> str:
    if not value or len(value) > 240 or value.startswith("/") or "\\" in value or "\x00" in value:
        raise HTTPException(400, "Choose a relative workspace path")
    if any(part in {"", ".", ".."} for part in value.split("/")) or any(ord(char) < 32 for char in value):
        raise HTTPException(400, "Path must stay inside the workspace")
    return value


def runtime_options(owner: str, identity: str) -> dict:
    return {
        "image": os.environ.get("PLAYGROUND_SANDBOX_IMAGE", "filspresso-playground-runtime:dev"),
        "name": f"filspresso-playground-{identity}", "detach": True,
        "labels": {LABEL: "1", "filspresso.owner": owner, "filspresso.id": identity, "filspresso.created": str(time.time()), "filspresso.namespace": namespace(), "filspresso.broker_epoch": BROKER_EPOCH},
        "user": "10001:10001", "working_dir": "/workspace", "network_mode": "none",
        "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"], "read_only": True,
        "mem_limit": "512m", "memswap_limit": "512m", "nano_cpus": 1_000_000_000,
        "pids_limit": 128, "init": True,
        "tmpfs": {"/workspace": "rw,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=0700", "/tmp": "rw,nosuid,nodev,size=16m,uid=10001,gid=10001,mode=1777"},
        "ulimits": [Ulimit(name="nofile", soft=1024, hard=1024), Ulimit(name="fsize", soft=8 * 1024 * 1024, hard=8 * 1024 * 1024)],
        "log_config": LogConfig(type="none"),
        "environment": {"HOME": "/tmp", "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"},
    }


def owned(request: Request, identity: str, require_running: bool = True):
    identity = sandbox_id(identity)
    with _lock:
        if require_running and identity in _removed:
            raise HTTPException(404, "Sandbox expired or was stopped")
    try:
        container = engine().containers.get(f"filspresso-playground-{identity}")
    except NotFound:
        raise HTTPException(404, "Sandbox expired or was stopped") from None
    labels = container.labels
    if labels.get(LABEL) != "1" or labels.get("filspresso.owner") != request.state.owner or labels.get("filspresso.namespace", "") != namespace():
        raise HTTPException(404, "Sandbox not found")
    if labels.get("filspresso.broker_epoch") != BROKER_EPOCH:
        remove(container)
        raise HTTPException(404, "Sandbox belonged to a previous broker process and was discarded")
    if require_running and container.status != "running":
        raise HTTPException(404, "Sandbox is no longer running")
    with _lock:
        _touched[identity] = time.time()
    return container


def remove(container):
    identity = container.labels.get("filspresso.id", "")
    with _lock:
        if identity in _discarded:
            return
        pending = _removals.get(identity)
        if pending is None:
            pending = threading.Event()
            _removals[identity] = pending
            _removed[identity] = time.monotonic()
            leader = True
        else:
            leader = False
    if not leader:
        if not pending.wait(20):
            raise DockerException("Workload removal confirmation timed out")
        with _lock:
            if identity in _discarded:
                return
        raise DockerException("Workload removal failed; retry discard")
    try:
        # Force removes only this broker-owned workload, including every descendant.
        with contextlib.suppress(NotFound):
            container.remove(force=True, v=True)
        with _lock:
            # Only actual daemon confirmation grants an exact-owner idempotent receipt.
            _discarded[identity] = (container.labels.get("filspresso.owner", ""), container.labels.get("filspresso.namespace", ""), time.monotonic())
            while len(_discarded) > 4096:
                _discarded.pop(next(iter(_discarded)))
            _touched.pop(identity, None)
            _busy.discard(identity)
            _baselines.pop(identity, None)
    finally:
        with _lock:
            _removals.pop(identity, None)
            pending.set()


def recover():
    # In-flight exec state cannot be reconstructed safely after a control-plane crash.
    # Expire only this namespace's old workloads; never adopt them as idle/ready sessions.
    for container in scoped_containers():
        if container.labels.get("filspresso.broker_epoch") != BROKER_EPOCH:
            remove(container)


def reaper():
    while not _stopping.wait(30):
        try:
            with _lock:
                for identity, when in list(_removed.items()):
                    if time.monotonic() - when > 60:
                        _removed.pop(identity, None)
                for identity, (_, _, when) in list(_discarded.items()):
                    if time.monotonic() - when > MAX_LIFETIME:
                        _discarded.pop(identity, None)
            for container in scoped_containers():
                identity = container.labels.get("filspresso.id", "")
                created = float(container.labels.get("filspresso.created", "0"))
                with _lock:
                    touched = _touched.get(identity, created)
                    busy = identity in _busy
                if container.labels.get("filspresso.broker_epoch") != BROKER_EPOCH or time.time() - created > MAX_LIFETIME or (not busy and time.time() - touched > IDLE_SECONDS):
                    remove(container)
        except (DockerException, ValueError):
            continue


@contextlib.asynccontextmanager
async def lifespan(_app):
    if len(os.environ.get("PLAYGROUND_SANDBOX_KEY", "")) < 32:
        raise RuntimeError("PLAYGROUND_SANDBOX_KEY must contain at least 32 characters")
    namespace()
    recover()
    _stopping.clear()
    thread = threading.Thread(target=reaper, daemon=True)
    thread.start()
    yield
    _stopping.set()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def authorize(request: Request, call_next):
    key = os.environ.get("PLAYGROUND_SANDBOX_KEY", "")
    presented = request.headers.get("x-sandbox-key", "")
    owner = request.headers.get("x-sandbox-owner", "")
    if len(key) < 32 or not hmac.compare_digest(presented, key) or not re.fullmatch(r"[1-9][0-9]{0,18}", owner):
        return JSONResponse({"message": "Sandbox service credential required"}, status_code=401)
    request.state.owner = owner
    if int(request.headers.get("content-length", "0") or "0") > 512 * 1024:
        return JSONResponse({"message": "Sandbox request is too large"}, status_code=413)
    try:
        return await call_next(request)
    except DockerException:
        return JSONResponse({"message": "Sandbox engine unavailable"}, status_code=503)


class FileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(max_length=240)
    text: str = Field(max_length=MAX_FILE)


class RunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: str = Field(min_length=1, max_length=4000)
    approved: StrictBool = False
    timeoutSeconds: int = Field(default=30, ge=1, le=60)


@app.get("/health")
def health():
    engine().ping()
    return {"available": True, "location": "hosted-docker", "network": "disabled", "runtime": "Python 3.11 / POSIX shell", "workspace": "/workspace", "ephemeral": True, "policyVersion": 2, "descendantPolicy": "freeze-check-discard"}


@app.post("/sandboxes")
def create(request: Request):
    with _lock:
        containers = scoped_containers()
        if len(containers) >= MAX_WORKSPACES or sum(c.labels.get("filspresso.owner") == request.state.owner for c in containers) >= 2:
            raise HTTPException(429, "Sandbox capacity reached. Stop an existing workspace or retry later.")
        identity = str(uuid.uuid4())
        container = engine().containers.run(**runtime_options(request.state.owner, identity))
        try:
            _baselines[identity] = process_ids(container)
        except DockerException:
            remove(container)
            raise
        _touched[identity] = time.time()
    return {"id": identity, "location": "hosted-docker", "workspace": "/workspace", "network": "disabled", "ephemeral": True, "policyVersion": 2}


@app.delete("/sandboxes/{identity}")
def stop(identity: str, request: Request):
    identity = sandbox_id(identity)
    with _lock:
        known = _discarded.get(identity)
        if known and known[:2] == (request.state.owner, namespace()):
            return {"stopped": True}
    remove(owned(request, identity, require_running=False))
    return {"stopped": True}


@app.get("/sandboxes/{identity}")
def inspect_workspace(identity: str, request: Request):
    owned(request, identity)
    return {"id": identity, "location": "hosted-docker", "workspace": "/workspace", "network": "disabled", "ephemeral": True, "policyVersion": 2}


@app.put("/sandboxes/{identity}/file")
def write_file(identity: str, request: Request, body: FileBody):
    path = safe_path(body.path)
    data = body.text.encode("utf-8")
    if len(data) > MAX_FILE:
        raise HTTPException(413, "File exceeds 256 KiB")
    container = owned(request, identity)
    with operation(identity):
        temporary = f".upload-{uuid.uuid4()}"
        # File writes use a non-root guest process, not Docker's privileged archive
        # extractor (which also refuses read-only-root containers on some engines).
        script = """
import os,sys,stat
parts=sys.argv[1].split('/')
fd=os.open('/workspace',os.O_DIRECTORY|os.O_NOFOLLOW)
temporary=sys.argv[2]
try:
 for part in parts[:-1]:
  try: os.mkdir(part,mode=0o700,dir_fd=fd)
  except FileExistsError: pass
  child=os.open(part,os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
  os.close(fd); fd=child
 try:
  existing=os.stat(parts[-1],dir_fd=fd,follow_symlinks=False)
  assert stat.S_ISREG(existing.st_mode)
 except FileNotFoundError: pass
 target=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 try:
  count=int(sys.argv[3]); assert 0<=count<=262144
  data=sys.stdin.buffer.read(count)
  assert len(data)==count
  with os.fdopen(target,'wb') as output: output.write(data)
  os.replace(temporary,parts[-1],src_dir_fd=fd,dst_dir_fd=fd)
 finally:
  try: os.unlink(temporary,dir_fd=fd)
  except FileNotFoundError: pass
finally:
 os.close(fd)
"""
        execution = engine().api.exec_create(container.id, ["python3", "-I", "-c", script, path, temporary, str(len(data))], user="10001:10001", stdin=True)
        connection = engine().api.exec_start(execution["Id"], socket=True)
        try:
            socket = getattr(connection, "_sock", connection)
            socket.settimeout(15)
            socket.sendall(data)
            received = 0
            while True:
                chunk = connection.read(4096)
                if not chunk:
                    break
                received += len(chunk)
                if received > 64 * 1024:
                    raise HTTPException(503, "File operation output exceeded its limit")
        except OSError as error:
            with contextlib.suppress(DockerException):
                remove(container)
            raise HTTPException(503, "File operation timed out; sandbox was stopped") from error
        finally:
            connection.close()
        result = engine().api.exec_inspect(execution["Id"])
        if result["Running"] or result["ExitCode"] != 0:
            raise HTTPException(400, "Destination is not a regular path inside the workspace")
    return {"path": path, "bytes": len(data)}


@app.get("/sandboxes/{identity}/files")
def files(identity: str, request: Request):
    container = owned(request, identity)
    script = "import os,json,itertools; print(json.dumps(list(itertools.islice((os.path.relpath(os.path.join(p,n),'/workspace') for p,ds,ns in os.walk('/workspace',followlinks=False) for n in ns),1000))))"
    with operation(identity):
        code, output = container.exec_run(["python3", "-I", "-c", script], user="10001:10001")
    if code != 0 or len(output) > 512_000:
        raise HTTPException(503, "Could not list workspace files")
    return {"files": json.loads(output)}


@app.get("/sandboxes/{identity}/file")
def read_file(identity: str, path: str, request: Request):
    path = safe_path(path)
    container = owned(request, identity)
    # Resolve/open each component relative to a directory descriptor. A resolve()/stat()/
    # read_text() sequence can be raced by a previous command's background process. Refuse
    # links and special files before reading, and bound the read even if the file grows.
    script = """
import os,sys,stat
parts=sys.argv[1].split('/')
fd=os.open('/workspace',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:
 for part in parts[:-1]:
  child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
  os.close(fd); fd=child
 target=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
 try:
  info=os.fstat(target)
  assert stat.S_ISREG(info.st_mode) and info.st_size<=262144
  with os.fdopen(target,'rb',closefd=False) as source: data=source.read(262145)
  assert len(data)<=262144
  data.decode('utf-8',errors='strict')
  sys.stdout.buffer.write(data)
 finally:
  os.close(target)
finally:
 os.close(fd)
"""
    with operation(identity):
        code, output = container.exec_run(["python3", "-I", "-c", script, path], user="10001:10001")
    if code != 0 or len(output) > MAX_FILE:
        raise HTTPException(400, "File is missing, binary, too large, or outside the workspace")
    return {"path": path, "text": output.decode("utf-8")}


@app.post("/sandboxes/{identity}/run")
def run(identity: str, request: Request, body: RunBody):
    if body.approved is not True:
        raise HTTPException(403, "Explicit execution approval is required")
    container = owned(request, identity)
    with _lock:
        if identity in _removed:
            raise HTTPException(404, "Sandbox was stopped")
        if identity in _busy:
            raise HTTPException(409, "A command is already running")
        _busy.add(identity)
    operation = str(uuid.uuid4())

    def events():
        started = time.monotonic()
        timed_out = threading.Event()
        finished = False

        def expire():
            timed_out.set()
            with contextlib.suppress(DockerException):
                remove(container)

        timer = threading.Timer(body.timeoutSeconds, expire)
        timer.daemon = True
        timer.start()
        try:
            yield "data: " + json.dumps({"event": "execution.started", "runId": operation, "location": "hosted-docker", "cwd": "/workspace", "command": body.command}) + "\n\n"
            execution = engine().api.exec_create(container.id, ["/bin/sh", "-lc", body.command], user="10001:10001", workdir="/workspace")
            count = 0
            for out, err in engine().api.exec_start(execution["Id"], stream=True, demux=True):
                for stream, chunk in (("stdout", out), ("stderr", err)):
                    if not chunk:
                        continue
                    count += len(chunk)
                    if count > MAX_OUTPUT:
                        expire()
                        yield "data: " + json.dumps({"event": "execution.output", "stream": "stderr", "text": "\n[Output limit reached; sandbox stopped.]"}) + "\n\n"
                        break
                    yield "data: " + json.dumps({"event": "execution.output", "stream": stream, "text": chunk.decode("utf-8", errors="replace")}) + "\n\n"
                if count > MAX_OUTPUT:
                    break
            code = None if timed_out.is_set() else engine().api.exec_inspect(execution["Id"])["ExitCode"]
            if not timed_out.is_set() and (not isinstance(code, int) or not quiescent(container)):
                timed_out.set()
            if timed_out.is_set():
                remove(container)  # Wait for the timeout thread's actual teardown receipt.
            finished = True
            yield "data: " + json.dumps({"event": "execution.finished", "runId": operation, "exitCode": code, "stopped": timed_out.is_set(), "seconds": round(time.monotonic() - started, 3)}) + "\n\n"
        except DockerException:
            if timed_out.is_set():
                try:
                    remove(container)
                    finished = True
                except DockerException:
                    pass
                if finished:
                    yield "data: " + json.dumps({"event": "execution.finished", "runId": operation, "exitCode": None, "stopped": True, "seconds": round(time.monotonic() - started, 3)}) + "\n\n"
            if not finished:
                yield "data: " + json.dumps({"event": "execution.failed", "runId": operation, "message": "Sandbox stopped or lost contact with its engine; teardown is unconfirmed."}) + "\n\n"
        finally:
            timer.cancel()
            if not finished:
                with contextlib.suppress(DockerException):
                    remove(container)
            with _lock:
                _busy.discard(identity)
                if identity not in _removed:
                    _touched[identity] = time.time()

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
