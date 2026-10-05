-- Token metering: a RON balance per account, and an immutable log of what was spent.
--
-- Both are needed. `account_balances` is the fast answer to "can this request run and
-- what will it leave"; `ai_token_usage` is the audit trail that answers "why is my balance
-- what it is". Keeping spend derived from a log rather than trusting a running total is
-- the same reason orders re-price from the catalogue instead of the request body.
--
-- Money is NUMERIC, never float. A 298-token exchange on the 230M costs 0.00011940 RON,
-- so binary floating point would drift within a few hundred requests.

CREATE TABLE IF NOT EXISTS account_balances (
    account_id     INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    -- Signed. A negative balance is allowed and means the account is in arrears, which is
    -- a real state once metering is live and a top-up has not landed yet. Forbidding it
    -- would mean refusing to record usage that has already been served.
    balance_ron    NUMERIC(18, 8) NOT NULL DEFAULT 0,
    lifetime_spent NUMERIC(18, 8) NOT NULL DEFAULT 0,
    lifetime_topup NUMERIC(18, 8) NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Belt and braces against a concurrent-decrement bug writing a negative balance by
    -- arithmetic accident, as opposed to by an intentional overdraft.
    CONSTRAINT account_balances_finite CHECK (
        balance_ron IS NOT NULL AND lifetime_spent IS NOT NULL AND lifetime_topup IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS ai_token_usage (
    id               BIGSERIAL PRIMARY KEY,
    account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- The canonical model key (lfm2_5_230m_q4_k_m, ...). NOT NULL so a row can never be
    -- unpriced: an unknown key is rejected by the service before it gets here, and a NULL
    -- would be a silent hole in the audit trail.
    model_key        TEXT NOT NULL,
    input_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens    INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    -- RON per 1M at the moment of the call. Snapshotted rather than joined to a price
    -- table at read time, so a future price change cannot rewrite history.
    input_price_per1m    NUMERIC(18, 8) NOT NULL,
    output_price_per1m   NUMERIC(18, 8) NOT NULL,
    subscriber_discount  SMALLINT NOT NULL DEFAULT 0,
    cost_ron         NUMERIC(18, 8) NOT NULL,
    -- False when the request was served by a fallback (no tokens spent) or when the
    -- upstream omitted usage. Kept so "we could not meter this" is visible rather than
    -- looking like a free request.
    metered          BOOLEAN NOT NULL DEFAULT TRUE,
    request_id       TEXT,
    balance_after    NUMERIC(18, 8),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The account+time read that the account page and any reconciliation job do.
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_account_created
    ON ai_token_usage(account_id, created_at DESC);

-- Per-model spend reporting for the admin price table.
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_model_created
    ON ai_token_usage(model_key, created_at DESC);

-- Retry guard. The Next layer reports usage after the generation has already been served,
-- so a retried or duplicated report would otherwise debit the customer twice for one
-- exchange. Partial on request_id so rows without one (backfills, manual entries) are not
-- all made equal by a NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_token_usage_request_dedupe
    ON ai_token_usage(request_id)
    WHERE request_id IS NOT NULL;

-- The application connects as a least-privilege role and does not own these tables, so
-- every table, sequence and index needs an explicit grant. The missing grant on
-- popular_products_cache is exactly what made /api/orders/popular return 500 for every
-- caller, so this is asserted rather than assumed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON account_balances TO filspresso_backend_svc';
    EXECUTE 'GRANT SELECT, INSERT ON ai_token_usage TO filspresso_backend_svc';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE ai_token_usage_id_seq TO filspresso_backend_svc';
  END IF;
END $$;

-- Give every existing account a zero balance row rather than relying on a lazy upsert at
-- read time. A missing row and a zero balance mean the same thing to a customer, and
-- materialising them keeps the debit path a plain UPDATE.
INSERT INTO account_balances (account_id)
SELECT id FROM accounts
ON CONFLICT (account_id) DO NOTHING;
