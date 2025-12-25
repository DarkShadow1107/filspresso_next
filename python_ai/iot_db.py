"""
PostgreSQL IoT DB Helper - Persistent storage for coffee machine commands
"""

import logging
import os
import json
import psycopg2
from typing import Dict, Optional
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

logger = logging.getLogger(__name__)

# Configuration
DB_NAME = os.getenv("DB_NAME", "filspresso")
DB_USER = os.getenv("DB_USER", "filspresso_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "filspresso_secure_2024")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")

def get_db_connection():
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT
    )

def init_db():
    """Initialize the database (schema is handled by Docker init)"""
    logger.info("IoT DB initialized (PostgreSQL)")

def create_command(machine_id: str, recipe: Dict, execute_allowed: bool = True, meta: Optional[Dict] = None) -> int:
    """Create a new command for a machine"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute(
            "INSERT INTO iot_commands (machine_id, recipe, execute_allowed, meta, status) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (machine_id, json.dumps(recipe), execute_allowed, json.dumps(meta or {}), "pending")
        )
        
        command_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        return command_id
    except Exception as e:
        logger.error(f"Error creating command: {e}")
        return -1

def get_pending_command(machine_id: str) -> Optional[Dict]:
    """Get the first pending command for a machine"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute(
            "SELECT id, machine_id, recipe, execute_allowed, meta, status FROM iot_commands WHERE machine_id = %s AND status = \"pending\" ORDER BY created_at ASC LIMIT 1",
            (machine_id,)
        )
        
        row = cur.fetchone()
        cur.close()
        conn.close()
        
        if row:
            return {
                "command_id": row[0],
                "machine_id": row[1],
                "recipe": row[2] if isinstance(row[2], dict) else json.loads(row[2]),
                "execute_allowed": row[3],
                "meta": row[4] if isinstance(row[4], dict) else json.loads(row[4]),
                "status": row[5]
            }
        return None
    except Exception as e:
        logger.error(f"Error getting pending command: {e}")
        return None

def update_command_status(command_id: int, status: str, meta: Optional[Dict] = None) -> bool:
    """Update the status of a command"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        if meta:
            cur.execute(
                "UPDATE iot_commands SET status = %s, meta = meta || %s::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (status, json.dumps(meta), command_id)
            )
        else:
            cur.execute(
                "UPDATE iot_commands SET status = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (status, command_id)
            )
        
        conn.commit()
        updated = cur.rowcount > 0
        cur.close()
        conn.close()
        return updated
    except Exception as e:
        logger.error(f"Error updating command status: {e}")
        return False
