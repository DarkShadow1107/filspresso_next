-- Persist the portion of a generation the wallet could not cover.
--
-- uncoveredRon is already returned by /api/billing/usage, but it existed only in the HTTP
-- response: nothing wrote it down. That makes it invisible to exactly the person it exists
-- for -- a customer whose wallet hit its floor and whose ledger shows a cost they cannot
-- reconcile with what was taken from the card.
--
-- Defaulted to 0 so every row written before this column existed reads as fully covered,
-- which is what it was.

ALTER TABLE ai_token_usage
    ADD COLUMN IF NOT EXISTS uncovered_ron NUMERIC(18, 8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN ai_token_usage.uncovered_ron IS
    'Portion of this request''s cost the wallet could not take, because the account was at its floor.';