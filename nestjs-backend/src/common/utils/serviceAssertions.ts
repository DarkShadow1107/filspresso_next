import * as crypto from "crypto";
import { getEnvOrFile } from "./secrets";
import { assertKeyUsage } from "./keyUsagePolicy";

const SERVICE_ASSERTION_AUDIENCE = String(process.env.SERVICE_ASSERTION_AUDIENCE || "filspresso-backend").trim();
const SERVICE_ASSERTION_ISSUER_ALLOWLIST = String(process.env.SERVICE_ASSERTION_ISSUER_ALLOWLIST || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const SERVICE_ASSERTION_PUBLIC_KEY = getEnvOrFile("SERVICE_ASSERTION_PUBLIC_KEY", {
  required: false,
  defaultValue: "",
});

function toBase64Url(data: string | Buffer) {
  return Buffer.from(data).toString("base64url");
}

function fromBase64Url(data: string) {
  try {
    return Buffer.from(String(data || ""), "base64url");
  } catch {
    return Buffer.alloc(0);
  }
}

function parseJson(buffer: Buffer) {
  try {
    return JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    return null;
  }
}

function verifyAudience(aud: any, expectedAudience = SERVICE_ASSERTION_AUDIENCE) {
  if (!expectedAudience) return true;
  if (Array.isArray(aud)) {
    return aud.includes(expectedAudience);
  }
  return String(aud || "") === expectedAudience;
}

function verifyScope(scope: string, expectedScope: string) {
  const normalized = String(scope || "")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!expectedScope) return true;
  return normalized.includes(expectedScope);
}

function verifyIssuerWithAllowlist(iss: string, allowlist: string[]) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  return allowlist.includes(String(iss || ""));
}

export function verifyServiceAssertion(token: string, options: any = {}) {
  const expectedScope = String(options.expectedScope || "").trim();
  const expectedAudience = String(options.expectedAudience || SERVICE_ASSERTION_AUDIENCE).trim();
  const expectedIssuers = Array.isArray(options.expectedIssuers)
    ? options.expectedIssuers.map((entry: any) => String(entry || "").trim()).filter(Boolean)
    : SERVICE_ASSERTION_ISSUER_ALLOWLIST;
  const requireJti = options.requireJti === true;
  if (!SERVICE_ASSERTION_PUBLIC_KEY) {
    return { ok: false, reason: "service assertion public key not configured" };
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "token format invalid" };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseJson(fromBase64Url(headerPart));
  const payload = parseJson(fromBase64Url(payloadPart));
  const signature = fromBase64Url(signaturePart);

  if (!header || !payload || signature.length === 0) {
    return { ok: false, reason: "token payload invalid" };
  }

  if (header.alg !== "EdDSA") {
    return { ok: false, reason: "token alg invalid" };
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(SERVICE_ASSERTION_PUBLIC_KEY);
  } catch {
    return { ok: false, reason: "service assertion public key malformed" };
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const verified = crypto.verify(null, Buffer.from(signingInput, "utf8"), publicKey, signature);
  if (!verified) {
    return { ok: false, reason: "signature verification failed" };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp || 0);
  const nbf = Number(payload.nbf || payload.iat || 0);
  if (!Number.isFinite(exp) || exp <= now) {
    return { ok: false, reason: "token expired" };
  }
  if (Number.isFinite(nbf) && nbf > now + 5) {
    return { ok: false, reason: "token not yet valid" };
  }

  if (!verifyAudience(payload.aud, expectedAudience)) {
    return { ok: false, reason: "token audience mismatch" };
  }
  if (!verifyIssuerWithAllowlist(payload.iss, expectedIssuers)) {
    return { ok: false, reason: "token issuer not allowed" };
  }
  if (!verifyScope(payload.scope, expectedScope)) {
    return { ok: false, reason: "token scope invalid" };
  }
  if (requireJti && !String(payload.jti || "").trim()) {
    return { ok: false, reason: "token_jti_missing" };
  }

  return { ok: true, claims: payload };
}

export function issueServiceAssertion(options: any = {}) {
  const privateKeyPem = String(options.privateKeyPem || "").trim();
  if (!privateKeyPem) {
    throw new Error("privateKeyPem is required");
  }

  const requestedScope = String(options.scope || "service-events:write").trim() || "service-events:write";
  const keyPurpose = String(options.keyPurpose || "service_assertion_signing").trim() || "service_assertion_signing";
  const operationType = String(options.operationType || "issue_service_assertion").trim() || "issue_service_assertion";
  const keyId = String(options.keyId || "service-assertion-ed25519").trim() || "service-assertion-ed25519";

  assertKeyUsage({
    keyPurpose,
    operationType,
    requestedScope,
    keyId,
  });

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.min(Math.max(Number(options.ttlSeconds || 120), 30), 600);
  const payload: any = {
    iss: options.issuer || "filspresso-service",
    sub: options.subject || "service",
    aud: options.audience || SERVICE_ASSERTION_AUDIENCE,
    scope: requestedScope,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };

  if (options.operationId) {
    payload.op_id = String(options.operationId).trim().slice(0, 128);
  }

  const headerPart = toBase64Url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = crypto
    .sign(null, Buffer.from(signingInput, "utf8"), crypto.createPrivateKey(privateKeyPem))
    .toString("base64url");

  return {
    token: `${headerPart}.${payloadPart}.${signature}`,
    claims: payload,
  };
}
