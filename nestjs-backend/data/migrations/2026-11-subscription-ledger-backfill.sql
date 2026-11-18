-- Link subscription payment events to the subscription they belong to and restore
-- purchase records that predate the payment ledger. Safe to apply repeatedly.
BEGIN;

ALTER TABLE subscription_payments
    ADD COLUMN IF NOT EXISTS subscription_id INTEGER
        REFERENCES user_subscriptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS card_last_four_snapshot CHAR(4),
    ADD COLUMN IF NOT EXISTS card_type_snapshot VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription
    ON subscription_payments(subscription_id, created_at DESC)
    WHERE subscription_id IS NOT NULL;

-- Link existing tier payments (including renewals) to the most recently created
-- matching subscription. Add-on rows are intentionally not linked.
WITH matches AS (
    SELECT p.id AS payment_id,
           us.id AS subscription_id,
           us.card_id,
           uc.card_last_four,
           uc.card_type,
           ROW_NUMBER() OVER (
               PARTITION BY p.id
               ORDER BY us.created_at DESC, us.id DESC
           ) AS position
      FROM subscription_payments p
      JOIN user_subscriptions us
        ON us.account_id = p.account_id
       AND LOWER(us.subscription_tier) = LOWER(p.tier)
       AND us.billing_cycle = p.billing_cycle
       AND us.price_ron = ABS(p.amount_ron)
       AND us.price_ron > 0
       AND us.status <> 'scheduled'
       AND us.created_at <= p.created_at
      LEFT JOIN user_cards uc ON uc.id = us.card_id
     WHERE p.subscription_id IS NULL
       AND p.scope = 'tier'
       AND p.payment_status IN ('paid', 'refunded')
)
UPDATE subscription_payments p
   SET subscription_id = m.subscription_id,
       card_id = COALESCE(p.card_id, m.card_id),
       card_last_four_snapshot = COALESCE(p.card_last_four_snapshot, m.card_last_four),
       card_type_snapshot = COALESCE(p.card_type_snapshot, m.card_type)
  FROM matches m
 WHERE p.id = m.payment_id
   AND m.position = 1;

-- Older checkouts wrote the subscription but not a payment row. A purchase event
-- is missing only when no paid event was written in the first ten minutes after
-- that subscription was created. Renewal entries do not suppress this row.
INSERT INTO subscription_payments
    (account_id, tier, billing_cycle, amount_ron, currency, card_id,
     payment_status, fulfilment_status, reference, idempotency_key,
     subscription_id, card_last_four_snapshot, card_type_snapshot, created_at)
SELECT us.account_id,
       us.subscription_tier,
       us.billing_cycle,
       us.price_ron,
       'RON',
       us.card_id,
       'paid',
       'delivered',
       'legacy-sub-' || us.id::text,
       'legacy-sub-' || us.id::text,
       us.id,
       uc.card_last_four,
       uc.card_type,
       us.created_at
  FROM user_subscriptions us
  LEFT JOIN user_cards uc ON uc.id = us.card_id
 WHERE us.price_ron > 0
   AND us.status IN ('active', 'ending', 'cancelled')
   AND NOT EXISTS (
       SELECT 1
         FROM subscription_payments p
        WHERE p.subscription_id = us.id
          AND p.payment_status = 'paid'
          AND p.created_at < us.created_at + INTERVAL '10 minutes'
   )
ON CONFLICT (account_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
DO NOTHING;

COMMIT;
