-- Multi-currency support for orders.
--
-- The `orders` table already had exchange_rate, conversion_fee_percent,
-- charged_subtotal, charged_shipping_cost, charged_tax, charged_total and
-- destination_country. The schema was designed for this and never implemented: checkout
-- read a currency label off the request and stored the RON figure beside it.
--
-- Semantics implemented here:
--   subtotal, discount_amount, shipping_cost, tax, total   RON, from the catalogue
--   exchange_rate                                          units of currency per 1 RON
--   charged_*                                              what the customer pays
--
-- A rate is snapshotted onto the order, so rendering it later never needs a live lookup
-- and the charged figures cannot drift as the market moves.
--
-- IDEMPOTENT. Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
  id SERIAL PRIMARY KEY,
  base_currency VARCHAR(3) NOT NULL,
  currency_code VARCHAR(3) NOT NULL,
  rate NUMERIC(20, 10) NOT NULL,
  rate_date DATE NOT NULL,
  source VARCHAR(32) NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (base_currency, currency_code, rate_date, source)
);

-- A rate of zero or negative would mean "this currency is free". Constrained rather than
-- trusted, because this table is an audit record.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'fx_rate_snapshots'::regclass
       AND conname = 'fx_rate_snapshots_rate_positive_chk'
  ) THEN
    ALTER TABLE fx_rate_snapshots ADD CONSTRAINT fx_rate_snapshots_rate_positive_chk
      CHECK (rate > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fx_rate_snapshots_lookup
  ON fx_rate_snapshots(base_currency, currency_code, rate_date DESC);

-- The application does not connect as the table owner, so it needs its own grants.
-- UPDATE is required in addition to INSERT: the write path is
-- `INSERT ... ON CONFLICT DO UPDATE`, and Postgres checks UPDATE privilege for the
-- DO UPDATE branch. Without it the snapshot silently fails on every live rate, which is
-- exactly the audit trail this table exists to provide.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON fx_rate_snapshots TO filspresso_backend_svc';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE fx_rate_snapshots_id_seq TO filspresso_backend_svc';
  END IF;
END $$;

-- The charged_* columns exist but are nullable and were left NULL by the old code (RON
-- orders stored 0.00). Nothing to migrate: historic rows used an inconsistent convention
-- and must not be silently rewritten. New rows always populate them.