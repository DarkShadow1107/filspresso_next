/**
 * PostgreSQL Database Connection Pool
 */

const { Pool } = require("pg");

if (!process.env.DB_PASSWORD) {
	throw new Error("DB_PASSWORD environment variable is required");
}

const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "5432"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD,
	max: 10,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.query("SELECT NOW()")
	.then(() => {
		console.log("✅ Connected to PostgreSQL database");
	})
	.catch((err) => {
		console.error("❌ Failed to connect to PostgreSQL:", err.message);
	});

module.exports = pool;
