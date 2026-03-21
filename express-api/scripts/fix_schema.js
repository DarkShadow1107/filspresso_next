const { Pool } = require("pg");

const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "5432"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD || "filspresso_secure_2024",
});

async function run() {
	try {
		console.log("Checking accounts table...");
		const res = await pool.query(`
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_name = 'accounts'
		`);
		const columns = res.rows.map((r) => r.column_name);
		console.log("Existing columns:", columns);

		if (!columns.includes("graph_theme")) {
			console.log("Adding graph_theme column...");
			await pool.query("ALTER TABLE accounts ADD COLUMN graph_theme VARCHAR(20) DEFAULT 'classic'");
			console.log("Column added successfully.");
		} else {
			console.log("graph_theme column already exists.");
		}

		if (!columns.includes("invoice_include_product_view")) {
			console.log("Adding invoice_include_product_view column...");
			await pool.query("ALTER TABLE accounts ADD COLUMN invoice_include_product_view BOOLEAN DEFAULT TRUE");
			console.log("Column added successfully.");
		} else {
			console.log("invoice_include_product_view column already exists.");
		}

		if (!columns.includes("subscription_id")) {
			console.log("Adding subscription_id column...");
			await pool.query("ALTER TABLE accounts ADD COLUMN subscription_id INTEGER");
			console.log("Column added successfully.");
		}

		// Create subscriptions table if missing
		console.log("Checking subscriptions table...");
		const subCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'subscriptions'
            )
        `);

		if (!subCheck.rows[0].exists) {
			console.log("Creating subscriptions table...");
			await pool.query(`
                CREATE TABLE subscriptions (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(50) NOT NULL,
                    description TEXT,
                    price_ron DECIMAL(10,2) DEFAULT 0.00,
                    features JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

			// Insert default subscriptions
			await pool.query(`
                INSERT INTO subscriptions (name, description, price_ron, features) VALUES
                ('Free', 'Basic access to coffee and machines', 0, '["Standard support", "Basic dashboard"]'),
                ('Gold', 'Premium benefits and discounts', 45, '["Free shipping", "Exclusive previews", "Priority support"]'),
                ('Platinum', 'Ultimate coffee experience', 95, '["Free shipping", "20% discount on capsules", "VIP support", "Machine maintenance"]')
            `);
			console.log("Subscriptions table created and populated.");
		} else {
			console.log("Subscriptions table already exists.");
		}
	} catch (err) {
		console.error("Error:", err);
	} finally {
		await pool.end();
	}
}

run();
