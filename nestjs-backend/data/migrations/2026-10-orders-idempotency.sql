-- Phase 6.4: idempotency key on POST /api/orders.
--
-- 6.1 made order *numbers* collision-free, which stops two concurrent checkouts from
-- colliding. It does nothing about a *retried request*: a phone that loses the response
-- mid-flight and retries will create a second order, and the customer is charged twice.
--
-- The key is scoped to the account, not globally, so two accounts cannot collide on a
-- client-chosen value and one account cannot probe another's keys.
--
-- Uniqueness is (account_id, idempotency_key). The partial index excludes rows with no
-- key, so ordinary orders -- which never send one -- are unaffected and do not all
-- collide on NULL.
--
-- The stored response is what gets replayed, so a retry returns the original order
-- rather than a fresh one.
--
-- IDEMPOTENT. Safe to run repeatedly.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- The response body, so a retry replays exactly what the first attempt returned rather
-- than a freshly-shaped one. Only written when a key was supplied; left NULL otherwise.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS response JSONB;

-- Backfill is not needed and not possible: historic rows predate the feature and have
-- no key to invent. They simply have NULL and are excluded from the index below.

-- Scoped per account. Partial, so the (very many) keyless rows stay out of it entirely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_account_idempotency_key
  ON orders(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Bounded, so a client cannot use this table as free storage. ADD CONSTRAINT has no
-- IF NOT EXISTS, so check pg_constraint first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'orders'::regclass
       AND conname = 'orders_idempotency_key_length_chk'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_length_chk
      CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128);
  END IF;
END $$;