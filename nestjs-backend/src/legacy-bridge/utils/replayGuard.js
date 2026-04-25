const crypto = require("crypto");
const pool = require("../db/connection");

const REPLAY_GUARD_STRICT_REQUIRED =
	String(process.env.OPERATION_REPLAY_REQUIRE_ID || "false")
		.trim()
		.toLowerCase() === "true";
const DEFAULT_REPLAY_TTL_SECONDS = Math.min(
	Math.max(Number.parseInt(process.env.OPERATION_REPLAY_TTL_SECONDS || "900", 10) || 900, 60),
	86400,
);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9:_-]{12,128}$/;

function normalizeOperationId(value) {
	const text = String(value || "").trim();
	if (!text) return "";
	if (!OPERATION_ID_PATTERN.test(text)) return "";
	return text;
}

function extractOperationId(req) {
	const headerValue = String(req.headers["x-operation-id"] || req.headers["x-idempotency-key"] || "").trim();
	if (headerValue) {
		return headerValue;
	}

	const body = req.body && typeof req.body === "object" ? req.body : null;
	if (!body) {
		return "";
	}

	const fromBody = String(body.operation_id || body.operationId || "").trim();
	return fromBody;
}

function resolveActorId(req) {
	if (req.user?.id) {
		return `user:${req.user.id}`;
	}

	if (req.adminSession?.userId) {
		return `admin:${req.adminSession.userId}`;
	}

	if (req.serviceIdentity?.service_name) {
		return `service:${String(req.serviceIdentity.service_name).slice(0, 64)}`;
	}

	if (req.ip) {
		return `ip:${String(req.ip).slice(0, 64)}`;
	}

	return "anonymous";
}

async function reserveReplayOperation(options = {}) {
	const scope =
		String(options.scope || "global")
			.trim()
			.slice(0, 64) || "global";
	const actorId =
		String(options.actorId || "anonymous")
			.trim()
			.slice(0, 128) || "anonymous";
	const ttlSeconds = Math.min(
		Math.max(Number.parseInt(options.ttlSeconds || DEFAULT_REPLAY_TTL_SECONDS, 10) || DEFAULT_REPLAY_TTL_SECONDS, 60),
		86400,
	);
	const operationId = normalizeOperationId(options.operationId);

	if (!operationId) {
		return { ok: false, reason: "invalid_operation_id" };
	}

	try {
		await pool.query("DELETE FROM security_operation_replay_guard WHERE expires_at < NOW()");
	} catch {
		// Best-effort cleanup.
	}

	const result = await pool.query(
		`INSERT INTO security_operation_replay_guard (operation_scope, operation_id, actor_id, expires_at)
		 VALUES ($1, $2, $3, NOW() + (($4)::text || ' seconds')::interval)
		 ON CONFLICT (operation_scope, operation_id) DO NOTHING
		 RETURNING id`,
		[scope, operationId, actorId, ttlSeconds],
	);

	if (result.rowCount === 0) {
		return { ok: false, reason: "replay_detected", operationId };
	}

	return { ok: true, operationId };
}

function requireOperationReplayGuard(options = {}) {
	const scope = String(options.scope || "global").trim() || "global";
	const ttlSeconds = Math.min(
		Math.max(Number.parseInt(options.ttlSeconds || DEFAULT_REPLAY_TTL_SECONDS, 10) || DEFAULT_REPLAY_TTL_SECONDS, 60),
		86400,
	);
	const required = options.required !== undefined ? Boolean(options.required) : REPLAY_GUARD_STRICT_REQUIRED;

	return async (req, res, next) => {
		const providedOperationId = extractOperationId(req);
		const normalizedProvided = normalizeOperationId(providedOperationId);

		if (providedOperationId && !normalizedProvided) {
			return res.status(400).json({ error: "Invalid operation id", reason: "operation_id_format_invalid" });
		}

		let operationId = normalizedProvided;
		if (!operationId) {
			if (required) {
				return res.status(400).json({ error: "Operation id is required", reason: "operation_id_missing" });
			}

			operationId = `op_${crypto.randomUUID().replace(/-/g, "")}`;
		}

		const reservation = await reserveReplayOperation({
			operationId,
			scope,
			ttlSeconds,
			actorId: resolveActorId(req),
		});

		if (!reservation.ok) {
			return res.status(409).json({
				error: "Replay detected",
				reason: reservation.reason || "operation_replay",
				operationId,
			});
		}

		req.operationId = operationId;
		res.setHeader("x-operation-id", operationId);
		next();
	};
}

module.exports = {
	normalizeOperationId,
	extractOperationId,
	reserveReplayOperation,
	requireOperationReplayGuard,
};
