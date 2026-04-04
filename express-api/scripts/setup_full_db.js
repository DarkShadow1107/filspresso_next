const fs = require("fs");
const path = require("path");
const mariadb = require("mariadb");

const pool = mariadb.createPool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "3306"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD,
	multipleStatements: true,
});

async function runSqlFile(conn, filePath) {
	console.log(`Reading ${filePath}...`);
	const sql = fs.readFileSync(filePath, "utf8");
	console.log(`Executing ${filePath}...`);
	await conn.query(sql);
	console.log(`Executed ${filePath} successfully.`);
}

async function setupFullDb() {
	let conn;
	try {
		conn = await pool.getConnection();
		console.log("Connected to database.");

		const migrationsDir = path.join(__dirname, "../data/migrations");
		const dataDir = path.join(__dirname, "../data");

		// 1. Run schema.sql (Base tables)
		await runSqlFile(conn, path.join(dataDir, "schema.sql"));

		// 2. Run create_products_tables.sql (Products, Users, Sessions)
		await runSqlFile(conn, path.join(migrationsDir, "create_products_tables.sql"));

		// 3. Run add_service_to_product_type.sql (Update order_items enum)
		await runSqlFile(conn, path.join(migrationsDir, "add_service_to_product_type.sql"));

		console.log("All database scripts executed successfully.");
	} catch (err) {
		console.error("Error executing database scripts:", err);
	} finally {
		if (conn) conn.release();
		await pool.end();
	}
}

setupFullDb();
