const { Pool } = require("pg");

const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "5432"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD,
});

async function checkTables() {
	let client;
	try {
		client = await pool.connect();
		const res = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
		console.log(
			"Tables in database:",
			res.rows.map((r) => r.tablename),
		);

		const accounts = await client.query("SELECT username, role FROM accounts WHERE role='admin'");
		console.log("Admin accounts:", accounts.rows);
	} catch (err) {
		console.error("Error checking tables:", err);
	} finally {
		if (client) client.release();
		await pool.end();
	}
}

checkTables();
