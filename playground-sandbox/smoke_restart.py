"""Crash only the uniquely named smoke broker; verify old active/idle workloads expire.

The enclosing Smoke-Docker.ps1 owns this namespace and cleans exact resources on failure.
No application service or database is restarted.
"""
import concurrent.futures
import json
import os
import subprocess
import threading
import time

import requests

base = os.environ["PLAYGROUND_SANDBOX_TEST_URL"]
name = os.environ["PLAYGROUND_SANDBOX_NAMESPACE"]
assert name.startswith("filspresso-playground-broker-check-")
headers = {"x-sandbox-key": os.environ["PLAYGROUND_SANDBOX_KEY"], "x-sandbox-owner": "987654321"}


def request(method, path, **kwargs):
    return requests.request(method, base + path, headers=headers, timeout=40, **kwargs)


idle = request("POST", "/sandboxes")
idle.raise_for_status()
active = request("POST", "/sandboxes")
active.raise_for_status()
idle_id, active_id = idle.json()["id"], active.json()["id"]
started = threading.Event()


def running():
    try:
        with request("POST", f"/sandboxes/{active_id}/run", json={"command": "sleep 300 & wait", "approved": True, "timeoutSeconds": 60}, stream=True) as response:
            response.raise_for_status()
            for line in response.iter_lines(chunk_size=1):
                if line.startswith(b"data:") and json.loads(line[5:]).get("event") == "execution.started":
                    started.set()
    except requests.RequestException:
        pass  # An interrupted stream is expected, never evidence of command completion.


with concurrent.futures.ThreadPoolExecutor(max_workers=1) as workers:
    task = workers.submit(running)
    assert started.wait(10), "Command did not start before the crash check"
    subprocess.run(["docker", "kill", "--signal", "KILL", name], check=True, capture_output=True)
    subprocess.run(["docker", "start", name], check=True, capture_output=True)
    for attempt in range(60):
        try:
            if request("GET", "/health").status_code == 200:
                break
        except requests.RequestException:
            pass
        time.sleep(0.2)
    else:
        raise AssertionError("Crashed smoke broker did not recover")
    task.result(timeout=10)

for identity in (idle_id, active_id):
    assert request("GET", f"/sandboxes/{identity}").status_code == 404
    inspected = subprocess.run(["docker", "container", "inspect", f"filspresso-playground-{identity}"], capture_output=True)
    assert inspected.returncode != 0, "Old-epoch workload/descendants survived broker recovery"

fresh = request("POST", "/sandboxes")
fresh.raise_for_status()
identity = fresh.json()["id"]
try:
    assert request("GET", f"/sandboxes/{identity}").status_code == 200
finally:
    response = request("DELETE", f"/sandboxes/{identity}")
    response.raise_for_status()
    assert response.json()["stopped"] is True
print("PASS: real broker SIGKILL/restart discarded idle and active old-epoch workloads/descendants; fresh workspaces remain usable.")
