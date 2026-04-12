#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db/connection");
const { verifySecurityLedgerChain } = require("../utils/securityLedger");
const { getEnvOrFile } = require("../utils/secrets");

const TRANSPARENCY_URL = String(process.env.SECURITY_LEDGER_TRANSPARENCY_URL || "").trim();
const TRANSPARENCY_METHOD = String(process.env.SECURITY_LEDGER_TRANSPARENCY_METHOD || "POST")
	.trim()
	.toUpperCase();
const TRANSPARENCY_FAIL_CLOSED =
	String(process.env.SECURITY_LEDGER_TRANSPARENCY_FAIL_CLOSED || "false")
		.trim()
		.toLowerCase() === "true";

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

function getAnchorPrivateKeyPem() {
	const direct = String(process.env.LEDGER_ANCHOR_PRIVATE_KEY || "").trim();
	if (direct) {
		return direct;
	}

	try {
		return getEnvOrFile("LEDGER_ANCHOR_PRIVATE_KEY", { required: true });
	} catch (error) {
		throw new Error(
			"Missing LEDGER_ANCHOR_PRIVATE_KEY (or LEDGER_ANCHOR_PRIVATE_KEY_FILE). Provide an Ed25519 private key PEM.",
		);
	}
}

function getPublicKeyFingerprint(privateKeyPem) {
	const privateKey = crypto.createPrivateKey(privateKeyPem);
	const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
	const digest = crypto.createHash("sha3-256").update(String(publicKey)).digest("hex");
	return { publicKeyPem: String(publicKey), fingerprint: digest };
}

function signAnchorPayload(privateKeyPem, anchorPayload) {
	const privateKey = crypto.createPrivateKey(privateKeyPem);
	const canonicalPayload = JSON.stringify(stableSort(anchorPayload));
	const signature = crypto.sign(null, Buffer.from(canonicalPayload, "utf8"), privateKey).toString("base64url");
	return { canonicalPayload, signature };
}

function getTransparencyAuthToken() {
	try {
		return getEnvOrFile("SECURITY_LEDGER_TRANSPARENCY_AUTH_TOKEN", { required: false, defaultValue: "" });
	} catch {
		return "";
	}
}

async function publishAnchorRecord(record) {
	if (!TRANSPARENCY_URL) {
		return { published: false, reason: "transparency_url_not_configured" };
	}

	if (!["POST", "PUT"].includes(TRANSPARENCY_METHOD)) {
		throw new Error("SECURITY_LEDGER_TRANSPARENCY_METHOD must be POST or PUT");
	}

	const authToken = getTransparencyAuthToken();
	const headers = {
		"Content-Type": "application/json",
		Accept: "application/json",
	};
	if (authToken) {
		headers.Authorization = `Bearer ${authToken}`;
	}

	const response = await fetch(TRANSPARENCY_URL, {
		method: TRANSPARENCY_METHOD,
		headers,
		body: JSON.stringify(record),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`transparency backend rejected anchor (${response.status}): ${body || "no response body"}`);
	}

	return {
		published: true,
		target: TRANSPARENCY_URL,
		status: response.status,
	};
}

async function main() {
	const chainScope = String(process.argv[2] || process.env.SECURITY_LEDGER_SCOPE || "service-health").trim();
	const maxRowsRaw = Number.parseInt(process.argv[3] || process.env.SECURITY_LEDGER_MAX_ROWS || "100000", 10);
	const maxRows = Number.isFinite(maxRowsRaw) ? Math.min(Math.max(maxRowsRaw, 1), 200000) : 100000;

	const privateKeyPem = getAnchorPrivateKeyPem();
	const { fingerprint, publicKeyPem } = getPublicKeyFingerprint(privateKeyPem);

	const client = await pool.connect();
	try {
		const verification = await verifySecurityLedgerChain(client, { chainScope, maxRows });
		if (!verification.ok) {
			console.error("Ledger verification failed, refusing to anchor");
			console.error(JSON.stringify(verification, null, 2));
			process.exitCode = 1;
			return;
		}

		const anchorPayload = {
			version: "titan-anchor-v1",
			chainScope,
			checkedRows: verification.checked,
			lastHash: verification.lastHash,
			firstId: verification.firstId,
			lastId: verification.lastId,
			anchoredAt: new Date().toISOString(),
			algorithm: "ed25519",
			publicKeyFingerprint: fingerprint,
		};

		const { canonicalPayload, signature } = signAnchorPayload(privateKeyPem, anchorPayload);
		const record = {
			...anchorPayload,
			signature,
			canonicalPayload,
			publicKeyPem,
		};

		const outputFile = path.resolve(__dirname, "../../logs/security_ledger_anchors.jsonl");
		fs.mkdirSync(path.dirname(outputFile), { recursive: true });
		fs.appendFileSync(outputFile, `${JSON.stringify(record)}\n`, "utf8");

		let publishResult = { published: false, reason: "transparency_url_not_configured" };
		try {
			publishResult = await publishAnchorRecord(record);
		} catch (publishError) {
			if (TRANSPARENCY_FAIL_CLOSED) {
				throw publishError;
			}
			publishResult = { published: false, reason: publishError.message || String(publishError) };
		}

		console.log("Security ledger anchor recorded");
		console.log(
			JSON.stringify(
				{
					outputFile,
					chainScope,
					checkedRows: verification.checked,
					lastHash: verification.lastHash,
					transparency: publishResult,
				},
				null,
				2,
			),
		);
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((error) => {
	console.error("Security ledger anchor failed:", error.message || String(error));
	process.exit(1);
});
