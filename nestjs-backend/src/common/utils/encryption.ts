import * as crypto from "crypto";
import { getEnvOrFile } from "./secrets";

const CryptoJS: any = require("crypto-js");

const ENCRYPTION_VERSION = "v2";
const ENCRYPTION_MODE = "gcm";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_CONTEXT = "filspresso_next.card_data";
const ACTIVE_KEY_ID = normalizeKeyId(process.env.ENCRYPTION_KEY_ID || "k1");
const ENCRYPTION_KEY = getEnvOrFile("ENCRYPTION_KEY", { required: true });
const LEGACY_ENCRYPTION_KEYS = String(getEnvOrFile("ENCRYPTION_KEY_LEGACY", { required: false, defaultValue: "" }))
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

function normalizeKeyId(value: string) {
  const keyId = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);
  return keyId || "k1";
}

function decodeRootKeyMaterial(rawKey: string) {
  const candidate = String(rawKey || "").trim();
  if (!candidate) {
    throw new Error("ENCRYPTION_KEY is empty");
  }

  if (candidate.startsWith("hex:")) {
    const hexValue = candidate.slice(4).trim();
    if (!/^[0-9a-fA-F]+$/.test(hexValue) || hexValue.length % 2 !== 0) {
      throw new Error("ENCRYPTION_KEY hex material is invalid");
    }
    return Buffer.from(hexValue, "hex");
  }

  if (candidate.startsWith("base64:")) {
    const base64Value = candidate.slice(7).trim();
    const decoded = Buffer.from(base64Value, "base64");
    if (decoded.length === 0) {
      throw new Error("ENCRYPTION_KEY base64 material is invalid");
    }
    return decoded;
  }

  if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
    return Buffer.from(candidate, "hex");
  }

  return Buffer.from(candidate, "utf8");
}

function deriveAeadKey(rawKey: string, keyId: string) {
  const ikm = decodeRootKeyMaterial(rawKey);
  if (ikm.length < 16) {
    throw new Error("ENCRYPTION_KEY must provide at least 128 bits of entropy");
  }

  const salt = crypto.createHash("sha3-256").update(`${ENCRYPTION_CONTEXT}|salt|${keyId}`).digest();
  const info = Buffer.from(`${ENCRYPTION_CONTEXT}|${ENCRYPTION_VERSION}|${ENCRYPTION_ALGORITHM}|${keyId}`, "utf8");

  try {
    return Buffer.from(crypto.hkdfSync("sha3-256", ikm, salt, info, 32));
  } catch {
    return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 32));
  }
}

function toBase64Url(value: Buffer) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  try {
    return Buffer.from(String(value || ""), "base64url");
  } catch {
    return Buffer.alloc(0);
  }
}

function buildAad(keyId: string) {
  return Buffer.from(`${ENCRYPTION_CONTEXT}|${ENCRYPTION_VERSION}|${keyId}`, "utf8");
}

const ACTIVE_KEY = {
  id: ACTIVE_KEY_ID,
  aeadKey: deriveAeadKey(ENCRYPTION_KEY, ACTIVE_KEY_ID),
  legacyPassphrase: ENCRYPTION_KEY,
};

const LEGACY_KEYRING = LEGACY_ENCRYPTION_KEYS.map((rawKey, index) => {
  const legacyId = normalizeKeyId(`legacy${index + 1}`);
  return {
    id: legacyId,
    aeadKey: deriveAeadKey(rawKey, legacyId),
    legacyPassphrase: rawKey,
  };
});

const KEYRING_BY_ID = new Map([[ACTIVE_KEY.id, ACTIVE_KEY], ...LEGACY_KEYRING.map((entry) => [entry.id, entry] as const)]);

export function encrypt(text: string): string {
  if (!text) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ACTIVE_KEY.aeadKey, iv);
  cipher.setAAD(buildAad(ACTIVE_KEY.id));

  const ciphertext = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    ENCRYPTION_MODE,
    ACTIVE_KEY.id,
    toBase64Url(iv),
    toBase64Url(authTag),
    toBase64Url(ciphertext),
  ].join(":");
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";
  if (String(ciphertext).startsWith(`${ENCRYPTION_VERSION}:${ENCRYPTION_MODE}:`)) {
    const parts = String(ciphertext).split(":");
    if (parts.length === 6) {
      const [, , keyIdRaw, ivEncoded, authTagEncoded, payloadEncoded] = parts;
      const keyId = normalizeKeyId(keyIdRaw);
      const keysToTry = [];
      const exactMatch = KEYRING_BY_ID.get(keyId);
      if (exactMatch) {
        keysToTry.push(exactMatch);
      }
      for (const candidate of [ACTIVE_KEY, ...LEGACY_KEYRING]) {
        if (!keysToTry.includes(candidate)) {
          keysToTry.push(candidate);
        }
      }

      const iv = fromBase64Url(ivEncoded);
      const authTag = fromBase64Url(authTagEncoded);
      const payload = fromBase64Url(payloadEncoded);

      if (iv.length === 12 && authTag.length === 16 && payload.length > 0) {
        for (const key of keysToTry) {
          try {
            const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key.aeadKey, iv);
            decipher.setAAD(buildAad(key.id));
            decipher.setAuthTag(authTag);
            const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]);
            return plaintext.toString("utf8");
          } catch {
            // Try next key candidate.
          }
        }
      }
    }
  }

  const keysToTry = [ACTIVE_KEY.legacyPassphrase, ...LEGACY_KEYRING.map((entry) => entry.legacyPassphrase)];
  for (const key of keysToTry) {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    const decoded = bytes.toString(CryptoJS.enc.Utf8);
    if (decoded) {
      return decoded;
    }
  }

  return "";
}

export function getLastFour(cardNumber: string): string {
  if (!cardNumber) return "****";
  const cleaned = cardNumber.replace(/\\D/g, "");
  return cleaned.slice(-4);
}

export function detectCardType(cardNumber: string): string {
  const cleaned = cardNumber.replace(/\\D/g, "");

  if (/^4/.test(cleaned)) return "visa";
  if (/^5[1-5]/.test(cleaned)) return "mastercard";
  if (/^3[47]/.test(cleaned)) return "amex";
  if (/^6(?:011|5)/.test(cleaned)) return "discover";
  return "unknown";
}
