"""
SQLAlchemy-based IoT DB wrapper.

This module provides the same public functions as `iot_db.py` but uses SQLAlchemy
for connection pooling, consistent dialect handling (MariaDB/MySQL and SQLite),
and easier testing. It reads the same environment variables (or an optional
IOT_DATABASE_URL) to determine which DB to use.

Public API:
 - init_db()
 - create_command(machine_id, recipe_json, execute_allowed=True, meta=None) -> int
 - get_pending_command(machine_id) -> Optional[dict]
 - update_command_status(command_id, status, meta=None) -> bool

This is optional: existing `iot_db.py` remains the default. Use this for
connection pooling and simpler migration to production-ready DB tooling.
"""
from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Optional, Dict, Any

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    Boolean,
    JSON,
    TIMESTAMP,
    func,
)
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import SQLAlchemyError

Base = declarative_base()

DEFAULT_DB_PATH = Path(__file__).parent / "iot_commands.db"

# configuration from environment
IOT_DATABASE_URL = os.getenv("IOT_DATABASE_URL")
IOT_DB_HOST = os.getenv("IOT_DB_HOST")
IOT_DB_PORT = os.getenv("IOT_DB_PORT", "3306")
IOT_DB_USER = os.getenv("IOT_DB_USER")
IOT_DB_PASS = os.getenv("IOT_DB_PASS")
IOT_DB_NAME = os.getenv("IOT_DB_NAME")


def _build_database_url() -> str:
    if IOT_DATABASE_URL:
        return IOT_DATABASE_URL
    if IOT_DB_HOST and IOT_DB_USER and IOT_DB_NAME:
        # construct a mysql+pymysql URL
        password = IOT_DB_PASS or ""
        return f"mysql+pymysql://{IOT_DB_USER}:{password}@{IOT_DB_HOST}:{IOT_DB_PORT}/{IOT_DB_NAME}?charset=utf8mb4"
    # fallback to sqlite file
    return f"sqlite:///{DEFAULT_DB_PATH.as_posix()}"


class Command(Base):
    __tablename__ = "commands"

    command_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    machine_id = Column(String(255), nullable=False, index=True)
    # Use JSON where supported; on SQLite SQLAlchemy will store JSON as TEXT
    recipe_json = Column(JSON, nullable=False)
    execute_allowed = Column(Boolean, nullable=False, default=True)
    status = Column(String(32), nullable=False, default="pending")
    meta_json = Column(JSON)
    created_at = Column(TIMESTAMP, server_default=func.current_timestamp())


_ENGINE = None
_SessionLocal = None


def init_db():
    """Create the database engine, tables, and session factory."""
    global _ENGINE, _SessionLocal
    db_url = _build_database_url()
    # create engine with sensible defaults for pooling and reconnects
    _ENGINE = create_engine(db_url, echo=False, pool_pre_ping=True)
    _SessionLocal = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)
    # create tables if missing
    Base.metadata.create_all(_ENGINE)


def _get_session():
    if _SessionLocal is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _SessionLocal()


def create_command(machine_id: str, recipe_json: Dict[str, Any], execute_allowed: bool = True, meta: Optional[Dict[str, Any]] = None) -> int:
    meta = meta or {}
    session = _get_session()
    try:
        cmd = Command(
            machine_id=machine_id,
            recipe_json=recipe_json,
            execute_allowed=bool(execute_allowed),
            status="pending",
            meta_json=meta,
        )
        session.add(cmd)
        session.commit()
        session.refresh(cmd)
        return int(cmd.command_id)
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()


def get_pending_command(machine_id: str) -> Optional[Dict[str, Any]]:
    session = _get_session()
    try:
        cmd = (
            session.query(Command)
            .filter(Command.machine_id == machine_id)
            .filter(Command.status == "pending")
            .order_by(Command.created_at.asc())
            .limit(1)
            .one_or_none()
        )
        if not cmd:
            return None
        return {
            "command_id": int(cmd.command_id),
            "machine_id": cmd.machine_id,
            "recipe": cmd.recipe_json,
            "execute_allowed": bool(cmd.execute_allowed),
            "status": cmd.status,
            "meta": cmd.meta_json or {},
            "created_at": cmd.created_at,
        }
    finally:
        session.close()


def update_command_status(command_id: int, status: str, meta: Optional[Dict[str, Any]] = None) -> bool:
    session = _get_session()
    try:
        cmd = session.get(Command, command_id)
        if not cmd:
            return False
        cmd.status = status
        if meta is not None:
            cmd.meta_json = meta
        session.add(cmd)
        session.commit()
        return True
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()
