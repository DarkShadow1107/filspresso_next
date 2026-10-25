/** Metadata/digests only. Neither raw arguments, source files nor tool output are durable. */
export const AGENT_ACTIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS playground_agent_actions (
  action_id UUID PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  model_run_id TEXT NOT NULL,
  execution_run_id TEXT NOT NULL UNIQUE,
  session_uuid UUID,
  scope TEXT NOT NULL CHECK (scope IN ('desktop', 'playground')),
  model_key TEXT NOT NULL,
  sandbox_id UUID NOT NULL,
  tool_call_id VARCHAR(64) NOT NULL,
  tool_name VARCHAR(64) NOT NULL,
  arguments_sha256 CHAR(64) NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('plan', 'build')),
  effect TEXT NOT NULL CHECK (effect IN ('read_only', 'mutation', 'execution')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'declined', 'executing', 'complete', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  UNIQUE (account_id, model_run_id, tool_call_id)
);
CREATE INDEX IF NOT EXISTS idx_playground_agent_actions_retention ON playground_agent_actions(created_at);
CREATE INDEX IF NOT EXISTS idx_playground_agent_actions_account ON playground_agent_actions(account_id, session_uuid);
`;
