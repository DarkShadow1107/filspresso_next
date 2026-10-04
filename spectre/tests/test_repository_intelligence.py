from pathlib import Path

from app.services.repository_intelligence import (
    build_dependency_profile,
    build_security_queries,
    correlate_web_evidence,
    parse_dependency_file,
)


def test_dependency_parsing_is_bounded_and_does_not_execute_metadata() -> None:
    dependencies = parse_dependency_file(
        "pyproject.toml",
        """
[project]
dependencies = ["requests>=2.31", "cryptography==42.0"]

[tool.poetry.dependencies]
python = ">=3.11"
urllib3 = "^2.2"
""",
    )

    assert {item["name"] for item in dependencies} == {"requests", "cryptography", "urllib3"}
    assert all("python" != item["name"] for item in dependencies)


def test_dependency_profile_reads_only_manifest_dependency_files(tmp_path: Path) -> None:
    dependency_file = tmp_path / "requirements.txt"
    dependency_file.write_text("flask==3.0.0\n# ignored\n", encoding="utf-8")
    profile = build_dependency_profile(
        tmp_path,
        {
            "languages": {".py": 1},
            "dependency_files": ["requirements.txt", "missing.txt"],
        },
    )

    assert profile["dependency_files"] == ["requirements.txt"]
    assert profile["dependencies"] == [
        {"name": "flask", "version": "==3.0.0", "source": "requirements.txt"}
    ]


def test_security_queries_include_repository_dependencies_and_threads() -> None:
    queries = build_security_queries(
        repository_url="https://github.com/example/widget.git",
        repository_name="widget",
        question="check parser exposure",
        dependencies=[{"name": "flask", "version": "==3.0.0", "source": "requirements.txt"}],
    )

    assert queries[0] == '"example/widget" security advisory CVE vulnerability'
    assert any("issue discussion" in query for query in queries)
    assert any('"flask" ==3.0.0 security advisory CVE' == query for query in queries)


def test_web_evidence_correlation_requires_security_signal() -> None:
    match = correlate_web_evidence(
        text="Flask 3.0.0 is affected by CVE-2024-12345. The patch fixes the vulnerability.",
        title="Flask security advisory",
        url="https://osv.dev/vulnerability/CVE-2024-12345",
        dependencies=[{"name": "flask", "version": "==3.0.0", "source": "requirements.txt"}],
        repository_name="widget",
    )
    assert match is not None
    assert match["identifiers"] == ["CVE-2024-12345"]
    assert match["matched_dependencies"] == ["flask"]
    assert match["source_tier"] == "security_advisory"

    assert (
        correlate_web_evidence(
            text="A general programming article with no security claim.",
            title="Programming article",
            url="https://example.com/article",
            dependencies=[],
            repository_name="widget",
        )
        is None
    )
