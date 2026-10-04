from types import SimpleNamespace

from app.services import spectre


def test_collect_scanner_results_can_disable_external_scanners(monkeypatch, tmp_path):
    monkeypatch.setattr(spectre, "static_security_findings", lambda *args, **kwargs: [])

    def unexpected_scanner(*args, **kwargs):
        raise AssertionError("external scanner should not run")

    monkeypatch.setattr(spectre, "_run_scanner", unexpected_scanner)

    findings, results = spectre.collect_scanner_results(
        tmp_path, tier="T1", run_static_scanners=False
    )

    assert findings == []
    assert results == []


def test_run_scanner_rejects_invalid_json(monkeypatch, tmp_path):
    monkeypatch.setattr(spectre.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        spectre.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=b"not json", stderr=b""),
    )

    result = spectre._run_scanner("semgrep", tmp_path, timeout_seconds=1)

    assert result.status == "invalid_output"
    assert result.findings == []


def test_run_scanner_keeps_semgrep_state_in_tmp(monkeypatch, tmp_path):
    captured = {}
    monkeypatch.setattr(spectre.shutil, "which", lambda name: f"/usr/bin/{name}")

    def run(*args, **kwargs):
        captured["command"] = args[0]
        captured["env"] = kwargs["env"]
        return SimpleNamespace(returncode=0, stdout=b'{"results": []}', stderr=b"")

    monkeypatch.setattr(spectre.subprocess, "run", run)

    result = spectre._run_scanner("semgrep", tmp_path, timeout_seconds=1)

    assert result.status == "completed"
    assert captured["command"][3] == "p/default"
    assert captured["env"]["SEMGREP_LOG_FILE"] == "/tmp/semgrep.log"
    assert captured["env"]["SEMGREP_SETTINGS_FILE"] == "/tmp/semgrep-settings.yml"


def test_run_scanner_rejects_truncated_output(monkeypatch, tmp_path):
    monkeypatch.setattr(spectre.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        spectre.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout=b"{" + b"x" * spectre.MAX_SCANNER_OUTPUT,
            stderr=b"",
        ),
    )

    result = spectre._run_scanner("semgrep", tmp_path, timeout_seconds=1)

    assert result.status == "output_truncated"
    assert result.findings == []


def test_run_scanner_accepts_clean_gitleaks_output(monkeypatch, tmp_path):
    monkeypatch.setattr(spectre.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        spectre.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=b"", stderr=b"no leaks found"),
    )

    result = spectre._run_scanner("gitleaks", tmp_path, timeout_seconds=1)

    assert result.status == "completed"
    assert result.findings == []


def test_run_scanner_does_not_confuse_source_text_with_truncation_marker(monkeypatch, tmp_path):
    monkeypatch.setattr(spectre.shutil, "which", lambda name: f"/usr/bin/{name}")
    payload = (
        b'{"errors": [], "results": [{"test_id": "B101", '
        b'"issue_severity": "LOW", "issue_text": "test", '
        b'"filename": "x.py", "line_number": 1, '
        b'"code": "[output truncated]"}]}'
    )
    monkeypatch.setattr(
        spectre.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout=payload, stderr=b""),
    )

    result = spectre._run_scanner("bandit", tmp_path, timeout_seconds=1)

    assert result.status == "completed"
    assert len(result.findings) == 1


def test_run_scanner_accepts_osv_no_package_sources(monkeypatch, tmp_path):
    monkeypatch.setattr(spectre.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        spectre.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout=b'{"results": null}',
            stderr=b"No package sources found",
        ),
    )

    result = spectre._run_scanner("osv_scanner", tmp_path, timeout_seconds=1)

    assert result.status == "completed"
    assert result.findings == []
