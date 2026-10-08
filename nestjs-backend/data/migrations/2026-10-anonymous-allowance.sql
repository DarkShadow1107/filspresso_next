-- Anonymous token allowance, keyed by browser fingerprint.
--
-- Anonymous callers have no account, so `ai_monthly_allowance` cannot hold them: its
-- primary key is account_id. They used to get a prompt *count* instead, which was a
-- second, contradictory budget once usage moved to money -- a visitor entitled to
-- 3 RON could be refused for "prompts" while holding all of it unspent.
--
-- Same shape as the account allowance, so both are consumed the same way and reset on
-- the same UTC boundary. Anonymous is granted ANONYMOUS_ALLOWANCE_RON (3), against list
-- price: there is no subscription to discount.
--
-- The fingerprint is a client-supplied cookie value and is therefore weak as an identity.
-- That is accepted deliberately: it is a courtesy budget to slow casual scraping, not an
-- account. It must never be treated as authentication, and nothing here grants access.

CREATE TABLE IF NOT EXISTS ai_anonymous_allowance (
    fingerprint  TEXT NOT NULL,
    -- UTC `YYYY-MM`, for the same reason as the account table: the reset instant is derived
    -- from this key, so a local boundary would let two replicas disagree about the month.
    month_key    TEXT NOT NULL,
    granted_ron  NUMERIC(18, 8) NOT NULL DEFAULT 0,
    spent_ron    NUMERIC(18, 8) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (fingerprint, month_key),
    CONSTRAINT ai_anonymous_allowance_non_negative CHECK (granted_ron >= 0 AND spent_ron >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ai_anonymous_allowance_month
    ON ai_anonymous_allowance(month_key);

-- The prompt counter on kafelot_anonymous_users stops being a limit. It is kept as a
-- usage figure (the admin anonymous list still reads prompts_used) and clamped to a very
-- large value so any code path that has not been migrated cannot suddenly start refusing
-- every anonymous visitor at 0 remaining.
--
-- Done in code rather than here: kafelot_anonymous_users.prompts_limit is still written
-- by getOrCreateAnonymous, so the migration updates that writer instead. This comment
-- records why that column is still present rather than dropped.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ai_anonymous_allowance TO filspresso_backend_svc';
  END IF;
END $$;
