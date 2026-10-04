from pathlib import Path

import pytest

from tools import repository_workspace
from tools.repository import RepositorySafetyError


def test_prepare_reuses_checkout_and_context_is_redacted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    def fake_clone(url: str, destination_root: Path) -> tuple[Path, str]:
        nonlocal calls
        calls += 1
        checkout = destination_root / "cloned"
        checkout.mkdir()
        (checkout / "main.py").write_text(
            'API_KEY = "supersecretvalue"\nprint("needle")\n', encoding="utf-8"
        )
        (checkout / "README.md").write_text("A small repository\n", encoding="utf-8")
        (checkout / "large.txt").write_text("large\n" * 4_000, encoding="utf-8")
        return checkout, "a" * 40

    monkeypatch.setattr(repository_workspace, "clone_repository", fake_clone)
    prepared = repository_workspace.prepare_repository(
        "https://github.com/example/project", root=tmp_path
    )
    repository_id = prepared["repository_id"]

    reused = repository_workspace.prepare_repository(
        "https://github.com/example/project.git", root=tmp_path
    )
    assert calls == 1
    assert reused["repository_id"] == repository_id
    assert all("sha256" in item for item in prepared["manifest"]["files"])

    context = repository_workspace.repository_context(repository_id, root=tmp_path)
    assert {item["path"] for item in context["file_tree"]} == {
        "README.md",
        "large.txt",
        "main.py",
    }
    assert "main.py" in context["inline_source"]
    assert "supersecretvalue" not in context["inline_source"]["main.py"]
    assert "[REDACTED]" in context["inline_source"]["main.py"]
    assert "large.txt" not in context["inline_source"]
    assert all("supersecretvalue" not in str(finding) for finding in context["findings"])

    listed = repository_workspace.list_repository_files(
        repository_id, path_prefix="main", root=tmp_path
    )
    assert [item["path"] for item in listed["files"]] == ["main.py"]
    read = repository_workspace.read_repository_file(
        repository_id, "main.py", start_line=2, end_line=2, root=tmp_path
    )
    assert read["content"] == 'print("needle")'
    search = repository_workspace.search_repository(repository_id, "NEEDLE", root=tmp_path)
    assert search["results"] == [{"path": "main.py", "line": 2, "text": 'print("needle")'}]


@pytest.mark.parametrize(
    "value",
    ["../outside.py", "/etc/passwd", "src/../../outside.py", "src\\main.py"],
)
def test_repository_paths_reject_traversal(value: str) -> None:
    with pytest.raises(RepositorySafetyError):
        repository_workspace.validate_repository_path(value)


def test_repository_id_and_manifest_path_are_checked(tmp_path: Path) -> None:
    with pytest.raises(RepositorySafetyError):
        repository_workspace.validate_repository_id("repo-../outside")
    with pytest.raises(RepositorySafetyError):
        repository_workspace.list_repository_files("repo-" + "a" * 64, root=tmp_path)
