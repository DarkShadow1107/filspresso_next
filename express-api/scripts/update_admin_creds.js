const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const pool = new Pool({
	host: process.env.DB_HOST || "localhost",
	port: parseInt(process.env.DB_PORT || "5432"),
	database: process.env.DB_NAME || "filspresso",
	user: process.env.DB_USER || "filspresso_user",
	password: process.env.DB_PASSWORD || "filspresso_secure_2024",
});

async function updateAdmin() {
	let client;
	try {
		// Default credentials if not in env - but the goal is to store them in DB
		const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
		const password = process.env.ADMIN_PASSWORD || "FilspressoNext";
		const email = "admin@filspresso.com";
		const hash = await bcrypt.hash(password, 10);

		client = await pool.connect();

		// Check if admin exists by email or username
		const res = await client.query("SELECT * FROM accounts WHERE email = $1 OR role = 'admin'", [email]);

		if (res.rows.length > 0) {
			console.log("Updating existing admin user...");
			await client.query(
				"UPDATE accounts SET username = $1, password_hash = $2, role = 'admin' WHERE email = $3 OR role = 'admin'",
				[username, hash, email],
			);
		} else {
			console.log("Creating new admin user...");
			await client.query("INSERT INTO accounts (username, email, password_hash, role, name) VALUES ($1, $2, $3, $4, $5)", [
				username,
				email,
				hash,
				"admin",
				"System Administrator",
			]);
		}

		console.log(`Admin user updated in database: ${username} (Email: ${email})`);
		console.log("You can now login with these credentials even if you remove them from .env");
	} catch (err) {
		console.error("Error updating admin:", err);
	} finally {
		if (client) client.release();
		await pool.end();
	}
}

updateAdmin();
