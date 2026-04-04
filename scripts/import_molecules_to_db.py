"""
Import molecules from public/data/chembl-molecules.json into PostgreSQL.
Stores only: chembl_id, name, smiles, synonyms.

Usage:
  python scripts/import_molecules_to_db.py
"""

import json
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
if not ENV_PATH.exists():
    ENV_PATH = ROOT / ".env.local"
load_dotenv(dotenv_path=ENV_PATH)

DATA_PATH = ROOT / "public" / "data" / "chembl-molecules.json"

DB_CONFIG = {
    "dbname": os.getenv("DB_NAME", "filspresso"),
    "user": os.getenv("DB_USER", "filspresso_user"),
    "password": os.getenv("DB_PASSWORD"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5432"),
}


def normalize_synonyms(value):
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    return []


def ensure_schema(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS molecules (
                id SERIAL PRIMARY KEY,
                chembl_id VARCHAR(64) UNIQUE,
                name VARCHAR(255),
                smiles TEXT NOT NULL,
                synonyms JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS chembl_id VARCHAR(64)")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS name VARCHAR(255)")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS smiles TEXT")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS synonyms JSONB DEFAULT '[]'::jsonb")
        cur.execute("ALTER TABLE molecules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_molecules_chembl_id ON molecules(chembl_id);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_molecules_name ON molecules(name);")


def main():
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {DATA_PATH}")

    with DATA_PATH.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    molecules = payload.get("molecules", []) if isinstance(payload, dict) else payload
    if not isinstance(molecules, list):
        raise ValueError("Invalid dataset format: expected list or { molecules: [] }")

    conn = psycopg2.connect(**DB_CONFIG)
    try:
        ensure_schema(conn)
        inserted = 0
        updated = 0

        with conn.cursor() as cur:
            for mol in molecules:
                chembl_id = (mol.get("chembl_id") or "").strip() or None
                name = (mol.get("name") or "").strip() or None
                smiles = (mol.get("smiles") or "").strip()
                synonyms = normalize_synonyms(mol.get("synonyms"))

                if not smiles:
                    continue

                cur.execute(
                    """
                    INSERT INTO molecules (chembl_id, name, smiles, synonyms)
                    VALUES (%s, %s, %s, %s::jsonb)
                    ON CONFLICT (chembl_id) DO UPDATE
                    SET name = EXCLUDED.name,
                        smiles = EXCLUDED.smiles,
                        synonyms = EXCLUDED.synonyms
                    """,
                    (chembl_id, name, smiles, json.dumps(synonyms)),
                )
                if cur.rowcount == 1:
                    inserted += 1
                else:
                    updated += 1

        conn.commit()
        print(f"Imported molecules complete. inserted_or_updated={inserted + updated}, inserted={inserted}, updated={updated}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
