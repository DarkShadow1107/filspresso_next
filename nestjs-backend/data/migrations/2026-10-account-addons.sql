-- The Spectre Playground add-on: a product sold alongside the subscription tiers.
--
-- Why a separate table rather than another `user_subscriptions` row. That table holds one
-- active row per account in practice, and `resolveTier` picks the single active row to
-- decide the caller's plan. A second row would make "which tier is this account?" a coin
-- toss between the plan and the add-on -- and the add-on is not a tier. It grants access
-- to one product and includes no usage at all, which is a different kind of thing from a
-- plan that carries a monthly allowance.
--
-- `subscription_tier` is left alone: a Spectre add-on holder can be on Free, Basic, Pro,
-- Max or Ultimate, and the entitlement below expresses that without disturbing the ladder.

CREATE TABLE IF NOT EXISTS account_addons (
    id             BIGSERIAL PRIMARY KEY,
    account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- 'spectre' is the only one today. A code rather than a table-per-product so a second
    -- add-on needs no migration.
    addon_code     VARCHAR(32) NOT NULL,
    price_ron      NUMERIC(10, 2) NOT NULL CHECK (price_ron >= 0),
    billing_cycle  VARCHAR(20) NOT NULL DEFAULT 'monthly'
                   CHECK (billing_cycle IN ('monthly', 'annual')),
    -- 'active' until cancelled, 'cancelled' at the end of the paid period, 'ended' after it.
    -- Access is retained while cancelled-but-unexpired, exactly as a tier is: the customer
    -- paid for the period they paid for.
    status         VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'cancelled', 'ended')),
    started_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- When access lapses. Compared against now() on every entitlement check rather than
    -- swept by the renewal job, so a missed run cannot extend access.
    expires_at     TIMESTAMP,
    auto_renew     BOOLEAN NOT NULL DEFAULT TRUE,
    card_id        INTEGER REFERENCES user_cards(id) ON DELETE SET NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One live row per account per add-on. Partial, because cancelled-then-ended history is
-- worth keeping and would otherwise collide on this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_addons_active_unique
    ON account_addons(account_id, addon_code)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_account_addons_account
    ON account_addons(account_id, addon_code, created_at DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
        GRANT SELECT, INSERT, UPDATE ON account_addons TO filspresso_backend_svc;
        GRANT USAGE, SELECT ON SEQUENCE account_addons_id_seq TO filspresso_backend_svc;
    END IF;
END
$$;
-- Records which product a payment row belongs to.
--
-- An add-on renewal is not a tier purchase, and a customer reading their history should be
-- able to tell "paid for Spectre" from "paid for Pro" without inferring it from the amount.
ALTER TABLE subscription_payments
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'tier';

COMMENT ON COLUMN subscription_payments.scope IS
    'Which product this payment bought: a tier, or the spectre add-on.';
