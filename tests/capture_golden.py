"""
Captures a golden *shape* snapshot of the live AI gateway.

Model output is non-deterministic, so capturing values would produce a
permanently-red test. What must not change across the FastAPI migration is the
**structure**: HTTP status codes and the set of JSON keys with their types.
That is what this records.

Usage (against the live container):
    python tests/capture_golden.py http://127.0.0.1:5000

Then diff after the migration:
    python tests/capture_golden.py http://127.0.0.1:5000 --out tests/golden/after.json
    diff tests/golden/before.json tests/golden/after.json

Committed baseline lives at tests/golden/before.json.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import httpx

GOLDEN_DIR = pathlib.Path(__file__).resolve().parent / "golden"

LFM_TEXT_MODEL = "LFM2.5-2.6B-Q4_0.gguf"
LFM_VISION_MODEL = "LFM2-VL-450M-Q4_0.gguf"

# (name, method, path, json_body)
PROBES: list[tuple[str, str, str, dict | None]] = [
    ("health", "GET", "/api/health", None),
    ("chat_ok", "POST", "/api/chat", {"message": "hi", "mode": "natural_language", "text_model": LFM_TEXT_MODEL}),
    ("chat_chemistry", "POST", "/api/chat", {"message": "why", "mode": "chemistry", "text_model": LFM_TEXT_MODEL}),
    ("chat_missing_message", "POST", "/api/chat", {"mode": "natural_language"}),
    ("chat_invalid_mode", "POST", "/api/chat", {"message": "hi", "mode": "bogus"}),
    # max_tokens must be comfortably above LFM 2.5's reasoning budget, otherwise
    # thinking consumes the whole allowance and no content delta is ever emitted.
    ("stream_ok", "POST", "/api/chat/stream", {"message": "hi", "text_model": LFM_TEXT_MODEL, "max_tokens": 400}),
    ("stream_missing_message", "POST", "/api/chat/stream", {"text_model": LFM_TEXT_MODEL}),
    ("warmup_get", "GET", "/api/warmup", None),
    ("warmup_post_unknown", "POST", "/api/warmup", {"model": "not-a-real-model.gguf", "vision": False}),
    ("cancel", "POST", "/api/cancel/golden-probe", None),
    ("molecule_search_missing_q", "GET", "/api/molecule/search", None),
    ("icons_save_missing_fields", "POST", "/api/icons/save", {"username": ""}),
]


def shape_of(value) -> object:
    """
    Reduces a value to its structural signature.

    Containers collapse to sorted key:type lists so key *order* and array length
    changes do not produce noise, while a missing key or a changed type does.
    """
    if isinstance(value, dict):
        return {k: shape_of(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        # Record the element shape once; a populated catalogue would otherwise
        # make the snapshot enormous and change on every product edit.
        return [shape_of(value[0])] if value else []
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int) and not isinstance(value, bool):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        # Record only whether the string looked non-empty, never its content.
        return "str" if value else "str:empty"
    return type(value).__name__


def sse_shape(text: str) -> dict:
    """Structural signature of an SSE body, mirroring the browser client's parser."""
    events: list[dict] = []
    buffer = ""
    for chunk in [text]:
        buffer += chunk
        while "\n\n" in buffer:
            frame, buffer = buffer.split("\n\n", 1)
            for line in frame.split("\n"):
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    events.append(shape_of(json.loads(data)))
                except json.JSONDecodeError:
                    events.append({"<unparseable>": "frame"})
    return {
        "separator": "\\n\\n" if "\n\n" in text else "<MISSING \\n\\n SEPARATOR>",
        # NOT part of the contract: the number of frames depends on how many
        # tokens the model happened to emit. Ignore event_count when diffing;
        # event_keys and separator are what the browser client actually depends on.
        "event_count": len(events),
        "event_keys": sorted({k for e in events if isinstance(e, dict) for k in e}),
    }


def capture(base_url: str, timeout: float = 240.0) -> dict:
    snapshot: dict = {"base_url": base_url, "probes": {}}
    with httpx.Client(base_url=base_url, timeout=timeout) as client:
        for name, method, path, body in PROBES:
            entry: dict = {"method": method, "path": path}
            try:
                if method == "GET":
                    response = client.get(path)
                else:
                    response = client.post(path, json=body)

                entry["status"] = response.status_code
                content_type = response.headers.get("content-type", "")

                if "text/event-stream" in content_type:
                    entry["kind"] = "sse"
                    entry["sse"] = sse_shape(response.text)
                else:
                    entry["kind"] = "json"
                    try:
                        entry["shape"] = shape_of(response.json())
                    except (json.JSONDecodeError, ValueError):
                        entry["shape"] = "<NON-JSON BODY>"
                        entry["body_prefix"] = response.text[:120]
            except Exception as exc:  # noqa: BLE001 - snapshot must not crash
                entry["error"] = f"{type(exc).__name__}: {exc}"

            snapshot["probes"][name] = entry
    return snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="e.g. http://127.0.0.1:5000")
    parser.add_argument("--out", default=str(GOLDEN_DIR / "before.json"))
    args = parser.parse_args()

    snapshot = capture(args.base_url.rstrip("/"))
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    failures = [name for name, e in snapshot["probes"].items() if "error" in e]
    print(f"wrote {out}")
    print(f"probes: {len(snapshot['probes'])}   transport errors: {len(failures)}")
    for name in failures:
        print(f"  ! {name}: {snapshot['probes'][name]['error']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
