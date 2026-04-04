const { Pool } = require("pg");

const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "5432"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD,
});

async function diagnostic() {
	let client;
	try {
		client = await pool.connect();
		const tableRes = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
		const tables = tableRes.rows.map((r) => r.tablename);

		console.log("--- TABLE STATUS ---");
		for (const table of tables) {
			const colRes = await client.query(
				"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'created_at'",
				[table],
			);
			if (colRes.rows.length === 0) {
				console.log(`[!] Table '${table}' is MISSING 'created_at' column.`);
			} else {
				console.log(`[OK] Table '${table}' has 'created_at'.`);
			}
		}
	} catch (err) {
		console.error("Diagnostic error:", err);
	} finally {
		if (client) client.release();
		await pool.end();
	}
}

diagnostic();
