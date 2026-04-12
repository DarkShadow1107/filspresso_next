#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const pool = require("../db/connection");

function parseArg(name, fallback = "") {
	const prefix = `--${name}=`;
	const arg = process.argv.find((entry) => entry.startsWith(prefix));
	if (!arg) return fallback;
	return String(arg.slice(prefix.length)).trim();
}

function parseBoolArg(name, fallback = false) {
	const value = String(parseArg(name, fallback ? "true" : "false")).toLowerCase();
	return ["1", "true", "yes", "on"].includes(value);
}

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return {};
	}
}

function runAwsCli(args) {
	try {
		return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		const stderr = String(error?.stderr || "").trim();
		throw new Error(`aws ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
	}
}

function generateAwsKmsDataKey({ region, kmsKeyId }) {
	const output = runAwsCli([
		"kms",
		"generate-data-key",
		"--region",
		region,
		"--key-id",
		kmsKeyId,
		"--key-spec",
		"AES_256",
		"--output",
		"json",
	]);

	const parsed = JSON.parse(output);
	const ciphertextB64 = String(parsed?.CiphertextBlob || "").trim();
	const plaintextB64 = String(parsed?.Plaintext || "").trim();
	if (!ciphertextB64 || !plaintextB64) {
		throw new Error("aws kms generate-data-key returned incomplete key material");
	}

	const plaintext = Buffer.from(plaintextB64, "base64").toString("base64");
	return {
		ciphertextB64,
		plaintextMaterial: `base64:${plaintext}`,
	};
}

async function persistLifecycleEvent({ keyName, keyId, provider, details }) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			`INSERT INTO security_key_lifecycle_events (
				key_name,
				key_id,
				event_type,
				provider,
				actor_id,
				details
			)
			VALUES ($1, $2, 'rotated', $3, $4, $5::jsonb)`,
			[keyName, keyId, provider, "script:rotate_managed_key", JSON.stringify(details || {})],
		);

		await client.query(
			`INSERT INTO security_key_registry (key_name, active_key_id, provider, metadata, rotated_at)
			 VALUES ($1, $2, $3, $4::jsonb, NOW())
			 ON CONFLICT (key_name)
			 DO UPDATE SET
				active_key_id = EXCLUDED.active_key_id,
				provider = EXCLUDED.provider,
				metadata = EXCLUDED.metadata,
				rotated_at = NOW(),
				updated_at = NOW()`,
			[keyName, keyId, provider, JSON.stringify(details || {})],
		);

		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

async function main() {
	const keyName = String(parseArg("key-name", process.env.KEY_ROTATION_DEFAULT_KEY || "VAULT_KEK")).trim();
	if (!keyName) {
		throw new Error("--key-name is required");
	}

	const bytes = Math.min(Math.max(Number.parseInt(parseArg("bytes", "32"), 10) || 32, 16), 64);
	const dryRun = parseBoolArg("dry-run", false);
	const persistDb = !parseBoolArg("no-db", false);
	const provider = String(parseArg("provider", "external-cache")).trim() || "external-cache";

	const region = String(parseArg("aws-region", process.env.AWS_KMS_REGION || process.env.AWS_REGION || "")).trim();
	const kmsKeyId = String(
		parseArg("kms-key-id", process.env.KEY_ROTATION_KMS_KEY_ID || process.env.AWS_KMS_KEY_ID || ""),
	).trim();

	let generatedKeyMaterial = `base64:${crypto.randomBytes(bytes).toString("base64")}`;
	let ciphertextB64 = "";
	if (provider === "aws-kms") {
		if (!region || !kmsKeyId) {
			throw new Error("provider=aws-kms requires --aws-region and --kms-key-id (or env equivalents)");
		}
		const generated = generateAwsKmsDataKey({ region, kmsKeyId });
		generatedKeyMaterial = generated.plaintextMaterial;
		ciphertextB64 = generated.ciphertextB64;
	}

	const keyId = String(parseArg("key-id", `${keyName.toLowerCase()}-${Date.now()}`)).trim();
	const cacheFile = String(
		parseArg(
			"cache-file",
			process.env.KEY_PROVIDER_CACHE_FILE ||
				process.env[`${keyName}_KEY_CACHE_FILE`] ||
				"./secrets/key-provider-cache.json",
		),
	).trim();
	const absoluteCacheFile = path.resolve(process.cwd(), cacheFile);

	const cache = readJson(absoluteCacheFile);
	cache[keyName] = {
		material: generatedKeyMaterial,
		keyId,
		provider,
		metadata: {
			rotatedAt: new Date().toISOString(),
			managedBy: "express-api/scripts/rotate_managed_key.js",
			...(provider === "aws-kms" ? { awsRegion: region, awsKmsKeyId: kmsKeyId } : {}),
		},
	};
	if (provider === "aws-kms") {
		cache[keyName].kmsCiphertextB64 = ciphertextB64;
	}

	if (!dryRun) {
		fs.mkdirSync(path.dirname(absoluteCacheFile), { recursive: true });
		fs.writeFileSync(absoluteCacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

		if (provider === "aws-kms") {
			const envFile = path.resolve(process.cwd(), parseArg("kms-env-file", "./secrets/kms-rotated.env"));
			const lines = [
				`${keyName}_ID=${keyId}`,
				`${keyName}_KMS_KEY_ID=${kmsKeyId}`,
				`${keyName}_KMS_CIPHERTEXT_B64=${ciphertextB64}`,
				`AWS_KMS_REGION=${region}`,
				"KEY_PROVIDER_MODE=aws-kms",
			];
			fs.mkdirSync(path.dirname(envFile), { recursive: true });
			fs.writeFileSync(envFile, `${lines.join("\n")}\n`, "utf8");
		}
	}

	if (persistDb) {
		try {
			await persistLifecycleEvent({
				keyName,
				keyId,
				provider,
				details: {
					cacheFile,
					dryRun,
					rotationBytes: bytes,
					...(provider === "aws-kms" ? { awsRegion: region, awsKmsKeyId: kmsKeyId } : {}),
				},
			});
		} catch (error) {
			if (!dryRun) {
				throw error;
			}
		}
	}

	console.log(
		JSON.stringify(
			{
				status: dryRun ? "dry-run" : "success",
				keyName,
				keyId,
				provider,
				cacheFile,
				persistDb,
				rotationBytes: bytes,
				awsKms: provider === "aws-kms" ? { region, kmsKeyId } : null,
			},
			null,
			2,
		),
	);
}

main()
	.catch((error) => {
		console.error("Managed key rotation failed:", error.message || String(error));
		process.exit(1);
	})
	.finally(async () => {
		await pool.end().catch(() => {});
	});
