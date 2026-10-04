-- Phase 6.1: collision-free order numbers.
--
-- createOrder built the number as `ORD-${Date.now()}`. Two checkouts in the same
-- millisecond collide. `orders_order_number_key` (UNIQUE) already exists, so the
-- database does reject the collision -- the failure mode is a customer whose checkout
-- errors out, not a duplicated order. Still a lost sale.
--
-- A sequence makes the number unique by construction and monotonic, and independent of
-- wall-clock resolution. The existing UNIQUE constraint stays as the backstop, so the
-- invariant is still enforced by the database even if the sequence is bypassed.
--
-- No backfill is needed. Historic numbers are `ORD-<millis>-<hex>` and subscription
-- numbers are `SUB-<millis>-<hex>`, neither of which a fresh `ORD-<n>` sequence value
-- can collide with.
--
-- IDEMPOTENT. Safe to run repeatedly.

CREATE SEQUENCE IF NOT EXISTS orders_order_number_seq;

-- The application does not connect as the owner. With
-- STRICT_SERVICE_DB_CREDENTIALS it uses BACKEND_DB_USER (default
-- `filspresso_backend_svc`), and a freshly created sequence grants nothing to anyone,
-- so `nextval` fails with "permission denied for sequence" at request time.
--
-- Granted to the documented application role rather than to PUBLIC: nextval on an
-- order sequence is not sensitive, but least privilege is still the right default.
-- If BACKEND_DB_USER is changed to a different role, add it here too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE orders_order_number_seq TO filspresso_backend_svc';
  END IF;
END $$;

-- Make the invariant explicit rather than incidental. ADD CONSTRAINT IF NOT EXISTS is
-- not supported by Postgres, so check pg_constraint first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'orders'::regclass
       AND conname = 'orders_order_number_key'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);
  END IF;
END $$;