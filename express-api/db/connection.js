/**
 * MariaDB Database Connection Pool
 */

const mariadb = require("mariadb");

const pool = mariadb.createPool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "3306"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD || "filspresso_secure_2024",
	connectionLimit: 10,
	acquireTimeout: 30000,
	idleTimeout: 60000,
});

// Test connection on startup
pool.getConnection()
	.then((conn) => {
		console.log("✅ Connected to MariaDB database");
		conn.release();
	})
	.catch((err) => {
		console.error("❌ Failed to connect to MariaDB:", err.message);
	});

module.exports = pool;
