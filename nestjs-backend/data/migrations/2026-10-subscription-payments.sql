-- Payment history for subscriptions.
--
-- A subscription purchase is not an order. `orders` carries a shipping address, a delivery
-- estimate and a 'delivered' status, none of which mean anything for a plan: nobody ships a
-- Pro tier. Filing subscription purchases in `orders` would have made them look like
-- parcels, so they get their own table.
--
-- Two columns rather than one status, because money and access are two separate facts and
-- they can disagree:
--
--   payment_status    did the charge complete
--   fulfilment_status was access granted
--
-- Collapsing them into a single 'paid' would make "we took your money and did not give you
-- the plan" unrepresentable, which is precisely the state worth being able to see.
--
-- No real payment provider is wired up. The charge is recorded against the card the
-- customer chose and no money leaves; `payment_status` is therefore 'paid' for the same
-- reason the wallet is a ledger: there is nothing to reconcile against yet. When a provider
-- is added, this table is where its result belongs.

CREATE TABLE IF NOT EXISTS subscription_payments (
    id                 BIGSERIAL PRIMARY KEY,
    account_id         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    tier               VARCHAR(50)  NOT NULL,
    billing_cycle      VARCHAR(20)  NOT NULL,
    amount_ron         NUMERIC(10, 2) NOT NULL CHECK (amount_ron >= 0),
    currency           VARCHAR(3)   NOT NULL DEFAULT 'RON',
    -- The card charged, so a dispute can be traced to a specific card rather than to
    -- "whatever was default at the time".
    card_id            INTEGER REFERENCES user_cards(id) ON DELETE SET NULL,
    payment_status     VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
    -- 'delivered' means access provisioned, not a parcel delivered. Named for the vocabulary
    -- the account page already uses for payments.
    fulfilment_status  VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (fulfilment_status IN ('pending', 'delivered', 'revoked')),
    reference          VARCHAR(64),
    -- A retried subscribe must not write a second row for the same purchase.
    idempotency_key    VARCHAR(128),
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_account_created
    ON subscription_payments(account_id, created_at DESC);

-- Only non-null keys are constrained, so an unkeyed row (a manual admin grant, say) does not
-- collide with another. Mirrors the orders table's partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_idempotency
    ON subscription_payments(account_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
        GRANT SELECT, INSERT ON subscription_payments TO filspresso_backend_svc;
        GRANT USAGE, SELECT ON SEQUENCE subscription_payments_id_seq TO filspresso_backend_svc;
    END IF;
END
$$;