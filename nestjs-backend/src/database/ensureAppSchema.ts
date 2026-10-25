import { Pool } from "pg";
import { AGENT_ACTIONS_SCHEMA } from "../desktop/playground-agent-actions.schema";

export async function ensureAppSchema(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS kafelot_anonymous_users (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL UNIQUE,
        ip_address VARCHAR(64),
        user_agent TEXT,
        system_info JSONB DEFAULT '{}'::jsonb,
        prompts_used INTEGER DEFAULT 0,
        prompts_limit INTEGER DEFAULT 5,
        reset_date DATE NOT NULL DEFAULT (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`ALTER TABLE kafelot_anonymous_users ALTER COLUMN ip_address TYPE VARCHAR(64)`);
    await client.query(`ALTER TABLE kafelot_anonymous_users ALTER COLUMN prompts_limit SET DEFAULT 5`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_anon_fingerprint ON kafelot_anonymous_users(fingerprint)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_anon_reset ON kafelot_anonymous_users(reset_date)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS kafelot_prompt_usage (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        month_year VARCHAR(7) NOT NULL,
        usage_scope VARCHAR(32) NOT NULL DEFAULT 'general',
        prompts_used INTEGER DEFAULT 0,
        prompts_limit INTEGER DEFAULT 15,
        subscription_tier VARCHAR(50) DEFAULT 'free',
        reset_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (account_id, month_year, usage_scope)
      )
    `);

    await client.query(`ALTER TABLE kafelot_prompt_usage ADD COLUMN IF NOT EXISTS usage_scope VARCHAR(32)`);
    await client.query(`ALTER TABLE kafelot_prompt_usage ALTER COLUMN usage_scope SET DEFAULT 'general'`);
    await client.query(`UPDATE kafelot_prompt_usage SET usage_scope = 'general' WHERE usage_scope IS NULL OR usage_scope = ''`);
    await client.query(`ALTER TABLE kafelot_prompt_usage ALTER COLUMN usage_scope SET NOT NULL`);
	await client.query(`ALTER TABLE kafelot_prompt_usage DROP CONSTRAINT IF EXISTS kafelot_prompt_usage_account_id_month_year_key`);
	// No unique index is created here on purpose.
	//
	// A three-column unique index over (account_id, month_year, usage_scope) was created
	// at this point in the sequence and then dropped further down, once model_key had been
	// added to the key. That only ever worked by accident: the first boot created it, and
	// every boot after that skipped it with IF NOT EXISTS while line 70 quietly dropped
	// it. So the index never existed again -- and the first boot that did try to create it
	// failed with "could not create unique index", because per-model rows are *expected* to
	// share an account, a month and a scope. It cannot be created at all; only the
	// four-column index below, which includes model_key, is consistent with the data.

    // ---- Per-model metering (see data/migrations/2026-10-kafelot-model-key.sql) ----
    //
    // Two granularities in one table: `model_key = ''` is the scope total that every
    // existing query already means, and a real model key is that model's sub-count.
    // A request passes only when both are under their limits.
    //
    // BOTH uniqueness objects must be dropped. A fresh database has the table-level
    // UNIQUE (account_id, month_year, usage_scope) whose auto-generated name is
    // kafelot_prompt_usage_account_id_month_year_usage_scope_key; an older one also
    // has the explicit index created just above. The old index is dropped and
    // recreated with model_key in the key so ON CONFLICT has something to infer.
    //
    // Note this bootstrap does not run at all when STRICT_SERVICE_DB_CREDENTIALS is
    // true, and it is not transactional, so the SQL migration is the reliable path.
    await client.query(`ALTER TABLE kafelot_prompt_usage ADD COLUMN IF NOT EXISTS model_key VARCHAR(64)`);
    await client.query(`ALTER TABLE kafelot_prompt_usage ALTER COLUMN model_key SET DEFAULT ''`);
    await client.query(`UPDATE kafelot_prompt_usage SET model_key = '' WHERE model_key IS NULL`);
    await client.query(`ALTER TABLE kafelot_prompt_usage ALTER COLUMN model_key SET NOT NULL`);
    await client.query(`ALTER TABLE kafelot_prompt_usage DROP CONSTRAINT IF EXISTS kafelot_prompt_usage_account_id_month_year_usage_scope_key`);
    await client.query(`ALTER TABLE kafelot_prompt_usage DROP CONSTRAINT IF EXISTS kafelot_prompt_usage_account_id_month_year_key`);
    await client.query(`DROP INDEX IF EXISTS idx_kafelot_prompt_usage_account_month_scope`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_account_month_scope_model ON kafelot_prompt_usage(account_id, month_year, usage_scope, model_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_model ON kafelot_prompt_usage(model_key)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS service_health_incidents (
        id BIGSERIAL PRIMARY KEY,
        service_key VARCHAR(64) NOT NULL,
        service_name VARCHAR(128) NOT NULL,
        status VARCHAR(8) NOT NULL CHECK (status IN ('up', 'down')),
        reason TEXT,
        occurred_at TIMESTAMP NOT NULL,
        source VARCHAR(32) NOT NULL DEFAULT 'backend',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ---- Durable Playground state (see data/migrations/2026-10-playground-run-events.sql) ----
    //
    // Both tables are also declared in the migration file above; this is the boot path that
    // makes them exist before the first record/interview/sweep touches them, exactly like
    // the kafelot tables at the top of this file.
    await client.query(`
      CREATE TABLE IF NOT EXISTS playground_sessions (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_uuid UUID NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT 'New conversation',
        model_key TEXT NOT NULL,
        input_context_tokens INTEGER NOT NULL DEFAULT 16384,
        compaction_mode TEXT NOT NULL DEFAULT 'balanced'
          CHECK (compaction_mode IN ('permissive', 'balanced', 'aggressive')),
        active_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS playground_run_events (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        session_uuid UUID,
        scope TEXT NOT NULL DEFAULT 'playground' CHECK (scope IN ('desktop', 'playground')),
        kind TEXT NOT NULL,
        sequence_number INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'complete', 'failed')),
        model_key TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_playground_run_events_sequence ON playground_run_events(run_id, sequence_number)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_playground_run_events_account ON playground_run_events(account_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_playground_run_events_session ON playground_run_events(session_uuid) WHERE session_uuid IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_playground_run_events_retention ON playground_run_events(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_playground_sessions_account ON playground_sessions(account_id, is_active, updated_at DESC)`);
    await client.query(AGENT_ACTIONS_SCHEMA);

    // The desktop installer download is gated on an explicit, server-recorded
    // acknowledgement per product version: the web popup cannot be trusted as the only
    // gate, because its state lives in a browser. One row per account+version carries the
    // user-stated OS claim (clearly non-authoritative -- the desktop app reports real
    // system facts separately) and counts completed downloads of that version.
    await client.query(`
      CREATE TABLE IF NOT EXISTS desktop_download_acks (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        product_version VARCHAR(32) NOT NULL,
        os_claim VARCHAR(64),
        download_count INTEGER NOT NULL DEFAULT 0
          CHECK (download_count >= 0),
        first_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_downloaded_at TIMESTAMPTZ,
        UNIQUE(account_id, product_version)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_desktop_download_acks_account ON desktop_download_acks(account_id, last_acknowledged_at DESC)`);

    // The desktop app is the only component that can read the real machine's Windows
    // edition/build/UBR. It reports them per device id alongside its app version, and the
    // account page shows that as "Playground installed on ...". This is client-reported
    // information (a lying client could lie here) and is therefore informational display
    // data, never an entitlement input.
    await client.query(`
      CREATE TABLE IF NOT EXISTS desktop_device_state (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_id VARCHAR(64) NOT NULL,
        device_name VARCHAR(120),
        os_edition VARCHAR(64),
        os_build INTEGER,
        os_ubr INTEGER,
        app_version VARCHAR(32),
        reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, device_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_desktop_device_state_account ON desktop_device_state(account_id, reported_at DESC)`);


    await client.query(`
      CREATE TABLE IF NOT EXISTS security_event_ledger (
        id BIGSERIAL PRIMARY KEY,
        chain_scope VARCHAR(64) NOT NULL DEFAULT 'global',
        event_type VARCHAR(96) NOT NULL,
        service_name VARCHAR(96) NOT NULL,
        actor_type VARCHAR(32) NOT NULL DEFAULT 'service',
        actor_id VARCHAR(128),
        correlation_id VARCHAR(128),
        prev_hash CHAR(64) NOT NULL,
        event_hash CHAR(64) NOT NULL,
        payload_canonical TEXT NOT NULL,
        event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_security_ledger_prev_hash CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_security_ledger_event_hash CHECK (event_hash ~ '^[0-9a-f]{64}$')
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS security_event_ledger_archive (
        id BIGSERIAL PRIMARY KEY,
        original_id BIGINT,
        chain_scope VARCHAR(64) NOT NULL,
        event_type VARCHAR(96) NOT NULL,
        service_name VARCHAR(96) NOT NULL,
        actor_type VARCHAR(32) NOT NULL,
        actor_id VARCHAR(128),
        correlation_id VARCHAR(128),
        prev_hash CHAR(64) NOT NULL,
        event_hash CHAR(64) NOT NULL,
        payload_canonical TEXT NOT NULL,
        event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        encrypted_payload TEXT,
        envelope_key_id VARCHAR(64),
        envelope_version VARCHAR(16),
        ciphertext_hash CHAR(64),
        occurred_at TIMESTAMP NOT NULL,
        archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_security_archive_prev_hash CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_security_archive_event_hash CHECK (event_hash ~ '^[0-9a-f]{64}$')
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS service_contract_registry (
        id BIGSERIAL PRIMARY KEY,
        service_name VARCHAR(96) NOT NULL,
        contract_name VARCHAR(96) NOT NULL,
        contract_version VARCHAR(24) NOT NULL,
        direction VARCHAR(16) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
        schema_body JSONB NOT NULL DEFAULT '{}'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (service_name, contract_name, contract_version, direction)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS zk_circuit_registry (
        id BIGSERIAL PRIMARY KEY,
        circuit_name VARCHAR(96) NOT NULL,
        circuit_version VARCHAR(32) NOT NULL,
        governance_status VARCHAR(16) NOT NULL DEFAULT 'proposed'
          CHECK (governance_status IN ('proposed', 'active', 'deprecated', 'revoked')),
        verification_key TEXT NOT NULL,
        verification_key_hash CHAR(64) NOT NULL,
        created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (circuit_name, circuit_version)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS zk_proof_sessions (
        id BIGSERIAL PRIMARY KEY,
        operation_id VARCHAR(128) NOT NULL UNIQUE,
        account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        circuit_name VARCHAR(96) NOT NULL,
        circuit_version VARCHAR(32) NOT NULL,
        public_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
        witness_hash CHAR(64) NOT NULL,
        proof_hash CHAR(64) NOT NULL,
        typed_event JSONB NOT NULL DEFAULT '{}'::jsonb,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mpc_quorum_sessions (
        id BIGSERIAL PRIMARY KEY,
        operation_id VARCHAR(128) NOT NULL UNIQUE,
        operation_type VARCHAR(64) NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        quorum_required INTEGER NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'ready', 'finalized', 'cancelled', 'expired')),
        created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finalized_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mpc_quorum_participants (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES mpc_quorum_sessions(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        partial_signature TEXT,
        signed_at TIMESTAMP,
        UNIQUE (session_id, account_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mpc_quorum_transcripts (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES mpc_quorum_sessions(id) ON DELETE CASCADE,
        participant_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        event_type VARCHAR(48) NOT NULL,
        event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        signature TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_login_attempts (
        id BIGSERIAL PRIMARY KEY,
        login_key VARCHAR(254) NOT NULL UNIQUE,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        first_failed_at TIMESTAMP,
        last_failed_at TIMESTAMP,
        lock_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_security_events (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        login_key VARCHAR(254),
        account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        ip_address VARCHAR(64),
        user_agent TEXT,
        details JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS security_operation_replay_guard (
        id BIGSERIAL PRIMARY KEY,
        operation_scope VARCHAR(64) NOT NULL,
        operation_id VARCHAR(128) NOT NULL,
        actor_id VARCHAR(128),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        UNIQUE (operation_scope, operation_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS security_key_registry (
        id BIGSERIAL PRIMARY KEY,
        key_name VARCHAR(96) NOT NULL UNIQUE,
        active_key_id VARCHAR(128) NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'local-env',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        rotated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS security_key_lifecycle_events (
        id BIGSERIAL PRIMARY KEY,
        key_name VARCHAR(96) NOT NULL,
        key_id VARCHAR(128),
        event_type VARCHAR(48) NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'local-env',
        actor_id VARCHAR(128),
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS threshold_operations (
        id BIGSERIAL PRIMARY KEY,
        operation_id VARCHAR(128) NOT NULL UNIQUE,
        operation_type VARCHAR(64) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(16) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'executed', 'rejected', 'expired', 'cancelled')),
        required_approvals INTEGER NOT NULL DEFAULT 2,
        created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        executed_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        approved_at TIMESTAMP,
        executed_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS threshold_operation_approvals (
        id BIGSERIAL PRIMARY KEY,
        threshold_operation_id BIGINT NOT NULL REFERENCES threshold_operations(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        operation_id VARCHAR(128) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (threshold_operation_id, account_id),
        UNIQUE (operation_id)
      )
    `);

    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_mfa_secret_encrypted TEXT`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_mfa_enabled_at TIMESTAMP`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_mfa_secret_encrypted TEXT`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_mfa_enabled_at TIMESTAMP`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20)`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_subject VARCHAR(191)`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_linked_at TIMESTAMP`);
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS google_sub VARCHAR(191)`);
    // `accounts.subscription` is written by subscriptions.service.ts and read as the
    // tier fallback by kafelot.service.ts (`fetchUserTier`), auth.service.ts and
    // auth-complex.service.ts. It exists on long-lived databases because it was added
    // by hand, but it was never in schema.sql nor created here -- so a database built
    // from the documented sources has no such column, every write throws, and the
    // tier fallback silently degrades to "free". That last effect matters: an Ultimate
    // account with no `user_subscriptions` row would resolve as free and lock itself
    // out of tier-gated features. Backfilling from `subscription_id` keeps existing
    // rows working.
    await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription VARCHAR(50)`);
    await client.query(`UPDATE accounts SET subscription = 'Free' WHERE subscription IS NULL OR subscription = ''`);
    await client.query(`ALTER TABLE security_event_ledger_archive ADD COLUMN IF NOT EXISTS encrypted_payload TEXT`);
    await client.query(`ALTER TABLE security_event_ledger_archive ADD COLUMN IF NOT EXISTS envelope_key_id VARCHAR(64)`);
    await client.query(`ALTER TABLE security_event_ledger_archive ADD COLUMN IF NOT EXISTS envelope_version VARCHAR(16)`);
    await client.query(`ALTER TABLE security_event_ledger_archive ADD COLUMN IF NOT EXISTS ciphertext_hash CHAR(64)`);
    await client.query(`DROP INDEX IF EXISTS idx_accounts_apple_sub`);
    await client.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS apple_sub`);

    // ---------------------------------------------------------------------
    // Chat sessions and messages.
    //
    // These are declared in `data/schema.sql`, which only runs when Postgres
    // initialises an *empty* data directory. A volume created before these tables
    // existed therefore never gets them, and `chat.service.ts` queries columns
    // (`is_active`, `message_count`) that would be missing. Mirroring the
    // definition here makes the tables and every column they are read for
    // self-healing on boot, the same way the rest of this file works.
    //
    // `category` and `metadata` are additions for the move away from the global
    // `src/data/chat_history.json` blob:
    //   - `category` preserves the coffee/chemistry/general split the Kafelot
    //     stats panel counts. `model_type` alone cannot express it (it only has
    //     tanka_semantic / tanka_chemistry).
    //   - `metadata` carries the per-message extras the UI renders but SQL has no
    //     column for: attached products, image data, the model that answered, and
    //     the molecule view. Encoding them into `content` would corrupt the text.
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_uuid VARCHAR(36) NOT NULL UNIQUE,
        title VARCHAR(255) DEFAULT 'New Chat',
        model_type VARCHAR(20) NOT NULL DEFAULT 'tanka_semantic',
        category VARCHAR(20) NOT NULL DEFAULT 'general',
        metadata JSONB,
        ai_enabled BOOLEAN DEFAULT TRUE,
        is_active BOOLEAN DEFAULT TRUE,
        message_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        tokens_used INTEGER DEFAULT 0,
        response_time_ms INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Columns added after the tables shipped. Ordered nullable-first, backfilled,
    // then tightened -- the sequence used for the usage_scope migration above.
    await client.query(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN`);
    await client.query(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS message_count INTEGER`);
    await client.query(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS category VARCHAR(20)`);
    await client.query(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS metadata JSONB`);
    await client.query(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
    await client.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB`);

    await client.query(`UPDATE chat_sessions SET is_active = TRUE WHERE is_active IS NULL`);
    await client.query(`UPDATE chat_sessions SET message_count = 0 WHERE message_count IS NULL`);
    await client.query(`UPDATE chat_sessions SET category = 'general' WHERE category IS NULL OR category = ''`);
    await client.query(`UPDATE chat_sessions SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL`);

    await client.query(`ALTER TABLE chat_sessions ALTER COLUMN is_active SET DEFAULT TRUE`);
    await client.query(`ALTER TABLE chat_sessions ALTER COLUMN is_active SET NOT NULL`);
    await client.query(`ALTER TABLE chat_sessions ALTER COLUMN message_count SET DEFAULT 0`);
    await client.query(`ALTER TABLE chat_sessions ALTER COLUMN message_count SET NOT NULL`);
    await client.query(`ALTER TABLE chat_sessions ALTER COLUMN category SET DEFAULT 'general'`);
    await client.query(`ALTER TABLE chat_sessions ALTER COLUMN category SET NOT NULL`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_account ON chat_sessions(account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_uuid ON chat_sessions(session_uuid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_account_active ON chat_sessions(account_id, is_active)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_mfa_challenges (
        id BIGSERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        challenge_token_hash CHAR(64) NOT NULL UNIQUE,
        purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('verify', 'enroll')),
        temp_secret_encrypted TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 6,
        expires_at TIMESTAMP NOT NULL,
        consumed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_mfa_challenges (
        id BIGSERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        challenge_token_hash CHAR(64) NOT NULL UNIQUE,
        purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('login', 'enable')),
        temp_secret_encrypted TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 6,
        expires_at TIMESTAMP NOT NULL,
        consumed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Session tokens are stored hashed (never in plaintext) so a database leak
    // cannot be replayed as a live credential. The hash also keeps the column
    // within a fixed width, which the raw EdDSA JWT exceeds.
    await client.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS session_token_hash CHAR(64)`);
    await client.query(`ALTER TABLE user_sessions ALTER COLUMN session_token DROP NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(session_token_hash)`);
    await client.query(`DELETE FROM user_sessions WHERE session_token_hash IS NULL`);

    // The molecules table is declared in data/schema.sql, but that file only runs
    // on first init of an empty Postgres volume. This is the owner-side backstop
    // that keeps it repairable afterwards, and it must run BEFORE the ai-role
    // grant below -- GRANT on a missing relation throws and would abort the rest
    // of the bootstrap. The AI service cannot do this itself: it connects as the
    // least-privilege AI_DB_USER role, and PostgreSQL rejects ALTER TABLE from a
    // non-owner even when ADD COLUMN IF NOT EXISTS makes it a semantic no-op.
    await client.query(`
      CREATE TABLE IF NOT EXISTS molecules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        smiles TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        chembl_id VARCHAR(64),
        synonyms JSONB DEFAULT '[]'::jsonb
      )
    `);
    await client.query(`ALTER TABLE molecules ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
    await client.query(`ALTER TABLE molecules ADD COLUMN IF NOT EXISTS smiles TEXT`);
    await client.query(`ALTER TABLE molecules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await client.query(`ALTER TABLE molecules ADD COLUMN IF NOT EXISTS chembl_id VARCHAR(64)`);
    await client.query(`ALTER TABLE molecules ADD COLUMN IF NOT EXISTS synonyms JSONB DEFAULT '[]'::jsonb`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_molecules_chembl_id_unique ON molecules(chembl_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_molecules_name ON molecules(name)`);

    // `molecule mol` plus its GIST index come from the rdkit extension. Both are
    // optional so a deployment without that extension still boots; the column is
    // only reachable for similarity search when the extension is present.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mol') THEN
          EXECUTE 'ALTER TABLE molecules ADD COLUMN IF NOT EXISTS molecule mol';
          EXECUTE 'CREATE INDEX IF NOT EXISTS idx_molecules_mol ON molecules USING gist(molecule)';
        END IF;
      END $$;
    `);

    // The AI service connects as its own least-privilege role (AI_DB_USER). The
    // role is created by the database image but ships with no grants, so without
    // this every fact-retrieval and molecule query fails with "permission denied".
    // Guarded so deployments that reuse the owner account are unaffected.
    const aiServiceRole = String(process.env.AI_DB_USER || "").trim();
    if (aiServiceRole && aiServiceRole !== "filspresso_user") {
      const roleExists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1 LIMIT 1", [aiServiceRole]);
      if (roleExists.rows[0]) {
        await client.query(`GRANT USAGE ON SCHEMA public TO "${aiServiceRole}"`);
        // SELECT only: the AI service is deliberately not an owner of any table,
        // so it can never migrate schema. See the molecules block above.
        await client.query(`GRANT SELECT ON coffee_facts, molecules TO "${aiServiceRole}"`);
        // CREATE on the schema is not table ownership; it only lets the role add
        // objects to `public`. Kept because the schema lives in `public`.
        await client.query(`GRANT CREATE ON SCHEMA public TO "${aiServiceRole}"`);
      }
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_lock_until ON auth_login_attempts(lock_until)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_last_failed ON auth_login_attempts(last_failed_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_security_events_created_at ON auth_security_events(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_security_events_type ON auth_security_events(event_type, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_security_events_login_key ON auth_security_events(login_key, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_operation_replay_expires ON security_operation_replay_guard(expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_operation_replay_actor ON security_operation_replay_guard(actor_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_key_lifecycle_events_key ON security_key_lifecycle_events(key_name, occurred_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_key_lifecycle_events_type ON security_key_lifecycle_events(event_type, occurred_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_threshold_operations_status ON threshold_operations(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_threshold_operations_expires ON threshold_operations(expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_threshold_approvals_operation ON threshold_operation_approvals(threshold_operation_id, created_at DESC)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_oauth_provider_subject ON accounts(oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_google_sub ON accounts(google_sub) WHERE google_sub IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_account ON admin_mfa_challenges(account_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_expires ON admin_mfa_challenges(expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_mfa_challenges_account ON user_mfa_challenges(account_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_mfa_challenges_expires ON user_mfa_challenges(expires_at)`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_service_health_incidents_occurred_at ON service_health_incidents(occurred_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_service_health_incidents_service ON service_health_incidents(service_key, occurred_at DESC)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_security_event_ledger_chain_hash ON security_event_ledger(chain_scope, event_hash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_event_ledger_chain_id ON security_event_ledger(chain_scope, id DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_event_ledger_occurred ON security_event_ledger(occurred_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_event_ledger_correlation ON security_event_ledger(correlation_id) WHERE correlation_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_security_event_archive_occurred ON security_event_ledger_archive(occurred_at DESC)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_security_event_archive_original_id ON security_event_ledger_archive(original_id) WHERE original_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_service_contract_registry_active ON service_contract_registry(service_name, contract_name, active)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_zk_circuit_registry_status ON zk_circuit_registry(circuit_name, governance_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_zk_proof_sessions_verified ON zk_proof_sessions(verified, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mpc_sessions_status ON mpc_quorum_sessions(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mpc_transcripts_session ON mpc_quorum_transcripts(session_id, created_at DESC)`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_account ON kafelot_prompt_usage(account_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_month ON kafelot_prompt_usage(month_year)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_scope ON kafelot_prompt_usage(usage_scope)`);

    await client.query(`
      UPDATE kafelot_prompt_usage
      SET prompts_limit = CASE
        WHEN usage_scope = 'general' AND LOWER(subscription_tier) = 'ultimate' THEN 1000
        WHEN usage_scope = 'molecule_helper' THEN 200
        ELSE prompts_limit
      END,
      updated_at = CURRENT_TIMESTAMP
      WHERE (usage_scope = 'general' AND model_key = '' AND LOWER(subscription_tier) = 'ultimate' AND prompts_limit <> 1000)
         OR (usage_scope = 'molecule_helper' AND prompts_limit <> 200)
    `);

    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'RON'`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1.000000`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS conversion_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_subtotal DECIMAL(10,2) DEFAULT 0.00`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_shipping_cost DECIMAL(10,2) DEFAULT 0.00`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_tax DECIMAL(10,2) DEFAULT 0.00`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_total DECIMAL(10,2) DEFAULT 0.00`);
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_country VARCHAR(100)`);

    await client.query(`
      CREATE OR REPLACE FUNCTION prevent_security_log_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Mutation is not allowed for immutable security log table %', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'forbid_security_event_ledger_update') THEN
          CREATE TRIGGER forbid_security_event_ledger_update
          BEFORE UPDATE OR DELETE ON security_event_ledger
          FOR EACH ROW EXECUTE FUNCTION prevent_security_log_mutation();
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'forbid_security_event_archive_update') THEN
          CREATE TRIGGER forbid_security_event_archive_update
          BEFORE UPDATE OR DELETE ON security_event_ledger_archive
          FOR EACH ROW EXECUTE FUNCTION prevent_security_log_mutation();
        END IF;

        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kafelot_anonymous_users_updated_at') THEN
            CREATE TRIGGER update_kafelot_anonymous_users_updated_at
            BEFORE UPDATE ON kafelot_anonymous_users
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
          END IF;

          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kafelot_prompt_usage_updated_at') THEN
            CREATE TRIGGER update_kafelot_prompt_usage_updated_at
            BEFORE UPDATE ON kafelot_prompt_usage
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
          END IF;

          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_threshold_operations_updated_at') THEN
            CREATE TRIGGER update_threshold_operations_updated_at
            BEFORE UPDATE ON threshold_operations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
          END IF;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_security_writer') THEN
          CREATE ROLE filspresso_security_writer NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_security_reader') THEN
          CREATE ROLE filspresso_security_reader NOLOGIN;
        END IF;
      END $$;
    `);

    await client.query(`REVOKE ALL ON security_event_ledger FROM PUBLIC`);
    await client.query(`REVOKE ALL ON security_event_ledger_archive FROM PUBLIC`);
    await client.query(`GRANT INSERT, SELECT ON security_event_ledger TO filspresso_security_writer`);
    await client.query(`GRANT SELECT ON security_event_ledger TO filspresso_security_reader`);
    await client.query(`GRANT SELECT ON security_event_ledger_archive TO filspresso_security_reader`);
  } finally {
    client.release();
  }
}
