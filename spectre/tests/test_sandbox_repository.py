import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import sandbox
from app.schemas import RepositoryCheckoutExecutionRequest, RepositoryExecutionRequest
from tools.repository_workspace import (
    build_bounded_manifest,
    repository_id_for_url,
)


def _write_workspace(root: Path, *, include_tests: bool = False) -> str:
    url = "https://github.com/example/profile-repository"
    repository_id = repository_id_for_url(url)
    checkout = root / repository_id / "checkout"
    checkout.mkdir(parents=True)
    (checkout / "main.py").write_text("print('ok')\n", encoding="utf-8")
    if include_tests:
        test_directory = checkout / "tests"
        test_directory.mkdir()
        (test_directory / "test_sample.py").write_text(
            "import unittest\n\n\nclass SampleTest(unittest.TestCase):\n"
            "    def test_ok(self):\n        self.assertTrue(True)\n",
            encoding="utf-8",
        )
    manifest = build_bounded_manifest(checkout)
    metadata = {
        "repository_id": repository_id,
        "url": url + ".git",
        "commit_sha": "b" * 40,
        "checkout_path": "checkout",
        "manifest_path": "manifest.json",
        "manifest": manifest,
        "findings": [],
    }
    workspace = root / repository_id
    (workspace / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (workspace / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return repository_id


def test_sandbox_profiles_require_manifest_listed_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository_id = _write_workspace(tmp_path)
    monkeypatch.setattr(sandbox, "REPOSITORY_ROOT", tmp_path)

    valid = RepositoryExecutionRequest(
        repository_id=repository_id, profile="python_script", path="main.py"
    )
    descriptor = sandbox.validate_repository_execution(valid)
    assert descriptor["valid"] is True
    assert descriptor["path"] == "main.py"

    for path in ("missing.py", "../main.py", "main.py/child"):
        request = RepositoryExecutionRequest(
            repository_id=repository_id, profile="python_script", path=path
        )
        with pytest.raises(HTTPException):
            sandbox.validate_repository_execution(request)


def test_compile_profile_does_not_execute_repository_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository_id = _write_workspace(tmp_path)
    monkeypatch.setattr(sandbox, "REPOSITORY_ROOT", tmp_path)
    result = sandbox.execute_repository(
        RepositoryExecutionRequest(repository_id=repository_id, profile="compile_python")
    )
    assert result.exit_code == 0
    assert result.output_json is not None
    assert result.output_json["checked"] == 1


def test_python_tests_profile_uses_fixed_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository_id = _write_workspace(tmp_path, include_tests=True)
    monkeypatch.setattr(sandbox, "REPOSITORY_ROOT", tmp_path)
    result = sandbox.execute_repository(
        RepositoryExecutionRequest(repository_id=repository_id, profile="python_tests")
    )
    assert result.exit_code == 0


def test_sandbox_rejects_unknown_profile_and_repository_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository_id = _write_workspace(tmp_path)
    monkeypatch.setattr(sandbox, "REPOSITORY_ROOT", tmp_path)
    with pytest.raises(ValidationError):
        RepositoryExecutionRequest(
            repository_id=repository_id, profile="not-a-profile"  # type: ignore[arg-type]
        )
    with pytest.raises(HTTPException):
        sandbox.validate_repository_execution(
            RepositoryExecutionRequest(
                repository_id="repo-" + "c" * 64,
                profile="python_script",
                path="main.py",
            )
        )


def test_codesentry_checkout_profiles_are_bounded_and_fixed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    checkout = tmp_path / "audit-checkout"
    tests = checkout / "tests"
    tests.mkdir(parents=True)
    (checkout / "main.py").write_text(
        "from pathlib import Path\nPath('should-not-exist').write_text('x')\n",
        encoding="utf-8",
    )
    (tests / "test_sample.py").write_text(
        "import unittest\n\n\nclass SampleTest(unittest.TestCase):\n"
        "    def test_ok(self):\n        self.assertTrue(True)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(sandbox, "CHECKOUT_ROOT", tmp_path)

    compiled = sandbox.execute_codesentry_checkout(
        RepositoryCheckoutExecutionRequest(checkout_name=checkout.name, profile="compile_python")
    )
    assert compiled.exit_code == 0
    assert compiled.output_json == {"checked": 2, "errors": []}
    assert not (checkout / "should-not-exist").exists()

    tested = sandbox.execute_codesentry_checkout(
        RepositoryCheckoutExecutionRequest(checkout_name=checkout.name, profile="python_tests")
    )
    assert tested.exit_code == 0
