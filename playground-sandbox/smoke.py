"""Real-engine integration check. Run only against a test broker, never production.

Reads PLAYGROUND_SANDBOX_TEST_URL/PLAYGROUND_SANDBOX_KEY; creates and removes only
its own temporary workspaces. Credentials and command output are not printed.
"""
import json
import os
import requests

base = os.environ.get("PLAYGROUND_SANDBOX_TEST_URL", "http://127.0.0.1:18095")
headers = {"x-sandbox-key": os.environ["PLAYGROUND_SANDBOX_KEY"], "x-sandbox-owner": "987654321"}


def request(method, path, body=None, status=200, owner=None):
    response = requests.request(method, base + path, json=body, headers={**headers, **({"x-sandbox-owner": owner} if owner else {})}, timeout=40)
    assert response.status_code == status, (path, response.status_code, response.text[:300])
    return response


def run(identity, command, timeout=30):
    response = request("POST", f"/sandboxes/{identity}/run", {"command": command, "approved": True, "timeoutSeconds": timeout})
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    assert events[0]["event"] == "execution.started"
    return events, "".join(event.get("text", "") for event in events)


identity = None
try:
    assert requests.post(base + "/sandboxes", timeout=10).status_code == 401
    assert request("GET", "/health").json()["network"] == "disabled"
    identity = request("POST", "/sandboxes").json()["id"]
    request("PUT", f"/sandboxes/{identity}/file", {"path": "project/main.py", "text": "print('sandbox-smoke')\n"})
    assert "project/main.py" in request("GET", f"/sandboxes/{identity}/files").json()["files"]
    assert request("GET", f"/sandboxes/{identity}/file?path=project/main.py").json()["text"] == "print('sandbox-smoke')\n"
    for name, text in [("empty.txt", ""), ("unicode.txt", "café 😀\n")]:
        request("PUT", f"/sandboxes/{identity}/file", {"path": name, "text": text})
        assert request("GET", f"/sandboxes/{identity}/file?path={name}").json()["text"] == text
    request("GET", f"/sandboxes/{identity}/files", owner="987654322", status=404)
    request("PUT", f"/sandboxes/{identity}/file", {"path": "../escape", "text": "no"}, status=400)
    request("POST", f"/sandboxes/{identity}/run", {"command": "echo no", "approved": False}, status=403)
    request("POST", f"/sandboxes/{identity}/run", {"command": "echo no", "approved": "true"}, status=422)
    events, output = run(identity, "python3 project/main.py")
    assert output.strip() == "sandbox-smoke" and events[-1]["exitCode"] == 0
    events, output = run(identity, "python3 -c \"import os,json; print(json.dumps({'uid':os.getuid(),'interfaces':os.listdir('/sys/class/net'),'socket':os.path.exists('/var/run/docker.sock')}))\"")
    state = json.loads(output)
    assert state == {"uid": 10001, "interfaces": ["lo"], "socket": False}
    run(identity, "ln -s /tmp linked")
    request("PUT", f"/sandboxes/{identity}/file", {"path": "linked/escape.txt", "text": "no"}, status=400)
    run(identity, "ln -s project/main.py linked-file; mkfifo named-pipe; printf '\\377' > binary.bin")
    for name in ["linked-file", "named-pipe", "binary.bin", "missing.txt"]:
        request("GET", f"/sandboxes/{identity}/file?path={name}", status=400)
    events, _ = run(identity, "python3 -c \"import subprocess; subprocess.Popen(['sleep','300'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)\"")
    assert events[-1]["event"] == "execution.finished" and events[-1]["stopped"] is True
    request("GET", f"/sandboxes/{identity}/files", status=404)
    assert request("DELETE", f"/sandboxes/{identity}").json()["stopped"] is True
    assert request("DELETE", f"/sandboxes/{identity}").json()["stopped"] is True
    request("DELETE", f"/sandboxes/{identity}", owner="987654322", status=404)
    identity = request("POST", "/sandboxes").json()["id"]
    # A detached descendant cannot outlive container removal, even after leaving the shell's
    # process group. This tests teardown, not cleanup after a normally completed command.
    events, _ = run(identity, "python3 -c \"import subprocess,time; subprocess.Popen(['sleep','300'],start_new_session=True); time.sleep(300)\"", timeout=1)
    assert events[-1]["event"] == "execution.finished" and events[-1]["stopped"] is True
    request("GET", f"/sandboxes/{identity}/files", status=404)
    assert request("DELETE", f"/sandboxes/{identity}").json()["stopped"] is True
    identity = None
    print("PASS: real Docker files/run/isolation/approval, normal/timeout descendant disposal and owner-bound idempotent discard receipts.")
finally:
    if identity:
        requests.delete(base + f"/sandboxes/{identity}", headers=headers, timeout=20)
