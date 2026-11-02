-- Apply explicitly as the coffee_facts owner or another role authorized to
-- reference it. Grant only the required index privileges to the AI service
-- role separately; this migration never alters the existing facts or vectors.
BEGIN;
CREATE TABLE IF NOT EXISTS coffee_fact_embeddings (
    fact_id INTEGER NOT NULL REFERENCES coffee_facts(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    fact_text TEXT NOT NULL,
    embedding vector(384) NOT NULL,
    PRIMARY KEY (fact_id, model_id)
);
COMMIT;
