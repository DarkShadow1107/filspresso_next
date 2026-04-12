#!/usr/bin/env node

require("dotenv").config();

const pool = require("../db/connection");

function hasFlag(name) {
	return process.argv.includes(`--${name}`);
}

async function main() {
	const execute = hasFlag("execute");
	const revokeCircuits = hasFlag("revoke-zk-circuits");
	const cancelMpc = hasFlag("cancel-mpc");
	const disableThreshold = hasFlag("disable-threshold-exec");

	if (!revokeCircuits && !cancelMpc && !disableThreshold) {
		console.log(
			JSON.stringify(
				{
					status: "no-op",
					message:
						"No containment actions selected. Use --revoke-zk-circuits, --cancel-mpc, and/or --disable-threshold-exec. Add --execute to apply.",
				},
				null,
				2,
			),
		);
		return;
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const actions = [];
		if (revokeCircuits) {
			const result = await client.query(
				`UPDATE zk_circuit_registry
				 SET governance_status = 'revoked',
					 updated_at = NOW()
				 WHERE governance_status IN ('active', 'deprecated')
				 RETURNING id`,
			);
			actions.push({ action: "revoke-zk-circuits", affectedRows: result.rowCount });
		}

		if (cancelMpc) {
			const result = await client.query(
				`UPDATE mpc_quorum_sessions
				 SET status = 'cancelled'
				 WHERE status IN ('pending', 'ready')
				 RETURNING id`,
			);
			actions.push({ action: "cancel-mpc", affectedRows: result.rowCount });
		}

		if (disableThreshold) {
			const result = await client.query(
				`UPDATE threshold_operations
				 SET status = 'cancelled',
					 updated_at = NOW()
				 WHERE status IN ('pending', 'approved')
				 RETURNING id`,
			);
			actions.push({ action: "disable-threshold-exec", affectedRows: result.rowCount });
		}

		if (execute) {
			await client.query("COMMIT");
		} else {
			await client.query("ROLLBACK");
		}

		console.log(
			JSON.stringify(
				{
					status: execute ? "applied" : "dry-run",
					actions,
				},
				null,
				2,
			),
		);
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Incident containment playbook failed:", error.message || String(error));
		process.exit(1);
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error("Incident containment playbook failed:", error.message || String(error));
	process.exit(1);
});
