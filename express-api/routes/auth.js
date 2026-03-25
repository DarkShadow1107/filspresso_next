/**
 * Authentication Routes
 * POST /api/auth/register - Register new user
 * POST /api/auth/login - Login user
 * POST /api/auth/logout - Logout user
 * GET /api/auth/me - Get current user
 */

const express = require("express");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const QRCode = require("qrcode");
const pool = require("../db/connection");
const { generateToken, authenticate } = require("../middleware/auth");
const { encrypt, decrypt } = require("../utils/encryption");
const {
	sendTransactionalEmail,
	buildEmailVerificationHtml,
	buildWelcomeHtml,
	buildSecurityLoginHtml,
} = require("../utils/resendMailer");

const router = express.Router();
const SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("filspresso_dummy_password", SALT_ROUNDS);
const IS_NON_PROD = process.env.NODE_ENV !== "production";
const RELAX_AUTH_LIMITS_IN_DEV =
	IS_NON_PROD && process.env.ENABLE_STRICT_AUTH_LIMITS !== "true" && process.env.DISABLE_RATE_LIMIT !== "false";

const AUTH_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000", 10));
const AUTH_MAX_ATTEMPTS = Math.max(5, Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || "30", 10));
const AUTH_LOCK_THRESHOLD = Math.max(3, Number.parseInt(process.env.AUTH_LOCK_THRESHOLD || "5", 10));
const AUTH_FAILURE_WINDOW_MINUTES = Math.max(1, Number.parseInt(process.env.AUTH_FAILURE_WINDOW_MINUTES || "30", 10));
const AUTH_LOCK_BASE_SECONDS = Math.max(5, Number.parseInt(process.env.AUTH_LOCK_BASE_SECONDS || "60", 10));
const AUTH_LOCK_MAX_SECONDS = Math.max(AUTH_LOCK_BASE_SECONDS, Number.parseInt(process.env.AUTH_LOCK_MAX_SECONDS || "1800", 10));
const USER_MFA_ISSUER = String(process.env.USER_MFA_ISSUER || "Filspresso").slice(0, 64);
const FRONTEND_ORIGIN =
	process.env.FRONTEND_ORIGIN ||
	process.env.NEXT_PUBLIC_FRONTEND_URL ||
	String(process.env.CORS_ORIGIN || "http://localhost:3000")
		.split(",")[0]
		.trim() ||
	"http://localhost:3000";
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || "http://localhost:4000";
const EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = Math.max(
	300,
	Number.parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS || "86400", 10),
);
const USER_MFA_CODE_DIGITS = 6;
const USER_MFA_TIME_STEP_SECONDS = Math.max(15, Number.parseInt(process.env.USER_MFA_TIME_STEP_SECONDS || "30", 10));
const USER_MFA_ALLOWED_DRIFT_STEPS = Math.max(0, Number.parseInt(process.env.USER_MFA_ALLOWED_DRIFT_STEPS || "1", 10));
const USER_MFA_VERIFY_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.USER_MFA_VERIFY_TTL_SECONDS || "300", 10));
const USER_MFA_SETUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.USER_MFA_SETUP_TTL_SECONDS || "600", 10));

const authAttemptLimiter = rateLimit({
	windowMs: AUTH_WINDOW_MS,
	max: AUTH_MAX_ATTEMPTS,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	skip: () => RELAX_AUTH_LIMITS_IN_DEV,
	message: { status: "error", message: "Too many authentication attempts. Please try again later." },
});

function normalizeCredentialField(value, maxLength) {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, maxLength);
}

function isReasonablePassword(password) {
	return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

function getClientIp(req) {
	const forwarded = String(req.headers["x-forwarded-for"] || "")
		.split(",")[0]
		.trim();
	const realIp = String(req.headers["x-real-ip"] || "").trim();
	const candidate = forwarded || realIp || req.ip || req.socket?.remoteAddress || "";
	return String(candidate).slice(0, 64) || null;
}

function normalizeLoginKey(loginField) {
	return normalizeCredentialField(loginField, 254).toLowerCase();
}

function computeLockSeconds(failedAttempts) {
	if (failedAttempts < AUTH_LOCK_THRESHOLD) return 0;
	const exponent = Math.max(0, failedAttempts - AUTH_LOCK_THRESHOLD);
	const calculated = AUTH_LOCK_BASE_SECONDS * 2 ** exponent;
	return Math.min(calculated, AUTH_LOCK_MAX_SECONDS);
}

async function getLockState(client, loginKey) {
	if (RELAX_AUTH_LIMITS_IN_DEV) {
		return { isLocked: false, retryAfterSeconds: 0, failedAttempts: 0 };
	}

	const result = await client.query(
		`SELECT failed_attempts, lock_until
		 FROM auth_login_attempts
		 WHERE login_key = $1
		 LIMIT 1`,
		[loginKey],
	);

	const row = result.rows[0];
	if (!row) {
		return { isLocked: false, retryAfterSeconds: 0, failedAttempts: 0 };
	}

	const lockUntil = row.lock_until ? new Date(row.lock_until) : null;
	if (!lockUntil || Number.isNaN(lockUntil.getTime()) || lockUntil <= new Date()) {
		return { isLocked: false, retryAfterSeconds: 0, failedAttempts: Number(row.failed_attempts) || 0 };
	}

	const retryAfterSeconds = Math.max(1, Math.ceil((lockUntil.getTime() - Date.now()) / 1000));
	return {
		isLocked: true,
		retryAfterSeconds,
		failedAttempts: Number(row.failed_attempts) || 0,
	};
}

async function recordFailedAttempt(client, loginKey) {
	const result = await client.query(
		`INSERT INTO auth_login_attempts (login_key, failed_attempts, first_failed_at, last_failed_at, lock_until, updated_at)
		 VALUES ($1, 1, NOW(), NOW(), NULL, NOW())
		 ON CONFLICT (login_key) DO UPDATE
		 SET failed_attempts = CASE
				WHEN auth_login_attempts.last_failed_at IS NULL
					OR auth_login_attempts.last_failed_at < NOW() - (($2)::text || ' minutes')::interval
				THEN 1
				ELSE auth_login_attempts.failed_attempts + 1
			END,
			 first_failed_at = CASE
				WHEN auth_login_attempts.last_failed_at IS NULL
					OR auth_login_attempts.last_failed_at < NOW() - (($2)::text || ' minutes')::interval
				THEN NOW()
				ELSE auth_login_attempts.first_failed_at
			END,
			 last_failed_at = NOW(),
			 updated_at = NOW()
		 RETURNING failed_attempts`,
		[loginKey, AUTH_FAILURE_WINDOW_MINUTES],
	);

	const failedAttempts = Number(result.rows[0]?.failed_attempts) || 1;
	const lockSeconds = computeLockSeconds(failedAttempts);

	if (lockSeconds > 0) {
		await client.query(
			"UPDATE auth_login_attempts SET lock_until = NOW() + (($1)::text || ' seconds')::interval WHERE login_key = $2",
			[lockSeconds, loginKey],
		);
	}

	return { failedAttempts, lockSeconds };
}

async function clearFailedAttempts(client, loginKey) {
	await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]);
}

async function logAuthSecurityEvent(client, eventType, payload = {}) {
	const loginKey = payload.loginKey ? String(payload.loginKey).slice(0, 254) : null;
	const accountId = Number.isInteger(payload.accountId) ? payload.accountId : null;
	const ipAddress = payload.ipAddress ? String(payload.ipAddress).slice(0, 64) : null;
	const userAgent = payload.userAgent ? String(payload.userAgent).slice(0, 512) : null;
	const details = payload.details && typeof payload.details === "object" ? payload.details : {};

	await client.query(
		`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
		[eventType, loginKey, accountId, ipAddress, userAgent, JSON.stringify(details)],
	);
}

function hashMfaChallengeToken(token) {
	return crypto
		.createHash("sha256")
		.update(String(token || ""))
		.digest("hex");
}

function generateMfaBase32Secret(length = 32) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const bytes = crypto.randomBytes(length);
	let output = "";
	for (let i = 0; i < bytes.length; i += 1) {
		output += alphabet[bytes[i] % alphabet.length];
	}
	return output;
}

function decodeMfaBase32(base32) {
	const clean = String(base32 || "")
		.toUpperCase()
		.replace(/=+$/g, "")
		.replace(/[^A-Z2-7]/g, "");
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const char of clean) {
		const value = alphabet.indexOf(char);
		if (value < 0) continue;
		bits += value.toString(2).padStart(5, "0");
	}

	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) {
		bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
	}
	return Buffer.from(bytes);
}

function generateTotpCode(secret, timestampMs = Date.now()) {
	const key = decodeMfaBase32(secret);
	if (!key.length) return null;

	const counter = Math.floor(timestampMs / 1000 / USER_MFA_TIME_STEP_SECONDS);
	const counterBuffer = Buffer.alloc(8);
	counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
	counterBuffer.writeUInt32BE(counter >>> 0, 4);

	const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const binary =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff);
	return String(binary % 10 ** USER_MFA_CODE_DIGITS).padStart(USER_MFA_CODE_DIGITS, "0");
}

function verifyTotpCode(secret, submittedCode) {
	const normalizedCode = String(submittedCode || "")
		.trim()
		.replace(/\s+/g, "");
	if (!/^\d{6,8}$/.test(normalizedCode)) {
		return false;
	}

	for (let drift = -USER_MFA_ALLOWED_DRIFT_STEPS; drift <= USER_MFA_ALLOWED_DRIFT_STEPS; drift += 1) {
		const timestamp = Date.now() + drift * USER_MFA_TIME_STEP_SECONDS * 1000;
		const code = generateTotpCode(secret, timestamp);
		if (code && code === normalizedCode) {
			return true;
		}
	}

	return false;
}

function buildUserOtpAuthUrl(secret, username) {
	const accountName = encodeURIComponent(
		String(username || "user")
			.trim()
			.toLowerCase(),
	);
	const issuer = encodeURIComponent(USER_MFA_ISSUER);
	return `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${USER_MFA_CODE_DIGITS}&period=${USER_MFA_TIME_STEP_SECONDS}`;
}

async function generateMfaQrDataUrl(otpauthUrl) {
	try {
		return await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: "M", margin: 1, width: 220 });
	} catch {
		return null;
	}
}

async function buildMfaSetupPayload({ secret, username, includeQrCode }) {
	const otpauthUrl = buildUserOtpAuthUrl(secret, username);
	const payload = {
		secret,
		issuer: USER_MFA_ISSUER,
		accountName: username,
		otpauthUrl,
	};

	if (includeQrCode) {
		payload.qrDataUrl = await generateMfaQrDataUrl(otpauthUrl);
	}

	return payload;
}

async function createUserMfaChallenge(client, { accountId, purpose, ttlSeconds, tempSecretEncrypted = null }) {
	const token = `mfa_${crypto.randomBytes(48).toString("hex")}`;
	const tokenHash = hashMfaChallengeToken(token);
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

	await client.query(
		`INSERT INTO user_mfa_challenges (account_id, challenge_token_hash, purpose, temp_secret_encrypted, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		[accountId, tokenHash, purpose, tempSecretEncrypted, expiresAt],
	);

	return { token, expiresIn: ttlSeconds };
}

async function getActiveUserMfaChallenge(client, token) {
	const tokenHash = hashMfaChallengeToken(token);
	const result = await client.query(
		`SELECT c.id, c.account_id, c.purpose, c.temp_secret_encrypted, c.attempts, c.max_attempts, c.expires_at,
				a.username, a.email, a.name, a.icon, a.role, a.created_at, a.subscription, a.user_mfa_enabled, a.user_mfa_secret_encrypted
		 FROM user_mfa_challenges c
		 JOIN accounts a ON a.id = c.account_id
		 WHERE c.challenge_token_hash = $1
		   AND c.consumed_at IS NULL
		 LIMIT 1`,
		[tokenHash],
	);

	return result.rows[0] || null;
}

async function invalidateExpiredUserMfaChallenges(client) {
	await client.query("DELETE FROM user_mfa_challenges WHERE consumed_at IS NOT NULL OR expires_at < NOW()");
}

function formatUserIcon(icon) {
	let iconUrl = icon || null;
	if (iconUrl && !iconUrl.startsWith("/") && !iconUrl.startsWith("http") && !iconUrl.startsWith("data:")) {
		iconUrl = `/images/icons/${iconUrl}`;
	}
	if (iconUrl && iconUrl.startsWith("/images/icons/") && !/\.(svg|png|jpe?g|ico|webp|avif)(\?.*)?$/i.test(iconUrl)) {
		iconUrl = `${iconUrl}.svg`;
	}
	return iconUrl;
}

function buildAuthAccountPayload(user) {
	return {
		name: user.name,
		full_name: user.name,
		username: user.username,
		email: user.email,
		role: user.role,
		icon: formatUserIcon(user.icon),
		created_at: user.created_at,
	};
}

function parseJsonSafe(input) {
	if (typeof input !== "string" || !input.trim()) return null;
	try {
		return JSON.parse(input);
	} catch {
		return null;
	}
}

function parseJwtPayload(token) {
	if (typeof token !== "string") return null;
	const parts = token.split(".");
	if (parts.length < 2) return null;
	try {
		return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

function safeReturnTo(value) {
	if (typeof value !== "string") return "/?page=account";
	const trimmed = value.trim();
	if (!trimmed.startsWith("/")) return "/?page=account";
	if (trimmed.startsWith("//")) return "/?page=account";
	if (trimmed.includes("\n") || trimmed.includes("\r")) return "/?page=account";
	return trimmed;
}

function createOAuthState(provider, mode, returnTo) {
	const payload = {
		provider,
		mode,
		returnTo: safeReturnTo(returnTo),
		timestamp: Date.now(),
		nonce: crypto.randomBytes(12).toString("hex"),
	};
	const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(serialized).digest("base64url");
	return `${serialized}.${signature}`;
}

function verifyOAuthState(state, expectedProvider) {
	if (typeof state !== "string" || !state.includes(".")) {
		return null;
	}
	const [serialized, signature] = state.split(".");
	if (!serialized || !signature) return null;
	const expectedSignature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(serialized).digest("base64url");
	if (signature !== expectedSignature) {
		return null;
	}

	const payload = parseJsonSafe(Buffer.from(serialized, "base64url").toString("utf8"));
	if (!payload || payload.provider !== expectedProvider) return null;

	const ageMs = Date.now() - Number(payload.timestamp || 0);
	if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) {
		return null;
	}

	return {
		mode: payload.mode === "signup" ? "signup" : "login",
		returnTo: safeReturnTo(payload.returnTo),
	};
}

function buildOAuthConfig(provider) {
	if (provider === "google") {
		if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI) return null;
		return {
			provider,
			clientId: GOOGLE_OAUTH_CLIENT_ID,
			clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
			redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
		};
	}

	return null;
}

function createEmailVerificationToken({ accountId, email }) {
	const payload = {
		aid: Number(accountId),
		email: normalizeCredentialField(email, 254).toLowerCase(),
		exp: Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_SECONDS * 1000,
		nonce: crypto.randomBytes(12).toString("hex"),
	};

	const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
	const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(serialized).digest("base64url");
	return `${serialized}.${signature}`;
}

function verifyEmailVerificationToken(token) {
	if (typeof token !== "string" || !token.includes(".")) {
		return null;
	}

	const [serialized, signature] = token.split(".");
	if (!serialized || !signature) return null;

	const expectedSignature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(serialized).digest("base64url");
	if (expectedSignature !== signature) return null;

	const payload = parseJsonSafe(Buffer.from(serialized, "base64url").toString("utf8"));
	if (!payload || !Number.isFinite(payload.exp) || payload.exp < Date.now()) {
		return null;
	}

	const accountId = Number.parseInt(String(payload.aid || ""), 10);
	const email = normalizeCredentialField(payload.email, 254).toLowerCase();
	if (!Number.isInteger(accountId) || accountId <= 0 || !email) {
		return null;
	}

	return { accountId, email };
}

async function sendEmailVerificationMessage({ accountId, email, displayName }) {
	const token = createEmailVerificationToken({ accountId, email });
	const verificationUrl = `${BACKEND_PUBLIC_URL.replace(/\/$/, "")}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
	const html = buildEmailVerificationHtml({ displayName, verificationUrl });

	return sendTransactionalEmail({
		to: email,
		subject: "Verify your Filspresso email",
		html,
		text: `Verify your Filspresso account: ${verificationUrl}`,
	});
}

async function sendWelcomeMessage({ email, displayName }) {
	if (!email) return;
	const accountUrl = `${FRONTEND_ORIGIN.replace(/\/$/, "")}/?page=account`;
	const html = buildWelcomeHtml({ displayName, accountUrl });
	return sendTransactionalEmail({
		to: email,
		subject: "Welcome to Filspresso",
		html,
		text: `Welcome to Filspresso, ${displayName || "there"}. Manage your account here: ${accountUrl}`,
	});
}

async function sendSecurityLoginMessage({ email, displayName, ipAddress, userAgent }) {
	if (!email) return;
	const html = buildSecurityLoginHtml({
		displayName,
		ipAddress,
		userAgent,
		occurredAt: new Date().toISOString(),
	});
	return sendTransactionalEmail({
		to: email,
		subject: "Filspresso security alert: new login",
		html,
		text: `New login detected at ${new Date().toISOString()} from ${ipAddress || "unknown IP"}. Device: ${
			userAgent || "unknown"
		}`,
	});
}

function normalizeOAuthProfileName(profile, fallbackEmail) {
	const candidate =
		profile.name ||
		profile.given_name ||
		[profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
		(fallbackEmail ? String(fallbackEmail).split("@")[0] : "");
	return normalizeCredentialField(candidate || "Filspresso User", 120) || "Filspresso User";
}

async function createUniqueUsername(client, preferredBase) {
	const normalizedBase =
		normalizeCredentialField(preferredBase, 40)
			.toLowerCase()
			.replace(/[^a-z0-9._-]/g, "") || `user${crypto.randomBytes(3).toString("hex")}`;

	for (let attempt = 0; attempt < 20; attempt += 1) {
		const suffix = attempt === 0 ? "" : `_${crypto.randomBytes(2).toString("hex")}`;
		const candidate = `${normalizedBase}${suffix}`.slice(0, 50);
		const existing = await client.query("SELECT id FROM accounts WHERE username = $1 LIMIT 1", [candidate]);
		if (!existing.rows[0]) {
			return candidate;
		}
	}

	return `user_${crypto.randomBytes(5).toString("hex")}`;
}

function buildOAuthSuccessRedirect(returnTo, account, token) {
	const url = new URL(returnTo, FRONTEND_ORIGIN);
	const payload = Buffer.from(JSON.stringify({ account: buildAuthAccountPayload(account), token }), "utf8").toString(
		"base64url",
	);
	url.searchParams.set("oauth", payload);
	return url.toString();
}

function buildOAuthFailureRedirect(returnTo, errorCode) {
	const url = new URL(returnTo, FRONTEND_ORIGIN);
	url.searchParams.set("oauth_error", errorCode || "oauth_failed");
	return url.toString();
}

async function findOrCreateOAuthAccount(client, { provider, subject, email, displayName, pictureUrl }) {
	const providerColumn = "google_sub";
	const normalizedEmail = normalizeCredentialField(email, 254).toLowerCase();
	const normalizedSubject = normalizeCredentialField(subject, 191);
	if (!normalizedEmail || !normalizedSubject) return null;

	let existing = await client.query(
		`SELECT id, username, email, name, icon, role, created_at
		 FROM accounts
		 WHERE ${providerColumn} = $1
		 LIMIT 1`,
		[normalizedSubject],
	);
	if (existing.rows[0]) {
		return { ...existing.rows[0], isNewAccount: false };
	}

	existing = await client.query(
		"SELECT id, username, email, name, icon, role, created_at FROM accounts WHERE email = $1 LIMIT 1",
		[normalizedEmail],
	);

	if (existing.rows[0]) {
		const current = existing.rows[0];
		await client.query(
			`UPDATE accounts
			 SET ${providerColumn} = $1,
				 oauth_provider = COALESCE(oauth_provider, $2),
				 oauth_subject = COALESCE(oauth_subject, $3),
				 oauth_linked_at = COALESCE(oauth_linked_at, NOW()),
				 icon = COALESCE(NULLIF(icon, ''), $4),
				 name = CASE WHEN COALESCE(name, '') = '' THEN $5 ELSE name END,
				 updated_at = NOW()
			 WHERE id = $6`,
			[normalizedSubject, provider, normalizedSubject, pictureUrl || null, displayName, current.id],
		);

		return {
			...current,
			name: current.name || displayName,
			icon: current.icon || pictureUrl || null,
			isNewAccount: false,
		};
	}

	const usernameBase = normalizedEmail.split("@")[0] || `user_${provider}`;
	const username = await createUniqueUsername(client, usernameBase);
	const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), SALT_ROUNDS);
	const created = await client.query(
		`INSERT INTO accounts (
			username,
			email,
			password_hash,
			name,
			icon,
			oauth_provider,
			oauth_subject,
			oauth_linked_at,
			google_sub,
			email_verified
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, TRUE)
		RETURNING id, username, email, name, icon, role, created_at`,
		[
			username,
			normalizedEmail,
			randomPasswordHash,
			displayName,
			pictureUrl || null,
			provider,
			normalizedSubject,
			normalizedSubject,
		],
	);

	if (!created.rows[0]) return null;
	return { ...created.rows[0], isNewAccount: true };
}

router.get("/oauth/:provider/start", async (req, res) => {
	const provider = String(req.params.provider || "").toLowerCase();
	if (provider !== "google") {
		return res.status(404).json({ status: "error", message: "Unknown OAuth provider" });
	}

	const oauthConfig = buildOAuthConfig(provider);
	if (!oauthConfig) {
		return res.status(503).json({ status: "error", message: `${provider} OAuth is not configured` });
	}

	const mode = String(req.query.mode || "login").toLowerCase() === "signup" ? "signup" : "login";
	const returnTo = safeReturnTo(String(req.query.returnTo || "/?page=account"));
	const state = createOAuthState(provider, mode, returnTo);

	const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	url.searchParams.set("client_id", oauthConfig.clientId);
	url.searchParams.set("redirect_uri", oauthConfig.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", "openid email profile");
	url.searchParams.set("state", state);
	url.searchParams.set("prompt", "select_account");
	return res.redirect(302, url.toString());
});

router.get("/oauth/:provider/callback", async (req, res) => {
	const provider = String(req.params.provider || "").toLowerCase();
	if (provider !== "google") {
		return res.status(404).json({ status: "error", message: "Unknown OAuth provider" });
	}
	const oauthConfig = buildOAuthConfig(provider);
	if (!oauthConfig) {
		return res.status(503).json({ status: "error", message: `${provider} OAuth is not configured` });
	}

	const code = normalizeCredentialField(req.query.code, 2048);
	const state = normalizeCredentialField(req.query.state, 4096);
	const verifiedState = verifyOAuthState(state, provider);
	const returnTo = verifiedState?.returnTo || "/?page=account";

	if (!verifiedState || !code) {
		return res.redirect(302, buildOAuthFailureRedirect(returnTo, "invalid_oauth_response"));
	}

	let profile;
	try {
		const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: oauthConfig.clientId,
				client_secret: oauthConfig.clientSecret,
				redirect_uri: oauthConfig.redirectUri,
				grant_type: "authorization_code",
			}).toString(),
		});
		if (!tokenResponse.ok) {
			throw new Error("Google token exchange failed");
		}

		const tokenData = await tokenResponse.json();
		const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
			headers: { Authorization: `Bearer ${tokenData.access_token}` },
		});
		if (!userInfoResponse.ok) {
			throw new Error("Google userinfo fetch failed");
		}
		profile = await userInfoResponse.json();
	} catch (error) {
		console.error("OAuth callback exchange error:", error);
		return res.redirect(302, buildOAuthFailureRedirect(returnTo, "oauth_exchange_failed"));
	}

	const providerSubject = normalizeCredentialField(profile?.sub, 191);
	const email = normalizeCredentialField(profile?.email, 254).toLowerCase();
	const displayName = normalizeOAuthProfileName(profile || {}, email);
	const pictureUrl = normalizeCredentialField(profile?.picture, 255) || null;

	if (!providerSubject || !email) {
		return res.redirect(302, buildOAuthFailureRedirect(returnTo, "oauth_profile_incomplete"));
	}

	const client = await pool.connect();
	try {
		const account = await findOrCreateOAuthAccount(client, {
			provider,
			subject: providerSubject,
			email,
			displayName,
			pictureUrl,
		});

		if (!account) {
			return res.redirect(302, buildOAuthFailureRedirect(returnTo, "oauth_account_failed"));
		}

		await client.query("UPDATE accounts SET last_login = NOW(), updated_at = NOW() WHERE id = $1", [account.id]);

		const token = generateToken(account);
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + 7);
		await client.query(
			"INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
			[account.id, token, expiresAt, req.ip, req.get("user-agent")],
		);

		await logAuthSecurityEvent(client, "oauth_login_success", {
			accountId: account.id,
			ipAddress: getClientIp(req),
			userAgent: String(req.get("user-agent") || "").slice(0, 512),
			details: { provider, mode: verifiedState.mode },
		});

		setImmediate(() => {
			sendSecurityLoginMessage({
				email: account.email,
				displayName: account.name || account.username,
				ipAddress: getClientIp(req),
				userAgent: String(req.get("user-agent") || "").slice(0, 512),
			}).catch((mailError) => {
				console.error("Failed to send OAuth security email:", mailError);
			});

			if (account.isNewAccount) {
				sendWelcomeMessage({
					email: account.email,
					displayName: account.name || account.username,
				}).catch((mailError) => {
					console.error("Failed to send OAuth welcome email:", mailError);
				});
			}
		});

		return res.redirect(302, buildOAuthSuccessRedirect(returnTo, account, token));
	} catch (error) {
		console.error("OAuth login error:", error);
		return res.redirect(302, buildOAuthFailureRedirect(returnTo, "oauth_login_failed"));
	} finally {
		client.release();
	}
});

router.get("/verify-email", async (req, res) => {
	const token = normalizeCredentialField(req.query.token, 4096);
	const verified = verifyEmailVerificationToken(token);
	const redirectBase = `${FRONTEND_ORIGIN.replace(/\/$/, "")}/?page=account`;

	if (!verified) {
		return res.redirect(302, `${redirectBase}&email_verified=0`);
	}

	let client;
	try {
		client = await pool.connect();
		await client.query("UPDATE accounts SET email_verified = TRUE, updated_at = NOW() WHERE id = $1 AND email = $2", [
			verified.accountId,
			verified.email,
		]);
		return res.redirect(302, `${redirectBase}&email_verified=1`);
	} catch (error) {
		console.error("Email verification error:", error);
		return res.redirect(302, `${redirectBase}&email_verified=0`);
	} finally {
		if (client) client.release();
	}
});

router.post("/verify-email/resend", authenticate, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const result = await client.query("SELECT id, email, name, username, email_verified FROM accounts WHERE id = $1", [
				req.user.id,
			]);
			const user = result.rows[0];
			if (!user) {
				return res.status(404).json({ status: "error", message: "Account not found" });
			}

			if (user.email_verified) {
				return res.status(200).json({ status: "success", message: "Email already verified" });
			}

			await sendEmailVerificationMessage({
				accountId: user.id,
				email: user.email,
				displayName: user.name || user.username,
			});

			return res.json({ status: "success", message: "Verification email sent" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Resend verification email error:", error);
		return res.status(500).json({ status: "error", message: "Failed to resend verification email" });
	}
});

/**
 * Register a new user
 */
router.post("/register", authAttemptLimiter, async (req, res) => {
	try {
		const username = normalizeCredentialField(req.body?.username, 64);
		const email = normalizeCredentialField(req.body?.email, 254);
		const password = typeof req.body?.password === "string" ? req.body.password : "";
		const full_name = normalizeCredentialField(req.body?.full_name, 120);
		const name = normalizeCredentialField(req.body?.name, 120);
		const icon = typeof req.body?.icon === "string" ? req.body.icon.trim().slice(0, 255) : null;
		const enable2fa = Boolean(req.body?.enable2fa);
		const includeQrCode = Boolean(req.body?.includeQrCode);
		const displayName = full_name || name;

		// Validation
		if (!username || !email || !password) {
			return res.status(400).json({ status: "error", message: "Username, email, and password are required" });
		}

		if (!isReasonablePassword(password)) {
			return res.status(400).json({ status: "error", message: "Password must be 8-128 characters" });
		}

		const client = await pool.connect();
		try {
			// Check if user exists
			const existing = await client.query("SELECT id FROM accounts WHERE email = $1 OR username = $2", [
				email.toLowerCase(),
				username.toLowerCase(),
			]);

			if (existing.rows.length > 0) {
				return res.status(409).json({ status: "error", message: "User with this email or username already exists" });
			}

			// Hash password
			const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

			// Insert user
			const result = await client.query(
				`INSERT INTO accounts (username, email, password_hash, name, icon, email_verified) 
        VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
				[username.toLowerCase(), email.toLowerCase(), passwordHash, displayName || username, icon || null],
			);

			const userId = result.rows[0].id;

			// Get created user
			const userRes = await client.query(
				"SELECT id, username, email, name, icon, role, created_at FROM accounts WHERE id = $1",
				[userId],
			);
			const user = userRes.rows[0];

			// Generate token
			const token = generateToken(user);

			// Record session in database so JWT is bound to an active server-side session.
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);
			await client.query(
				"INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
				[user.id, token, expiresAt, req.ip, req.get("user-agent")],
			);

			let mfaSetup = null;
			if (enable2fa) {
				const setupSecret = generateMfaBase32Secret(32);
				const challenge = await createUserMfaChallenge(client, {
					accountId: user.id,
					purpose: "enable",
					ttlSeconds: USER_MFA_SETUP_TTL_SECONDS,
					tempSecretEncrypted: encrypt(setupSecret),
				});

				mfaSetup = {
					challengeToken: challenge.token,
					expiresIn: challenge.expiresIn,
					totp: await buildMfaSetupPayload({
						secret: setupSecret,
						username: user.username,
						includeQrCode,
					}),
				};

				await logAuthSecurityEvent(client, "user_mfa_setup_started", {
					accountId: user.id,
					ipAddress: getClientIp(req),
					userAgent: String(req.get("user-agent") || "").slice(0, 512),
				});
			}

			res.status(201).json({
				status: "success",
				message: "User registered successfully",
				account: buildAuthAccountPayload(user),
				icon_path: formatUserIcon(user.icon),
				token,
				mfaSetup,
			});

			sendEmailVerificationMessage({
				accountId: user.id,
				email: user.email,
				displayName: user.name || user.username,
			}).catch((mailError) => {
				console.error("Failed to send verification email:", mailError);
			});

			sendWelcomeMessage({
				email: user.email,
				displayName: user.name || user.username,
			}).catch((mailError) => {
				console.error("Failed to send welcome email:", mailError);
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Registration error:", error);
		res.status(500).json({ status: "error", message: "Registration failed" });
	}
});

/**
 * Login user
 */
router.post("/login", authAttemptLimiter, async (req, res) => {
	try {
		const email = normalizeCredentialField(req.body?.email, 254);
		const username = normalizeCredentialField(req.body?.username, 64);
		const password = typeof req.body?.password === "string" ? req.body.password : "";
		const loginField = email || username;
		const loginKey = normalizeLoginKey(loginField);
		const ipAddress = getClientIp(req);
		const userAgent = String(req.get("user-agent") || "").slice(0, 512);
		const includeQrCode = Boolean(req.body?.includeQrCode);

		if (!loginField || !password) {
			return res.status(400).json({ status: "error", message: "Email/username and password are required" });
		}

		if (loginField.length > 254 || password.length > 128 || !loginKey) {
			return res.status(400).json({ status: "error", message: "Invalid credentials format" });
		}

		const client = await pool.connect();
		try {
			const lockState = await getLockState(client, loginKey);
			if (lockState.isLocked) {
				await logAuthSecurityEvent(client, "login_locked", {
					loginKey,
					ipAddress,
					userAgent,
					details: { retryAfterSeconds: lockState.retryAfterSeconds, failedAttempts: lockState.failedAttempts },
				});
				res.setHeader("Retry-After", String(lockState.retryAfterSeconds));
				return res.status(429).json({
					status: "error",
					message: "Too many failed login attempts. Try again later.",
					retryAfterSeconds: lockState.retryAfterSeconds,
				});
			}

			// Find user by email or username
			const userRes = await client.query(
				"SELECT id, username, email, password_hash, name, icon, subscription, role, created_at, user_mfa_enabled, user_mfa_secret_encrypted FROM accounts WHERE email = $1 OR username = $2",
				[loginKey, loginKey],
			);
			const user = userRes.rows[0];

			if (!user) {
				await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
				const failed = await recordFailedAttempt(client, loginKey);
				await logAuthSecurityEvent(client, "login_failed", {
					loginKey,
					ipAddress,
					userAgent,
					details: { failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds, reason: "unknown_user" },
				});
				return res.status(401).json({ status: "error", message: "Invalid credentials" });
			}

			// Verify password normally
			const validPassword = await bcrypt.compare(password, user.password_hash);
			if (!validPassword) {
				const failed = await recordFailedAttempt(client, loginKey);
				await logAuthSecurityEvent(client, "login_failed", {
					loginKey,
					accountId: user.id,
					ipAddress,
					userAgent,
					details: { failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds, reason: "bad_password" },
				});
				return res.status(401).json({ status: "error", message: "Invalid credentials" });
			}

			await clearFailedAttempts(client, loginKey);
			await invalidateExpiredUserMfaChallenges(client);

			if (user.user_mfa_enabled && user.user_mfa_secret_encrypted) {
				const challenge = await createUserMfaChallenge(client, {
					accountId: user.id,
					purpose: "login",
					ttlSeconds: USER_MFA_VERIFY_TTL_SECONDS,
				});

				await logAuthSecurityEvent(client, "login_mfa_challenge_created", {
					loginKey,
					accountId: user.id,
					ipAddress,
					userAgent,
				});

				return res.status(202).json({
					status: "mfa_required",
					requiresMfa: true,
					challengeToken: challenge.token,
					expiresIn: challenge.expiresIn,
					message: "MFA verification required",
				});
			}

			// Update last login
			await client.query("UPDATE accounts SET last_login = NOW() WHERE id = $1", [user.id]);

			// Generate token
			const token = generateToken(user);

			// Record session in database
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
			await client.query(
				"INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
				[user.id, token, expiresAt, req.ip, req.get("user-agent")],
			);

			await logAuthSecurityEvent(client, "login_success", {
				loginKey,
				accountId: user.id,
				ipAddress,
				userAgent,
				details: { mfaUsed: false, includeQrCode },
			});

			// Remove password hash from response
			delete user.password_hash;

			res.json({
				status: "success",
				message: "Login successful",
				account: buildAuthAccountPayload(user),
				token,
			});

			setImmediate(() => {
				sendSecurityLoginMessage({
					email: user.email,
					displayName: user.name || user.username,
					ipAddress,
					userAgent,
				}).catch((mailError) => {
					console.error("Failed to send login security email:", mailError);
				});
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Login error:", error);
		res.status(500).json({ status: "error", message: "Login failed" });
	}
});

router.post("/login/mfa-verify", authAttemptLimiter, async (req, res) => {
	try {
		const challengeToken = normalizeCredentialField(req.body?.challengeToken, 256);
		const code = normalizeCredentialField(req.body?.code, 16);
		const ipAddress = getClientIp(req);
		const userAgent = String(req.get("user-agent") || "").slice(0, 512);

		if (!challengeToken || !code) {
			return res.status(400).json({ status: "error", message: "Challenge token and code are required" });
		}

		const client = await pool.connect();
		try {
			await invalidateExpiredUserMfaChallenges(client);

			const challenge = await getActiveUserMfaChallenge(client, challengeToken);
			if (!challenge || challenge.purpose !== "login") {
				return res.status(401).json({ status: "error", message: "Invalid or expired MFA challenge" });
			}

			if (challenge.expires_at && new Date(challenge.expires_at).getTime() <= Date.now()) {
				await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
				return res.status(401).json({ status: "error", message: "MFA challenge expired" });
			}

			if (challenge.attempts >= challenge.max_attempts) {
				await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
				await logAuthSecurityEvent(client, "login_mfa_verify_blocked", {
					accountId: challenge.account_id,
					ipAddress,
					userAgent,
					details: { reason: "attempt_limit_reached" },
				});
				return res.status(429).json({ status: "error", message: "Too many invalid MFA attempts" });
			}

			const secret = challenge.user_mfa_secret_encrypted ? decrypt(challenge.user_mfa_secret_encrypted) : "";
			const codeValid = Boolean(secret) && verifyTotpCode(secret, code);

			if (!codeValid) {
				await client.query("UPDATE user_mfa_challenges SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1", [
					challenge.id,
				]);

				await logAuthSecurityEvent(client, "login_mfa_verify_failed", {
					accountId: challenge.account_id,
					ipAddress,
					userAgent,
				});

				return res.status(401).json({ status: "error", message: "Invalid authenticator code" });
			}

			await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);

			const user = {
				id: challenge.account_id,
				username: challenge.username,
				email: challenge.email,
				name: challenge.name,
				icon: challenge.icon,
				role: challenge.role,
				created_at: challenge.created_at,
			};

			await client.query("UPDATE accounts SET last_login = NOW() WHERE id = $1", [user.id]);

			const token = generateToken(user);
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);

			await client.query(
				"INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
				[user.id, token, expiresAt, req.ip, req.get("user-agent")],
			);

			await logAuthSecurityEvent(client, "login_success", {
				accountId: user.id,
				ipAddress,
				userAgent,
				details: { mfaUsed: true },
			});

			setImmediate(() => {
				sendSecurityLoginMessage({
					email: user.email,
					displayName: user.name || user.username,
					ipAddress,
					userAgent,
				}).catch((mailError) => {
					console.error("Failed to send MFA security email:", mailError);
				});
			});

			return res.json({
				status: "success",
				message: "Login successful",
				account: buildAuthAccountPayload(user),
				token,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("MFA verify error:", error);
		res.status(500).json({ status: "error", message: "MFA verification failed" });
	}
});

router.get("/mfa/status", authenticate, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const result = await client.query("SELECT user_mfa_enabled, user_mfa_enabled_at FROM accounts WHERE id = $1", [
				req.user.id,
			]);
			const row = result.rows[0];
			if (!row) {
				return res.status(404).json({ status: "error", message: "Account not found" });
			}

			return res.json({
				status: "success",
				mfa: {
					enabled: Boolean(row.user_mfa_enabled),
					enabledAt: row.user_mfa_enabled_at,
				},
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("MFA status error:", error);
		res.status(500).json({ status: "error", message: "Failed to fetch MFA status" });
	}
});

router.post("/mfa/setup", authenticate, async (req, res) => {
	try {
		const includeQrCode = Boolean(req.body?.includeQrCode);
		const ipAddress = getClientIp(req);
		const userAgent = String(req.get("user-agent") || "").slice(0, 512);
		const client = await pool.connect();
		try {
			const accountRes = await client.query("SELECT username, user_mfa_enabled FROM accounts WHERE id = $1", [req.user.id]);
			const account = accountRes.rows[0];
			if (!account) {
				return res.status(404).json({ status: "error", message: "Account not found" });
			}

			if (account.user_mfa_enabled) {
				return res.status(409).json({ status: "error", message: "MFA is already enabled" });
			}

			await invalidateExpiredUserMfaChallenges(client);
			await client.query(
				"DELETE FROM user_mfa_challenges WHERE account_id = $1 AND purpose = 'enable' AND consumed_at IS NULL",
				[req.user.id],
			);

			const setupSecret = generateMfaBase32Secret(32);
			const challenge = await createUserMfaChallenge(client, {
				accountId: req.user.id,
				purpose: "enable",
				ttlSeconds: USER_MFA_SETUP_TTL_SECONDS,
				tempSecretEncrypted: encrypt(setupSecret),
			});

			await logAuthSecurityEvent(client, "user_mfa_setup_started", {
				accountId: req.user.id,
				ipAddress,
				userAgent,
			});

			return res.json({
				status: "success",
				challengeToken: challenge.token,
				expiresIn: challenge.expiresIn,
				totp: await buildMfaSetupPayload({
					secret: setupSecret,
					username: account.username,
					includeQrCode,
				}),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("MFA setup error:", error);
		res.status(500).json({ status: "error", message: "Failed to create MFA setup" });
	}
});

router.post("/mfa/enable", authenticate, async (req, res) => {
	try {
		const challengeToken = normalizeCredentialField(req.body?.challengeToken, 256);
		const code = normalizeCredentialField(req.body?.code, 16);
		const ipAddress = getClientIp(req);
		const userAgent = String(req.get("user-agent") || "").slice(0, 512);

		if (!challengeToken || !code) {
			return res.status(400).json({ status: "error", message: "Challenge token and code are required" });
		}

		const client = await pool.connect();
		try {
			await invalidateExpiredUserMfaChallenges(client);

			const challenge = await getActiveUserMfaChallenge(client, challengeToken);
			if (!challenge || challenge.purpose !== "enable" || challenge.account_id !== req.user.id) {
				return res.status(401).json({ status: "error", message: "Invalid or expired MFA setup challenge" });
			}

			if (!challenge.temp_secret_encrypted) {
				await client.query("DELETE FROM user_mfa_challenges WHERE id = $1", [challenge.id]);
				return res.status(400).json({ status: "error", message: "MFA setup challenge is incomplete" });
			}

			const setupSecret = decrypt(challenge.temp_secret_encrypted);
			const codeValid = Boolean(setupSecret) && verifyTotpCode(setupSecret, code);

			if (!codeValid) {
				await client.query("UPDATE user_mfa_challenges SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1", [
					challenge.id,
				]);

				await logAuthSecurityEvent(client, "user_mfa_enable_failed", {
					accountId: req.user.id,
					ipAddress,
					userAgent,
					details: { reason: "bad_code" },
				});

				return res.status(401).json({ status: "error", message: "Invalid authenticator code" });
			}

			await client.query(
				"UPDATE accounts SET user_mfa_enabled = TRUE, user_mfa_secret_encrypted = $1, user_mfa_enabled_at = NOW(), updated_at = NOW() WHERE id = $2",
				[encrypt(setupSecret), req.user.id],
			);
			await client.query("DELETE FROM user_mfa_challenges WHERE account_id = $1", [req.user.id]);

			await logAuthSecurityEvent(client, "user_mfa_enabled", {
				accountId: req.user.id,
				ipAddress,
				userAgent,
			});

			return res.json({
				status: "success",
				message: "Two-factor authentication enabled",
				mfa: { enabled: true },
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("MFA enable error:", error);
		res.status(500).json({ status: "error", message: "Failed to enable MFA" });
	}
});

/**
 * Get current user
 */
router.get("/me", authenticate, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const userRes = await client.query(
				"SELECT id, username, email, name, icon, subscription, created_at, user_mfa_enabled, user_mfa_enabled_at FROM accounts WHERE id = $1",
				[req.user.id],
			);
			const user = userRes.rows[0];

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			res.json({
				user: {
					...user,
					full_name: user.name,
					icon: formatUserIcon(user.icon),
					mfa: {
						enabled: Boolean(user.user_mfa_enabled),
						enabledAt: user.user_mfa_enabled_at,
					},
				},
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get user error:", error);
		res.status(500).json({ error: "Failed to get user" });
	}
});

/**
 * Logout (optional - invalidate token server-side if using sessions)
 */
router.post("/logout", authenticate, async (req, res) => {
	try {
		const authHeader = req.headers.authorization;
		const token = authHeader.substring(7);
		const ipAddress = getClientIp(req);
		const userAgent = String(req.get("user-agent") || "").slice(0, 512);
		const client = await pool.connect();
		try {
			await client.query("DELETE FROM user_sessions WHERE session_token = $1", [token]);
			await logAuthSecurityEvent(client, "logout", {
				accountId: req.user?.id,
				ipAddress,
				userAgent,
			});
			res.json({ status: "success", message: "Logged out successfully" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Logout error:", error);
		res.status(500).json({ error: "Logout failed" });
	}
});

/**
 * Change password
 */
router.put("/password", authenticate, async (req, res) => {
	try {
		const { currentPassword, newPassword } = req.body;
		const ipAddress = getClientIp(req);
		const userAgent = String(req.get("user-agent") || "").slice(0, 512);

		if (!currentPassword || !newPassword) {
			return res.status(400).json({ error: "Current and new password are required" });
		}

		if (!isReasonablePassword(newPassword)) {
			return res.status(400).json({ error: "New password must be 8-128 characters" });
		}

		const client = await pool.connect();
		try {
			// Get current password hash
			const userRes = await client.query("SELECT password_hash FROM accounts WHERE id = $1", [req.user.id]);
			const user = userRes.rows[0];

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			// Verify current password
			const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
			if (!validPassword) {
				await logAuthSecurityEvent(client, "password_change_failed", {
					accountId: req.user?.id,
					ipAddress,
					userAgent,
					details: { reason: "bad_current_password" },
				});
				return res.status(401).json({ error: "Current password is incorrect" });
			}

			// Hash new password
			const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

			// Update password
			await client.query("UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
				newPasswordHash,
				req.user.id,
			]);

			// Invalidate all existing sessions except the one used for this request.
			const authHeader = String(req.headers.authorization || "");
			const activeToken = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : "";
			if (activeToken) {
				await client.query("DELETE FROM user_sessions WHERE account_id = $1 AND session_token <> $2", [
					req.user.id,
					activeToken,
				]);
			} else {
				await client.query("DELETE FROM user_sessions WHERE account_id = $1", [req.user.id]);
			}

			await logAuthSecurityEvent(client, "password_changed", {
				accountId: req.user?.id,
				ipAddress,
				userAgent,
			});

			res.json({ message: "Password changed successfully" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Change password error:", error);
		res.status(500).json({ error: "Failed to change password" });
	}
});

module.exports = router;
