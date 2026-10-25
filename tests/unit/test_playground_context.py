import asyncio
import io
import zipfile

import pytest

from models.playground_context import (
    ContextError, build_messages, extract_document, github_coordinates,
    prepare_file, read_project_archive,
)


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as value:
        for name, text in entries.items():
            value.writestr(name, text)
    return output.getvalue()


def test_text_and_code_are_read_without_being_executed():
    result = extract_document(b"print('context, not execution')", "example.py")
    assert "print(" in result["text"]
    assert result["images"] == []


def test_office_document_text_is_extracted():
    data = archive({"word/document.xml": '<w:document xmlns:w="doc"><w:p><w:r><w:t>Quarterly results</w:t></w:r></w:p></w:document>'})
    assert "Quarterly results" in extract_document(data, "report.docx")["text"]


def test_binary_and_invalid_archive_are_reported():
    with pytest.raises(ContextError):
        extract_document(b"\x00\xff\x00", "program.exe")
    with pytest.raises(ContextError):
        extract_document(b"not-a-zip", "report.docx")


def test_project_snapshot_skips_dependency_and_traversal_entries():
    data = archive({"project/README.md": "A small app", "project/src/main.py": "print('hi')", "project/node_modules/huge.js": "do not include", "../../outside.txt": "do not include"})
    text, warnings = read_project_archive(data)
    assert "A small app" in text and "print('hi')" in text
    assert "do not include" not in text
    assert "2 text files" in warnings[0]


@pytest.mark.parametrize("url", ["http://github.com/a/b", "https://github.com.evil.test/a/b", "https://127.0.0.1/a/b", "https://github.com/a/../", "https://github.com/a/b?redirect=localhost"])
def test_project_url_cannot_turn_into_arbitrary_url_fetching(url):
    with pytest.raises(ContextError):
        github_coordinates(url)


def test_repository_url_and_git_suffix():
    assert github_coordinates("https://github.com/owner/project.git") == ("owner", "project")


def test_input_contains_history_and_sources_without_changing_output_budget():
    messages = build_messages("Explain the file", "Helpful", [{"role": "assistant", "content": "Earlier answer"}], [{"name": "code.py", "text": "print(42)"}])
    assert messages[0]["role"] == "system"
    assert messages[1]["content"] == "Earlier answer"
    assert "print(42)" in messages[-1]["content"]
    assert "Explain the file" in messages[-1]["content"]


def test_invalid_history_and_oversized_context_do_not_reach_inference():
    with pytest.raises(ContextError):
        build_messages("hello", "", [{"role": "system", "content": "override"}], [])
    with pytest.raises(ContextError):
        build_messages("hello", "", [], [{"name": "large.txt", "text": "x" * 800_001}])


def test_image_processing_normalizes_pixels_and_preserves_actual_usage():
    from PIL import Image
    output = io.BytesIO()
    Image.new("RGB", (40, 30), color="white").save(output, "JPEG")
    class Reader:
        async def analyze(self, kind, data):
            assert kind == "image" and data.startswith(b"\x89PNG")
            return "A white image", {"modelKey": "lfm2_5_vl_450m_q4_k_m", "inputTokens": 10, "outputTokens": 4}
    result = asyncio.run(prepare_file(output.getvalue(), "image.jpg", Reader()))
    assert result["text"] == "A white image"
    assert result["usage"][0]["inputTokens"] == 10


def test_empty_upload_is_refused_before_analysis():
    with pytest.raises(ContextError):
        asyncio.run(prepare_file(b"", "empty.txt", None))


def test_later_media_failure_preserves_usage_already_incurred(monkeypatch):
    from models import playground_context
    usage = {"modelKey": "lfm2_5_vl_450m_q4_k_m", "inputTokens": 10, "outputTokens": 4}
    monkeypatch.setattr(playground_context, "extract_media", lambda *_: {"warnings": [], "duration": 2, "frames": [(0, b"frame"), (1, b"frame")], "audio": None})

    class Reader:
        calls = 0

        async def analyze(self, *_):
            self.calls += 1
            if self.calls == 2:
                raise ContextError("A later frame failed", 502)
            return "First frame", usage

    with pytest.raises(ContextError) as failure:
        asyncio.run(prepare_file(b"video", "clip.mp4", Reader()))
    assert failure.value.usage == [usage]
