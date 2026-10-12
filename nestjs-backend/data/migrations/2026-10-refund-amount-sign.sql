-- Allow a refund row to carry a negative amount.
--
-- The original constraint was `amount_ron >= 0`, which is the right invariant for a payment:
-- an amount of money is not negative. A refund is not a payment, though -- it reverses one --
-- and recording it as a positive amount with a 'refunded' status means the sign of the
-- ledger stops being meaningful: sum the rows and a customer who paid 100 and was refunded
-- 100 nets to 200.
--
-- Narrowed rather than removed, so an ordinary charge can still never be negative. A typo
-- that put -50 on a 'paid' row is now a database error rather than a customer dispute.

ALTER TABLE subscription_payments
    DROP CONSTRAINT IF EXISTS subscription_payments_amount_ron_check;

ALTER TABLE subscription_payments
    ADD CONSTRAINT subscription_payments_amount_ron_check
    CHECK (amount_ron >= 0 OR payment_status = 'refunded');

COMMENT ON CONSTRAINT subscription_payments_amount_ron_check ON subscription_payments IS
    'A charge is never negative; only a refund may be, and it carries a negative amount so the ledger nets correctly.';