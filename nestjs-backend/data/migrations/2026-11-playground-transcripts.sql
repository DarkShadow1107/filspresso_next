-- NULL means this session predates transcript storage, not an empty conversation.
ALTER TABLE playground_sessions ADD COLUMN IF NOT EXISTS transcript JSONB;
