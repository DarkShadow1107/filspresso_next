const { pool } = require("../db/connection");

async function debugAccountDates() {
	console.log("--- Account Dates Debugger ---");
	try {
		const result = await pool.query(`
            SELECT id, username, email, created_at, 
            (created_at IS NULL) as is_null,
            EXTRACT(YEAR FROM created_at) as year
            FROM accounts
        `);

		console.table(result.rows);

		const nullDates = result.rows.filter((r) => r.is_null);
		if (nullDates.length > 0) {
			console.log(`\nFound ${nullDates.length} accounts with NULL created_at.`);
			console.log("Fixing them by setting to 2024-01-01...");

			await pool.query(`
                UPDATE accounts 
                SET created_at = '2024-01-01 00:00:00+00' 
                WHERE created_at IS NULL
            `);
			console.log("Updated successfully.");
		} else {
			console.log("\nAll accounts have created_at dates.");
		}
	} catch (err) {
		console.error("Error debugging accounts:", err.message);
	} finally {
		await pool.end();
	}
}

debugAccountDates();
