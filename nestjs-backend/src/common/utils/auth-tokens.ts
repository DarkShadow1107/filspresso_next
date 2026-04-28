import * as crypto from "crypto";
import { getEnvOrFile } from "./secrets";
import { assertKeyUsage } from "./keyUsagePolicy";

import jwt, { type SignOptions } from "jsonwebtoken";

export const JWT_SECRET = getEnvOrFile("JWT_SECRET", { required: true });
export const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_TOKEN_TTL || "15m").trim() || "15m";
export const JWT_ISSUER = String(process.env.JWT_ISSUER || process.env.BACKEND_PUBLIC_URL || "http://localhost:4000").trim().replace(/\/$/, "");
export const JWT_AUDIENCE = String(process.env.JWT_AUDIENCE || "filspresso-users").trim() || "filspresso-users";
export const JWT_SIGNING_PRIVATE_KEY = getEnvOrFile("JWT_SIGNING_PRIVATE_KEY", { required: false, defaultValue: "" });
export const JWT_SIGNING_PUBLIC_KEY_RAW = getEnvOrFile("JWT_SIGNING_PUBLIC_KEY", { required: false, defaultValue: "" });
export const JWT_SIGNING_KEY_ID = String(process.env.JWT_SIGNING_KEY_ID || "jwt-k1").trim() || "jwt-k1";
export const JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON = String(process.env.JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON || "").trim();
export const AUTH_SESSION_IDLE_TIMEOUT_DAYS = Math.max(1, Number.parseInt(process.env.AUTH_SESSION_IDLE_TIMEOUT_DAYS || "30", 10) || 30);

function normalizePem(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("\\n") && !text.includes("\n")) {
    return text.replace(/\\n/g, "\n");
  }
  return text;
}

function parseTtlToSeconds(value: string | number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(60, Math.min(Math.floor(value), 86400));
  }

  const text = String(value || "").trim().toLowerCase();
  if (!text) return 900;

  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(60, Math.min(parsed, 86400));
    }
  }

  const match = text.match(/^(\d+)\s*([smhd])$/);
  if (!match) {
    return 900;
  }

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 900;
  }

  const unit = match[2];
  const multiplier = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return Math.max(60, Math.min(amount * multiplier, 86400));
}

type PreviousPublicKeyEntry = { kid: string; publicKey: string };

function parsePreviousPublicKeys(raw: string): PreviousPublicKeyEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => ({
          kid: String(entry?.kid || "").trim(),
          publicKey: normalizePem(entry?.publicKey || ""),
        }))
        .filter((entry) => entry.kid && entry.publicKey);
    }

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .map(([kid, publicKey]) => ({ kid: String(kid || "").trim(), publicKey: normalizePem(String(publicKey || "")) }))
        .filter((entry) => entry.kid && entry.publicKey);
    }
  } catch {
    console.warn("JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON is invalid JSON; ignoring previous key ring");
  }

  return [];
}

function derivePublicKeyPem(privateKeyPem: string) {
  if (!privateKeyPem) {
    return "";
  }

  try {
    const publicKey = crypto.createPublicKey(privateKeyPem);
    return String(publicKey.export({ format: "pem", type: "spki" }) || "").trim();
  } catch {
    return "";
  }
}

export const JWT_SIGNING_PUBLIC_KEY = normalizePem(JWT_SIGNING_PUBLIC_KEY_RAW) || derivePublicKeyPem(normalizePem(JWT_SIGNING_PRIVATE_KEY));
const JWT_PREVIOUS_PUBLIC_KEYS = parsePreviousPublicKeys(JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON);
const JWT_EDDSA_PUBLIC_KEYS = new Map<string, string>();
if (JWT_SIGNING_PUBLIC_KEY) {
  JWT_EDDSA_PUBLIC_KEYS.set(JWT_SIGNING_KEY_ID, JWT_SIGNING_PUBLIC_KEY);
}
for (const previous of JWT_PREVIOUS_PUBLIC_KEYS) {
  if (previous.kid && previous.publicKey && !JWT_EDDSA_PUBLIC_KEYS.has(previous.kid)) {
    JWT_EDDSA_PUBLIC_KEYS.set(previous.kid, previous.publicKey);
  }
}

const JWT_EDDSA_ENABLED = Boolean(normalizePem(JWT_SIGNING_PRIVATE_KEY) && JWT_EDDSA_PUBLIC_KEYS.size > 0);
export const JWT_ACCESS_TTL_SECONDS = parseTtlToSeconds(JWT_EXPIRES_IN);

export function buildSessionExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + AUTH_SESSION_IDLE_TIMEOUT_DAYS);
  return expiresAt;
}

type JwtUserLike = {
  id: number | string;
  email?: string | null;
  username?: string | null;
};

export type JwtClaims = {
  id: number | string;
  email?: string | null;
  username?: string | null;
  [key: string]: unknown;
};

type JwtIssueOptions = Partial<Pick<SignOptions, "expiresIn">>;

const signJwt = jwt.sign as unknown as (
  payload: object,
  secretOrPrivateKey: string,
  options: Record<string, unknown>,
) => string;

const verifyJwt = jwt.verify as unknown as (
  token: string,
  secretOrPublicKey: string,
  options?: Record<string, unknown>,
) => unknown;

function isJwtClaims(value: unknown): value is JwtClaims {
  return Boolean(value && typeof value === "object" && "id" in value);
}

export function generateToken(user: JwtUserLike, options: JwtIssueOptions = {}) {
  const payload = {
    id: user.id,
    email: user.email,
    username: user.username,
  };

  const expiresIn = options.expiresIn || JWT_EXPIRES_IN;
  if (JWT_EDDSA_ENABLED) {
    assertKeyUsage({
      keyPurpose: "user_identity_signing",
      operationType: "issue_user_jwt",
      requestedScope: "access_token",
      keyId: JWT_SIGNING_KEY_ID,
    });

    return signJwt(payload, normalizePem(JWT_SIGNING_PRIVATE_KEY), {
      algorithm: "EdDSA",
      expiresIn,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      header: {
        typ: "JWT",
        kid: JWT_SIGNING_KEY_ID,
      },
    });
  }

  assertKeyUsage({
    keyPurpose: "user_identity_signing",
    operationType: "issue_user_jwt",
    requestedScope: "access_token",
    keyId: "legacy-hs256",
  });

  return signJwt(payload, JWT_SECRET, {
    expiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: "HS256",
  });
}

export function verifyToken(token: string): JwtClaims | null {
  try {
    const decoded = jwt.decode(token, { complete: true }) as { header?: { alg?: string; kid?: string } } | null;
    const algorithm = String(decoded?.header?.alg || "HS256").trim();

    if (algorithm === "EdDSA") {
      const kid = String(decoded?.header?.kid || "").trim();
      const verificationKey = kid ? JWT_EDDSA_PUBLIC_KEYS.get(kid) : JWT_EDDSA_PUBLIC_KEYS.size === 1 ? Array.from(JWT_EDDSA_PUBLIC_KEYS.values())[0] : "";

      if (!verificationKey) {
        return null;
      }

      const verified = verifyJwt(token, verificationKey, {
        algorithms: ["EdDSA"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return isJwtClaims(verified) ? verified : null;
    }

    if (algorithm !== "HS256") {
      return null;
    }

    try {
      const verified = verifyJwt(token, JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return isJwtClaims(verified) ? verified : null;
    } catch {
      const verified = verifyJwt(token, JWT_SECRET, { algorithms: ["HS256"] });
      return isJwtClaims(verified) ? verified : null;
    }
  } catch (error) {
    return null;
  }
}

export function jwtSupportsOidcJwks(): boolean {
  return JWT_EDDSA_ENABLED && JWT_EDDSA_PUBLIC_KEYS.size > 0;
}

export function getOpenIdConfiguration(baseUrl: string): Record<string, unknown> {
  const issuer = String(baseUrl || JWT_ISSUER).replace(/\/$/, "");
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/api/auth/me`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: JWT_EDDSA_ENABLED ? ["EdDSA"] : ["HS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    claims_supported: ["sub", "email", "username", "iss", "aud", "exp", "iat"],
  };
}

export function getJwtJwks(): Record<string, unknown> {
  if (!JWT_EDDSA_ENABLED || JWT_EDDSA_PUBLIC_KEYS.size === 0) {
    return { keys: [] };
  }
  const keys: Record<string, unknown>[] = [];
  for (const [kid, publicKeyPem] of JWT_EDDSA_PUBLIC_KEYS.entries()) {
    try {
      const keyObj = crypto.createPublicKey(publicKeyPem);
      const jwk = keyObj.export({ format: "jwk" }) as Record<string, unknown>;
      keys.push({ ...jwk, kid, use: "sig", alg: "EdDSA" });
    } catch {
      // Skip malformed keys
    }
  }
  return { keys };
}
