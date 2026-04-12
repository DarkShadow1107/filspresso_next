/**
 * PostgreSQL Database Connection Pool
 */

const { Pool } = require("pg");
const { getEnvOrFile } = require("../utils/secrets");

const STRICT_SERVICE_DB_CREDENTIALS =
	String(process.env.STRICT_SERVICE_DB_CREDENTIALS || "false")
		.trim()
		.toLowerCase() === "true";
const BACKEND_DB_USER = String(process.env.BACKEND_DB_USER || "").trim();
const ROOT_DB_USER = String(process.env.DB_USER || "filspresso_user").trim();
const DB_USER = BACKEND_DB_USER || ROOT_DB_USER;

const BACKEND_DB_PASSWORD = getEnvOrFile("BACKEND_DB_PASSWORD", { required: false, defaultValue: "" });
const ROOT_DB_PASSWORD = getEnvOrFile("DB_PASSWORD", { required: true });
const DB_PASSWORD = BACKEND_DB_PASSWORD || ROOT_DB_PASSWORD;

if (STRICT_SERVICE_DB_CREDENTIALS) {
	if (!BACKEND_DB_USER) {
		throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_USER");
	}

	if (BACKEND_DB_USER === ROOT_DB_USER) {
		throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_USER to differ from DB_USER");
	}

	if (!BACKEND_DB_PASSWORD) {
		throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_PASSWORD or BACKEND_DB_PASSWORD_FILE");
	}
}

const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "5432"),
	database: process.env.DB_NAME || "filspresso",
	user: DB_USER,
	password: DB_PASSWORD,
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
