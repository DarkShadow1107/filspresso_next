"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_ACCESS_TTL_SECONDS = exports.JWT_SIGNING_PUBLIC_KEY = exports.AUTH_SESSION_IDLE_TIMEOUT_DAYS = exports.JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON = exports.JWT_SIGNING_KEY_ID = exports.JWT_SIGNING_PUBLIC_KEY_RAW = exports.JWT_SIGNING_PRIVATE_KEY = exports.JWT_AUDIENCE = exports.JWT_ISSUER = exports.JWT_EXPIRES_IN = exports.JWT_SECRET = void 0;
exports.buildSessionExpiryDate = buildSessionExpiryDate;
exports.generateToken = generateToken;
exports.verifyToken = verifyToken;
exports.jwtSupportsOidcJwks = jwtSupportsOidcJwks;
exports.getOpenIdConfiguration = getOpenIdConfiguration;
exports.getJwtJwks = getJwtJwks;
const crypto = __importStar(require("crypto"));
const secrets_1 = require("./secrets");
const keyUsagePolicy_1 = require("./keyUsagePolicy");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
exports.JWT_SECRET = (0, secrets_1.getEnvOrFile)("JWT_SECRET", { required: true });
exports.JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_TOKEN_TTL || "15m").trim() || "15m";
exports.JWT_ISSUER = String(process.env.JWT_ISSUER || process.env.BACKEND_PUBLIC_URL || "http://localhost:4000")
    .trim()
    .replace(/\/$/, "");
exports.JWT_AUDIENCE = String(process.env.JWT_AUDIENCE || "filspresso-users").trim() || "filspresso-users";
exports.JWT_SIGNING_PRIVATE_KEY = (0, secrets_1.getEnvOrFile)("JWT_SIGNING_PRIVATE_KEY", { required: false, defaultValue: "" });
exports.JWT_SIGNING_PUBLIC_KEY_RAW = (0, secrets_1.getEnvOrFile)("JWT_SIGNING_PUBLIC_KEY", { required: false, defaultValue: "" });
exports.JWT_SIGNING_KEY_ID = String(process.env.JWT_SIGNING_KEY_ID || "jwt-k1").trim() || "jwt-k1";
exports.JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON = String(process.env.JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON || "").trim();
exports.AUTH_SESSION_IDLE_TIMEOUT_DAYS = Math.max(1, Number.parseInt(process.env.AUTH_SESSION_IDLE_TIMEOUT_DAYS || "30", 10) || 30);
function normalizePem(value) {
    const text = String(value || "").trim();
    if (!text)
        return "";
    if (text.includes("\\n") && !text.includes("\n")) {
        return text.replace(/\\n/g, "\n");
    }
    return text;
}
function parseTtlToSeconds(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(60, Math.min(Math.floor(value), 86400));
    }
    const text = String(value || "")
        .trim()
        .toLowerCase();
    if (!text)
        return 900;
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
function parsePreviousPublicKeys(raw) {
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
    }
    catch {
        console.warn("JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON is invalid JSON; ignoring previous key ring");
    }
    return [];
}
function derivePublicKeyPem(privateKeyPem) {
    if (!privateKeyPem) {
        return "";
    }
    try {
        const publicKey = crypto.createPublicKey(privateKeyPem);
        return String(publicKey.export({ format: "pem", type: "spki" }) || "").trim();
    }
    catch {
        return "";
    }
}
exports.JWT_SIGNING_PUBLIC_KEY = normalizePem(exports.JWT_SIGNING_PUBLIC_KEY_RAW) || derivePublicKeyPem(normalizePem(exports.JWT_SIGNING_PRIVATE_KEY));
const JWT_PREVIOUS_PUBLIC_KEYS = parsePreviousPublicKeys(exports.JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON);
const JWT_EDDSA_PUBLIC_KEYS = new Map();
if (exports.JWT_SIGNING_PUBLIC_KEY) {
    JWT_EDDSA_PUBLIC_KEYS.set(exports.JWT_SIGNING_KEY_ID, exports.JWT_SIGNING_PUBLIC_KEY);
}
for (const previous of JWT_PREVIOUS_PUBLIC_KEYS) {
    if (previous.kid && previous.publicKey && !JWT_EDDSA_PUBLIC_KEYS.has(previous.kid)) {
        JWT_EDDSA_PUBLIC_KEYS.set(previous.kid, previous.publicKey);
    }
}
const JWT_EDDSA_ENABLED = Boolean(normalizePem(exports.JWT_SIGNING_PRIVATE_KEY) && JWT_EDDSA_PUBLIC_KEYS.size > 0);
exports.JWT_ACCESS_TTL_SECONDS = parseTtlToSeconds(exports.JWT_EXPIRES_IN);
function buildSessionExpiryDate() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + exports.AUTH_SESSION_IDLE_TIMEOUT_DAYS);
    return expiresAt;
}
const signJwt = jsonwebtoken_1.default.sign;
const verifyJwt = jsonwebtoken_1.default.verify;
function isJwtClaims(value) {
    return Boolean(value && typeof value === "object" && "id" in value);
}
function generateToken(user, options = {}) {
    const payload = {
        id: user.id,
        email: user.email,
        username: user.username,
    };
    const expiresIn = options.expiresIn || exports.JWT_EXPIRES_IN;
    if (JWT_EDDSA_ENABLED) {
        (0, keyUsagePolicy_1.assertKeyUsage)({
            keyPurpose: "user_identity_signing",
            operationType: "issue_user_jwt",
            requestedScope: "access_token",
            keyId: exports.JWT_SIGNING_KEY_ID,
        });
        return signJwt(payload, normalizePem(exports.JWT_SIGNING_PRIVATE_KEY), {
            algorithm: "EdDSA",
            expiresIn,
            issuer: exports.JWT_ISSUER,
            audience: exports.JWT_AUDIENCE,
            header: {
                typ: "JWT",
                kid: exports.JWT_SIGNING_KEY_ID,
            },
        });
    }
    (0, keyUsagePolicy_1.assertKeyUsage)({
        keyPurpose: "user_identity_signing",
        operationType: "issue_user_jwt",
        requestedScope: "access_token",
        keyId: "legacy-hs256",
    });
    return signJwt(payload, exports.JWT_SECRET, {
        expiresIn,
        issuer: exports.JWT_ISSUER,
        audience: exports.JWT_AUDIENCE,
        algorithm: "HS256",
    });
}
function verifyToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.decode(token, { complete: true });
        const algorithm = String(decoded?.header?.alg || "HS256").trim();
        if (algorithm === "EdDSA") {
            const kid = String(decoded?.header?.kid || "").trim();
            const verificationKey = kid
                ? JWT_EDDSA_PUBLIC_KEYS.get(kid)
                : JWT_EDDSA_PUBLIC_KEYS.size === 1
                    ? Array.from(JWT_EDDSA_PUBLIC_KEYS.values())[0]
                    : "";
            if (!verificationKey) {
                return null;
            }
            const verified = verifyJwt(token, verificationKey, {
                algorithms: ["EdDSA"],
                issuer: exports.JWT_ISSUER,
                audience: exports.JWT_AUDIENCE,
            });
            return isJwtClaims(verified) ? verified : null;
        }
        if (algorithm !== "HS256") {
            return null;
        }
        try {
            const verified = verifyJwt(token, exports.JWT_SECRET, {
                algorithms: ["HS256"],
                issuer: exports.JWT_ISSUER,
                audience: exports.JWT_AUDIENCE,
            });
            return isJwtClaims(verified) ? verified : null;
        }
        catch {
            const verified = verifyJwt(token, exports.JWT_SECRET, { algorithms: ["HS256"] });
            return isJwtClaims(verified) ? verified : null;
        }
    }
    catch (error) {
        return null;
    }
}
function jwtSupportsOidcJwks() {
    return JWT_EDDSA_ENABLED && JWT_EDDSA_PUBLIC_KEYS.size > 0;
}
function getOpenIdConfiguration(baseUrl) {
    const issuer = String(baseUrl || exports.JWT_ISSUER).replace(/\/$/, "");
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
function getJwtJwks() {
    if (!JWT_EDDSA_ENABLED || JWT_EDDSA_PUBLIC_KEYS.size === 0) {
        return { keys: [] };
    }
    const keys = [];
    for (const [kid, publicKeyPem] of JWT_EDDSA_PUBLIC_KEYS.entries()) {
        try {
            const keyObj = crypto.createPublicKey(publicKeyPem);
            const jwk = keyObj.export({ format: "jwk" });
            keys.push({ ...jwk, kid, use: "sig", alg: "EdDSA" });
        }
        catch {
            // Skip malformed keys
        }
    }
    return { keys };
}
