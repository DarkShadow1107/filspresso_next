-- Device identity and refresh credentials for the desktop client.
--
-- Why `user_sessions` needed more columns. It stored a hashed token, an expiry, an IP
-- and a user agent, and that was enough for a browser: every login made a new row, and
-- `GET /api/auth/sessions` rendered each one as an anonymous device the user could not
-- name or recognise. A desktop client cannot use that model at all. It holds one
-- long-lived session per machine, so it needs to be able to say *which* machine, and it
-- needs somewhere to keep a refresh credential -- the access token lives 15 minutes
-- (JWT_EXPIRES_IN), which is far too short for an interactive coding session.
--
-- One row per device, not one per login. A desktop client authenticates once and then
-- rotates its access token in place for weeks. Minting a new row per refresh would fill
-- the sessions list with dozens of near-identical entries and make revocation
-- meaningless.
--
-- `refresh_token_hash` is a second credential on the same row, so that rotating a
-- refresh invalidates the access token in the same statement. Two tables would let them
-- drift: a rotated refresh with a live access token, or the reverse.

ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS device_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS device_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS platform VARCHAR(32),
    ADD COLUMN IF NOT EXISTS app_version VARCHAR(32),
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 'web' is the default because every existing row is a browser. 'desktop' is the only
-- other client. Constrained rather than left free text: this column decides which
-- refresh path a token may use, so it cannot be whatever the caller sent.
ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS client_type VARCHAR(20) NOT NULL DEFAULT 'web';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_client_type_chk'
    ) THEN
        ALTER TABLE user_sessions
            ADD CONSTRAINT user_sessions_client_type_chk
            CHECK (client_type IN ('web', 'desktop'));
    END IF;
END
$$;

-- The refresh credential. Nullable because web sessions never had one, and they still do
-- not need one: the browser flow keeps its cookie. A desktop row with a null
-- refresh_token_hash is simply not refreshable, which is the correct answer rather than a
-- bug to be papered over with a default.
ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS refresh_token_hash CHAR(64),
    ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMP;

-- Revoking "this laptop" is a lookup by device, and the sessions list needs to render a
-- device name. Both are per-account reads.
CREATE INDEX IF NOT EXISTS idx_user_sessions_account_device
    ON user_sessions(account_id, device_id)
    WHERE device_id IS NOT NULL;

-- Lookup by refresh credential on every rotation. Partial, because most rows have none.
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_hash
    ON user_sessions(refresh_token_hash)
    WHERE refresh_token_hash IS NOT NULL;

-- `GET /api/auth/sessions` should show the freshest activity first.
CREATE INDEX IF NOT EXISTS idx_user_sessions_account_last_seen
    ON user_sessions(account_id, last_seen_at DESC);
