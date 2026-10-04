-- Per-model prompt metering for kafelot_prompt_usage.
--
-- Adds a `model_key` dimension so each model's allowance can be enforced
-- separately, while keeping the existing scope-level total intact.
--
-- Two granularities in one table:
--   model_key = ''                       -> the scope total (what the existing
--                                           queries and the plans page headline
--                                           already mean)
--   model_key = 'lfm2_5_230m_q4_k_m'     -> that model's sub-count
--
-- A request is allowed only when BOTH the scope total and the model sub-count are
-- under their limits.
--
-- IDEMPOTENT. Safe to run repeatedly; safe to run while the app is up.
--
-- IMPORTANT: run this out of band as well as via ensureAppSchema. The bootstrap is
-- skipped entirely when STRICT_SERVICE_DB_CREDENTIALS=true, and it is not
-- transactional, so a dedicated runner is the reliable path.

-- 1. The column. Nullable first, defaulted, backfilled, then tightened -- the same
--    ordering the usage_scope migration used.
ALTER TABLE kafelot_prompt_usage ADD COLUMN IF NOT EXISTS model_key VARCHAR(64);
ALTER TABLE kafelot_prompt_usage ALTER COLUMN model_key SET DEFAULT '';
UPDATE kafelot_prompt_usage SET model_key = '' WHERE model_key IS NULL;
ALTER TABLE kafelot_prompt_usage ALTER COLUMN model_key SET NOT NULL;

-- 2. Drop BOTH existing uniqueness objects.
--
--    A fresh database gets the table-level UNIQUE (account_id, month_year,
--    usage_scope) from CREATE TABLE, whose auto-generated name is
--    kafelot_prompt_usage_account_id_month_year_usage_scope_key. An older database
--    additionally has the explicit index below. Both must go, otherwise ON CONFLICT
--    on the four-column key has nothing to infer against and duplicate rows become
--    possible.
ALTER TABLE kafelot_prompt_usage
  DROP CONSTRAINT IF EXISTS kafelot_prompt_usage_account_id_month_year_usage_scope_key;
ALTER TABLE kafelot_prompt_usage
  DROP CONSTRAINT IF EXISTS kafelot_prompt_usage_account_id_month_year_key;
DROP INDEX IF EXISTS idx_kafelot_prompt_usage_account_month_scope;

-- 3. The four-column key. CREATE UNIQUE INDEX IF NOT EXISTS makes this re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_account_month_scope_model
  ON kafelot_prompt_usage(account_id, month_year, usage_scope, model_key);

-- 4. Lookup helper for the per-model row.
CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_model
  ON kafelot_prompt_usage(model_key);