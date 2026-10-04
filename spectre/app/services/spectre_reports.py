from __future__ import annotations

import hashlib
import io
import json
import textwrap
import uuid
from datetime import datetime
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SpectreFinding, SpectreReport, SpectreScanRun, Repository
from app.services.artifacts import MinioArtifactStore
from app.services.spectre import redact_text


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _finding_record(finding: SpectreFinding) -> dict[str, Any]:
    payload = finding.raw_payload if isinstance(finding.raw_payload, dict) else {}
    return {
        "id": str(finding.id),
        "source": finding.source,
        "rule_id": finding.rule_id,
        "cwe": finding.cwe,
        "severity": finding.severity,
        "title": finding.title,
        "description": finding.description,
        "evidence": redact_text(finding.evidence),
        "path": payload.get("path", "[unknown]"),
        "line_start": finding.line_start,
        "line_end": finding.line_end,
        "status": finding.status,
        "llm_verdict": finding.llm_verdict,
        "confidence": finding.confidence,
        "fingerprint": finding.fingerprint,
        "created_at": _iso(finding.created_at),
    }


def build_json_report(
    scan: SpectreScanRun, repository: Repository, findings: list[SpectreFinding]
) -> bytes:
    body = {
        "schema_version": "1.0",
        "product": "Spectre",
        "scan": {
            "id": str(scan.id),
            "repository_id": str(repository.id),
            "repository": repository.name,
            "commit_sha": repository.commit_sha,
            "status": scan.status,
            "created_at": _iso(scan.created_at),
            "completed_at": _iso(scan.completed_at),
        },
        "summary": scan.summary,
        "findings": [_finding_record(finding) for finding in findings],
    }
    return json.dumps(body, indent=2, sort_keys=True).encode("utf-8")


def build_sarif_report(
    scan: SpectreScanRun, repository: Repository, findings: list[SpectreFinding]
) -> bytes:
    rules: dict[str, dict[str, Any]] = {}
    results: list[dict[str, Any]] = []
    for finding in findings:
        record = _finding_record(finding)
        rule_id = str(record["rule_id"])
        rules.setdefault(
            rule_id,
            {
                "id": rule_id,
                "name": rule_id,
                "shortDescription": {"text": str(record["title"])[:500]},
                "fullDescription": {"text": str(record["description"])[:4_000]},
                "properties": {"cwe": record["cwe"]},
            },
        )
        level = {"critical": "error", "high": "error", "medium": "warning"}.get(
            str(record["severity"]), "note"
        )
        result: dict[str, Any] = {
            "ruleId": rule_id,
            "level": level,
            "message": {"text": str(record["description"])[:4_000]},
            "fingerprints": {"codesentry/v1": str(record["fingerprint"])},
            "properties": {
                "severity": record["severity"],
                "status": record["status"],
                "llm_verdict": record["llm_verdict"],
                "confidence": record["confidence"],
                "cwe": record["cwe"],
            },
        }
        path = str(record["path"])
        if path != "[unknown]":
            result["locations"] = [
                {
                    "physicalLocation": {
                        "artifactLocation": {"uri": path},
                        "region": {
                            "startLine": int(record["line_start"] or 1),
                            "endLine": int(record["line_end"] or record["line_start"] or 1),
                        },
                    }
                }
            ]
        results.append(result)
    body = {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Spectre",
                        "version": "0.1.0",
                        "informationUri": "https://127.0.0.1:8080",
                        "rules": list(rules.values()),
                    }
                },
                "automationDetails": {
                    "id": str(scan.id),
                    "properties": {
                        "repository": repository.name,
                        "commit_sha": repository.commit_sha,
                    },
                },
                "results": results,
            }
        ],
    }
    return json.dumps(body, indent=2, sort_keys=True).encode("utf-8")


def build_markdown_report(
    scan: SpectreScanRun, repository: Repository, findings: list[SpectreFinding]
) -> bytes:
    lines = [
        f"# Spectre Security Report: {repository.name}",
        "",
        f"- Scan: `{scan.id}`",
        f"- Commit: `{repository.commit_sha or 'unknown'}`",
        f"- Status: **{scan.status}**",
        f"- Findings: **{len(findings)}**",
        "",
        "## Summary",
        "",
        "```json",
        json.dumps(scan.summary, indent=2, sort_keys=True),
        "```",
    ]
    for index, finding in enumerate(findings, start=1):
        record = _finding_record(finding)
        lines.extend(
            [
                "",
                f"## {index}. {record['title']}",
                "",
                f"- Severity: **{record['severity']}**",
                f"- Status: `{record['status']}`",
                f"- Rule: `{record['rule_id']}`",
                f"- CWE: `{record['cwe'] or 'unknown'}`",
                f"- Location: `{record['path']}:{record['line_start']}`",
                f"- LLM verdict: `{record['llm_verdict'] or 'unknown'}`",
                "",
                record["description"],
                "",
                "```text",
                record["evidence"],
                "```",
            ]
        )
    return "\n".join(lines).encode("utf-8")


def build_pdf_report(
    scan: SpectreScanRun, repository: Repository, findings: list[SpectreFinding]
) -> bytes:
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=A4)
    _, height = A4
    cursor = height - 52

    def block(title: str, body: str) -> None:
        nonlocal cursor
        if cursor < 72:
            canvas.showPage()
            cursor = height - 52
        canvas.setFont("Helvetica-Bold", 13)
        canvas.drawString(44, cursor, title[:110])
        cursor -= 19
        canvas.setFont("Helvetica", 9)
        for line in textwrap.wrap(body, width=108) or [""]:
            if cursor < 52:
                canvas.showPage()
                cursor = height - 52
                canvas.setFont("Helvetica", 9)
            canvas.drawString(44, cursor, line[:150])
            cursor -= 12
        cursor -= 9

    block(
        "Spectre Security Report",
        f"Repository: {repository.name} | Scan: {scan.id} | "
        f"Commit: {repository.commit_sha or 'unknown'} | Status: {scan.status}",
    )
    block("Summary", json.dumps(scan.summary, sort_keys=True))
    for index, finding in enumerate(findings, start=1):
        record = _finding_record(finding)
        block(
            f"{index}. {record['title']}",
            f"Severity: {record['severity']} | CWE: {record['cwe'] or 'unknown'} | "
            f"Location: {record['path']}:{record['line_start']} | Status: {record['status']}",
        )
        block("Description", str(record["description"]))
        block("Evidence", str(record["evidence"]))
    canvas.save()
    return buffer.getvalue()


REPORT_BUILDERS = {
    "json": (build_json_report, "application/json", "json"),
    "sarif": (build_sarif_report, "application/sarif+json", "sarif"),
    "markdown": (build_markdown_report, "text/markdown", "md"),
    "pdf": (build_pdf_report, "application/pdf", "pdf"),
}


async def create_scan_reports(
    db: AsyncSession,
    *,
    scan: SpectreScanRun,
    repository: Repository,
    findings: list[SpectreFinding],
) -> list[SpectreReport]:
    reports: list[SpectreReport] = []
    for report_format, (builder, content_type, extension) in REPORT_BUILDERS.items():
        data = builder(scan, repository, findings)
        report_id = uuid.uuid4()
        key = (
            f"codesentry/{scan.organization_id}/scans/{scan.id}/reports/"
            f"{report_format}-{report_id}.{extension}"
        )
        await MinioArtifactStore().put(key, data, content_type)
        report = SpectreReport(
            id=report_id,
            organization_id=scan.organization_id,
            scan_run_id=scan.id,
            format=report_format,
            status="ready",
            schema_version="1.0",
            content_type=content_type,
            storage_key=key,
            byte_size=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            finding_count=len(findings),
            metadata_json={
                "product": "Spectre",
                "repository": repository.name,
                "commit_sha": repository.commit_sha,
            },
        )
        db.add(report)
        reports.append(report)
    await db.flush()
    return reports


async def get_scan_report_bytes(report: SpectreReport) -> bytes:
    return await MinioArtifactStore().get(report.storage_key)
