#!/usr/bin/env node

require("dotenv").config();

const pool = require("../db/connection");
const { verifySecurityLedgerChain } = require("../utils/securityLedger");

async function main() {
	const chainScope = String(process.argv[2] || process.env.SECURITY_LEDGER_SCOPE || "service-health").trim();
	const maxRowsRaw = Number.parseInt(process.argv[3] || process.env.SECURITY_LEDGER_MAX_ROWS || "10000", 10);
	const maxRows = Number.isFinite(maxRowsRaw) ? Math.min(Math.max(maxRowsRaw, 1), 100000) : 10000;

	const client = await pool.connect();
	try {
		const result = await verifySecurityLedgerChain(client, { chainScope, maxRows });
		if (!result.ok) {
			console.error("Security ledger verification failed");
			console.error(JSON.stringify(result, null, 2));
			process.exitCode = 1;
			return;
		}

		console.log("Security ledger verification passed");
		console.log(JSON.stringify(result, null, 2));
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error("Security ledger verification encountered an error:", error.message || String(error));
	process.exit(1);
});
