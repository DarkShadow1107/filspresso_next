/** Metadata and body of a Playground chat document. Markdown body only; the row is account-scoped. */
export const PLAYGROUND_DOCUMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS playground_documents (
  id UUID PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) <= 120),
  content TEXT NOT NULL,
  content_bytes INTEGER NOT NULL CHECK (content_bytes >= 0),
  mime TEXT NOT NULL DEFAULT 'text/markdown',
  body_sha256 CHAR(64) NOT NULL,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_playground_documents_account ON playground_documents(account_id, created_at);
`;
