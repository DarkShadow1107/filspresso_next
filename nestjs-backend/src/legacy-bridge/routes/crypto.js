const express = require("express");
const crypto = require("crypto");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");
const { getEnvOrFile } = require("../utils/secrets");
const { issueServiceAssertion } = require("../utils/serviceAssertions");
const { assertAllowedEgress } = require("../utils/egressPolicy");
const { requireOperationReplayGuard } = require("../utils/replayGuard");
const { assertServiceContract } = require("../utils/serviceContracts");
const { appendSecurityLedgerEvent } = require("../utils/securityLedger");

const router = express.Router();
const RUST_CRYPTO_URL = String(process.env.RUST_CRYPTO_URL || "http://localhost:8090").trim();
const RUST_CRYPTO_TIMEOUT_MS = Math.min(
	Math.max(Number.parseInt(process.env.RUST_CRYPTO_TIMEOUT_MS || "4000", 10) || 4000, 1000),
	15000,
);
const RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION =
	String(process.env.RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION || "true")
		.trim()
		.toLowerCase() === "true";
const RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_COMMITMENT =
	String(process.env.RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_COMMITMENT || "service-crypto:commitment").trim() ||
	"service-crypto:commitment";
const RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_VERIFY =
	String(process.env.RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_VERIFY || "service-crypto:verify").trim() || "service-crypto:verify";
const SERVICE_ASSERTION_PRIVATE_KEY = getEnvOrFile("SERVICE_ASSERTION_PRIVATE_KEY", { required: false, defaultValue: "" });
const SERVICE_ASSERTION_ISSUER = String(process.env.SERVICE_ASSERTION_ISSUER || "filspresso-backend").trim();
const SERVICE_ASSERTION_SUBJECT = String(process.env.SERVICE_ASSERTION_SUBJECT || "backend").trim();
const SERVICE_ASSERTION_TTL_SECONDS = Math.min(
	Math.max(Number.parseInt(process.env.SERVICE_ASSERTION_TTL_SECONDS || "120", 10) || 120, 30),
	600,
);
const THRESHOLD_DEFAULT_APPROVALS = Math.min(
	Math.max(Number.parseInt(process.env.CRYPTO_THRESHOLD_DEFAULT_APPROVALS || "2", 10) || 2, 2),
	5,
);
const MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE = Math.min(
	Math.max(Number.parseInt(process.env.MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE || "30", 10) || 30, 5),
	300,
);
const ZK_MAX_WITNESS_BYTES = Math.min(
	Math.max(Number.parseInt(process.env.ZK_MAX_WITNESS_BYTES || "65536", 10) || 65536, 1024),
	5 * 1024 * 1024,
);

assertAllowedEgress(RUST_CRYPTO_URL, "RUST_CRYPTO_URL");

function requireAdminUser(req, res) {
	if (!req.user || String(req.user.role || "").toLowerCase() !== "admin") {
		res.status(403).json({ error: "Admin role is required" });
		return false;
	}

	return true;
}

function createRustCryptoServiceAssertion(scope, operationId = "") {
	if (!SERVICE_ASSERTION_PRIVATE_KEY) {
		return "";
	}

	try {
		const issued = issueServiceAssertion({
			privateKeyPem: SERVICE_ASSERTION_PRIVATE_KEY,
			issuer: SERVICE_ASSERTION_ISSUER,
			subject: SERVICE_ASSERTION_SUBJECT,
			scope,
			ttlSeconds: SERVICE_ASSERTION_TTL_SECONDS,
			operationId,
			keyPurpose: "service_assertion_signing",
			operationType: "issue_service_assertion",
		});
		return issued.token;
	} catch (error) {
		console.warn("Failed to issue rust-crypto service assertion:", error.message || String(error));
		return "";
	}
}

function buildRustCryptoUpstreamHeaders(scope, operationId = "") {
	const serviceAssertion = createRustCryptoServiceAssertion(scope, operationId);
	if (RUST_CRYPTO_REQUIRE_SERVICE_ASSERTION && !serviceAssertion) {
		return null;
	}

	const headers = {
		"x-service-name": "filspresso-backend",
		"x-operation-id": operationId,
	};

	if (serviceAssertion) {
		headers["x-service-assertion"] = serviceAssertion;
	}

	return headers;
}

function toThresholdOperationResponse(row) {
	if (!row) return null;
	return {
		id: row.id,
		operationId: row.operation_id,
		operationType: row.operation_type,
		status: row.status,
		requiredApprovals: row.required_approvals,
		createdBy: row.created_by,
		executedBy: row.executed_by,
		approvedAt: row.approved_at,
		executedAt: row.executed_at,
		expiresAt: row.expires_at,
		payload: row.payload,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function stableSort(input) {
	if (Array.isArray(input)) {
		return input.map((item) => stableSort(item));
	}

	if (!input || typeof input !== "object") {
		return input;
	}

	const ordered = {};
	for (const key of Object.keys(input).sort()) {
		ordered[key] = stableSort(input[key]);
	}
	return ordered;
}

function canonicalJson(value) {
	const safe = value && typeof value === "object" ? value : {};
	return JSON.stringify(stableSort(safe));
}

function sha3Hex(value) {
	return crypto
		.createHash("sha3-256")
		.update(String(value || ""))
		.digest("hex");
}

function signTranscriptPayload(payload) {
	if (!SERVICE_ASSERTION_PRIVATE_KEY) {
		return "";
	}

	try {
		const canonical = canonicalJson(payload);
		return crypto
			.sign(null, Buffer.from(canonical, "utf8"), crypto.createPrivateKey(SERVICE_ASSERTION_PRIVATE_KEY))
			.toString("base64url");
	} catch (error) {
		console.warn("Failed to sign MPC transcript payload:", error.message || String(error));
		return "";
	}
}

async function appendMpcTranscript(client, options) {
	const payload = options.payload && typeof options.payload === "object" ? options.payload : {};
	const signature = signTranscriptPayload(payload);

	await client.query(
		`INSERT INTO mpc_quorum_transcripts (
			session_id,
			participant_account_id,
			event_type,
			event_payload,
			signature
		)
		VALUES ($1, $2, $3, $4::jsonb, $5)`,
		[
			options.sessionId,
			options.participantAccountId || null,
			String(options.eventType || "mpc.event").slice(0, 48),
			JSON.stringify(payload),
			signature || null,
		],
	);
}

function buildProofHash({ verificationKeyHash, witnessHash, publicInputsCanonical }) {
	const publicInputsHash = sha3Hex(publicInputsCanonical);
	return sha3Hex(`${verificationKeyHash}|${witnessHash}|${publicInputsHash}`);
}

async function enforceMpcTranscriptRateLimit(client, accountId) {
	const result = await client.query(
		`SELECT COUNT(*)::int AS count
		 FROM mpc_quorum_transcripts
		 WHERE participant_account_id = $1
		   AND created_at > NOW() - INTERVAL '1 minute'`,
		[accountId],
	);

	const count = Number(result.rows[0]?.count || 0);
	if (count >= MPC_TRANSCRIPT_RATE_LIMIT_PER_MINUTE) {
		const error = new Error("MPC transcript rate limit exceeded");
		error.statusCode = 429;
		throw error;
	}
}

async function callRustCrypto(pathname, payload, options = {}) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), RUST_CRYPTO_TIMEOUT_MS);

	try {
		const response = await fetch(`${RUST_CRYPTO_URL}${pathname}`, {
			method: payload ? "POST" : "GET",
			headers: {
				Accept: "application/json",
				...(payload ? { "Content-Type": "application/json" } : {}),
				...(options.headers || {}),
			},
			body: payload ? JSON.stringify(payload) : undefined,
			signal: controller.signal,
		});

		const text = await response.text();
		let data = null;
		if (text) {
			try {
				data = JSON.parse(text);
			} catch {
				data = { raw: text };
			}
		}

		return { ok: response.ok, status: response.status, data };
	} finally {
		clearTimeout(timeout);
	}
}

router.get("/health", async (req, res) => {
	try {
		const upstream = await callRustCrypto("/health");
		if (!upstream.ok) {
			return res.status(502).json({ error: "Rust crypto service unavailable", upstream });
		}

		return res.json({ upstream: upstream.data || {} });
	} catch (error) {
		console.error("Rust crypto health error:", error);
		return res.status(502).json({ error: "Failed to reach rust crypto service" });
	}
});

router.post(
	"/commitment",
	authenticate,
	requireOperationReplayGuard({ scope: "crypto-commitment", ttlSeconds: 900 }),
	async (req, res) => {
		try {
			const domain = String(req.body?.domain || "").trim();
			const payload = typeof req.body?.payload === "string" ? req.body.payload : undefined;
			const payloadJson =
				req.body?.payload_json && typeof req.body.payload_json === "object" ? req.body.payload_json : undefined;
			const operationId = String(req.operationId || "").trim();

			if (!domain) {
				return res.status(400).json({ error: "domain is required" });
			}

			const upstreamHeaders = buildRustCryptoUpstreamHeaders(RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_COMMITMENT, operationId);
			if (!upstreamHeaders) {
				return res.status(500).json({ error: "Rust crypto service assertion is required but could not be issued" });
			}

			const commitmentRequest = {
				domain,
				payload,
				payload_json: payloadJson,
				operation_id: operationId,
			};
			assertServiceContract("rust_commitment_request_v1", commitmentRequest);

			const upstream = await callRustCrypto("/v1/commitment/sha3-256", commitmentRequest, {
				headers: upstreamHeaders,
			});

			if (!upstream.ok) {
				return res.status(502).json({ error: "Rust crypto commitment failed", upstream: upstream.data });
			}

			assertServiceContract("rust_commitment_response_v1", upstream.data || {});

			return res.json({ operationId, commitment: upstream.data });
		} catch (error) {
			console.error("Rust crypto commitment error:", error);
			return res.status(500).json({ error: "Failed to compute commitment" });
		}
	},
);

router.post(
	"/verify",
	authenticate,
	requireOperationReplayGuard({ scope: "crypto-verify", ttlSeconds: 900 }),
	async (req, res) => {
		try {
			const domain = String(req.body?.domain || "").trim();
			const commitment = String(req.body?.commitment_sha3_256 || "")
				.trim()
				.toLowerCase();
			const payload = typeof req.body?.payload === "string" ? req.body.payload : undefined;
			const payloadJson =
				req.body?.payload_json && typeof req.body.payload_json === "object" ? req.body.payload_json : undefined;
			const operationId = String(req.operationId || "").trim();

			if (!domain || !commitment) {
				return res.status(400).json({ error: "domain and commitment_sha3_256 are required" });
			}

			const upstreamHeaders = buildRustCryptoUpstreamHeaders(RUST_CRYPTO_SERVICE_ASSERTION_SCOPE_VERIFY, operationId);
			if (!upstreamHeaders) {
				return res.status(500).json({ error: "Rust crypto service assertion is required but could not be issued" });
			}

			const verifyRequest = {
				domain,
				payload,
				payload_json: payloadJson,
				commitment_sha3_256: commitment,
				operation_id: operationId,
			};
			assertServiceContract("rust_verify_request_v1", verifyRequest);

			const upstream = await callRustCrypto("/v1/verify/sha3-256", verifyRequest, {
				headers: upstreamHeaders,
			});

			if (!upstream.ok) {
				return res.status(502).json({ error: "Rust crypto verification failed", upstream: upstream.data });
			}

			assertServiceContract("rust_verify_response_v1", upstream.data || {});

			return res.json({ operationId, verification: upstream.data });
		} catch (error) {
			console.error("Rust crypto verify error:", error);
			return res.status(500).json({ error: "Failed to verify commitment" });
		}
	},
);

router.post(
	"/threshold/operations",
	authenticate,
	requireOperationReplayGuard({ scope: "crypto-threshold-initiate", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const operationType = String(req.body?.operation_type || req.body?.operationType || "").trim();
		if (!operationType) {
			return res.status(400).json({ error: "operation_type is required" });
		}

		const requiredApprovalsRaw = Number.parseInt(
			req.body?.required_approvals || req.body?.requiredApprovals || THRESHOLD_DEFAULT_APPROVALS,
			10,
		);
		const requiredApprovals = Math.min(Math.max(requiredApprovalsRaw || THRESHOLD_DEFAULT_APPROVALS, 2), 5);
		const expiresInSecondsRaw = Number.parseInt(req.body?.expires_in_seconds || req.body?.expiresInSeconds || "1800", 10);
		const expiresInSeconds = Math.min(Math.max(expiresInSecondsRaw || 1800, 300), 86400);
		const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};

		const operationId = String(req.operationId || "").trim();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const inserted = await client.query(
				`INSERT INTO threshold_operations (
					operation_id,
					operation_type,
					payload,
					required_approvals,
					created_by,
					expires_at
				)
				VALUES ($1, $2, $3::jsonb, $4, $5, NOW() + (($6)::text || ' seconds')::interval)
				RETURNING *`,
				[
					operationId,
					operationType.slice(0, 64),
					JSON.stringify(payload),
					requiredApprovals,
					req.user.id,
					expiresInSeconds,
				],
			);
			const operationRow = inserted.rows[0];

			await client.query(
				`INSERT INTO threshold_operation_approvals (threshold_operation_id, account_id, operation_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (threshold_operation_id, account_id) DO NOTHING`,
				[operationRow.id, req.user.id, operationId],
			);

			const approvalCountResult = await client.query(
				"SELECT COUNT(*)::int AS count FROM threshold_operation_approvals WHERE threshold_operation_id = $1",
				[operationRow.id],
			);
			const approvals = Number(approvalCountResult.rows[0]?.count || 0);

			let resolvedOperation = operationRow;
			if (approvals >= operationRow.required_approvals) {
				const approved = await client.query(
					`UPDATE threshold_operations
					 SET status = 'approved', approved_at = NOW(), updated_at = NOW()
					 WHERE id = $1
					 RETURNING *`,
					[operationRow.id],
				);
				resolvedOperation = approved.rows[0] || operationRow;
			}

			await client.query("COMMIT");
			return res.status(201).json({
				status: "success",
				operation: toThresholdOperationResponse(resolvedOperation),
				approvals,
			});
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("Threshold operation create error:", error);
			return res.status(500).json({ error: "Failed to create threshold operation" });
		} finally {
			client.release();
		}
	},
);

router.post(
	"/threshold/operations/:id/approve",
	authenticate,
	requireOperationReplayGuard({ scope: "crypto-threshold-approve", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const thresholdOperationId = Number.parseInt(req.params.id, 10);
		if (!Number.isInteger(thresholdOperationId) || thresholdOperationId <= 0) {
			return res.status(400).json({ error: "Invalid threshold operation id" });
		}

		const actionOperationId = String(req.operationId || "").trim();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const operationResult = await client.query("SELECT * FROM threshold_operations WHERE id = $1 FOR UPDATE", [
				thresholdOperationId,
			]);
			const operationRow = operationResult.rows[0];
			if (!operationRow) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Threshold operation not found" });
			}

			if (["cancelled", "rejected", "executed"].includes(String(operationRow.status))) {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: `Operation is already ${operationRow.status}` });
			}

			if (operationRow.expires_at && new Date(operationRow.expires_at).getTime() <= Date.now()) {
				await client.query("UPDATE threshold_operations SET status = 'expired', updated_at = NOW() WHERE id = $1", [
					thresholdOperationId,
				]);
				await client.query("COMMIT");
				return res.status(409).json({ error: "Operation is expired" });
			}

			const approvalInsert = await client.query(
				`INSERT INTO threshold_operation_approvals (threshold_operation_id, account_id, operation_id)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (threshold_operation_id, account_id) DO NOTHING
				 RETURNING id`,
				[thresholdOperationId, req.user.id, actionOperationId],
			);

			const approvalCountResult = await client.query(
				"SELECT COUNT(*)::int AS count FROM threshold_operation_approvals WHERE threshold_operation_id = $1",
				[thresholdOperationId],
			);
			const approvals = Number(approvalCountResult.rows[0]?.count || 0);

			let resolvedOperation = operationRow;
			if (
				String(operationRow.status) === "pending" &&
				approvals >= Number(operationRow.required_approvals || THRESHOLD_DEFAULT_APPROVALS)
			) {
				const approved = await client.query(
					`UPDATE threshold_operations
					 SET status = 'approved', approved_at = COALESCE(approved_at, NOW()), updated_at = NOW()
					 WHERE id = $1
					 RETURNING *`,
					[thresholdOperationId],
				);
				resolvedOperation = approved.rows[0] || operationRow;
			}

			await client.query("COMMIT");
			return res.json({
				status: "success",
				operation: toThresholdOperationResponse(resolvedOperation),
				approvals,
				alreadyApproved: approvalInsert.rowCount === 0,
			});
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("Threshold operation approve error:", error);
			return res.status(500).json({ error: "Failed to approve threshold operation" });
		} finally {
			client.release();
		}
	},
);

router.post(
	"/threshold/operations/:id/execute",
	authenticate,
	requireOperationReplayGuard({ scope: "crypto-threshold-execute", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const thresholdOperationId = Number.parseInt(req.params.id, 10);
		if (!Number.isInteger(thresholdOperationId) || thresholdOperationId <= 0) {
			return res.status(400).json({ error: "Invalid threshold operation id" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const operationResult = await client.query("SELECT * FROM threshold_operations WHERE id = $1 FOR UPDATE", [
				thresholdOperationId,
			]);
			let operationRow = operationResult.rows[0];
			if (!operationRow) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Threshold operation not found" });
			}

			if (["executed", "cancelled", "rejected"].includes(String(operationRow.status))) {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: `Operation is already ${operationRow.status}` });
			}

			if (operationRow.expires_at && new Date(operationRow.expires_at).getTime() <= Date.now()) {
				await client.query("UPDATE threshold_operations SET status = 'expired', updated_at = NOW() WHERE id = $1", [
					thresholdOperationId,
				]);
				await client.query("COMMIT");
				return res.status(409).json({ error: "Operation is expired" });
			}

			if (String(operationRow.status) === "pending") {
				const approvalCountResult = await client.query(
					"SELECT COUNT(*)::int AS count FROM threshold_operation_approvals WHERE threshold_operation_id = $1",
					[thresholdOperationId],
				);
				const approvals = Number(approvalCountResult.rows[0]?.count || 0);
				if (approvals >= Number(operationRow.required_approvals || THRESHOLD_DEFAULT_APPROVALS)) {
					const approved = await client.query(
						`UPDATE threshold_operations
						 SET status = 'approved', approved_at = COALESCE(approved_at, NOW()), updated_at = NOW()
						 WHERE id = $1
						 RETURNING *`,
						[thresholdOperationId],
					);
					operationRow = approved.rows[0] || operationRow;
				}
			}

			if (String(operationRow.status) !== "approved") {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: "Operation is not approved" });
			}

			const executed = await client.query(
				`UPDATE threshold_operations
				 SET status = 'executed',
					 executed_at = NOW(),
					 executed_by = $2,
					 updated_at = NOW()
				 WHERE id = $1
				 RETURNING *`,
				[thresholdOperationId, req.user.id],
			);

			await client.query("COMMIT");
			return res.json({ status: "success", operation: toThresholdOperationResponse(executed.rows[0]) });
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("Threshold operation execute error:", error);
			return res.status(500).json({ error: "Failed to execute threshold operation" });
		} finally {
			client.release();
		}
	},
);

router.get("/threshold/operations/:id", authenticate, async (req, res) => {
	if (!requireAdminUser(req, res)) return;

	const thresholdOperationId = Number.parseInt(req.params.id, 10);
	if (!Number.isInteger(thresholdOperationId) || thresholdOperationId <= 0) {
		return res.status(400).json({ error: "Invalid threshold operation id" });
	}

	try {
		const operationResult = await pool.query("SELECT * FROM threshold_operations WHERE id = $1", [thresholdOperationId]);
		const operation = operationResult.rows[0];
		if (!operation) {
			return res.status(404).json({ error: "Threshold operation not found" });
		}

		const approvals = await pool.query(
			`SELECT a.account_id, acc.username, a.created_at
			 FROM threshold_operation_approvals a
			 JOIN accounts acc ON acc.id = a.account_id
			 WHERE a.threshold_operation_id = $1
			 ORDER BY a.created_at ASC`,
			[thresholdOperationId],
		);

		return res.json({
			status: "success",
			operation: toThresholdOperationResponse(operation),
			approvals: approvals.rows,
		});
	} catch (error) {
		console.error("Threshold operation lookup error:", error);
		return res.status(500).json({ error: "Failed to fetch threshold operation" });
	}
});

router.post(
	"/zk/circuits/register",
	authenticate,
	requireOperationReplayGuard({ scope: "zk-circuit-register", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const circuitName = String(req.body?.circuitName || "")
			.trim()
			.slice(0, 96);
		const circuitVersion = String(req.body?.circuitVersion || "")
			.trim()
			.slice(0, 32);
		const verificationKey = String(req.body?.verificationKey || "").trim();
		const governanceStatus = String(req.body?.governanceStatus || "proposed")
			.trim()
			.toLowerCase();

		if (!circuitName || !circuitVersion || !verificationKey) {
			return res.status(400).json({ error: "circuitName, circuitVersion, and verificationKey are required" });
		}

		if (!["proposed", "active", "deprecated", "revoked"].includes(governanceStatus)) {
			return res.status(400).json({ error: "governanceStatus must be proposed|active|deprecated|revoked" });
		}

		try {
			const verificationKeyHash = sha3Hex(verificationKey);
			const result = await pool.query(
				`INSERT INTO zk_circuit_registry (
					circuit_name,
					circuit_version,
					governance_status,
					verification_key,
					verification_key_hash,
					created_by
				)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (circuit_name, circuit_version)
				DO UPDATE SET
					governance_status = EXCLUDED.governance_status,
					verification_key = EXCLUDED.verification_key,
					verification_key_hash = EXCLUDED.verification_key_hash,
					updated_at = NOW()
				RETURNING *`,
				[circuitName, circuitVersion, governanceStatus, verificationKey, verificationKeyHash, req.user.id],
			);

			return res.status(201).json({
				status: "success",
				circuit: result.rows[0],
			});
		} catch (error) {
			console.error("ZK circuit register error:", error);
			return res.status(500).json({ error: "Failed to register circuit" });
		}
	},
);

router.post(
	"/zk/circuits/:id/status",
	authenticate,
	requireOperationReplayGuard({ scope: "zk-circuit-status", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const id = Number.parseInt(req.params.id, 10);
		const nextStatus = String(req.body?.status || "")
			.trim()
			.toLowerCase();
		if (!Number.isInteger(id) || id <= 0) {
			return res.status(400).json({ error: "Invalid circuit id" });
		}
		if (!["proposed", "active", "deprecated", "revoked"].includes(nextStatus)) {
			return res.status(400).json({ error: "status must be proposed|active|deprecated|revoked" });
		}

		const transitions = {
			proposed: ["active", "revoked"],
			active: ["deprecated", "revoked"],
			deprecated: ["revoked"],
			revoked: [],
		};

		try {
			const current = await pool.query("SELECT * FROM zk_circuit_registry WHERE id = $1", [id]);
			const row = current.rows[0];
			if (!row) {
				return res.status(404).json({ error: "Circuit not found" });
			}

			const currentStatus = String(row.governance_status || "proposed");
			if (currentStatus !== nextStatus && !(transitions[currentStatus] || []).includes(nextStatus)) {
				return res.status(409).json({ error: `Invalid governance transition from ${currentStatus} to ${nextStatus}` });
			}

			const updated = await pool.query(
				"UPDATE zk_circuit_registry SET governance_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
				[id, nextStatus],
			);

			return res.json({ status: "success", circuit: updated.rows[0] });
		} catch (error) {
			console.error("ZK circuit status update error:", error);
			return res.status(500).json({ error: "Failed to update circuit governance status" });
		}
	},
);

router.post(
	"/zk/proofs/generate",
	authenticate,
	requireOperationReplayGuard({ scope: "zk-proof-generate", ttlSeconds: 1800 }),
	async (req, res) => {
		const circuitName = String(req.body?.circuitName || "")
			.trim()
			.slice(0, 96);
		const circuitVersion = String(req.body?.circuitVersion || "")
			.trim()
			.slice(0, 32);
		if (!circuitName || !circuitVersion) {
			return res.status(400).json({ error: "circuitName and circuitVersion are required" });
		}

		const witness = req.body?.witness;
		const publicInputs = req.body?.publicInputs && typeof req.body.publicInputs === "object" ? req.body.publicInputs : {};

		const witnessCanonical = typeof witness === "string" ? witness : canonicalJson(witness || {});
		if (Buffer.byteLength(witnessCanonical, "utf8") > ZK_MAX_WITNESS_BYTES) {
			return res.status(413).json({ error: "Witness payload is too large" });
		}

		try {
			const circuit = await pool.query(
				`SELECT * FROM zk_circuit_registry
				 WHERE circuit_name = $1
				   AND circuit_version = $2
				   AND governance_status = 'active'
				 LIMIT 1`,
				[circuitName, circuitVersion],
			);
			const circuitRow = circuit.rows[0];
			if (!circuitRow) {
				return res.status(404).json({ error: "Active circuit version not found" });
			}

			const witnessHash = sha3Hex(witnessCanonical);
			const publicInputsCanonical = canonicalJson(publicInputs);
			const proofHash = buildProofHash({
				verificationKeyHash: circuitRow.verification_key_hash,
				witnessHash,
				publicInputsCanonical,
			});

			const typedEvent = {
				eventType: String(req.body?.typedEventType || "zk.proof.verified"),
				operationId: String(req.operationId || ""),
				circuit: { name: circuitName, version: circuitVersion },
				proofHash,
			};

			const created = await pool.query(
				`INSERT INTO zk_proof_sessions (
					operation_id,
					account_id,
					circuit_name,
					circuit_version,
					public_inputs,
					witness_hash,
					proof_hash,
					typed_event
				)
				VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
				RETURNING *`,
				[
					String(req.operationId || ""),
					req.user.id,
					circuitName,
					circuitVersion,
					JSON.stringify(publicInputs),
					witnessHash,
					proofHash,
					JSON.stringify(typedEvent),
				],
			);

			return res.status(201).json({
				status: "success",
				proof: created.rows[0],
			});
		} catch (error) {
			console.error("ZK proof generation error:", error);
			return res.status(500).json({ error: "Failed to generate proof" });
		}
	},
);

router.post(
	"/zk/proofs/:id/verify",
	authenticate,
	requireOperationReplayGuard({ scope: "zk-proof-verify", ttlSeconds: 1800 }),
	async (req, res) => {
		const id = Number.parseInt(req.params.id, 10);
		if (!Number.isInteger(id) || id <= 0) {
			return res.status(400).json({ error: "Invalid proof id" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const proofResult = await client.query("SELECT * FROM zk_proof_sessions WHERE id = $1 FOR UPDATE", [id]);
			const proofRow = proofResult.rows[0];
			if (!proofRow) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Proof session not found" });
			}

			const circuitResult = await client.query(
				`SELECT * FROM zk_circuit_registry
				 WHERE circuit_name = $1
				   AND circuit_version = $2
				 LIMIT 1`,
				[proofRow.circuit_name, proofRow.circuit_version],
			);
			const circuitRow = circuitResult.rows[0];
			if (!circuitRow) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Circuit for proof session not found" });
			}

			const publicInputsCanonical = canonicalJson(proofRow.public_inputs || {});
			const expectedProofHash = buildProofHash({
				verificationKeyHash: circuitRow.verification_key_hash,
				witnessHash: proofRow.witness_hash,
				publicInputsCanonical,
			});

			const valid = expectedProofHash === String(proofRow.proof_hash || "");
			if (valid) {
				await client.query("UPDATE zk_proof_sessions SET verified = TRUE, verified_at = NOW() WHERE id = $1", [id]);

				await appendSecurityLedgerEvent(client, {
					chainScope: "zk-proof",
					eventType: "zk.proof.verified",
					serviceName: "backend",
					actorType: "user",
					actorId: String(req.user.id),
					correlationId: String(req.operationId || ""),
					payload: {
						proofSessionId: id,
						circuitName: proofRow.circuit_name,
						circuitVersion: proofRow.circuit_version,
						typedEvent: proofRow.typed_event || {},
					},
				});
			}

			await client.query("COMMIT");
			return res.json({
				status: "success",
				valid,
				expectedProofHash,
				proofHash: proofRow.proof_hash,
				typedEvent: proofRow.typed_event,
			});
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("ZK proof verification error:", error);
			return res.status(500).json({ error: "Failed to verify proof" });
		} finally {
			client.release();
		}
	},
);

router.get("/zk/proofs/:id", authenticate, async (req, res) => {
	const id = Number.parseInt(req.params.id, 10);
	if (!Number.isInteger(id) || id <= 0) {
		return res.status(400).json({ error: "Invalid proof id" });
	}

	try {
		const result = await pool.query("SELECT * FROM zk_proof_sessions WHERE id = $1", [id]);
		const row = result.rows[0];
		if (!row) {
			return res.status(404).json({ error: "Proof session not found" });
		}
		return res.json({ status: "success", proof: row });
	} catch (error) {
		console.error("ZK proof lookup error:", error);
		return res.status(500).json({ error: "Failed to fetch proof session" });
	}
});

router.post(
	"/mpc/sessions",
	authenticate,
	requireOperationReplayGuard({ scope: "mpc-session-create", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const operationType = String(req.body?.operationType || req.body?.operation_type || "")
			.trim()
			.slice(0, 64);
		if (!operationType) {
			return res.status(400).json({ error: "operationType is required" });
		}

		const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
		const participantsInput = Array.isArray(req.body?.participants) ? req.body.participants : [req.user.id];
		const participants = Array.from(
			new Set(
				participantsInput
					.map((value) => Number.parseInt(value, 10))
					.filter((value) => Number.isInteger(value) && value > 0),
			),
		);
		if (participants.length === 0) {
			return res.status(400).json({ error: "participants must contain at least one account id" });
		}

		const quorumRequiredRaw = Number.parseInt(req.body?.quorumRequired || req.body?.quorum_required || "0", 10);
		const quorumRequired = Math.min(Math.max(quorumRequiredRaw || 2, 2), participants.length);

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const payloadHash = sha3Hex(canonicalJson(payload));

			const created = await client.query(
				`INSERT INTO mpc_quorum_sessions (
					operation_id,
					operation_type,
					payload_hash,
					quorum_required,
					created_by
				)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING *`,
				[String(req.operationId || ""), operationType, payloadHash, quorumRequired, req.user.id],
			);
			const session = created.rows[0];

			for (const accountId of participants) {
				await client.query(
					`INSERT INTO mpc_quorum_participants (session_id, account_id)
					 VALUES ($1, $2)
					 ON CONFLICT (session_id, account_id) DO NOTHING`,
					[session.id, accountId],
				);
			}

			await appendMpcTranscript(client, {
				sessionId: session.id,
				participantAccountId: req.user.id,
				eventType: "session.created",
				payload: {
					operationId: session.operation_id,
					operationType: session.operation_type,
					quorumRequired: session.quorum_required,
					participants,
				},
			});

			await client.query("COMMIT");
			return res.status(201).json({ status: "success", session, participants });
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("MPC session create error:", error);
			return res.status(500).json({ error: "Failed to create MPC session" });
		} finally {
			client.release();
		}
	},
);

router.post(
	"/mpc/sessions/:id/sign",
	authenticate,
	requireOperationReplayGuard({ scope: "mpc-session-sign", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const sessionId = Number.parseInt(req.params.id, 10);
		if (!Number.isInteger(sessionId) || sessionId <= 0) {
			return res.status(400).json({ error: "Invalid session id" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await enforceMpcTranscriptRateLimit(client, req.user.id);

			const sessionResult = await client.query("SELECT * FROM mpc_quorum_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
			const session = sessionResult.rows[0];
			if (!session) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "MPC session not found" });
			}
			if (["finalized", "cancelled", "expired"].includes(String(session.status))) {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: `MPC session is ${session.status}` });
			}

			const participantResult = await client.query(
				`SELECT * FROM mpc_quorum_participants
				 WHERE session_id = $1 AND account_id = $2
				 LIMIT 1`,
				[sessionId, req.user.id],
			);
			const participant = participantResult.rows[0];
			if (!participant) {
				await client.query("ROLLBACK");
				return res.status(403).json({ error: "Account is not a participant for this session" });
			}
			if (participant.signed_at) {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: "Participant already signed" });
			}

			const providedPartialSignature = String(req.body?.partialSignature || "").trim();
			const partialSignature =
				providedPartialSignature ||
				`mpc_${sha3Hex(`${session.operation_id}|${req.user.id}|${Date.now()}|${String(req.operationId || "")}`)}`;

			await client.query(
				`UPDATE mpc_quorum_participants
				 SET partial_signature = $3,
					 signed_at = NOW()
				 WHERE session_id = $1 AND account_id = $2`,
				[sessionId, req.user.id, partialSignature],
			);

			await appendMpcTranscript(client, {
				sessionId,
				participantAccountId: req.user.id,
				eventType: "participant.signed",
				payload: {
					sessionId,
					accountId: req.user.id,
					operationId: session.operation_id,
					partialSignatureHash: sha3Hex(partialSignature),
				},
			});

			const signedCountResult = await client.query(
				`SELECT COUNT(*)::int AS count
				 FROM mpc_quorum_participants
				 WHERE session_id = $1 AND signed_at IS NOT NULL`,
				[sessionId],
			);
			const signedCount = Number(signedCountResult.rows[0]?.count || 0);

			let status = String(session.status || "pending");
			if (signedCount >= Number(session.quorum_required || 2) && status !== "ready") {
				const updated = await client.query(
					"UPDATE mpc_quorum_sessions SET status = 'ready' WHERE id = $1 RETURNING status",
					[sessionId],
				);
				status = String(updated.rows[0]?.status || "ready");
			}

			await client.query("COMMIT");
			return res.json({
				status: "success",
				sessionId,
				quorumRequired: Number(session.quorum_required || 2),
				signedCount,
				sessionStatus: status,
			});
		} catch (error) {
			await client.query("ROLLBACK");
			if (error?.statusCode === 429) {
				return res.status(429).json({ error: "MPC transcript rate limit exceeded" });
			}
			console.error("MPC session sign error:", error);
			return res.status(500).json({ error: "Failed to submit MPC partial signature" });
		} finally {
			client.release();
		}
	},
);

router.post(
	"/mpc/sessions/:id/finalize",
	authenticate,
	requireOperationReplayGuard({ scope: "mpc-session-finalize", ttlSeconds: 3600 }),
	async (req, res) => {
		if (!requireAdminUser(req, res)) return;

		const sessionId = Number.parseInt(req.params.id, 10);
		if (!Number.isInteger(sessionId) || sessionId <= 0) {
			return res.status(400).json({ error: "Invalid session id" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			const sessionResult = await client.query("SELECT * FROM mpc_quorum_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
			const session = sessionResult.rows[0];
			if (!session) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "MPC session not found" });
			}
			if (String(session.status) === "finalized") {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: "MPC session already finalized" });
			}

			const signaturesResult = await client.query(
				`SELECT partial_signature
				 FROM mpc_quorum_participants
				 WHERE session_id = $1 AND signed_at IS NOT NULL
				 ORDER BY account_id ASC`,
				[sessionId],
			);
			const signatures = signaturesResult.rows.map((entry) => String(entry.partial_signature || "").trim()).filter(Boolean);
			if (signatures.length < Number(session.quorum_required || 2)) {
				await client.query("ROLLBACK");
				return res.status(409).json({ error: "Session quorum has not been reached" });
			}

			const combinedSignatureHash = sha3Hex(signatures.join("|"));
			const updated = await client.query(
				`UPDATE mpc_quorum_sessions
				 SET status = 'finalized',
					 finalized_at = NOW()
				 WHERE id = $1
				 RETURNING *`,
				[sessionId],
			);

			await appendMpcTranscript(client, {
				sessionId,
				participantAccountId: req.user.id,
				eventType: "session.finalized",
				payload: {
					sessionId,
					operationId: session.operation_id,
					combinedSignatureHash,
					signatureCount: signatures.length,
				},
			});

			await appendSecurityLedgerEvent(client, {
				chainScope: "mpc-quorum",
				eventType: "mpc.quorum.finalized",
				serviceName: "backend",
				actorType: "user",
				actorId: String(req.user.id),
				correlationId: String(req.operationId || ""),
				payload: {
					sessionId,
					operationId: session.operation_id,
					combinedSignatureHash,
					signatureCount: signatures.length,
				},
			});

			await client.query("COMMIT");
			return res.json({
				status: "success",
				session: updated.rows[0],
				combinedSignatureHash,
				signatureCount: signatures.length,
			});
		} catch (error) {
			await client.query("ROLLBACK");
			console.error("MPC session finalize error:", error);
			return res.status(500).json({ error: "Failed to finalize MPC session" });
		} finally {
			client.release();
		}
	},
);

router.get("/mpc/sessions/:id", authenticate, async (req, res) => {
	if (!requireAdminUser(req, res)) return;

	const sessionId = Number.parseInt(req.params.id, 10);
	if (!Number.isInteger(sessionId) || sessionId <= 0) {
		return res.status(400).json({ error: "Invalid session id" });
	}

	try {
		const sessionResult = await pool.query("SELECT * FROM mpc_quorum_sessions WHERE id = $1", [sessionId]);
		const session = sessionResult.rows[0];
		if (!session) {
			return res.status(404).json({ error: "MPC session not found" });
		}

		const participants = await pool.query(
			`SELECT p.account_id, a.username, p.signed_at
			 FROM mpc_quorum_participants p
			 LEFT JOIN accounts a ON a.id = p.account_id
			 WHERE p.session_id = $1
			 ORDER BY p.account_id ASC`,
			[sessionId],
		);

		const transcripts = await pool.query(
			`SELECT id, participant_account_id, event_type, created_at
			 FROM mpc_quorum_transcripts
			 WHERE session_id = $1
			 ORDER BY created_at ASC`,
			[sessionId],
		);

		return res.json({
			status: "success",
			session,
			participants: participants.rows,
			transcripts: transcripts.rows,
		});
	} catch (error) {
		console.error("MPC session lookup error:", error);
		return res.status(500).json({ error: "Failed to fetch MPC session" });
	}
});

module.exports = router;
