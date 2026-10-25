import importlib.util
import pathlib
import sys
import concurrent.futures
import threading
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

pytest.importorskip("docker")
spec = importlib.util.spec_from_file_location("playground_sandbox_broker", pathlib.Path(__file__).resolve().parents[2] / "playground-sandbox" / "broker.py")
broker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = broker
spec.loader.exec_module(broker)


@pytest.mark.parametrize("path", ["../outside", "/etc/passwd", "a/../../etc", "a\\b", "a//b", "./file", "file\x00.txt"])
def test_workspace_paths_are_relative_and_bounded(path):
    with pytest.raises(HTTPException):
        broker.safe_path(path)


def test_workload_is_offline_nonroot_bounded_and_has_no_mounts_or_secrets():
    options = broker.runtime_options("42", "00000000-0000-4000-8000-000000000000")
    assert options["network_mode"] == "none"
    assert options["user"] == "10001:10001"
    assert options["read_only"] is True
    assert options["cap_drop"] == ["ALL"]
    assert "no-new-privileges:true" in options["security_opt"]
    assert options["mem_limit"] == "512m" and options["pids_limit"] == 128
    assert options["nano_cpus"] == 1000000000
    assert "volumes" not in options and "mounts" not in options
    assert all("KEY" not in name and "TOKEN" not in name for name in options["environment"])
    assert "size=64m" in options["tmpfs"]["/workspace"]


def test_broker_denies_missing_credentials_and_unapproved_execution(monkeypatch):
    monkeypatch.setenv("PLAYGROUND_SANDBOX_KEY", "test-only-" + "a" * 40)
    monkeypatch.setattr(broker, "recover", lambda: None)
    with TestClient(broker.app) as client:
        assert client.post("/sandboxes").status_code == 401
        headers = {"x-sandbox-key": "test-only-" + "a" * 40, "x-sandbox-owner": "42"}
        response = client.post("/sandboxes/00000000-0000-4000-8000-000000000000/run", headers=headers, json={"command": "echo hello", "approved": False})
        assert response.status_code == 403
        assert client.post("/sandboxes/00000000-0000-4000-8000-000000000000/run", headers=headers, json={"command": "echo hello", "approved": "true"}).status_code == 422


def test_owned_lookup_does_not_accept_another_accounts_container(monkeypatch):
    class Container:
        labels = {broker.LABEL: "1", "filspresso.owner": "other"}
    class Containers:
        def get(self, name): return Container()
    class Engine:
        containers = Containers()
    class State:
        owner = "42"
    class Request:
        state = State()
    monkeypatch.setattr(broker, "engine", lambda: Engine())
    with pytest.raises(HTTPException) as error:
        broker.owned(Request(), "00000000-0000-4000-8000-000000000000")
    assert error.value.status_code == 404


def test_namespaces_isolate_ownership_capacity_and_reaper_discovery(monkeypatch):
    class Container:
        def __init__(self, scope):
            self.labels = {broker.LABEL: "1", "filspresso.owner": "42"}
            if scope is not None:
                self.labels["filspresso.namespace"] = scope
    old, local, other = Container(None), Container("test"), Container("another-broker")
    class Containers:
        def list(self, **kwargs): return [old, local, other]
        def get(self, name): return other
    class Engine:
        containers = Containers()
    class State:
        owner = "42"
    class Request:
        state = State()
    monkeypatch.setattr(broker, "engine", lambda: Engine())
    monkeypatch.setenv("PLAYGROUND_SANDBOX_NAMESPACE", "test")
    assert broker.scoped_containers() == [local]
    assert broker.runtime_options("42", "fixture")["labels"]["filspresso.namespace"] == "test"
    with pytest.raises(HTTPException) as error:
        broker.owned(Request(), "00000000-0000-4000-8000-000000000000")
    assert error.value.status_code == 404
    monkeypatch.delenv("PLAYGROUND_SANDBOX_NAMESPACE")
    assert broker.scoped_containers() == [old]


def test_namespace_configuration_is_bounded_not_a_caller_override(monkeypatch):
    monkeypatch.setenv("PLAYGROUND_SANDBOX_NAMESPACE", "invalid/namespace")
    with pytest.raises(RuntimeError):
        broker.namespace()


def test_quiescence_freezes_before_process_check_and_only_unpauses_the_exact_baseline(monkeypatch):
    steps = []
    class Container:
        labels = {"filspresso.id": "fixture"}
        def pause(self): steps.append("pause")
        def unpause(self): steps.append("unpause")
        def top(self, **kwargs):
            steps.append("top")
            return {"Titles": ["PID"], "Processes": [["100"], ["101"]]}
    monkeypatch.setitem(broker._baselines, "fixture", frozenset({"100", "101"}))
    assert broker.quiescent(Container()) is True
    assert steps == ["pause", "top", "unpause"]


def test_a_detached_descendant_discards_the_frozen_workload_instead_of_reusing_it(monkeypatch):
    steps = []
    class Container:
        labels = {"filspresso.id": "fixture"}
        def pause(self): steps.append("pause")
        def unpause(self): raise AssertionError("Never resume an unexpected task")
        def top(self, **kwargs): return {"Titles": ["PID"], "Processes": [["100"], ["101"], ["999"]]}
    monkeypatch.setitem(broker._baselines, "fixture", frozenset({"100", "101"}))
    monkeypatch.setattr(broker, "remove", lambda container: steps.append("remove"))
    assert broker.quiescent(Container()) is False
    assert steps == ["pause", "remove"]


def test_recovery_discards_old_epoch_only_and_operation_reservations_exclude_file_command_races(monkeypatch):
    old = type("Container", (), {"labels": {"filspresso.broker_epoch": "old"}})()
    current = type("Container", (), {"labels": {"filspresso.broker_epoch": broker.BROKER_EPOCH}})()
    removed = []
    monkeypatch.setattr(broker, "scoped_containers", lambda: [old, current])
    monkeypatch.setattr(broker, "remove", removed.append)
    broker.recover()
    assert removed == [old]
    with broker.operation("fixture"):
        with pytest.raises(HTTPException) as error:
            with broker.operation("fixture"): pass
        assert error.value.status_code == 409
    assert "fixture" not in broker._busy


def test_discard_confirmation_requires_successful_daemon_removal_and_the_exact_owner(monkeypatch):
    identity = "00000000-0000-4000-8000-000000000042"
    calls = []
    class Container:
        labels = {broker.LABEL: "1", "filspresso.id": identity, "filspresso.owner": "42", "filspresso.namespace": "", "filspresso.broker_epoch": broker.BROKER_EPOCH}
        status = "paused"
        def remove(self, **options):
            calls.append(options)
            if len(calls) == 1:
                raise broker.DockerException("Temporary daemon failure")
    monkeypatch.delenv("PLAYGROUND_SANDBOX_NAMESPACE", raising=False)
    monkeypatch.setattr(broker, "_removed", {})
    monkeypatch.setattr(broker, "_discarded", {})
    monkeypatch.setattr(broker, "engine", lambda: SimpleNamespace(containers=SimpleNamespace(get=lambda _: Container())))
    request = SimpleNamespace(state=SimpleNamespace(owner="42"))
    with pytest.raises(broker.DockerException):
        broker.stop(identity, request)
    assert identity not in broker._discarded
    assert broker.stop(identity, request) == {"stopped": True}  # Retry also permits a paused/invalidated workload.
    assert broker.stop(identity, request) == {"stopped": True}
    assert len(calls) == 2
    with pytest.raises(HTTPException) as error:
        broker.stop(identity, SimpleNamespace(state=SimpleNamespace(owner="43")))
    assert error.value.status_code == 404 and len(calls) == 2


def test_timeout_and_explicit_discard_share_one_confirmed_daemon_removal(monkeypatch):
    identity = "concurrent-removal-fixture"
    entered, release = threading.Event(), threading.Event()
    calls = []
    class Container:
        labels = {"filspresso.id": identity, "filspresso.owner": "42", "filspresso.namespace": "fixture"}
        def remove(self, **options):
            calls.append(options)
            entered.set()
            assert release.wait(3)
    monkeypatch.setattr(broker, "_removed", {})
    monkeypatch.setattr(broker, "_discarded", {})
    monkeypatch.setattr(broker, "_removals", {})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(broker.remove, Container())
        assert entered.wait(3)
        second = workers.submit(broker.remove, Container())
        assert identity not in broker._discarded
        release.set()
        first.result(timeout=3)
        second.result(timeout=3)
    assert len(calls) == 1 and broker._discarded[identity][:2] == ("42", "fixture")
