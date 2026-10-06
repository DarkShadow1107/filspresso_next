-- Monthly token allowance, and the funded wallet's own rules.
--
-- Two separate pots, spent in a defined order, because they are different promises:
--
--   ai_monthly_allowance   money included with the plan, free to use, resets monthly
--   account_balances       money the customer put on a card and owns
--
-- The allowance is spent first, because it is the thing the subscription bought; the
-- funded balance only takes over once the included money is gone. Keeping them in one
-- column would make "how much of my plan is left" and "how much money do I have" the same
-- question, and they answer differently at the end of a month.

CREATE TABLE IF NOT EXISTS ai_monthly_allowance (
    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- UTC `YYYY-MM`. UTC because the reset instant is derived from this key; a local
    -- boundary would let two servers in different zones disagree about the month and
    -- hand out the allowance twice.
    month_key    TEXT NOT NULL,
    tier         TEXT NOT NULL DEFAULT 'free',
    granted_ron  NUMERIC(18, 8) NOT NULL DEFAULT 0,
    spent_ron    NUMERIC(18, 8) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, month_key),
    CONSTRAINT ai_monthly_allowance_non_negative CHECK (granted_ron >= 0 AND spent_ron >= 0)
);

-- "How much of my plan have I used this month", which the account and Kafelot windows
-- both ask on every render.
CREATE INDEX IF NOT EXISTS idx_ai_monthly_allowance_month
    ON ai_monthly_allowance(month_key);

-- The funded wallet's floor becomes the customer's choice: 0 means never spend past zero,
-- a negative value allows a deliberate overdraft ("credit"), and a positive value keeps a
-- float. Default 0 rather than the earlier hardcoded -0.50, because "don't go into debt"
-- is the safer default for a wallet that a card can drain automatically.
ALTER TABLE account_balances
    ADD COLUMN IF NOT EXISTS min_balance_ron NUMERIC(18, 8) NOT NULL DEFAULT 0;

-- Funding events, so "why is my balance X" is answerable without reading the order table.
-- Immediate, no delivery: the Playground is metered, not shipped, which is why these settle
-- in full rather than moving through pending/shipped/delivered.
CREATE TABLE IF NOT EXISTS billing_topups (
    id             BIGSERIAL PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount_ron     NUMERIC(18, 8) NOT NULL CHECK (amount_ron > 0),
    -- 'user' for a deliberate top-up, 'auto' for the automatic refill to the target balance.
    source         TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'auto')),
    -- The card charged, so a disputed charge can be traced to a specific card rather than
    -- to "the default card at the time".
    card_id        INTEGER REFERENCES user_cards(id) ON DELETE SET NULL,
    -- True when this row was created by a retry rather than a real second charge. Kept so
    -- a replayed webhook cannot drain the card twice.
    idempotency_key TEXT,
    balance_after  NUMERIC(18, 8),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_topups_account_created
    ON billing_topups(account_id, created_at DESC);

-- The refill is issued from inside the metered request path, so it must be idempotent per
-- request or a retry charges the card twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_topups_idempotency
    ON billing_topups(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ai_monthly_allowance TO filspresso_backend_svc';
    -- Billing needs DELETE on the wallet alone: the floor is a setting the customer may
    -- change, and Postgres 14+ requires DELETE for some ON CONFLICT paths. The top-up and
    -- usage logs stay append-only.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON account_balances TO filspresso_backend_svc';
    EXECUTE 'GRANT SELECT, INSERT ON billing_topups TO filspresso_backend_svc';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE billing_topups_id_seq TO filspresso_backend_svc';
  END IF;
END $$;
