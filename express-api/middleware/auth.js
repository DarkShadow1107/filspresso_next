/**
 * JWT Authentication Middleware
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db/connection");
const { getEnvOrFile } = require("../utils/secrets");
const { assertKeyUsage } = require("../utils/keyUsagePolicy");

const JWT_SECRET = getEnvOrFile("JWT_SECRET", { required: true });
const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_TOKEN_TTL || "15m").trim() || "15m";
const JWT_ISSUER = String(process.env.JWT_ISSUER || process.env.BACKEND_PUBLIC_URL || "http://localhost:4000")
	.trim()
	.replace(/\/$/, "");
const JWT_AUDIENCE = String(process.env.JWT_AUDIENCE || "filspresso-users").trim() || "filspresso-users";
const JWT_SIGNING_PRIVATE_KEY = getEnvOrFile("JWT_SIGNING_PRIVATE_KEY", { required: false, defaultValue: "" });
const JWT_SIGNING_PUBLIC_KEY_RAW = getEnvOrFile("JWT_SIGNING_PUBLIC_KEY", { required: false, defaultValue: "" });
const JWT_SIGNING_KEY_ID = String(process.env.JWT_SIGNING_KEY_ID || "jwt-k1").trim() || "jwt-k1";
const JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON = String(process.env.JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON || "").trim();
const AUTH_SESSION_IDLE_TIMEOUT_DAYS = Math.max(1, Number.parseInt(process.env.AUTH_SESSION_IDLE_TIMEOUT_DAYS || "30", 10) || 30);

function normalizePem(value) {
	const text = String(value || "").trim();
	if (!text) return "";
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
				.map(([kid, publicKey]) => ({ kid: String(kid || "").trim(), publicKey: normalizePem(publicKey) }))
				.filter((entry) => entry.kid && entry.publicKey);
		}
	} catch {
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
	} catch {
		return "";
	}
}

const JWT_SIGNING_PUBLIC_KEY =
	normalizePem(JWT_SIGNING_PUBLIC_KEY_RAW) || derivePublicKeyPem(normalizePem(JWT_SIGNING_PRIVATE_KEY));
const JWT_PREVIOUS_PUBLIC_KEYS = parsePreviousPublicKeys(JWT_SIGNING_PREVIOUS_PUBLIC_KEYS_JSON);
const JWT_EDDSA_PUBLIC_KEYS = new Map();
if (JWT_SIGNING_PUBLIC_KEY) {
	JWT_EDDSA_PUBLIC_KEYS.set(JWT_SIGNING_KEY_ID, JWT_SIGNING_PUBLIC_KEY);
}
for (const previous of JWT_PREVIOUS_PUBLIC_KEYS) {
	if (previous.kid && previous.publicKey && !JWT_EDDSA_PUBLIC_KEYS.has(previous.kid)) {
		JWT_EDDSA_PUBLIC_KEYS.set(previous.kid, previous.publicKey);
	}
}

const JWT_EDDSA_ENABLED = Boolean(normalizePem(JWT_SIGNING_PRIVATE_KEY) && JWT_EDDSA_PUBLIC_KEYS.size > 0);
const JWT_ACCESS_TTL_SECONDS = parseTtlToSeconds(JWT_EXPIRES_IN);

function exportPublicKeyJwk(publicKeyPem, kid) {
	try {
		const publicKey = crypto.createPublicKey(publicKeyPem);
		const jwk = publicKey.export({ format: "jwk" });
		if (!jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
			return null;
		}

		return {
			kty: jwk.kty,
			crv: jwk.crv,
			x: jwk.x,
			alg: "EdDSA",
			use: "sig",
			kid,
		};
	} catch {
		return null;
	}
}

function getJwtJwks() {
	if (!JWT_EDDSA_ENABLED) {
		return { keys: [] };
	}

	const keys = [];
	for (const [kid, publicKey] of JWT_EDDSA_PUBLIC_KEYS.entries()) {
		const jwk = exportPublicKeyJwk(publicKey, kid);
		if (jwk) {
			keys.push(jwk);
		}
	}

	return { keys };
}

function jwtSupportsOidcJwks() {
	return getJwtJwks().keys.length > 0;
}

function getOpenIdConfiguration(baseUrl) {
	const normalizedBase = String(baseUrl || JWT_ISSUER || "http://localhost:4000")
		.trim()
		.replace(/\/$/, "");
	const issuer = String(JWT_ISSUER || normalizedBase || "http://localhost:4000")
		.trim()
		.replace(/\/$/, "");

	return {
		issuer,
		jwks_uri: `${normalizedBase}/api/auth/.well-known/jwks.json`,
		token_endpoint: `${normalizedBase}/api/auth/login`,
		userinfo_endpoint: `${normalizedBase}/api/auth/me`,
		revocation_endpoint: `${normalizedBase}/api/auth/logout`,
		grant_types_supported: ["authorization_code", "refresh_token"],
		response_types_supported: ["token"],
		subject_types_supported: ["public"],
		id_token_signing_alg_values_supported: ["EdDSA"],
		token_endpoint_auth_methods_supported: ["none"],
	};
}

/**
 * Generate JWT token for a user
 * @param {object} user - User object with id, email, username
 * @returns {string} - JWT token
 */
function generateToken(user, options = {}) {
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

		return jwt.sign(payload, normalizePem(JWT_SIGNING_PRIVATE_KEY), {
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

	return jwt.sign(payload, JWT_SECRET, {
		expiresIn,
		issuer: JWT_ISSUER,
		audience: JWT_AUDIENCE,
		algorithm: "HS256",
	});
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {object|null} - Decoded token or null
 */
function verifyToken(token) {
	try {
		const decoded = jwt.decode(token, { complete: true });
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

			return jwt.verify(token, verificationKey, {
				algorithms: ["EdDSA"],
				issuer: JWT_ISSUER,
				audience: JWT_AUDIENCE,
			});
		}

		if (algorithm !== "HS256") {
			return null;
		}

		try {
			return jwt.verify(token, JWT_SECRET, {
				algorithms: ["HS256"],
				issuer: JWT_ISSUER,
				audience: JWT_AUDIENCE,
			});
		} catch {
			// Backward compatibility for legacy HS256 tokens minted before issuer/audience claims.
			return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
		}
	} catch (error) {
		return null;
	}
}

function buildSessionExpiryDate() {
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + AUTH_SESSION_IDLE_TIMEOUT_DAYS);
	return expiresAt;
}

async function getActiveSessionUser(accountId, token, options = {}) {
	const { refreshSession = true } = options;
	const result = await pool.query(
		`SELECT a.id, a.username, a.email, a.name, a.icon, a.subscription, a.role
		 FROM accounts a
		 JOIN user_sessions s ON s.account_id = a.id
		 WHERE a.id = $1
		   AND s.session_token = $2
		   AND s.expires_at > NOW()
		 LIMIT 1`,
		[accountId, token],
	);

	const user = result.rows[0] || null;
	if (!user) {
		return null;
	}

	if (refreshSession) {
		try {
			await pool.query(
				"UPDATE user_sessions SET expires_at = NOW() + (($3)::text || ' days')::interval WHERE account_id = $1 AND session_token = $2 AND expires_at > NOW()",
				[accountId, token, AUTH_SESSION_IDLE_TIMEOUT_DAYS],
			);
		} catch (refreshError) {
			console.warn("Session refresh error:", refreshError);
		}
	}

	return user;
}

/**
 * Authentication middleware
 */
async function authenticate(req, res, next) {
	try {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ error: "Authentication required" });
		}

		const token = authHeader.slice(7).trim();
		if (!token) {
			return res.status(401).json({ error: "Authentication required" });
		}
		const decoded = verifyToken(token);

		if (!decoded) {
			return res.status(401).json({ error: "Invalid or expired token" });
		}

		// Require an active server-side session for every JWT.
		try {
			const user = await getActiveSessionUser(decoded.id, token);

			if (!user) {
				return res.status(401).json({ error: "Invalid or expired session" });
			}

			req.user = user;
			next();
		} catch (dbError) {
			console.error("DB Auth error:", dbError);
			return res.status(500).json({ error: "Database error during authentication" });
		}
	} catch (error) {
		console.error("Auth error:", error);
		res.status(500).json({ error: "Authentication failed" });
	}
}

/**
 * Optional authentication - doesn't fail if no token
 */
async function optionalAuth(req, res, next) {
	try {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			req.user = null;
			return next();
		}

		const token = authHeader.slice(7).trim();
		if (!token) {
			req.user = null;
			return next();
		}
		const decoded = verifyToken(token);

		if (!decoded) {
			req.user = null;
			return next();
		}

		try {
			req.user = await getActiveSessionUser(decoded.id, token);
		} catch (err) {
			req.user = null;
		}

		next();
	} catch (error) {
		req.user = null;
		next();
	}
}

module.exports = {
	generateToken,
	verifyToken,
	authenticate,
	optionalAuth,
	buildSessionExpiryDate,
	AUTH_SESSION_IDLE_TIMEOUT_DAYS,
	JWT_SECRET,
	JWT_EXPIRES_IN,
	JWT_ACCESS_TTL_SECONDS,
	JWT_ISSUER,
	JWT_AUDIENCE,
	getOpenIdConfiguration,
	getJwtJwks,
	jwtSupportsOidcJwks,
};
