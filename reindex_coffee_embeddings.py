"""Build a versioned MiniLM index without changing or deleting coffee facts.

Run explicitly inside the configured AI environment after confirming the MiniLM
GGUF and pooling match MINILM_INDEX_ID. The entire update commits atomically.
"""
import argparse
import sys

from app import get_db_connection, tanka
from models.tanka import MINILM_INDEX_ID


def reindex():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS coffee_fact_embeddings (
                    fact_id INTEGER NOT NULL REFERENCES coffee_facts(id) ON DELETE CASCADE,
                    model_id TEXT NOT NULL, fact_text TEXT NOT NULL,
                    embedding vector(384) NOT NULL, PRIMARY KEY (fact_id, model_id)
                )
            """)
            cur.execute("SELECT id, fact FROM coffee_facts ORDER BY id")
            facts = cur.fetchall()
            for fact_id, fact in facts:
                vector = tanka.encode(fact)
                if vector is None:
                    raise RuntimeError("MiniLM embedding unavailable; transaction rolled back")
                encoded = "[" + ",".join(str(value) for value in vector) + "]"
                # Do not index text that was changed concurrently after it was read.
                cur.execute("""
                    INSERT INTO coffee_fact_embeddings (fact_id, model_id, fact_text, embedding)
                    SELECT id, %s, fact, %s::vector FROM coffee_facts WHERE id = %s AND fact = %s
                    ON CONFLICT (fact_id, model_id) DO UPDATE
                    SET fact_text = EXCLUDED.fact_text, embedding = EXCLUDED.embedding
                """, (MINILM_INDEX_ID, encoded, fact_id, fact))
                if cur.rowcount != 1:
                    raise RuntimeError("A fact changed during indexing; transaction rolled back")
    return len(facts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="commit the separate embedding index")
    args = parser.parse_args()
    if not args.apply:
        parser.error("pass --apply to create/update the versioned index")
    try:
        print(f"Indexed {reindex()} facts for {MINILM_INDEX_ID}; original facts were not changed.")
    except Exception as exc:
        print(f"Indexing failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
