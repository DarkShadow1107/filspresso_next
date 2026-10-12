-- Refused top-ups.
--
-- A top-up that was attempted and declined is not a top-up, so it cannot live in
-- `billing_topups`: that table is a history of money that arrived, and `amount_ron` there is
-- constrained positive. Writing a zero row would have been the cheaper option and would have
-- made the top-up history claim funds arrived when none did.
--
-- This is what the automatic refill consults, and what /api/billing/balance reports, so a
-- refill that has stopped stopping visibly rather than leaving the balance pinned at the
-- floor with nothing to explain it.

CREATE TABLE IF NOT EXISTS billing_topup_failures (
    id           BIGSERIAL PRIMARY KEY,
    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount_ron   NUMERIC(18, 8) NOT NULL,
    -- 'user' for a deliberate top-up, 'auto' for the automatic refill.
    source       TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'auto')),
    card_id      INTEGER REFERENCES user_cards(id) ON DELETE SET NULL,
    -- The provider's code, e.g. 'card_declined' or 'no_card'. Kept as text because the
    -- vocabulary belongs to the provider, not to us.
    failure_code TEXT NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_topup_failures_account_created
    ON billing_topup_failures(account_id, created_at DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
        GRANT SELECT, INSERT ON billing_topup_failures TO filspresso_backend_svc;
        GRANT USAGE, SELECT ON SEQUENCE billing_topup_failures_id_seq TO filspresso_backend_svc;
    END IF;
END
$$;