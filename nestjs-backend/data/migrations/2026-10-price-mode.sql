-- Records which price list priced a row, and which pot paid for it.
--
-- Without these, a charge is unexplainable after the fact. The Spectre Playground is
-- list-priced while Kafelot is discounted for the same tier, and an add-on holder pays
-- entirely from the wallet while a Max subscriber pays from allowance first -- so "how did
-- this 0.42 RON arise" has three different answers depending on columns nobody was storing.
--
-- Defaults match the historical behaviour so existing rows read correctly without a
-- backfill: they were all subscriber-or-list pricing, allowance first.

ALTER TABLE ai_token_usage
    ADD COLUMN IF NOT EXISTS price_mode TEXT NOT NULL DEFAULT 'list';

ALTER TABLE ai_token_usage
    ADD COLUMN IF NOT EXISTS bill_from TEXT NOT NULL DEFAULT 'allowance_then_wallet';

ALTER TABLE ai_token_usage
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'kafelot';

COMMENT ON COLUMN ai_token_usage.price_mode IS
    'Which rate priced this row: list, subscriber (Kafelot discount) or playground (list-priced surface).';

COMMENT ON COLUMN ai_token_usage.bill_from IS
    'Whether the charge drew on the plan allowance first, or came wholly from the wallet.';

COMMENT ON COLUMN ai_token_usage.scope IS
    'Which surface generated the usage: kafelot or playground.';