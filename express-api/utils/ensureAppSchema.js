const pool = require("../db/connection");

async function ensureAppSchema() {
	const client = await pool.connect();

	try {
		await client.query(`
			CREATE TABLE IF NOT EXISTS kafelot_anonymous_users (
				id SERIAL PRIMARY KEY,
				fingerprint VARCHAR(64) NOT NULL UNIQUE,
				ip_address VARCHAR(64),
				user_agent TEXT,
				system_info JSONB DEFAULT '{}'::jsonb,
				prompts_used INTEGER DEFAULT 0,
				prompts_limit INTEGER DEFAULT 5,
				reset_date DATE NOT NULL DEFAULT (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::DATE,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`ALTER TABLE kafelot_anonymous_users ALTER COLUMN ip_address TYPE VARCHAR(64)`);
		await client.query(`ALTER TABLE kafelot_anonymous_users ALTER COLUMN prompts_limit SET DEFAULT 5`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_anon_fingerprint ON kafelot_anonymous_users(fingerprint)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_anon_reset ON kafelot_anonymous_users(reset_date)`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS kafelot_prompt_usage (
				id SERIAL PRIMARY KEY,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				month_year VARCHAR(7) NOT NULL,
				prompts_used INTEGER DEFAULT 0,
				prompts_limit INTEGER DEFAULT 15,
				subscription_tier VARCHAR(50) DEFAULT 'free',
				reset_date DATE NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE (account_id, month_year)
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS service_health_incidents (
				id BIGSERIAL PRIMARY KEY,
				service_key VARCHAR(64) NOT NULL,
				service_name VARCHAR(128) NOT NULL,
				status VARCHAR(8) NOT NULL CHECK (status IN ('up', 'down')),
				reason TEXT,
				occurred_at TIMESTAMP NOT NULL,
				source VARCHAR(32) NOT NULL DEFAULT 'backend',
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS auth_login_attempts (
				id BIGSERIAL PRIMARY KEY,
				login_key VARCHAR(254) NOT NULL UNIQUE,
				failed_attempts INTEGER NOT NULL DEFAULT 0,
				first_failed_at TIMESTAMP,
				last_failed_at TIMESTAMP,
				lock_until TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS auth_security_events (
				id BIGSERIAL PRIMARY KEY,
				event_type VARCHAR(64) NOT NULL,
				login_key VARCHAR(254),
				account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
				ip_address VARCHAR(64),
				user_agent TEXT,
				details JSONB DEFAULT '{}'::jsonb,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_mfa_secret_encrypted TEXT`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS admin_mfa_enabled_at TIMESTAMP`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_mfa_secret_encrypted TEXT`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_mfa_enabled_at TIMESTAMP`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20)`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_subject VARCHAR(191)`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS oauth_linked_at TIMESTAMP`);
		await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS google_sub VARCHAR(191)`);
		await client.query(`DROP INDEX IF EXISTS idx_accounts_apple_sub`);
		await client.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS apple_sub`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS admin_mfa_challenges (
				id BIGSERIAL PRIMARY KEY,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				challenge_token_hash CHAR(64) NOT NULL UNIQUE,
				purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('verify', 'enroll')),
				temp_secret_encrypted TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 6,
				expires_at TIMESTAMP NOT NULL,
				consumed_at TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`
			CREATE TABLE IF NOT EXISTS user_mfa_challenges (
				id BIGSERIAL PRIMARY KEY,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				challenge_token_hash CHAR(64) NOT NULL UNIQUE,
				purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('login', 'enable')),
				temp_secret_encrypted TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 6,
				expires_at TIMESTAMP NOT NULL,
				consumed_at TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		await client.query(`CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_lock_until ON auth_login_attempts(lock_until)`);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_last_failed ON auth_login_attempts(last_failed_at)`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_auth_security_events_created_at ON auth_security_events(created_at DESC)`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_auth_security_events_type ON auth_security_events(event_type, created_at DESC)`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_auth_security_events_login_key ON auth_security_events(login_key, created_at DESC)`,
		);
		await client.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_oauth_provider_subject ON accounts(oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL`,
		);
		await client.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_google_sub ON accounts(google_sub) WHERE google_sub IS NOT NULL`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_account ON admin_mfa_challenges(account_id, created_at DESC)`,
		);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_expires ON admin_mfa_challenges(expires_at)`);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_user_mfa_challenges_account ON user_mfa_challenges(account_id, created_at DESC)`,
		);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_user_mfa_challenges_expires ON user_mfa_challenges(expires_at)`);

		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_service_health_incidents_occurred_at ON service_health_incidents(occurred_at DESC)`,
		);
		await client.query(
			`CREATE INDEX IF NOT EXISTS idx_service_health_incidents_service ON service_health_incidents(service_key, occurred_at DESC)`,
		);

		await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_account ON kafelot_prompt_usage(account_id)`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_kafelot_prompt_usage_month ON kafelot_prompt_usage(month_year)`);

		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'RON'`);
		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1.000000`);
		await client.query(
			`ALTER TABLE orders ADD COLUMN IF NOT EXISTS conversion_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00`,
		);
		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_subtotal DECIMAL(10,2) DEFAULT 0.00`);
		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_shipping_cost DECIMAL(10,2) DEFAULT 0.00`);
		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_tax DECIMAL(10,2) DEFAULT 0.00`);
		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS charged_total DECIMAL(10,2) DEFAULT 0.00`);
		await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_country VARCHAR(100)`);

		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
					IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kafelot_anonymous_users_updated_at') THEN
						CREATE TRIGGER update_kafelot_anonymous_users_updated_at
						BEFORE UPDATE ON kafelot_anonymous_users
						FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
					END IF;

					IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_kafelot_prompt_usage_updated_at') THEN
						CREATE TRIGGER update_kafelot_prompt_usage_updated_at
						BEFORE UPDATE ON kafelot_prompt_usage
						FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
					END IF;
				END IF;
			END $$;
		`);
	} finally {
		client.release();
	}
}

module.exports = {
	ensureAppSchema,
};
