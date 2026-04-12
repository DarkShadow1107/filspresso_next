#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db/connection");
const { verifySecurityLedgerChain } = require("../utils/securityLedger");

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

function parseScopes() {
	const raw = String(process.env.SECURITY_INTEGRITY_SCOPES || "service-health,threshold-operation,zk-proof,mpc-quorum").trim();
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function verifyAnchorRecord(record) {
	if (!record?.signature || !record?.canonicalPayload || !record?.publicKeyPem) {
		return { ok: false, reason: "missing signature/canonicalPayload/publicKeyPem" };
	}

	const expectedFingerprint = crypto.createHash("sha3-256").update(String(record.publicKeyPem)).digest("hex");
	if (expectedFingerprint !== String(record.publicKeyFingerprint || "")) {
		return { ok: false, reason: "public key fingerprint mismatch" };
	}

	let canonicalMaterial;
	try {
		const parsedCanonical = JSON.parse(String(record.canonicalPayload));
		canonicalMaterial = JSON.stringify(stableSort(parsedCanonical));
	} catch {
		return { ok: false, reason: "canonical payload is not valid JSON" };
	}

	const verified = crypto.verify(
		null,
		Buffer.from(canonicalMaterial, "utf8"),
		crypto.createPublicKey(String(record.publicKeyPem)),
		Buffer.from(String(record.signature), "base64url"),
	);
	if (!verified) {
		return { ok: false, reason: "anchor signature verification failed" };
	}

	return { ok: true };
}

function getLatestAnchorByScope() {
	const anchorFile = path.resolve(__dirname, "../../logs/security_ledger_anchors.jsonl");
	if (!fs.existsSync(anchorFile)) {
		return { anchorFile, anchorsByScope: new Map(), errors: ["anchor file missing"] };
	}

	const lines = fs
		.readFileSync(anchorFile, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const anchorsByScope = new Map();
	const errors = [];
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			const scope = String(parsed.chainScope || "").trim();
			if (!scope) continue;
			anchorsByScope.set(scope, parsed);
		} catch {
			errors.push("invalid anchor JSON line encountered");
		}
	}

	return { anchorFile, anchorsByScope, errors };
}

async function main() {
	const scopes = parseScopes();
	const maxRowsRaw = Number.parseInt(process.env.SECURITY_LEDGER_MAX_ROWS || "100000", 10);
	const maxRows = Number.isFinite(maxRowsRaw) ? Math.min(Math.max(maxRowsRaw, 1), 200000) : 100000;

	const { anchorFile, anchorsByScope, errors: anchorReadErrors } = getLatestAnchorByScope();
	const client = await pool.connect();
	try {
		const checks = [];
		let failed = false;

		for (const scope of scopes) {
			const chainResult = await verifySecurityLedgerChain(client, { chainScope: scope, maxRows });
			const anchor = anchorsByScope.get(scope) || null;
			let anchorStatus = { ok: false, reason: "anchor missing" };
			if (anchor) {
				anchorStatus = verifyAnchorRecord(anchor);
				if (anchorStatus.ok && String(anchor.lastHash || "") !== String(chainResult.lastHash || "")) {
					anchorStatus = { ok: false, reason: "anchor lastHash mismatch with ledger chain" };
				}
			}

			const ok = Boolean(chainResult.ok) && Boolean(anchorStatus.ok);
			if (!ok) failed = true;
			checks.push({
				scope,
				chain: chainResult,
				anchor: {
					present: Boolean(anchor),
					ok: anchorStatus.ok,
					reason: anchorStatus.reason || null,
					anchoredAt: anchor?.anchoredAt || null,
				},
				ok,
			});
		}

		const report = {
			generatedAt: new Date().toISOString(),
			anchorFile,
			anchorReadErrors,
			maxRows,
			checks,
			ok: !failed && anchorReadErrors.length === 0,
		};

		console.log(JSON.stringify(report, null, 2));
		if (!report.ok) {
			process.exitCode = 1;
		}
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error("Post-incident integrity check failed:", error.message || String(error));
	process.exit(1);
});
