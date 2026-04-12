#!/usr/bin/env node

require("dotenv").config();

const crypto = require("crypto");
const pool = require("../db/connection");
const { encryptEnvelope } = require("../utils/vaultEnvelope");

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

function sha3(value) {
	return crypto
		.createHash("sha3-256")
		.update(String(value || ""))
		.digest("hex");
}

async function main() {
	const chainScope = parseArg("chain-scope", process.env.SECURITY_ARCHIVE_CHAIN_SCOPE || "");
	const olderThanHours = parseIntArg("older-than-hours", process.env.SECURITY_ARCHIVE_OLDER_THAN_HOURS || 24, 1, 24 * 365);
	const limit = parseIntArg("limit", process.env.SECURITY_ARCHIVE_LIMIT || 500, 1, 5000);
	const dryRun = ["1", "true", "yes"].includes(String(parseArg("dry-run", "false")).toLowerCase());

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const scopeClause = chainScope ? "AND l.chain_scope = $3" : "";
		const params = chainScope ? [olderThanHours, limit, chainScope] : [olderThanHours, limit];
		const candidates = await client.query(
			`SELECT l.*
			 FROM security_event_ledger l
			 LEFT JOIN security_event_ledger_archive a ON a.original_id = l.id
			 WHERE a.id IS NULL
			   AND l.occurred_at <= NOW() - ($1::int * INTERVAL '1 hour')
			   ${scopeClause}
			 ORDER BY l.id ASC
			 LIMIT $2`,
			params,
		);

		if (dryRun) {
			await client.query("ROLLBACK");
			console.log(
				JSON.stringify(
					{
						status: "dry-run",
						chainScope: chainScope || "all",
						olderThanHours,
						limit,
						candidateRows: candidates.rows.length,
					},
					null,
					2,
				),
			);
			return;
		}

		let archived = 0;
		for (const row of candidates.rows) {
			const sensitivePayload = JSON.stringify({
				payloadCanonical: row.payload_canonical,
				eventPayload: row.event_payload || {},
			});
			const envelope = encryptEnvelope(sensitivePayload, {
				context: `security-ledger-archive|${row.chain_scope}|${row.id}`,
			});
			const encryptedPayload = JSON.stringify(envelope);
			const ciphertextHash = sha3(encryptedPayload);

			const inserted = await client.query(
				`INSERT INTO security_event_ledger_archive (
					original_id,
					chain_scope,
					event_type,
					service_name,
					actor_type,
					actor_id,
					correlation_id,
					prev_hash,
					event_hash,
					payload_canonical,
					event_payload,
					encrypted_payload,
					envelope_key_id,
					envelope_version,
					ciphertext_hash,
					occurred_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16)
				ON CONFLICT (original_id) DO NOTHING
				RETURNING id`,
				[
					row.id,
					row.chain_scope,
					row.event_type,
					row.service_name,
					row.actor_type,
					row.actor_id,
					row.correlation_id,
					row.prev_hash,
					row.event_hash,
					"[vault-encrypted]",
					"{}",
					encryptedPayload,
					envelope.kekId,
					envelope.version,
					ciphertextHash,
					row.occurred_at,
				],
			);

			if (inserted.rowCount > 0) {
				archived += 1;
			}
		}

		await client.query("COMMIT");
		console.log(
			JSON.stringify(
				{
					status: "success",
					chainScope: chainScope || "all",
					olderThanHours,
					limit,
					candidateRows: candidates.rows.length,
					archivedRows: archived,
				},
				null,
				2,
			),
		);
	} catch (error) {
		await client.query("ROLLBACK");
		console.error("Security ledger archive job failed:", error.message || String(error));
		process.exit(1);
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error("Security ledger archive job failed:", error.message || String(error));
	process.exit(1);
});
