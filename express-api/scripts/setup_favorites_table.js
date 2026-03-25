const pool = require("../db/connection");

async function checkFavoritesTable() {
	try {
		console.log("Checking favorites table...");
		await pool.query(`
			CREATE TABLE IF NOT EXISTS favorites (
				id SERIAL PRIMARY KEY,
				account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
				product_type VARCHAR(20) NOT NULL, -- capsule, machine
				product_id VARCHAR(100) NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				UNIQUE (account_id, product_type, product_id)
			);
		`);
		console.log("Ensuring index exists...");
		await pool.query(`CREATE INDEX IF NOT EXISTS idx_favorites_account ON favorites(account_id);`);
		console.log("✅ Favorites table is ready.");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error setting up favorites table:", error);
		process.exit(1);
	}
}

checkFavoritesTable();
