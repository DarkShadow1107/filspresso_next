-- Durable Playground session state and versioned run events.
--
-- Two tables, not one, because they answer different questions.
--
-- playground_sessions is what the client *restores*: preferences, source references and the
-- compaction checkpoint -- the active context for continuing a conversation. It deliberately
-- does NOT hold the full transcript; the transcript stays client-local in both clients until
-- cross-device sync is an actual product decision (ENHANCEMENT.md "Subsequent improvements").
-- Storing messages here without that decision would create a second copy of user text in a
-- new retention class, which is a privacy question before it is an engineering one.
--
-- playground_run_events is what the server can *prove*: one append-only row per meaningful
-- step of a generation or a hosted execution, keyed by a server-owned run id. Before this, a
-- compaction summary existed only in the browser, and an execution that ended with the tab
-- closed left no trace of what ran or how it ended. The billing ledger already answers "was
-- this account charged?"; this table answers "what happened, in order, at that run".
--
-- Both tables are account-scoped on purpose. A run id is never a cross-account lookup key:
-- replay always filters on account_id AND run_id together.

CREATE TABLE IF NOT EXISTS playground_sessions (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_uuid UUID NOT NULL UNIQUE,
    -- Client-side conversation label; the server only stores what the client chose.
    title TEXT NOT NULL DEFAULT 'New conversation',
    model_key TEXT NOT NULL,
    input_context_tokens INTEGER NOT NULL DEFAULT 16384,
    -- Closed set of three, matching models/playground_compaction.THRESHOLDS upstream.
    compaction_mode TEXT NOT NULL DEFAULT 'balanced'
        CHECK (compaction_mode IN ('permissive', 'balanced', 'aggressive')),
    -- The last compaction checkpoint: { ids, history, tokensBefore, tokensAfter, summary }.
    -- Bounded by the service layer (see playground-sessions.service.ts) so one PATCH cannot
    -- pay for unbounded JSONB.
    active_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Uploader names/urls only. Source *text* is intentionally absent: it belongs to the
    -- transcript class of data, not to server-held session state.
    source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Soft delete. Row data (and its events) are only swept later, by the retention code.
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS playground_run_events (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Server-generated, never client-supplied: `dsk-<24hex>` for generations, `exec-<24hex>`
    -- for hosted executions. The broker's own internal run id is recorded in the payload,
    -- not in this column, so an attempt is one replayable stream end to end.
    run_id TEXT NOT NULL,
    -- Optional client conversation linkage; there is no FK by design -- a client may report
    -- events for a session row it has not (yet) created through the sessions API.
    session_uuid UUID,
    scope TEXT NOT NULL DEFAULT 'playground' CHECK (scope IN ('desktop', 'playground')),
    -- Append-only log of one run: generation.started -> context.compacted ->
    -- settlement.* -> generation.finished. `kind` is validated in TypeScript against a
    -- closed allowlist (playground-run-events.service.ts) rather than here: new kinds are a
    -- code-and-migration change, and a CHECK that silently disagrees with the allowlist
    -- would make the recorder drop events with no reason visible to anyone.
    kind TEXT NOT NULL,
    -- 0..N within a run. A restart seeded from MAX(sequence_number) keeps two backend
    -- instances from fighting; the unique index turns a two-instance race into an
    -- idempotent no-op instead of a duplicate.
    sequence_number INTEGER NOT NULL DEFAULT 0,
    -- Pending marks events whose terminal counterpart has not been recorded yet.
    status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'complete', 'failed')),
    model_key TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The idempotency object for the recorder. ON CONFLICT DO NOTHING relies on it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_playground_run_events_sequence
    ON playground_run_events(run_id, sequence_number);

-- Replay lists a run's events; support views the lawyer-by-tab-closed execution here.
CREATE INDEX IF NOT EXISTS idx_playground_run_events_account
    ON playground_run_events(account_id, created_at DESC);

-- Session-linked lookups only, so NULL rows are not in the index at all.
CREATE INDEX IF NOT EXISTS idx_playground_run_events_session
    ON playground_run_events(session_uuid)
    WHERE session_uuid IS NOT NULL;

-- The retention sweep finds old rows by created_at; a full scan on every hourly sweep is
-- exactly the kind of quiet cost this file exists to avoid paying.
CREATE INDEX IF NOT EXISTS idx_playground_run_events_retention
    ON playground_run_events(created_at);

CREATE INDEX IF NOT EXISTS idx_playground_sessions_account
    ON playground_sessions(account_id, is_active, updated_at DESC);

COMMENT ON TABLE playground_sessions IS
    'Account-scoped Playground resume state: preferences, source references and the compaction checkpoint. Deliberately not the transcript.';
COMMENT ON TABLE playground_run_events IS
    'Server-owned, account-scoped, append-only record of what one Playground generation or hosted execution did, in order.';
