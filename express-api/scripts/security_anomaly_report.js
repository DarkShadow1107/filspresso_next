#!/usr/bin/env node

require("dotenv").config();

const pool = require("../db/connection");

function parseArg(name, fallback = "") {
	const prefix = `--${name}=`;
	const arg = process.argv.find((entry) => entry.startsWith(prefix));
	if (!arg) return fallback;
	return String(arg.slice(prefix.length)).trim();
}

function parseIntArg(name, fallback, min, max) {
	const raw = parseArg(name, "");
	const parsed = Number.parseInt(raw || String(fallback), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(parsed, min), max);
}

function severityFromMetrics(metrics) {
	if (metrics.zkVerificationFailures >= 3 || metrics.mpcStalledSessions >= 3) return "critical";
	if (metrics.policyDenials >= 10 || metrics.zkPendingVerifications >= 10 || metrics.thresholdExpired >= 2) return "high";
	if (metrics.policyDenials >= 3 || metrics.mpcReadyBacklog >= 1) return "medium";
	return "low";
}

async function main() {
	const windowMinutes = parseIntArg("window-minutes", process.env.SECURITY_ANOMALY_WINDOW_MINUTES || 60, 5, 24 * 60);
	const mpcStaleMinutes = parseIntArg("mpc-stale-minutes", process.env.MPC_STALE_MINUTES || 30, 5, 24 * 60);
	const failOn = String(parseArg("fail-on", process.env.SECURITY_ANOMALY_FAIL_ON || "critical")).toLowerCase();

	const client = await pool.connect();
	try {
		const policyDenialsResult = await client.query(
			`SELECT COUNT(*)::int AS count
			 FROM security_event_ledger
			 WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 minute')
			   AND (
					event_type ILIKE 'policy.%deny%'
					OR event_type ILIKE 'auth.%deny%'
					OR event_type ILIKE 'opa.%deny%'
			   )`,
			[windowMinutes],
		);

		const zkFailuresResult = await client.query(
			`SELECT
				COUNT(*) FILTER (WHERE verified = FALSE)::int AS pending_or_failed,
				COUNT(*) FILTER (WHERE verified = FALSE AND created_at <= NOW() - INTERVAL '15 minutes')::int AS stale_failures
			 FROM zk_proof_sessions
			 WHERE created_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
			[windowMinutes],
		);

		const mpcResult = await client.query(
			`SELECT
				COUNT(*) FILTER (WHERE status IN ('pending', 'ready') AND created_at <= NOW() - ($1::int * INTERVAL '1 minute'))::int AS stalled,
				COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_backlog,
				COUNT(*) FILTER (WHERE status IN ('cancelled', 'expired') AND created_at >= NOW() - ($2::int * INTERVAL '1 minute'))::int AS quorum_failures
			 FROM mpc_quorum_sessions`,
			[mpcStaleMinutes, windowMinutes],
		);

		const thresholdResult = await client.query(
			`SELECT COUNT(*)::int AS expired
			 FROM threshold_operations
			 WHERE status IN ('expired', 'rejected')
			   AND updated_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
			[windowMinutes],
		);

		const metrics = {
			policyDenials: Number(policyDenialsResult.rows[0]?.count || 0),
			zkPendingVerifications: Number(zkFailuresResult.rows[0]?.pending_or_failed || 0),
			zkVerificationFailures: Number(zkFailuresResult.rows[0]?.stale_failures || 0),
			mpcStalledSessions: Number(mpcResult.rows[0]?.stalled || 0),
			mpcReadyBacklog: Number(mpcResult.rows[0]?.ready_backlog || 0),
			mpcQuorumFailures: Number(mpcResult.rows[0]?.quorum_failures || 0),
			thresholdExpired: Number(thresholdResult.rows[0]?.expired || 0),
		};

		const severity = severityFromMetrics(metrics);
		const report = {
			generatedAt: new Date().toISOString(),
			windowMinutes,
			mpcStaleMinutes,
			severity,
			metrics,
		};

		console.log(JSON.stringify(report, null, 2));

		const severityOrder = ["low", "medium", "high", "critical"];
		if (severityOrder.indexOf(severity) >= severityOrder.indexOf(failOn)) {
			process.exitCode = 2;
		}
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error("Security anomaly report failed:", error.message || String(error));
	process.exit(1);
});
