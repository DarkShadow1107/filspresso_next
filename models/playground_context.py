"""Bounded, non-executing attachment and project ingestion for both Playground clients."""
from __future__ import annotations

import asyncio
import base64
import io
import itertools
import json
from pathlib import PurePosixPath, Path
import re
import subprocess
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET

import httpx
from starlette.concurrency import run_in_threadpool

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TEXT = 240_000
INPUT_LEVELS = (16_384, 32_768, 65_536, 131_072)
VISION_FILE = "LFM2.5-VL-450M-Q4_K_M.gguf"
AUDIO_FILE = "LFM2.5-Audio-1.5B-Q4_0.gguf"
VISION_KEY = "lfm2_5_vl_450m_q4_k_m"
AUDIO_KEY = "lfm2_5_audio_1_5b_q4_0"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi"}
SKIP_PARTS = {"node_modules", ".git", "vendor", ".venv", "bin", "obj", "dist", "build", ".next"}


class ContextError(ValueError):
    def __init__(self, message: str, status: int = 400, usage: list[dict] | None = None):
        super().__init__(message)
        self.status = status
        self.usage = usage or []


def clean_name(value: str) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", "", value.replace("\\", "/").split("/")[-1])[:180] or "attachment"


def _bounded(text: str, warnings: list[str]) -> str:
    if len(text) > MAX_TEXT:
        warnings.append(f"Only the first {MAX_TEXT:,} characters are included.")
    return text[:MAX_TEXT]


def _archive(data: bytes) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        entries = archive.infolist()
        if len(entries) > 4000 or sum(entry.file_size for entry in entries) > 80 * 1024 * 1024:
            raise ContextError("This archive expands beyond the supported size.", 413)
        if any(entry.file_size > 8 * 1024 * 1024 or entry.file_size > max(1, entry.compress_size) * 300 for entry in entries):
            raise ContextError("This archive contains an oversized compressed entry.", 413)
        return archive
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise ContextError("The archive could not be read.") from error


def read_project_archive(data: bytes) -> tuple[str, list[str]]:
    warnings: list[str] = []
    with _archive(data) as archive:
        files = [entry for entry in archive.infolist() if not entry.is_dir() and
                 not any(part in SKIP_PARTS or part == ".." for part in PurePosixPath(entry.filename).parts)]
        # A GitHub zipball wraps everything in a single generated root directory.
        files.sort(key=lambda entry: (0 if PurePosixPath(entry.filename).name.lower().startswith("readme") else
                                     1 if PurePosixPath(entry.filename).name in {"package.json", "pyproject.toml", "Cargo.toml", "README.md"} else 2,
                                     len(PurePosixPath(entry.filename).parts), entry.filename))
        result = ["Project file list:\n" + "\n".join(entry.filename for entry in files[:300])]
        included = 0
        length = len(result[0])
        for entry in files:
            if included >= 40 or length >= MAX_TEXT - 1000:
                break
            try:
                raw = archive.read(entry)
                if b"\x00" in raw[:4096]:
                    continue
                text = raw.decode("utf-8-sig")
            except (UnicodeDecodeError, RuntimeError):
                continue
            if not text.strip():
                continue
            block = f"\n--- {entry.filename} ---\n{text[:40_000]}"
            remaining = MAX_TEXT - length
            result.append(block[:remaining])
            length += min(remaining, len(block))
            included += 1
        warnings.append(f"Project snapshot: {included} text files included from {len(files)} files; dependencies and binaries are excluded.")
    return "\n".join(result), warnings


def extract_document(data: bytes, name: str) -> dict:
    suffix = PurePosixPath(name).suffix.lower()
    warnings: list[str] = []
    if suffix == ".pdf":
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted and not reader.decrypt(""):
                raise ContextError("This PDF is password-protected. Upload an unlocked copy.")
            pages = reader.pages
            text = "\n\n".join((page.extract_text() or "")[:50_000] for page in itertools.islice(pages, 100))
            if len(pages) > 100:
                warnings.append("Only the first 100 PDF pages are included.")
            if not text.strip():
                import pypdfium2 as pdfium
                document = pdfium.PdfDocument(data)
                images = []
                try:
                    for index in range(min(3, len(document))):
                        page = document[index]
                        width, height = page.get_size()
                        bitmap = page.render(scale=min(1.4, 1536 / max(width, height, 1)))
                        image = bitmap.to_pil()
                        output = io.BytesIO()
                        image.save(output, format="PNG")
                        images.append(output.getvalue())
                        image.close(); bitmap.close(); page.close()
                    if len(document) > 3:
                        warnings.append("Scanned PDF: the first 3 pages are analyzed.")
                finally:
                    document.close()
                return {"text": "", "images": images, "warnings": warnings}
        except ContextError:
            raise
        except Exception as error:
            raise ContextError("This PDF could not be read.") from error
    elif suffix in {".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"}:
        parts = []
        with _archive(data) as archive:
            for entry in archive.infolist():
                if not entry.filename.endswith(".xml") or not entry.filename.startswith(("word/", "xl/", "ppt/slides/", "content.xml")):
                    continue
                try:
                    root = ET.fromstring(archive.read(entry))
                    parts.extend(node.text or "" for node in root.iter() if node.tag.rsplit("}", 1)[-1] in {"t", "v", "p"})
                except ET.ParseError:
                    raise ContextError("This document contains invalid XML.")
        text = "\n".join(parts)
    elif suffix == ".zip":
        text, warnings = read_project_archive(data)
    else:
        try:
            if b"\x00" in data[:4096]:
                raise UnicodeDecodeError("utf8", data, 0, 1, "binary")
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ContextError("This file is not a readable text/document format. Supported: PDF, Office/OpenDocument, text/code, ZIP projects, images, audio and video.", 415) from error
    if not text.strip():
        raise ContextError("No readable content was found in this file.")
    return {"text": _bounded(text, warnings), "warnings": warnings, "images": []}


def normalize_image(data: bytes) -> bytes:
    from PIL import Image, ImageOps
    try:
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > 25_000_000:
                raise ContextError("This image is larger than 25 megapixels.", 413)
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((1536, 1536))
            output = io.BytesIO(); image.save(output, format="PNG")
            return output.getvalue()
    except ContextError:
        raise
    except Exception as error:
        raise ContextError("The image could not be decoded.") from error


def extract_media(data: bytes, suffix: str, video: bool) -> dict:
    warnings = []
    with tempfile.TemporaryDirectory(prefix="filspresso-media-") as directory:
        source = Path(directory) / ("input" + suffix)
        source.write_bytes(data)
        formats = "mov,matroska,webm,avi,mp3,wav,flac,ogg,aac"
        try:
            probe = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats,
                                    "-show_format", "-show_streams", "-of", "json", str(source)], capture_output=True, timeout=30, check=True)
            if len(probe.stdout) > 512_000:
                raise ContextError("Media metadata is too large.", 413)
            metadata = json.loads(probe.stdout)
            duration = float(metadata.get("format", {}).get("duration") or 0)
            if duration <= 0:
                raise ContextError("This media file does not report a usable duration.")
            analyzed = min(duration, 120)
            if duration > analyzed:
                warnings.append("Only the first 2 minutes are analyzed.")
            streams = metadata.get("streams", [])
            frames = []
            if video:
                for index, position in enumerate((0, analyzed / 2, max(0, analyzed - 1))):
                    target = Path(directory) / f"frame-{index}.png"
                    subprocess.run(["ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats,
                                    "-ss", str(position), "-i", str(source), "-frames:v", "1", "-vf", "scale=1024:1024:force_original_aspect_ratio=decrease", "-threads", "1", str(target)],
                                   capture_output=True, timeout=40, check=True)
                    if target.exists():
                        frames.append((round(position, 1), target.read_bytes()))
                warnings.append("Video analysis uses 3 sampled frames" + (" and its audio track." if any(stream.get("codec_type") == "audio" for stream in streams) else "."))
            audio = None
            if any(stream.get("codec_type") == "audio" for stream in streams):
                target = Path(directory) / "audio.wav"
                subprocess.run(["ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", formats,
                                "-i", str(source), "-t", str(analyzed), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-threads", "1", str(target)],
                               capture_output=True, timeout=60, check=True)
                audio = target.read_bytes()
            return {"frames": frames, "audio": audio, "duration": duration, "warnings": warnings}
        except (subprocess.SubprocessError, FileNotFoundError, json.JSONDecodeError, ValueError) as error:
            if isinstance(error, ContextError):
                raise
            raise ContextError("The audio/video file could not be decoded.") from error


class MediaReader:
    def __init__(self, runtime):
        self.runtime = runtime

    async def analyze(self, kind: str, data: bytes) -> tuple[str, dict]:
        model = AUDIO_FILE if kind == "audio" else VISION_FILE
        key = AUDIO_KEY if kind == "audio" else VISION_KEY
        coordinator = self.runtime.residency
        await coordinator.refresh_residency()
        await coordinator.request_load(model)
        deadline = time.monotonic() + 900
        while time.monotonic() < deadline:
            await coordinator.refresh_residency()
            state = coordinator.status_for(model)
            if state["status"] == "loaded":
                break
            if state["status"] == "unavailable":
                raise ContextError("The attachment model could not be loaded. Please retry.", 503)
            await asyncio.sleep(1)
        else:
            raise ContextError("The attachment model is still loading. Please retry shortly.", 503)
        encoded = base64.b64encode(data).decode("ascii")
        content = ([{"type": "text", "text": "Transcribe this audio verbatim. Return only the transcript."},
                    {"type": "input_audio", "input_audio": {"data": encoded, "format": "wav"}}] if kind == "audio" else
                   [{"type": "text", "text": "Describe the image and transcribe all readable text, preserving code and document structure when visible. Do not invent details."},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}}])
        async with coordinator.slot(model, wait_seconds=60):
            response = await self.runtime._client.post(
                self.runtime._resolve_model_base_url(model) + "/v1/chat/completions",
                json={"model": model.removesuffix(".gguf"), "messages": [{"role": "user", "content": content}], "max_tokens": 2048, "temperature": 0.1, "reasoning": "off", "stream": False},
                headers=self.runtime._llama_headers(), timeout=300)
            if response.status_code >= 400:
                raise ContextError("The attachment model could not analyze this media file.", 502)
            payload = response.json()
        choices = payload.get("choices") or []
        text = str((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""
        usage = payload.get("usage")
        if not isinstance(usage, dict) or not all(type(usage.get(field)) is int and usage[field] >= 0 for field in ("prompt_tokens", "completion_tokens")):
            raise ContextError("The attachment model returned no readable content or usage data.", 502)
        metered = {"modelKey": key, "inputTokens": usage["prompt_tokens"], "outputTokens": usage["completion_tokens"]}
        if not text:
            raise ContextError("The attachment model returned no readable content.", 502, usage=[metered])
        return text, metered


async def prepare_file(data: bytes, filename: str, reader: MediaReader) -> dict:
    usage = []
    try:
        return await _prepare_file(data, filename, reader, usage)
    except ContextError as error:
        error.usage = usage + error.usage
        raise
    except Exception as error:
        raise ContextError("The file could not be processed. Please retry.", 503, usage=usage) from error


async def _prepare_file(data: bytes, filename: str, reader: MediaReader, usage: list[dict]) -> dict:
    if not data or len(data) > MAX_FILE_BYTES:
        raise ContextError("Choose a non-empty file no larger than 20 MB.", 413)
    name = clean_name(filename)
    suffix = PurePosixPath(name).suffix.lower()
    result = {"name": name, "kind": "document", "text": "", "size": len(data), "warnings": [], "usage": usage}
    if suffix in IMAGE_EXTENSIONS:
        result["kind"] = "image"
        normalized = await run_in_threadpool(normalize_image, data)
        result["text"], usage = await reader.analyze("image", normalized)
        result["usage"].append(usage)
    elif suffix in AUDIO_EXTENSIONS or suffix in VIDEO_EXTENSIONS:
        video = suffix in VIDEO_EXTENSIONS
        result["kind"] = "video" if video else "audio"
        media = await run_in_threadpool(extract_media, data, suffix, video)
        result["warnings"] = media["warnings"]
        blocks = [f"Duration: {media['duration']:.1f} seconds."]
        for timestamp, image in media["frames"]:
            text, usage = await reader.analyze("image", image)
            blocks.append(f"Frame at {timestamp}s:\n{text}")
            result["usage"].append(usage)
        if media["audio"]:
            text, usage = await reader.analyze("audio", media["audio"])
            blocks.append("Audio transcript:\n" + text)
            result["usage"].append(usage)
        result["text"] = "\n\n".join(blocks)
    else:
        document = await run_in_threadpool(extract_document, data, name)
        result["text"], result["warnings"] = document["text"], document["warnings"]
        for index, image in enumerate(document["images"]):
            text, usage = await reader.analyze("image", image)
            result["text"] += f"\nPage {index + 1}:\n{text}"
            result["usage"].append(usage)
    result["text"] = _bounded(result["text"], result["warnings"])
    return result


def github_coordinates(value: str) -> tuple[str, str]:
    match = re.fullmatch(r"https://github\.com/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9_.-]{1,100})/?", value.strip(), re.IGNORECASE)
    if not match:
        raise ContextError("Enter a GitHub repository URL such as https://github.com/owner/project.")
    owner, repository = match.groups()
    repository = repository.removesuffix(".git")
    if repository in {".", "..", ""}:
        raise ContextError("Enter a valid GitHub repository URL.")
    return owner, repository


async def prepare_github(value: str) -> dict:
    owner, repository = github_coordinates(value)
    # Fixed GitHub hosts, no arbitrary URL fetching, redirects or credential forwarding.
    url = f"https://api.github.com/repos/{owner}/{repository}/zipball"
    headers = {"User-Agent": "Filspresso-Playground", "Accept": "application/vnd.github+json"}
    data = bytearray()
    async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
        for _ in range(3):
            async with client.stream("GET", url, headers=headers) as response:
                if response.status_code in {301, 302, 307, 308}:
                    from urllib.parse import urlparse
                    target = response.headers.get("location", "")
                    parsed = urlparse(target)
                    if parsed.scheme != "https" or parsed.hostname not in {"api.github.com", "codeload.github.com"} or parsed.username or parsed.port not in {None, 443}:
                        raise ContextError("GitHub returned an unsupported download location.", 502)
                    url = target
                    continue
                if response.status_code == 404:
                    raise ContextError("This repository is private, missing, or not publicly accessible.", 404)
                if response.status_code in {403, 429}:
                    raise ContextError("GitHub is rate-limiting repository downloads. Please retry later.", 429)
                if response.status_code >= 400:
                    raise ContextError("The GitHub project could not be downloaded.", 502)
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_FILE_BYTES:
                        raise ContextError("This repository archive is larger than 20 MB. Upload a smaller project ZIP or selected files.", 413)
                break
        else:
            raise ContextError("GitHub returned too many redirects.", 502)
    text, warnings = await run_in_threadpool(read_project_archive, bytes(data))
    return {"name": f"{owner}/{repository}", "kind": "github", "text": text, "sourceUrl": f"https://github.com/{owner}/{repository}", "size": len(data), "warnings": warnings, "usage": []}


def build_messages(message: str, system_prompt: str, history: list, contexts: list) -> list[dict]:
    if not isinstance(history, list) or len(history) > 100 or not isinstance(contexts, list) or len(contexts) > 12:
        raise ContextError("There are too many messages or attachments in this request.", 413)
    messages = [{"role": "system", "content": system_prompt}] if system_prompt else []
    for entry in history:
        if not isinstance(entry, dict) or entry.get("role") not in {"user", "assistant"} or not isinstance(entry.get("content"), str):
            raise ContextError("Invalid conversation history.")
        messages.append({"role": entry["role"], "content": entry["content"]})
    blocks = [message]
    for item in contexts:
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise ContextError("Invalid attachment context.")
        name = clean_name(str(item.get("name") or "attachment"))
        blocks.append(f"\n<attached-source name={json.dumps(name)}>\n{item['text']}\n</attached-source>")
    messages.append({"role": "user", "content": "\n\n".join(blocks)})
    if sum(len(entry["content"]) for entry in messages) > 800_000:
        raise ContextError("This conversation contains too much text. Remove some attachments or start a new conversation.", 413)
    return messages
