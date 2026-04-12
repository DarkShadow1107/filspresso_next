const crypto = require("crypto");
const { resolveManagedKey } = require("./keyProvider");

const ENVELOPE_VERSION = "vault-env-v1";
const ENVELOPE_ALGORITHM = "aes-256-gcm";
const DEFAULT_KEK_ID = String(process.env.VAULT_KEK_ID || "kek-local-v1").trim() || "kek-local-v1";

function decodeKeyMaterial(rawKey) {
	const candidate = String(rawKey || "").trim();
	if (!candidate) {
		throw new Error("VAULT_KEK is empty");
	}

	if (candidate.startsWith("hex:")) {
		const hexValue = candidate.slice(4).trim();
		if (!/^[0-9a-fA-F]+$/.test(hexValue) || hexValue.length % 2 !== 0) {
			throw new Error("VAULT_KEK hex material is invalid");
		}
		return Buffer.from(hexValue, "hex");
	}

	if (candidate.startsWith("base64:")) {
		const base64Value = candidate.slice(7).trim();
		const decoded = Buffer.from(base64Value, "base64");
		if (!decoded.length) {
			throw new Error("VAULT_KEK base64 material is invalid");
		}
		return decoded;
	}

	if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
		return Buffer.from(candidate, "hex");
	}

	return Buffer.from(candidate, "utf8");
}

function deriveKekAeadKey(rawKey, kekId) {
	const ikm = decodeKeyMaterial(rawKey);
	if (ikm.length < 16) {
		throw new Error("VAULT_KEK must provide at least 128 bits of entropy");
	}

	const salt = crypto.createHash("sha3-256").update(`vault-envelope|salt|${kekId}`).digest();
	const info = Buffer.from(`vault-envelope|${ENVELOPE_VERSION}|${ENVELOPE_ALGORITHM}|${kekId}`, "utf8");

	try {
		return Buffer.from(crypto.hkdfSync("sha3-256", ikm, salt, info, 32));
	} catch {
		return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 32));
	}
}

function toBase64Url(value) {
	return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value) {
	try {
		return Buffer.from(String(value || ""), "base64url");
	} catch {
		return Buffer.alloc(0);
	}
}

function getKekMaterial() {
	const resolved = resolveManagedKey({ keyName: "VAULT_KEK", defaultKeyId: DEFAULT_KEK_ID });
	const kekId = String(resolved.keyId || DEFAULT_KEK_ID).trim() || DEFAULT_KEK_ID;
	const key = deriveKekAeadKey(resolved.material, kekId);
	return { kekId, key, provider: resolved.provider, metadata: resolved.metadata };
}

function encryptWithAead(key, iv, aad, plaintext) {
	const cipher = crypto.createCipheriv(ENVELOPE_ALGORITHM, key, iv);
	cipher.setAAD(aad);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return { ciphertext, tag };
}

function decryptWithAead(key, iv, aad, ciphertext, tag) {
	const decipher = crypto.createDecipheriv(ENVELOPE_ALGORITHM, key, iv);
	decipher.setAAD(aad);
	decipher.setAuthTag(tag);
	const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return plaintext.toString("utf8");
}

function encryptEnvelope(plaintext, options = {}) {
	const { kekId, key: kekKey, provider, metadata } = getKekMaterial();
	const context = String(options.context || "security-vault").trim() || "security-vault";

	const dek = crypto.randomBytes(32);
	const payloadIv = crypto.randomBytes(12);
	const payloadAad = Buffer.from(`${ENVELOPE_VERSION}|payload|${context}|${kekId}`, "utf8");
	const payload = encryptWithAead(dek, payloadIv, payloadAad, String(plaintext || ""));

	const wrapIv = crypto.randomBytes(12);
	const wrapAad = Buffer.from(`${ENVELOPE_VERSION}|wrap|${context}|${kekId}`, "utf8");
	const wrappedDek = encryptWithAead(kekKey, wrapIv, wrapAad, dek.toString("base64url"));

	return {
		version: ENVELOPE_VERSION,
		algorithm: ENVELOPE_ALGORITHM,
		kekId,
		kekProvider: provider,
		kekMetadata: metadata,
		context,
		payload: {
			iv: toBase64Url(payloadIv),
			tag: toBase64Url(payload.tag),
			ciphertext: toBase64Url(payload.ciphertext),
		},
		dekWrap: {
			iv: toBase64Url(wrapIv),
			tag: toBase64Url(wrappedDek.tag),
			ciphertext: toBase64Url(wrappedDek.ciphertext),
		},
	};
}

function decryptEnvelope(envelope, options = {}) {
	if (!envelope || typeof envelope !== "object") {
		throw new Error("Envelope payload is required");
	}

	const { key: kekKey } = getKekMaterial();
	const context = String(options.context || envelope.context || "security-vault").trim() || "security-vault";
	const kekId = String(envelope.kekId || "").trim();
	if (!kekId) {
		throw new Error("Envelope key ID is missing");
	}

	const wrapIv = fromBase64Url(envelope.dekWrap?.iv);
	const wrapTag = fromBase64Url(envelope.dekWrap?.tag);
	const wrapCiphertext = fromBase64Url(envelope.dekWrap?.ciphertext);
	if (wrapIv.length !== 12 || wrapTag.length !== 16 || wrapCiphertext.length === 0) {
		throw new Error("Envelope DEK wrapper payload is invalid");
	}

	const wrapAad = Buffer.from(`${ENVELOPE_VERSION}|wrap|${context}|${kekId}`, "utf8");
	const dekBase64 = decryptWithAead(kekKey, wrapIv, wrapAad, wrapCiphertext, wrapTag);
	const dek = Buffer.from(dekBase64, "base64url");
	if (dek.length !== 32) {
		throw new Error("Envelope DEK length is invalid");
	}

	const payloadIv = fromBase64Url(envelope.payload?.iv);
	const payloadTag = fromBase64Url(envelope.payload?.tag);
	const payloadCiphertext = fromBase64Url(envelope.payload?.ciphertext);
	if (payloadIv.length !== 12 || payloadTag.length !== 16 || payloadCiphertext.length === 0) {
		throw new Error("Envelope ciphertext payload is invalid");
	}

	const payloadAad = Buffer.from(`${ENVELOPE_VERSION}|payload|${context}|${kekId}`, "utf8");
	return decryptWithAead(dek, payloadIv, payloadAad, payloadCiphertext, payloadTag);
}

module.exports = {
	encryptEnvelope,
	decryptEnvelope,
	ENVELOPE_VERSION,
};
