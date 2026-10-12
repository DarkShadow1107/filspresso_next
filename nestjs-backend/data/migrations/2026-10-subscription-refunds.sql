-- Links a refund row to the payment it reverses.
--
-- Without this, a customer looking at their payment history sees a negative-amount row and
-- has to guess what it refunded. Worse, nothing stops two refund rows both pointing at the
-- same payment -- a double refund, which is the failure mode a refunds feature most needs to
-- not have.

ALTER TABLE subscription_payments
    ADD COLUMN IF NOT EXISTS refund_of BIGINT
        REFERENCES subscription_payments(id) ON DELETE SET NULL;

COMMENT ON COLUMN subscription_payments.refund_of IS
    'The payment this row reverses. Null on an ordinary charge.';

-- One refund per payment. Partial, so ordinary charges -- which have no key -- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_payments_single_refund
    ON subscription_payments(refund_of)
    WHERE refund_of IS NOT NULL;