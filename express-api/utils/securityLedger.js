const crypto = require("crypto");

const LEDGER_VERSION = "titan-v2-ledger-v1";
const ZERO_HASH = "0".repeat(64);

function normalizeText(value, maxLength = 128, fallback = "") {
	const text = typeof value === "string" ? value.trim() : String(value || "").trim();
	if (!text) return fallback;
	return text.slice(0, maxLength);
}

function normalizeOccurredAt(value) {
	const timestamp = value ? new Date(value) : new Date();
	if (Number.isNaN(timestamp.getTime())) {
		return new Date().toISOString();
	}
	return timestamp.toISOString();
}

function stableSortObject(input) {
	if (Array.isArray(input)) {
		return input.map((entry) => stableSortObject(entry));
	}

	if (!input || typeof input !== "object") {
		return input;
	}

	const sorted = {};
	for (const key of Object.keys(input).sort()) {
		sorted[key] = stableSortObject(input[key]);
	}
	return sorted;
}

function canonicalizePayload(payload) {
	const safePayload = payload && typeof payload === "object" ? payload : {};
	return JSON.stringify(stableSortObject(safePayload));
}

function computeEventHash(material) {
	return crypto.createHash("sha3-256").update(material).digest("hex");
}

function buildLedgerMaterial(event) {
	return [
		LEDGER_VERSION,
		event.chainScope,
		event.prevHash,
		event.eventType,
		event.serviceName,
		event.actorType,
		event.actorId,
		event.correlationId,
		event.occurredAt,
		event.payloadCanonical,
	].join("|");
}

function normalizeLedgerEvent(event = {}) {
	const chainScope = normalizeText(event.chainScope, 64, "global");
	const eventType = normalizeText(event.eventType, 96, "security.event");
	const serviceName = normalizeText(event.serviceName, 96, "backend");
	const actorType = normalizeText(event.actorType, 32, "service");
	const actorId = normalizeText(event.actorId, 128, "");
	const correlationId = normalizeText(event.correlationId, 128, "");
	const occurredAt = normalizeOccurredAt(event.occurredAt);
	const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
	const payloadCanonical = canonicalizePayload(payload);

	return {
		chainScope,
		eventType,
		serviceName,
		actorType,
		actorId,
		correlationId,
		occurredAt,
		payload,
		payloadCanonical,
	};
}

async function appendSecurityLedgerEvent(client, event) {
	const normalized = normalizeLedgerEvent(event);
	const previousResult = await client.query(
		`SELECT event_hash
		 FROM security_event_ledger
		 WHERE chain_scope = $1
		 ORDER BY id DESC
		 LIMIT 1
		 FOR UPDATE`,
		[normalized.chainScope],
	);

	const prevHash = previousResult.rows[0]?.event_hash || ZERO_HASH;
	const material = buildLedgerMaterial({ ...normalized, prevHash });
	const eventHash = computeEventHash(material);

	const result = await client.query(
		`INSERT INTO security_event_ledger (
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
			occurred_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
		RETURNING id, chain_scope, event_type, service_name, prev_hash, event_hash, occurred_at, created_at`,
		[
			normalized.chainScope,
			normalized.eventType,
			normalized.serviceName,
			normalized.actorType,
			normalized.actorId || null,
			normalized.correlationId || null,
			prevHash,
			eventHash,
			normalized.payloadCanonical,
			JSON.stringify(normalized.payload),
			normalized.occurredAt,
		],
	);

	return result.rows[0];
}

async function verifySecurityLedgerChain(client, options = {}) {
	const chainScope = normalizeText(options.chainScope, 64, "global");
	const maxRows = Math.min(Math.max(Number.parseInt(options.maxRows || "10000", 10) || 10000, 1), 100000);

	const result = await client.query(
		`SELECT id, chain_scope, event_type, service_name, actor_type, actor_id, correlation_id, prev_hash, event_hash,
				payload_canonical, occurred_at
		 FROM security_event_ledger
		 WHERE chain_scope = $1
		 ORDER BY id ASC
		 LIMIT $2`,
		[chainScope, maxRows],
	);

	let expectedPrevHash = ZERO_HASH;
	let lastHash = ZERO_HASH;

	for (const row of result.rows) {
		if (row.prev_hash !== expectedPrevHash) {
			return {
				ok: false,
				chainScope,
				checked: result.rows.length,
				lastHash,
				mismatch: {
					id: row.id,
					reason: "prev_hash does not match expected chain state",
					expectedPrevHash,
					actualPrevHash: row.prev_hash,
				},
			};
		}

		const normalizedEvent = {
			chainScope: row.chain_scope,
			eventType: row.event_type,
			serviceName: row.service_name,
			actorType: row.actor_type,
			actorId: row.actor_id || "",
			correlationId: row.correlation_id || "",
			occurredAt: normalizeOccurredAt(row.occurred_at),
			payloadCanonical: String(row.payload_canonical || "{}"),
			prevHash: row.prev_hash,
		};

		const recomputedHash = computeEventHash(buildLedgerMaterial(normalizedEvent));
		if (recomputedHash !== row.event_hash) {
			return {
				ok: false,
				chainScope,
				checked: result.rows.length,
				lastHash,
				mismatch: {
					id: row.id,
					reason: "event_hash mismatch",
					expectedHash: recomputedHash,
					actualHash: row.event_hash,
				},
			};
		}

		expectedPrevHash = row.event_hash;
		lastHash = row.event_hash;
	}

	return {
		ok: true,
		chainScope,
		checked: result.rows.length,
		lastHash,
		firstId: result.rows[0]?.id || null,
		lastId: result.rows[result.rows.length - 1]?.id || null,
	};
}

module.exports = {
	appendSecurityLedgerEvent,
	verifySecurityLedgerChain,
	canonicalizePayload,
	buildLedgerMaterial,
	computeEventHash,
	ZERO_HASH,
	LEDGER_VERSION,
};
