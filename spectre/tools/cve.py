"""CVE enrichment: NVD + OSV, cached into knowledge_store.cve_index."""
from __future__ import annotations

import os

import httpx

NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0"
OSV_BASE = "https://api.osv.dev/v1/query"
TIMEOUT = float(os.environ.get("CVE_TIMEOUT", "12"))


async def nvd_search(keyword: str, max_results: int = 5) -> list[dict]:
    keyword = keyword.strip()[:120]
    if not keyword:
        return []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(
                NVD_BASE, params={"keywordSearch": keyword, "resultsPerPage": max_results}
            )
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []
    out = []
    for item in (data.get("vulnerabilities") or [])[:max_results]:
        cve = (item.get("cve") or {})
        cve_id = cve.get("id", "")
        descs = cve.get("descriptions") or []
        summary = next(
            (d.get("value", "") for d in descs if d.get("lang") == "en"),
            "",
        )[:1200]
        metrics = cve.get("metrics") or {}
        sev = ""
        for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
            arr = metrics.get(key) or []
            if arr:
                sev = str((arr[0].get("cvssData") or {}).get("baseSeverity", ""))
                break
        out.append(
            {"cve_id": cve_id, "pkg": keyword, "severity": sev, "summary": summary,
             "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}"}
        )
    return out


async def osv_query(pkg: str, max_results: int = 5) -> list[dict]:
    pkg = pkg.strip()[:120]
    if not pkg:
        return []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post(OSV_BASE, json={"package": {"name": pkg}, "page_size": max_results})
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []
    out = []
    for v in (data.get("vulns") or [])[:max_results]:
        out.append(
            {"cve_id": next(
                (a for a in (v.get("aliases") or []) if str(a).startswith("CVE-")),
                v.get("id", ""),
            ),
             "pkg": pkg,
             "severity": "",
             "summary": str(v.get("summary", "") or v.get("details", ""))[:1200],
             "url": f"https://osv.dev/vulnerability/{v.get('id','')}"}
        )
    return out
