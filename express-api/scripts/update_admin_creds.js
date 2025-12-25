const bcrypt = require("bcrypt");
const mariadb = require("mariadb");

const pool = mariadb.createPool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "3306"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD || "filspresso_secure_2024",
});

async function updateAdmin() {
	let conn;
	try {
		const password = "FilspressoNext";
		const username = "Admin";
		const hash = await bcrypt.hash(password, 10);

		conn = await pool.getConnection();

		// Check if admin exists
		const rows = await conn.query("SELECT * FROM users WHERE role = 'admin'");

		if (rows.length > 0) {
			console.log("Updating existing admin user...");
			await conn.query("UPDATE users SET username = ?, password_hash = ? WHERE role = 'admin'", [username, hash]);
		} else {
			console.log("Creating new admin user...");
			await conn.query("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)", [
				username,
				"admin@filspresso.com",
				hash,
				"admin",
			]);
		}

		console.log(`Admin user updated to: ${username} / ${password}`);
	} catch (err) {
		console.error("Error updating admin:", err);
	} finally {
		if (conn) conn.release();
		await pool.end();
	}
}

updateAdmin();
