const fs = require("fs");
const path = require("path");
const mariadb = require("mariadb");

const pool = mariadb.createPool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "3306"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD || "filspresso_secure_2024",
	multipleStatements: true, // Important for running the full SQL file
});

async function runMigration() {
	let conn;
	try {
		conn = await pool.getConnection();
		console.log("Connected to database.");

		const sqlPath = path.join(__dirname, "../data/migrations/create_products_tables.sql");
		const sql = fs.readFileSync(sqlPath, "utf8");

		console.log("Executing migration...");
		await conn.query(sql);
		console.log("Migration executed successfully.");
	} catch (err) {
		console.error("Error executing migration:", err);
	} finally {
		if (conn) conn.release();
		await pool.end();
	}
}

runMigration();
