const fs = require("fs");
const path = require("path");
const mariadb = require("mariadb");
const bcrypt = require("bcrypt");

const pool = mariadb.createPool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "3306"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD,
	multipleStatements: true,
});

async function runSqlFile(conn, filePath) {
	if (!fs.existsSync(filePath)) {
		console.log(`Skipping ${filePath} (not found)`);
		return;
	}
	console.log(`Reading ${path.basename(filePath)}...`);
	const sql = fs.readFileSync(filePath, "utf8");
	console.log(`Executing ${path.basename(filePath)}...`);
	try {
		await conn.query(sql);
		console.log(`✅ Executed ${path.basename(filePath)} successfully.`);
	} catch (err) {
		// Ignore "table already exists" or "column already exists" errors to allow re-running
		if (err.code === "ER_TABLE_EXISTS_ERROR" || err.code === "ER_DUP_FIELDNAME") {
			console.log(`⚠️  Notice for ${path.basename(filePath)}: ${err.message}`);
		} else {
			console.error(`❌ Error executing ${path.basename(filePath)}:`, err.message);
		}
	}
}

async function setupFullDb() {
	let conn;
	try {
		conn = await pool.getConnection();
		console.log("Connected to database.");

		const dataDir = path.join(__dirname, "../data");
		const migrationsDir = path.join(__dirname, "../data/migrations");

		// 1. Base Schema (Accounts, Orders, Chat, etc.)
		await runSqlFile(conn, path.join(dataDir, "schema.sql"));

		// 2. Products Tables (Coffee, Machines) - This drops and recreates products tables
		await runSqlFile(conn, path.join(migrationsDir, "create_products_tables.sql"));

		// 3. Additional Tables in data root
		await runSqlFile(conn, path.join(dataDir, "create_member_status_table.sql"));
		await runSqlFile(conn, path.join(dataDir, "create_repairs_table.sql"));

		// 4. Alterations / Updates
		await runSqlFile(conn, path.join(dataDir, "add_delivery_date_and_subscriptions.sql"));
		await runSqlFile(conn, path.join(dataDir, "add_delivery_estimate.sql"));
		await runSqlFile(conn, path.join(dataDir, "add_order_discount_columns.sql"));

		// 5. Migrations
		await runSqlFile(conn, path.join(migrationsDir, "2025-12-15-extend-products.sql"));
		await runSqlFile(conn, path.join(migrationsDir, "add_service_to_product_type.sql"));

		// 6. Ensure Admin User
		console.log("Ensuring Admin user exists and has correct password...");
		const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
		const password = process.env.ADMIN_PASSWORD;
		if (!password) {
			throw new Error("ADMIN_PASSWORD environment variable is required");
		}
		const hash = await bcrypt.hash(password, 10);

		// Check if admin exists (by role or username)
		const rows = await conn.query("SELECT * FROM users WHERE role = 'admin' OR username = ?", [username]);

		if (rows.length > 0) {
			console.log("Updating existing admin user...");
			await conn.query("UPDATE users SET username = ?, password_hash = ?, role = 'admin' WHERE id = ?", [
				username,
				hash,
				rows[0].id,
			]);
		} else {
			console.log("Creating new admin user...");
			await conn.query("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)", [
				username,
				"admin@filspresso.com",
				hash,
				"admin",
			]);
		}
		console.log(`✅ Admin user set: ${username}`);

		console.log("\n🎉 All database scripts executed successfully.");
	} catch (err) {
		console.error("Fatal error executing database scripts:", err);
	} finally {
		if (conn) conn.release();
		await pool.end();
	}
}

setupFullDb();
