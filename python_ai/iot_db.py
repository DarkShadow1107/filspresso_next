"""
IoT command storage helper supporting MariaDB (primary) and SQLite fallback.

Environment variables for MariaDB (optional):
 - IOT_DB_HOST
 - IOT_DB_PORT
 - IOT_DB_USER
 - IOT_DB_PASS
 - IOT_DB_NAME

Public functions:
- init_db()
- create_command(machine_id, recipe_json, execute_allowed=True, meta=None)
- get_pending_command(machine_id)
- update_command_status(command_id, status, meta=None)

If MariaDB connection details are present, the module will use `pymysql` to connect and create the same `commands` table.
Otherwise it falls back to a local SQLite file `iot_commands.db` in the same directory.
"""
import os
import json
from pathlib import Path
from typing import Optional, Dict, Any

DEFAULT_DB = Path(__file__).parent / "iot_commands.db"

# MariaDB env config
IOT_DB_HOST = os.getenv("IOT_DB_HOST")
IOT_DB_PORT = int(os.getenv("IOT_DB_PORT", "3306")) if os.getenv("IOT_DB_HOST") else None
IOT_DB_USER = os.getenv("IOT_DB_USER")
IOT_DB_PASS = os.getenv("IOT_DB_PASS")
IOT_DB_NAME = os.getenv("IOT_DB_NAME")


def _use_mariadb() -> bool:
    return bool(IOT_DB_HOST and IOT_DB_USER and IOT_DB_NAME)


def init_db():
    """Create the commands table in MariaDB if configured, else create SQLite DB."""
    if _use_mariadb():
        try:
            import pymysql
        except Exception as e:
            raise RuntimeError("pymysql is required for MariaDB usage: pip install pymysql") from e

        conn = pymysql.connect(host=IOT_DB_HOST, port=IOT_DB_PORT or 3306, user=IOT_DB_USER, password=IOT_DB_PASS or "", database=IOT_DB_NAME, autocommit=True)
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS commands (
                command_id BIGINT PRIMARY KEY AUTO_INCREMENT,
                machine_id VARCHAR(255) NOT NULL,
                recipe_json JSON NOT NULL,
                execute_allowed TINYINT NOT NULL DEFAULT 1,
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                meta_json JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )
        cur.close()
        conn.close()
    else:
        import sqlite3
        db_file = DEFAULT_DB
        db_file.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_file))
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS commands (
                command_id INTEGER PRIMARY KEY AUTOINCREMENT,
                machine_id TEXT NOT NULL,
                recipe_json TEXT NOT NULL,
                execute_allowed INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'pending',
                meta_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()
        conn.close()


def create_command(machine_id: str, recipe_json: Dict[str, Any], execute_allowed: bool = True, meta: Optional[Dict[str, Any]] = None) -> int:
    """Insert a command and return its id."""
    meta = meta or {}
    if _use_mariadb():
        import pymysql
        conn = pymysql.connect(host=IOT_DB_HOST, port=IOT_DB_PORT or 3306, user=IOT_DB_USER, password=IOT_DB_PASS or "", database=IOT_DB_NAME, autocommit=True)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO commands (machine_id, recipe_json, execute_allowed, status, meta_json) VALUES (%s, %s, %s, %s, %s)",
            (machine_id, json.dumps(recipe_json), 1 if execute_allowed else 0, 'pending', json.dumps(meta))
        )
        command_id = cur.lastrowid
        cur.close()
        conn.close()
        return int(command_id)
    else:
        import sqlite3
        db_file = DEFAULT_DB
        conn = sqlite3.connect(str(db_file))
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO commands (machine_id, recipe_json, execute_allowed, status, meta_json) VALUES (?, ?, ?, ?, ?)",
            (machine_id, json.dumps(recipe_json), 1 if execute_allowed else 0, 'pending', json.dumps(meta))
        )
        command_id = cur.lastrowid
        conn.commit()
        conn.close()
        return int(command_id)


def get_pending_command(machine_id: str) -> Optional[Dict[str, Any]]:
    """Return the oldest pending command for the machine or None."""
    if _use_mariadb():
        import pymysql
        conn = pymysql.connect(host=IOT_DB_HOST, port=IOT_DB_PORT or 3306, user=IOT_DB_USER, password=IOT_DB_PASS or "", database=IOT_DB_NAME)
        cur = conn.cursor()
        cur.execute(
            "SELECT command_id, recipe_json, execute_allowed, status, meta_json, created_at FROM commands WHERE machine_id=%s AND status='pending' ORDER BY created_at ASC LIMIT 1",
            (machine_id,)
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return None
        command_id, recipe_json, execute_allowed, status, meta_json, created_at = row
        return {
            'command_id': int(command_id),
            'machine_id': machine_id,
            'recipe': json.loads(recipe_json) if isinstance(recipe_json, str) else recipe_json,
            'execute_allowed': bool(execute_allowed),
            'status': status,
            'meta': json.loads(meta_json) if meta_json else {},
            'created_at': created_at,
        }
    else:
        import sqlite3
        db_file = DEFAULT_DB
        conn = sqlite3.connect(str(db_file))
        cur = conn.cursor()
        cur.execute(
            "SELECT command_id, recipe_json, execute_allowed, status, meta_json, created_at FROM commands WHERE machine_id=? AND status='pending' ORDER BY created_at ASC LIMIT 1",
            (machine_id,)
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        command_id, recipe_json, execute_allowed, status, meta_json, created_at = row
        return {
            'command_id': command_id,
            'machine_id': machine_id,
            'recipe': json.loads(recipe_json),
            'execute_allowed': bool(execute_allowed),
            'status': status,
            'meta': json.loads(meta_json) if meta_json else {},
            'created_at': created_at,
        }


def update_command_status(command_id: int, status: str, meta: Optional[Dict[str, Any]] = None) -> bool:
    """Update status and optional meta for a command. Returns True if updated."""
    if _use_mariadb():
        import pymysql
        conn = pymysql.connect(host=IOT_DB_HOST, port=IOT_DB_PORT or 3306, user=IOT_DB_USER, password=IOT_DB_PASS or "", database=IOT_DB_NAME, autocommit=True)
        cur = conn.cursor()
        if meta is not None:
            cur.execute("UPDATE commands SET status=%s, meta_json=%s WHERE command_id=%s", (status, json.dumps(meta), command_id))
        else:
            cur.execute("UPDATE commands SET status=%s WHERE command_id=%s", (status, command_id))
        changed = cur.rowcount
        cur.close()
        conn.close()
        return changed > 0
    else:
        import sqlite3
        db_file = DEFAULT_DB
        conn = sqlite3.connect(str(db_file))
        cur = conn.cursor()
        if meta is not None:
            cur.execute(
                "UPDATE commands SET status=?, meta_json=? WHERE command_id=?",
                (status, json.dumps(meta), command_id)
            )
        else:
            cur.execute(
                "UPDATE commands SET status=? WHERE command_id=?",
                (status, command_id)
            )
        changed = cur.rowcount
        conn.commit()
        conn.close()
        return changed > 0
