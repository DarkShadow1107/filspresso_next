const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { getEnvOrFile } = require("./secrets");

const KEY_PROVIDER_MODE = String(process.env.KEY_PROVIDER_MODE || "local-env")
	.trim()
	.toLowerCase();
const KEY_PROVIDER_CACHE_FILE = String(process.env.KEY_PROVIDER_CACHE_FILE || "").trim();

function readJsonFile(filePath) {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

function normalizeProviderRecord(raw) {
	if (!raw || typeof raw !== "object") return null;
	const material = String(raw.material || "").trim();
	const keyId = String(raw.keyId || "").trim();
	if (!material || !keyId) return null;
	return {
		material,
		keyId,
		provider: String(raw.provider || "external-cache").trim() || "external-cache",
		metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
	};
}

function resolveFromCacheFile(keyName) {
	const configured = KEY_PROVIDER_CACHE_FILE || String(process.env[`${keyName}_KEY_CACHE_FILE`] || "").trim();
	if (!configured) return null;

	const absolutePath = path.resolve(process.cwd(), configured);
	const data = readJsonFile(absolutePath);
	if (!data || typeof data !== "object") return null;

	const fromKey = normalizeProviderRecord(data[keyName]);
	if (fromKey) return fromKey;

	const fallback = normalizeProviderRecord(data.default);
	if (fallback) return fallback;

	return null;
}

function decryptAwsKmsCiphertext(ciphertextB64, region) {
	const ciphertext = Buffer.from(String(ciphertextB64 || "").trim(), "base64");
	if (!ciphertext.length) {
		throw new Error("AWS KMS ciphertext blob is empty or invalid");
	}

	const tempPath = path.join(os.tmpdir(), `filspresso-kms-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
	fs.writeFileSync(tempPath, ciphertext);

	try {
		const output = execFileSync(
			"aws",
			["kms", "decrypt", "--region", region, "--ciphertext-blob", `fileb://${tempPath}`, "--output", "json"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);

		const parsed = JSON.parse(output);
		const plaintextB64 = String(parsed?.Plaintext || "").trim();
		if (!plaintextB64) {
			throw new Error("AWS KMS decrypt returned empty Plaintext");
		}

		const plaintext = Buffer.from(plaintextB64, "base64").toString("utf8").trim();
		if (!plaintext) {
			throw new Error("AWS KMS decrypt returned blank plaintext material");
		}

		return plaintext;
	} catch (error) {
		const stderr = String(error?.stderr || "").trim();
		throw new Error(`aws kms decrypt failed${stderr ? `: ${stderr}` : ""}`);
	} finally {
		fs.rmSync(tempPath, { force: true });
	}
}

function resolveFromAwsKms(keyName) {
	const region = String(process.env.AWS_KMS_REGION || process.env.AWS_REGION || "").trim();
	if (!region) {
		throw new Error("AWS_KMS_REGION or AWS_REGION is required for KEY_PROVIDER_MODE=aws-kms");
	}

	const ciphertextB64 = String(process.env[`${keyName}_KMS_CIPHERTEXT_B64`] || "").trim();
	if (!ciphertextB64) {
		throw new Error(`${keyName}_KMS_CIPHERTEXT_B64 is required for KEY_PROVIDER_MODE=aws-kms`);
	}

	const material = decryptAwsKmsCiphertext(ciphertextB64, region);
	const keyId = String(process.env[`${keyName}_ID`] || process.env[`${keyName}_KMS_KEY_ID`] || "").trim() || "aws-kms-key";

	return {
		material,
		keyId,
		provider: "aws-kms",
		metadata: { region },
	};
}

function resolveManagedKey(options = {}) {
	const keyName = String(options.keyName || "").trim();
	if (!keyName) {
		throw new Error("keyName is required");
	}

	if (KEY_PROVIDER_MODE === "external-cache") {
		const cached = resolveFromCacheFile(keyName);
		if (cached) {
			return cached;
		}

		if (
			String(process.env.KEY_PROVIDER_FAIL_CLOSED || "false")
				.trim()
				.toLowerCase() === "true"
		) {
			throw new Error(`No external key cache record found for ${keyName}`);
		}
	}

	if (KEY_PROVIDER_MODE === "aws-kms") {
		return resolveFromAwsKms(keyName);
	}

	const directMaterial = getEnvOrFile(keyName, { required: true });
	const keyId = String(process.env[`${keyName}_ID`] || options.defaultKeyId || "").trim() || "local-key-v1";
	return {
		material: directMaterial,
		keyId,
		provider: "local-env",
		metadata: {},
	};
}

module.exports = {
	resolveManagedKey,
};
