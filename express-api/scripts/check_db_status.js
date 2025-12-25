const mariadb = require("mariadb");

const pool = mariadb.createPool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "3306"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD || "filspresso_secure_2024",
});

async function checkTables() {
	let conn;
	try {
		conn = await pool.getConnection();
		const rows = await conn.query("SHOW TABLES LIKE 'accounts'");
		if (rows.length > 0) {
			console.log("Table 'accounts' exists.");
		} else {
			console.log("Table 'accounts' DOES NOT exist.");
		}

		const users = await conn.query("SELECT username FROM users WHERE role='admin'");
		console.log("Admin users:", users);
	} catch (err) {
		console.error("Error checking tables:", err);
	} finally {
		if (conn) conn.release();
		await pool.end();
	}
}

checkTables();
