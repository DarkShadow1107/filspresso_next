"""Hybrid knowledge DB: global CVE cache + device-scoped memory.

Single SQLite file in Docker volume, no extra deps (stdlib sqlite3 + FTS5).
- scope='global' : public CVE / web knowledge, shared across devices
- scope='device:<id>' : private chats, notes, thoughts, searches
"""
from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("KNOWLEDGE_ROOT", "/srv/tools/knowledge"))
DB_PATH = ROOT / "knowledge.db"
_LOCK = threading.RLock()
_CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)


def _connect() -> sqlite3.Connection:
    ROOT.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> None:
    with _LOCK, _connect() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS documents(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope TEXT NOT NULL,
            device_id TEXT NOT NULL DEFAULT '',
            chat_id TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL,
            hash TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'web',
            created_at INTEGER NOT NULL,
            UNIQUE(scope, hash)
            )"""
        )
        conn.execute(
            """CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
            USING fts5(title, text, content='documents', content_rowid='id')"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS cve_index(
            cve_id TEXT PRIMARY KEY,
            pkg TEXT NOT NULL DEFAULT '',
            severity TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL
            )"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_scope ON documents(scope)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_device ON documents(device_id)")
        conn.commit()


def _doc_hash(text: str, url: str) -> str:
    return hashlib.sha256(f"{url}\n{text}".encode("utf-8")).hexdigest()


def upsert_document(
    *,
    scope: str,
    text: str,
    title: str = "",
    url: str = "",
    device_id: str = "",
    chat_id: str = "",
    source: str = "web",
) -> dict[str, Any]:
    text = (text or "").strip()[:20000]
    if len(text) < 40:
        return {"saved": False, "reason": "too short"}
    init_db()
    h = _doc_hash(text, url or title)
    now = int(time.time())
    with _LOCK, _connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO documents(scope,device_id,chat_id,url,title,text,hash,source,created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (scope, device_id, chat_id, url, title[:500], text, h, source, now),
            )
            doc_id = cur.lastrowid
            conn.execute(
                "INSERT INTO documents_fts(rowid,title,text) VALUES(?,?,?)",
                (doc_id, title[:500], text),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            row = conn.execute(
                "SELECT id FROM documents WHERE scope=? AND hash=?", (scope, h)
            ).fetchone()
            doc_id = row[0] if row else 0
    cves = sorted({c.upper() for c in _CVE_RE.findall(text)})[:20]
    for cve in cves:
        upsert_cve(cve, "", "", text[:600], url)
    return {"saved": True, "id": doc_id, "hash": h, "cves": cves}


def search(
    *, query: str, scope_filter: str | None = None, device_id: str = "", limit: int = 6
) -> list[dict[str, Any]]:
    init_db()
    query = (query or "").strip()[:300]
    if not query:
        return []
    # FTS query: quote + prefix match on keywords
    tokens = [re.sub(r"[^\w\-.:]+", "", t) for t in query.split() if len(t) > 2][:8]
    if not tokens:
        return []
    fts_q = " OR ".join(f'"{t}"*' for t in tokens)
    with _LOCK, _connect() as conn:
        try:
            rows = conn.execute(
                """SELECT d.id,d.scope,d.device_id,d.title,d.url,substr(d.text,1,1200),d.source,d.created_at,
                rank FROM documents_fts f JOIN documents d ON d.id=f.rowid
                WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?""",
                (fts_q, limit * 3),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
    out: list[dict[str, Any]] = []
    for r in rows:
        _id, scope, dev, title, url, snippet, source, created, _rank = r
        # Hybrid rule: global always visible; device rows only to owner device
        if scope != "global" and device_id and dev and dev != device_id:
            continue
        if scope_filter and scope != scope_filter and scope != "global":
            continue
        out.append(
            {
                "id": _id,
                "scope": scope,
                "title": title,
                "url": url,
                "snippet": snippet,
                "source": source,
                "created_at": created,
            }
        )
        if len(out) >= limit:
            break
    return out


def upsert_cve(
    cve_id: str, pkg: str, severity: str, summary: str, url: str = ""
) -> None:
    init_db()
    cve_id = cve_id.upper().strip()
    if not cve_id.startswith("CVE-"):
        return
    now = int(time.time())
    with _LOCK, _connect() as conn:
        conn.execute(
            """INSERT INTO cve_index(cve_id,pkg,severity,summary,url,updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(cve_id) DO UPDATE SET
            pkg=excluded.pkg, severity=excluded.severity,
            summary=excluded.summary, url=excluded.url, updated_at=excluded.updated_at""",
            (cve_id, pkg[:200], severity[:40], summary[:2000], url[:500], now),
        )
        conn.commit()


def lookup_cves(pkg_or_query: str, limit: int = 10) -> list[dict[str, Any]]:
    init_db()
    q = f"%{pkg_or_query.strip()[:100]}%"
    with _LOCK, _connect() as conn:
        rows = conn.execute(
            "SELECT cve_id,pkg,severity,summary,url FROM cve_index"
            " WHERE cve_id LIKE ? OR pkg LIKE ? OR summary LIKE ? LIMIT ?",
            (q, q, q, limit),
        ).fetchall()
    return [
        {"cve_id": r[0], "pkg": r[1], "severity": r[2], "summary": r[3], "url": r[4]}
        for r in rows
    ]


def delete_device_knowledge(device_id: str, chat_id: str = "") -> dict[str, Any]:
    """Delete user/device-collected knowledge. Global CVE cache is never touched."""
    init_db()
    device_id = (device_id or "").strip()[:120]
    if not device_id:
        return {"deleted": 0, "reason": "device_id required"}
    with _LOCK, _connect() as conn:
        if chat_id:
            rows = conn.execute(
                "SELECT id FROM documents WHERE scope='device' AND device_id=? AND chat_id=?",
                (device_id, chat_id[:200]),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id FROM documents WHERE scope='device' AND device_id=?",
                (device_id,),
            ).fetchall()
        ids = [r[0] for r in rows]
        for doc_id in ids:
            conn.execute("DELETE FROM documents_fts WHERE rowid=?", (doc_id,))
            conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
        conn.commit()
    return {"deleted": len(ids)}


def stats() -> dict[str, Any]:
    init_db()
    with _LOCK, _connect() as conn:
        docs = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        glb = conn.execute("SELECT COUNT(*) FROM documents WHERE scope='global'").fetchone()[0]
        cves = conn.execute("SELECT COUNT(*) FROM cve_index").fetchone()[0]
    return {"documents": docs, "global": glb, "device": docs - glb, "cves": cves}
