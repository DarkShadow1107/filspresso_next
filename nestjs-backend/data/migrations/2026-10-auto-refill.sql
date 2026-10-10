-- Automatic wallet refill.
--
-- The balance endpoint has always advertised `autoRefillTargetRon`, and it has never run:
-- nothing triggered it, so the promise was decorative. This adds the column that lets a
-- top-up record whether it was an automatic refill, so the account page can tell the
-- customer what happened instead of leaving them to infer it from a balance change.
--
-- Distinct from idempotency_key, which answers "is this the same charge?" This answers
-- "why was this charge made?", and it is set on the retry path too: a replayed request
-- that was correctly refused still needs to say so, otherwise a wallet sitting at its
-- floor looks like nothing ever tried.

ALTER TABLE billing_topups
    ADD COLUMN IF NOT EXISTS auto_refill BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN billing_topups.auto_refill IS
    'True when this top-up was the automatic refill to the target balance, rather than a deliberate one.';