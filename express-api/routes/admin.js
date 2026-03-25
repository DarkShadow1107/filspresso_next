/**
 * Admin Routes
 * POST /api/admin/login - Admin login
 * GET /api/admin/tables - Get all tables
 * GET /api/admin/tables/:table - Get table columns and data
 * POST /api/admin/tables/:table - Insert row
 * PUT /api/admin/tables/:table/:id - Update row
 * DELETE /api/admin/tables/:table/:id - Delete row
 * GET /api/admin/table-info/:table - Get table schema info
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcrypt");
const QRCode = require("qrcode");
const pool = require("../db/connection");
const { encrypt, decrypt } = require("../utils/encryption");

const router = express.Router();
const ADMIN_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const ADMIN_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const IS_NON_PROD = process.env.NODE_ENV !== "production";
const RELAX_ADMIN_LIMITS_IN_DEV =
	IS_NON_PROD && process.env.ENABLE_STRICT_ADMIN_LIMITS !== "true" && process.env.DISABLE_RATE_LIMIT !== "false";

const VALID_IMAGE_EXTENSIONS = new Set(["png", "avif", "webp", "jpg", "jpeg", "svg"]);

const ADMIN_LOGIN_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS || "900000", 10));
const ADMIN_LOGIN_MAX_ATTEMPTS = Math.max(3, Number.parseInt(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX || "15", 10));
const ADMIN_QUERY_MAX_LENGTH = Math.max(64, Number.parseInt(process.env.ADMIN_QUERY_MAX_LENGTH || "5000", 10));
const ADMIN_QUERY_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.ADMIN_QUERY_TIMEOUT_MS || "4000", 10));
const ADMIN_MFA_ISSUER = String(process.env.ADMIN_MFA_ISSUER || "Filspresso").slice(0, 64);
const ADMIN_MFA_CODE_DIGITS = 6;
const ADMIN_MFA_TIME_STEP_SECONDS = Math.max(15, Number.parseInt(process.env.ADMIN_MFA_TIME_STEP_SECONDS || "30", 10));
const ADMIN_MFA_ALLOWED_DRIFT_STEPS = Math.max(0, Number.parseInt(process.env.ADMIN_MFA_ALLOWED_DRIFT_STEPS || "1", 10));
const ADMIN_MFA_VERIFY_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.ADMIN_MFA_VERIFY_TTL_SECONDS || "300", 10));
const ADMIN_MFA_ENROLL_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.ADMIN_MFA_ENROLL_TTL_SECONDS || "600", 10));
const ADMIN_AUTH_LOCK_THRESHOLD = Math.max(3, Number.parseInt(process.env.ADMIN_AUTH_LOCK_THRESHOLD || "5", 10));
const ADMIN_AUTH_FAILURE_WINDOW_MINUTES = Math.max(1, Number.parseInt(process.env.ADMIN_AUTH_FAILURE_WINDOW_MINUTES || "30", 10));
const ADMIN_AUTH_LOCK_BASE_SECONDS = Math.max(5, Number.parseInt(process.env.ADMIN_AUTH_LOCK_BASE_SECONDS || "60", 10));
const ADMIN_AUTH_LOCK_MAX_SECONDS = Math.max(
	ADMIN_AUTH_LOCK_BASE_SECONDS,
	Number.parseInt(process.env.ADMIN_AUTH_LOCK_MAX_SECONDS || "1800", 10),
);
const ADMIN_IP_ALLOWLIST = String(process.env.ADMIN_IP_ALLOWLIST || "")
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean);

const adminLoginLimiter = rateLimit({
	windowMs: ADMIN_LOGIN_WINDOW_MS,
	max: ADMIN_LOGIN_MAX_ATTEMPTS,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
	skip: () => RELAX_ADMIN_LIMITS_IN_DEV,
	message: { error: "Too many admin login attempts. Please try again later." },
});

function normalizeIp(ip = "") {
	const clean = String(ip || "")
		.split(",")[0]
		.trim()
		.replace(/^\[|\]$/g, "");
	if (clean.startsWith("::ffff:")) {
		return clean.replace("::ffff:", "");
	}
	return clean;
}

function getRequestIp(req) {
	const forwarded = req.headers["x-forwarded-for"];
	const source = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || req.socket?.remoteAddress || "";
	return normalizeIp(source);
}

function isIpAllowed(ip) {
	if (ADMIN_IP_ALLOWLIST.length === 0) return true;
	const normalized = normalizeIp(ip);
	return ADMIN_IP_ALLOWLIST.some((entry) => normalizeIp(entry) === normalized);
}

function enforceAdminIpAllowlist(req, res, next) {
	const ip = getRequestIp(req);
	if (isIpAllowed(ip)) {
		return next();
	}

	return res.status(403).json({ error: "Admin access is restricted from this network" });
}

router.use(enforceAdminIpAllowlist);

const isAllowedImage = (file) => {
	const ext = path
		.extname(file.originalname || "")
		.toLowerCase()
		.replace(".", "");
	const mime = (file.mimetype || "").toLowerCase();
	if (VALID_IMAGE_EXTENSIONS.has(ext)) return true;
	// Extra safety: allow based on mimetype even if extension casing is odd
	if (
		mime.includes("image/avif") ||
		mime.includes("image/webp") ||
		mime.includes("image/png") ||
		mime.includes("jpeg") ||
		mime.includes("image/svg+xml")
	) {
		return true;
	}
	return false;
};

/**
 * Generate a simple admin token
 */
function generateAdminToken() {
	return `admin_${crypto.randomBytes(32).toString("hex")}`;
}

function normalizeAdminLoginKey(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.slice(0, 254);
}

function computeLockSeconds(failedAttempts) {
	if (failedAttempts < ADMIN_AUTH_LOCK_THRESHOLD) return 0;
	const exponent = Math.max(0, failedAttempts - ADMIN_AUTH_LOCK_THRESHOLD);
	const calculated = ADMIN_AUTH_LOCK_BASE_SECONDS * 2 ** exponent;
	return Math.min(calculated, ADMIN_AUTH_LOCK_MAX_SECONDS);
}

async function getAdminLockState(client, loginKey) {
	if (RELAX_ADMIN_LIMITS_IN_DEV) {
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

async function recordAdminFailedAttempt(client, loginKey) {
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
		[loginKey, ADMIN_AUTH_FAILURE_WINDOW_MINUTES],
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

async function clearAdminFailedAttempts(client, loginKey) {
	await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]);
}

async function logAdminSecurityEvent(client, eventType, payload = {}) {
	const loginKey = payload.loginKey ? String(payload.loginKey).slice(0, 254) : null;
	const accountId = Number.isInteger(payload.accountId) ? payload.accountId : null;
	const ipAddress = payload.ipAddress ? String(payload.ipAddress).slice(0, 64) : null;
	const userAgent = payload.userAgent ? String(payload.userAgent).slice(0, 500) : null;
	const details = payload.details && typeof payload.details === "object" ? payload.details : {};

	await client.query(
		`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
		[eventType, loginKey, accountId, ipAddress, userAgent, JSON.stringify(details)],
	);
}

function hashChallengeToken(token) {
	return crypto
		.createHash("sha256")
		.update(String(token || ""))
		.digest("hex");
}

function generateBase32Secret(length = 32) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const bytes = crypto.randomBytes(length);
	let output = "";
	for (let i = 0; i < bytes.length; i += 1) {
		output += alphabet[bytes[i] % alphabet.length];
	}
	return output;
}

function decodeBase32(base32) {
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

function generateTotp(secret, timestampMs = Date.now()) {
	const key = decodeBase32(secret);
	if (!key.length) return null;

	const counter = Math.floor(timestampMs / 1000 / ADMIN_MFA_TIME_STEP_SECONDS);
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
	const code = String(binary % 10 ** ADMIN_MFA_CODE_DIGITS).padStart(ADMIN_MFA_CODE_DIGITS, "0");
	return code;
}

function verifyTotp(secret, submittedCode) {
	const normalizedCode = String(submittedCode || "")
		.trim()
		.replace(/\s+/g, "");
	if (!/^\d{6,8}$/.test(normalizedCode)) {
		return false;
	}

	for (let drift = -ADMIN_MFA_ALLOWED_DRIFT_STEPS; drift <= ADMIN_MFA_ALLOWED_DRIFT_STEPS; drift += 1) {
		const timestamp = Date.now() + drift * ADMIN_MFA_TIME_STEP_SECONDS * 1000;
		const code = generateTotp(secret, timestamp);
		if (code && code === normalizedCode) {
			return true;
		}
	}

	return false;
}

function buildOtpAuthUrl(secret, username) {
	const accountName = encodeURIComponent(
		String(username || "admin")
			.trim()
			.toLowerCase(),
	);
	const issuer = encodeURIComponent(ADMIN_MFA_ISSUER);
	return `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${ADMIN_MFA_CODE_DIGITS}&period=${ADMIN_MFA_TIME_STEP_SECONDS}`;
}

async function generateAdminQrDataUrl(otpauthUrl) {
	try {
		return await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: "M", margin: 1, width: 220 });
	} catch {
		return null;
	}
}

async function createAdminMfaChallenge(client, { accountId, purpose, ttlSeconds, tempSecretEncrypted = null }) {
	const token = `mfa_${crypto.randomBytes(48).toString("hex")}`;
	const tokenHash = hashChallengeToken(token);
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

	await client.query(
		`INSERT INTO admin_mfa_challenges (account_id, challenge_token_hash, purpose, temp_secret_encrypted, expires_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		[accountId, tokenHash, purpose, tempSecretEncrypted, expiresAt],
	);

	return {
		token,
		expiresIn: ttlSeconds,
	};
}

async function getActiveMfaChallenge(client, token) {
	const tokenHash = hashChallengeToken(token);
	const result = await client.query(
		`SELECT c.id, c.account_id, c.purpose, c.temp_secret_encrypted, c.attempts, c.max_attempts, c.expires_at,
				 a.username, a.role, a.admin_mfa_enabled, a.admin_mfa_secret_encrypted
		 FROM admin_mfa_challenges c
		 JOIN accounts a ON a.id = c.account_id
		 WHERE c.challenge_token_hash = $1
		   AND c.consumed_at IS NULL
		 LIMIT 1`,
		[tokenHash],
	);

	return result.rows[0] || null;
}

async function invalidateExpiredChallenges(client) {
	await client.query("DELETE FROM admin_mfa_challenges WHERE consumed_at IS NOT NULL OR expires_at < NOW()");
}

async function createAdminSession(client, user, req) {
	const token = generateAdminToken();
	const expiresAt = new Date(Date.now() + ADMIN_SESSION_TIMEOUT_MS);

	await client.query(
		"INSERT INTO user_sessions (account_id, session_token, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)",
		[user.id, token, expiresAt, getRequestIp(req) || null, String(req.headers["user-agent"] || "").slice(0, 500) || null],
	);

	return {
		token,
		expiresIn: Math.floor(ADMIN_SESSION_TIMEOUT_MS / 1000),
	};
}

function isSafeReadOnlyAdminQuery(sql) {
	const normalized = String(sql || "").trim();
	if (!normalized) return false;
	if (normalized.length > ADMIN_QUERY_MAX_LENGTH) return false;

	// Block stacked queries and SQL comments.
	if (normalized.includes(";") || /--|\/\*/.test(normalized)) {
		return false;
	}

	const upper = normalized.toUpperCase();
	if (!(upper.startsWith("SELECT") || upper.startsWith("WITH") || upper.startsWith("SHOW") || upper.startsWith("DESCRIBE"))) {
		return false;
	}

	// Block mutating/privileged operations even if embedded in CTEs.
	if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|CALL|COPY|DO|EXECUTE)\b/.test(upper)) {
		return false;
	}

	return true;
}

function isSafeSqlIdentifier(value) {
	return ADMIN_IDENTIFIER_PATTERN.test(String(value || ""));
}

// Admin authentication middleware
async function authenticateAdmin(req, res, next) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Admin authentication required" });
	}

	const token = authHeader.substring(7).trim();
	if (!token) {
		return res.status(401).json({ error: "Invalid or expired admin session" });
	}

	let client;
	try {
		client = await pool.connect();
		const sessionResult = await client.query(
			`SELECT s.account_id, a.username
			 FROM user_sessions s
			 JOIN accounts a ON a.id = s.account_id
			 WHERE s.session_token = $1
			   AND s.expires_at > NOW()
			   AND a.role = 'admin'
			 LIMIT 1`,
			[token],
		);

		const session = sessionResult.rows[0];
		if (!session) {
			return res.status(401).json({ error: "Invalid or expired admin session" });
		}

		const expiresAt = new Date(Date.now() + ADMIN_SESSION_TIMEOUT_MS);
		await client.query("UPDATE user_sessions SET expires_at = $1 WHERE session_token = $2", [expiresAt, token]);

		req.adminSession = {
			username: session.username,
			userId: session.account_id,
			expiresAt: expiresAt.getTime(),
		};

		const startedAt = Date.now();
		res.on("finish", () => {
			if (req.path === "/session") return;

			const details = {
				method: req.method,
				path: req.originalUrl,
				statusCode: res.statusCode,
				durationMs: Date.now() - startedAt,
			};

			pool.query(
				`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details)
					 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
				[
					"admin_action",
					session.username,
					session.account_id,
					getRequestIp(req) || null,
					String(req.headers["user-agent"] || "").slice(0, 500) || null,
					JSON.stringify(details),
				],
			).catch(() => {
				// Best-effort telemetry only.
			});
		});
		next();
	} catch (error) {
		console.error("Admin auth error:", error);
		return res.status(500).json({ error: "Admin authentication failed" });
	} finally {
		if (client) client.release();
	}
}

async function getPublicTables(client) {
	const result = await client.query(
		`SELECT relname AS name
		 FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = 'public' AND c.relkind = 'r'
		 ORDER BY relname`,
	);

	return result.rows.map((row) => row.name);
}

async function assertPublicTable(client, table) {
	const result = await client.query(
		`SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		) AS exists`,
		[table],
	);

	return Boolean(result.rows[0]?.exists);
}

async function getTableColumns(client, table) {
	const result = await client.query(
		`SELECT
			c.column_name AS name,
			c.data_type AS type,
			c.is_nullable AS nullable,
			c.column_default AS default_value,
			c.character_maximum_length AS max_length,
			CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS key_type,
			CASE WHEN c.column_default LIKE 'nextval%' OR c.is_identity = 'YES' THEN true ELSE false END AS is_auto_increment
		 FROM information_schema.columns c
		 LEFT JOIN (
			SELECT ku.column_name, ku.table_name, ku.table_schema
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage ku
			  ON tc.constraint_name = ku.constraint_name
			  AND tc.table_schema = ku.table_schema
			WHERE tc.constraint_type = 'PRIMARY KEY'
		 ) pk ON pk.column_name = c.column_name
		   AND pk.table_name = c.table_name
		   AND pk.table_schema = c.table_schema
		 WHERE c.table_schema = 'public' AND c.table_name = $1
		 ORDER BY c.ordinal_position`,
		[table],
	);

	return result.rows.map((column) => ({
		name: column.name,
		type: column.type,
		nullable: column.nullable === "YES",
		isPrimary: column.key_type === "PRI",
		isAutoIncrement: column.is_auto_increment,
		defaultValue: column.default_value,
		maxLength: column.max_length ? Number(column.max_length) : null,
	}));
}

async function getPrimaryKey(client, table) {
	const result = await client.query(
		`SELECT ku.column_name AS name
		 FROM information_schema.table_constraints tc
		 JOIN information_schema.key_column_usage ku
		   ON tc.constraint_name = ku.constraint_name
		   AND tc.table_schema = ku.table_schema
		 WHERE tc.constraint_type = 'PRIMARY KEY'
		   AND tc.table_name = $1
		   AND tc.table_schema = 'public'
		 ORDER BY ku.ordinal_position`,
		[table],
	);

	return result.rows[0]?.name || "id";
}

function sanitizeRowData(data, columns) {
	const editableColumns = new Map(columns.filter((column) => !column.isAutoIncrement).map((column) => [column.name, column]));

	const sanitized = {};
	for (const [key, value] of Object.entries(data || {})) {
		if (editableColumns.has(key)) {
			sanitized[key] = value;
		}
	}

	delete sanitized.created_at;
	delete sanitized.updated_at;

	return sanitized;
}

const CATEGORY_FOLDER_MAP = {
	original: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"creations barista": "Barista Creations",
		"barista creations": "Barista Creations",
		espresso: "Espresso",
		"edition limitee": "Limited Edition",
		"limited edition": "Limited Edition",
		"ispirazione italiana": "Ispirazione Italiana",
		"italian explorations": "Italian Explorations",
		"origines principales": "Master Origins",
		"master origins": "Master Origins",
		"explorations du monde": "World Explorations",
		"world explorations": "World Explorations",
		tasse: "Mug",
		mug: "Mug",
	},
	vertuo: {
		"coffee+": "Coffee+",
		"craft brew": "Craft Brew",
		"double espresso": "Double Espresso",
		espresso: "Espressos",
		espressos: "Espressos",
		"gran lungo": "Gran Lungo",
		"edition limitee": "Limited Edition",
		"limited edition": "Limited Edition",
		"barista creation": "Barista Creation",
		"barista creations": "Barista Creation",
		"creations barista": "Barista Creation",
		"master origins": "Master Origins",
		"origines principales": "Master Origins",
		mug: "Mug",
		tasse: "Mug",
	},
};

const normalizeCategoryKey = (value = "") =>
	value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();

const slugifyFilename = (name = "") =>
	name
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "") || `upload-${Date.now()}`;

const resolveImageTarget = (productType, category) => {
	const typeKey = (productType || "").toLowerCase() === "vertuo" ? "vertuo" : "original";
	const categoryKey = normalizeCategoryKey(category);
	const mapped = CATEGORY_FOLDER_MAP[typeKey]?.[categoryKey];
	const categoryDir = mapped || category || "Uncategorized";
	const typeDir = typeKey === "vertuo" ? "Vertuo" : "Original";
	const relativeDir = path.join("images", "Capsules", typeDir, categoryDir);
	// Always target the top-level public/ so Next.js can serve the file
	const projectRoot = path.resolve(__dirname, "..", "..");
	const absoluteDir = path.join(projectRoot, "public", relativeDir);
	return { typeDir, categoryDir, relativeDir, absoluteDir };
};

const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => {
			try {
				const { product_type: productType = "", category = "" } = req.body || {};
				console.log("[Upload] Destination - productType:", productType, "category:", category);
				const target = resolveImageTarget(productType, category);
				console.log("[Upload] Destination - absoluteDir:", target.absoluteDir);
				req.uploadTarget = target;
				fs.mkdirSync(target.absoluteDir, { recursive: true });
				cb(null, target.absoluteDir);
			} catch (err) {
				console.error("[Upload] Destination error:", err);
				cb(err);
			}
		},
		filename: (req, file, cb) => {
			const ext = path
				.extname(file.originalname || "")
				.toLowerCase()
				.replace(".", "");
			if (!isAllowedImage(file)) {
				return cb(new Error(`Invalid image type. Allowed: ${Array.from(VALID_IMAGE_EXTENSIONS).join(", ")}`));
			}

			// Preserve the original upload name (without any slugging/timestamp) while still stripping path segments
			const safeName = path.basename(file.originalname);
			cb(null, safeName);
		},
	}),
	fileFilter: (req, file, cb) => {
		if (!isAllowedImage(file)) {
			return cb(new Error("Only png, avif, webp, jpg, or jpeg are allowed"));
		}
		cb(null, true);
	},
	limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Admin Login
 */
router.post("/login", adminLoginLimiter, async (req, res) => {
	let client;
	try {
		const username = String(req.body?.username || "")
			.trim()
			.toLowerCase()
			.slice(0, 64);
		const password = typeof req.body?.password === "string" ? req.body.password : "";
		const loginKey = normalizeAdminLoginKey(`admin:${username}`);
		const ipAddress = getRequestIp(req) || null;
		const userAgent = String(req.headers["user-agent"] || "").slice(0, 500) || null;
		const includeQrCode = Boolean(req.body?.includeQrCode);

		if (!username || !password || password.length > 128) {
			return res.status(400).json({ error: "Username and password are required" });
		}

		client = await pool.connect();
		await invalidateExpiredChallenges(client);

		const lockState = await getAdminLockState(client, loginKey);
		if (lockState.isLocked) {
			await logAdminSecurityEvent(client, "admin_login_locked", {
				loginKey,
				ipAddress,
				userAgent,
				details: { retryAfterSeconds: lockState.retryAfterSeconds, failedAttempts: lockState.failedAttempts },
			});
			res.setHeader("Retry-After", String(lockState.retryAfterSeconds));
			return res.status(429).json({
				error: "Too many failed admin login attempts. Please try again later.",
				retryAfterSeconds: lockState.retryAfterSeconds,
			});
		}

		// Find an admin user record in the database
		const result = await client.query(
			"SELECT id, username, role, password_hash, admin_mfa_enabled, admin_mfa_secret_encrypted FROM accounts WHERE LOWER(username) = $1 AND role = 'admin'",
			[username],
		);

		if (result.rows.length === 0) {
			const failed = await recordAdminFailedAttempt(client, loginKey);
			await logAdminSecurityEvent(client, "admin_login_failed", {
				loginKey,
				ipAddress,
				userAgent,
				details: { reason: "unknown_admin", failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds },
			});
			return res.status(401).json({ error: "Invalid credentials" });
		}

		const user = result.rows[0];

		// Compare password with database hash
		const isValid = await bcrypt.compare(password, user.password_hash);
		if (!isValid) {
			const failed = await recordAdminFailedAttempt(client, loginKey);
			await logAdminSecurityEvent(client, "admin_login_failed", {
				loginKey,
				accountId: user.id,
				ipAddress,
				userAgent,
				details: { reason: "bad_password", failedAttempts: failed.failedAttempts, lockSeconds: failed.lockSeconds },
			});
			return res.status(401).json({ error: "Invalid credentials" });
		}

		await clearAdminFailedAttempts(client, loginKey);

		if (user.admin_mfa_enabled && user.admin_mfa_secret_encrypted) {
			const challenge = await createAdminMfaChallenge(client, {
				accountId: user.id,
				purpose: "verify",
				ttlSeconds: ADMIN_MFA_VERIFY_TTL_SECONDS,
			});

			await logAdminSecurityEvent(client, "admin_mfa_challenge_created", {
				loginKey,
				accountId: user.id,
				ipAddress,
				userAgent,
				details: { purpose: "verify", expiresIn: challenge.expiresIn },
			});

			return res.status(202).json({
				status: "mfa_required",
				requiresMfa: true,
				challengeToken: challenge.token,
				expiresIn: challenge.expiresIn,
				message: "MFA verification required",
			});
		}

		const enrollmentSecret = generateBase32Secret(32);
		const challenge = await createAdminMfaChallenge(client, {
			accountId: user.id,
			purpose: "enroll",
			ttlSeconds: ADMIN_MFA_ENROLL_TTL_SECONDS,
			tempSecretEncrypted: encrypt(enrollmentSecret),
		});

		await logAdminSecurityEvent(client, "admin_mfa_enrollment_required", {
			loginKey,
			accountId: user.id,
			ipAddress,
			userAgent,
			details: { expiresIn: challenge.expiresIn },
		});

		const otpauthUrl = buildOtpAuthUrl(enrollmentSecret, user.username);
		const totp = {
			secret: enrollmentSecret,
			issuer: ADMIN_MFA_ISSUER,
			accountName: user.username,
			otpauthUrl,
		};
		if (includeQrCode) {
			totp.qrDataUrl = await generateAdminQrDataUrl(otpauthUrl);
		}

		return res.status(202).json({
			status: "mfa_enrollment_required",
			requiresMfaEnrollment: true,
			challengeToken: challenge.token,
			expiresIn: challenge.expiresIn,
			message: "MFA setup is required for admin accounts",
			totp,
		});
	} catch (error) {
		console.error("Admin login error:", error);
		res.status(500).json({ error: "Admin login failed" });
	} finally {
		if (client) client.release();
	}
});

router.post("/mfa/verify", adminLoginLimiter, async (req, res) => {
	let client;
	try {
		const challengeToken = String(req.body?.challengeToken || "").trim();
		const code = String(req.body?.code || "")
			.trim()
			.replace(/\s+/g, "");
		const ipAddress = getRequestIp(req) || null;
		const userAgent = String(req.headers["user-agent"] || "").slice(0, 500) || null;

		if (!challengeToken || !code) {
			return res.status(400).json({ error: "challengeToken and code are required" });
		}

		client = await pool.connect();
		await invalidateExpiredChallenges(client);

		const challenge = await getActiveMfaChallenge(client, challengeToken);
		if (!challenge) {
			return res.status(401).json({ error: "Invalid or expired MFA challenge" });
		}

		if (challenge.role !== "admin") {
			return res.status(403).json({ error: "Admin role required" });
		}

		const expiresAt = new Date(challenge.expires_at);
		if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
			return res.status(401).json({ error: "Invalid or expired MFA challenge" });
		}

		if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
			return res.status(429).json({ error: "Too many MFA attempts. Start login again." });
		}

		const secret =
			challenge.purpose === "verify"
				? challenge.admin_mfa_secret_encrypted
					? decrypt(challenge.admin_mfa_secret_encrypted)
					: ""
				: challenge.temp_secret_encrypted
					? decrypt(challenge.temp_secret_encrypted)
					: "";

		if (!secret) {
			return res.status(401).json({ error: "MFA challenge is no longer valid" });
		}

		const validCode = verifyTotp(secret, code);
		if (!validCode) {
			await client.query("UPDATE admin_mfa_challenges SET attempts = attempts + 1 WHERE id = $1", [challenge.id]);
			await logAdminSecurityEvent(client, "admin_mfa_failed", {
				loginKey: `admin:${challenge.username}`,
				accountId: challenge.account_id,
				ipAddress,
				userAgent,
				details: { purpose: challenge.purpose },
			});
			return res.status(401).json({ error: "Invalid MFA code" });
		}

		if (challenge.purpose === "enroll") {
			await client.query(
				"UPDATE accounts SET admin_mfa_enabled = TRUE, admin_mfa_secret_encrypted = $1, admin_mfa_enabled_at = NOW() WHERE id = $2",
				[encrypt(secret), challenge.account_id],
			);
		}

		await client.query("UPDATE admin_mfa_challenges SET consumed_at = NOW() WHERE id = $1", [challenge.id]);
		const session = await createAdminSession(client, { id: challenge.account_id }, req);

		await logAdminSecurityEvent(client, "admin_login_success_mfa", {
			loginKey: `admin:${challenge.username}`,
			accountId: challenge.account_id,
			ipAddress,
			userAgent,
			details: { purpose: challenge.purpose },
		});

		return res.json({
			status: "success",
			message: "Admin login successful",
			token: session.token,
			expiresIn: session.expiresIn,
			mfaEnrollmentCompleted: challenge.purpose === "enroll",
		});
	} catch (error) {
		console.error("Admin MFA verify error:", error);
		res.status(500).json({ error: "Admin MFA verification failed" });
	} finally {
		if (client) client.release();
	}
});

/**
 * Admin Logout
 */
router.post("/logout", authenticateAdmin, async (req, res) => {
	const authHeader = req.headers.authorization;
	const token = authHeader.substring(7);

	let client;
	try {
		client = await pool.connect();
		await client.query("DELETE FROM user_sessions WHERE session_token = $1", [token]);
	} catch (error) {
		console.error("Error deleting admin session from DB:", error);
	} finally {
		if (client) client.release();
	}

	res.json({ status: "success", message: "Admin logged out" });
});

/**
 * Validate current admin session (used by frontend server-side route guards)
 */
router.get("/session", authenticateAdmin, async (req, res) => {
	res.json({
		status: "success",
		admin: {
			id: req.adminSession?.userId || null,
			username: req.adminSession?.username || null,
		},
		expiresAt: req.adminSession?.expiresAt || null,
	});
});

// Upload coffee capsule image (stored under public/images/Capsules/{Original|Vertuo}/{Category})
router.post("/upload/coffee-image", authenticateAdmin, (req, res) => {
	console.log("[Upload] Request received");
	upload.single("image")(req, res, (err) => {
		if (err) {
			console.error("[Upload] Multer error:", err);
			return res.status(400).json({ error: err.message || "Failed to upload image" });
		}

		if (!req.file) {
			console.error("[Upload] No file in request");
			return res.status(400).json({ error: "No image file provided" });
		}

		const productType = (req.body?.product_type || "").toString().trim();
		const category = (req.body?.category || "").toString().trim();
		if (!productType || !category) {
			// Cleanup the uploaded file if metadata is missing
			if (req.file?.path) fs.unlink(req.file.path, () => {});
			return res.status(400).json({ error: "product_type and category are required before uploading an image" });
		}

		const target = req.uploadTarget || resolveImageTarget(productType, category);
		const extension = path
			.extname(req.file.filename || "")
			.toLowerCase()
			.replace(".", "");
		const relativePath = path.join(target.relativeDir, req.file.filename).replace(/\\/g, "/");

		console.log("[Upload] Success:", {
			filename: req.file.filename,
			absoluteDir: target.absoluteDir,
			relativePath,
			productType,
			category,
			mimetype: req.file.mimetype,
			size: req.file.size,
		});

		return res.json({
			status: "success",
			filename: req.file.filename,
			extension,
			relativePath,
		});
	});
});

/**
 * Get all tables in the database
 */
router.get("/tables", authenticateAdmin, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			// Get table names and comments
			const metaResult = await client.query(
				`SELECT 
					relname as name, 
					obj_description(c.oid, 'pg_class') as comment
				 FROM pg_class c
				 JOIN pg_namespace n ON n.oid = c.relnamespace
				 WHERE n.nspname = 'public' AND c.relkind = 'r'
				 ORDER BY relname`,
			);

			if (metaResult.rows.length === 0) {
				return res.json({ status: "success", tables: [] });
			}

			// Build a single UNION ALL query for accurate row counts
			const countQuery = metaResult.rows
				.map((t) => `SELECT '${t.name}' as name, COUNT(*)::bigint as row_count FROM "${t.name}"`)
				.join(" UNION ALL ");

			const countResult = await client.query(countQuery);
			const countMap = {};
			for (const row of countResult.rows) {
				countMap[row.name] = Number(row.row_count);
			}

			res.json({
				status: "success",
				tables: metaResult.rows.map((t) => ({
					name: t.name,
					rowCount: countMap[t.name] ?? 0,
					comment: t.comment || "",
				})),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get tables error:", error);
		res.status(500).json({ error: "Failed to get tables" });
	}
});

/**
 * Get table schema information (columns)
 */
router.get("/table-info/:table", authenticateAdmin, async (req, res) => {
	try {
		const { table } = req.params;
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const columnsResult = await client.query(
				`SELECT 
					c.column_name as name,
					c.data_type as type,
					c.is_nullable as nullable,
					c.column_default as default_value,
					c.character_maximum_length as max_length,
					pg_catalog.col_description(t.oid, c.ordinal_position) as comment,
					CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as key_type,
					CASE WHEN c.column_default LIKE 'nextval%' OR c.is_identity = 'YES' THEN true ELSE false END as is_auto_increment
				 FROM information_schema.columns c
				 JOIN pg_class t ON t.relname = c.table_name
				 JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
				 LEFT JOIN (
					SELECT ku.column_name, ku.table_name, ku.table_schema
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage ku 
					  ON tc.constraint_name = ku.constraint_name 
					  AND tc.table_schema = ku.table_schema
					WHERE tc.constraint_type = 'PRIMARY KEY'
				 ) pk ON pk.column_name = c.column_name 
				   AND pk.table_name = c.table_name 
				   AND pk.table_schema = c.table_schema
				 WHERE c.table_schema = 'public' AND c.table_name = $1
				 ORDER BY c.ordinal_position`,
				[table],
			);

			// Get primary key
			const pkResult = await client.query(
				`SELECT ku.column_name as name
				 FROM information_schema.table_constraints tc
				 JOIN information_schema.key_column_usage ku 
				   ON tc.constraint_name = ku.constraint_name 
				   AND tc.table_schema = ku.table_schema
				 WHERE tc.constraint_type = 'PRIMARY KEY' 
				   AND tc.table_name = $1 
				   AND tc.table_schema = 'public'`,
				[table],
			);

			const primaryKey = pkResult.rows.length > 0 ? pkResult.rows[0].name : "id";

			res.json({
				status: "success",
				table,
				primaryKey,
				columns: columnsResult.rows.map((c) => ({
					name: c.name,
					type: c.type,
					nullable: c.nullable === "YES",
					isPrimary: c.key_type === "PRI",
					isAutoIncrement: c.is_auto_increment,
					defaultValue: c.default_value,
					maxLength: c.max_length ? Number(c.max_length) : null,
					comment: c.comment || "",
				})),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get table info error:", error);
		res.status(500).json({ error: `Failed to get table info: ${error.message}` });
	}
});

/**
 * Get table data with pagination
 */
router.get("/tables/:table", authenticateAdmin, async (req, res) => {
	try {
		const { table } = req.params;
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}
		const page = parseInt(req.query.page) || 1;
		const limit = Math.min(parseInt(req.query.limit) || 50, 200);
		const offset = (page - 1) * limit;
		const requestedSortBy = req.query.sortBy || "id";
		if (!isSafeSqlIdentifier(requestedSortBy)) {
			return res.status(400).json({ error: "Invalid sort column" });
		}
		const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
		const search = req.query.search || "";

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const tableColumns = await getTableColumns(client, table);
			const columnNames = new Set(tableColumns.map((column) => column.name));
			const sortBy = columnNames.has(requestedSortBy) ? requestedSortBy : await getPrimaryKey(client, table);

			// Get total count
			let countQuery = `SELECT COUNT(*) as total FROM "${table}"`;
			let dataQuery = `SELECT * FROM "${table}"`;
			const params = [];
			let paramIdx = 1;

			// Add search if provided
			if (search) {
				// Get text columns for search
				const columnsResult = await client.query(
					`SELECT column_name FROM information_schema.columns 
					 WHERE table_schema = 'public' AND table_name = $1
					 AND data_type IN ('character varying', 'text', 'character', 'jsonb')`,
					[table],
				);

				if (columnsResult.rows.length > 0) {
					const searchConditions = columnsResult.rows
						.map((c) => `"${c.column_name}"::text ILIKE $${paramIdx++}`)
						.join(" OR ");
					countQuery += ` WHERE (${searchConditions})`;
					dataQuery += ` WHERE (${searchConditions})`;
					columnsResult.rows.forEach(() => params.push(`%${search}%`));
				}
			}

			const countResult = await client.query(countQuery, params);
			const total = Number(countResult.rows[0].total);

			// Add sorting and pagination
			dataQuery += ` ORDER BY "${sortBy}" ${sortOrder} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
			params.push(limit, offset);

			const result = await client.query(dataQuery, params);

			res.json({
				status: "success",
				table,
				data: result.rows,
				pagination: {
					page,
					limit,
					total,
					totalPages: Math.ceil(total / limit),
				},
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get table data error:", error);
		res.status(500).json({ error: "Failed to get table data" });
	}
});

/**
 * Insert new row
 */
router.post("/tables/:table", authenticateAdmin, async (req, res) => {
	try {
		const { table } = req.params;
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}
		const data = req.body;

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const tableColumns = await getTableColumns(client, table);
			const sanitized = sanitizeRowData(data, tableColumns);

			if (!sanitized || Object.keys(sanitized).length === 0) {
				return res.status(400).json({ error: "No editable data provided" });
			}

			if (table === "accounts" && sanitized.password_hash) {
				sanitized.password_hash = await bcrypt.hash(sanitized.password_hash, 10);
			}

			const primaryKey = await getPrimaryKey(client, table);
			const columns = Object.keys(sanitized);
			const values = Object.values(sanitized);
			const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

			const result = await client.query(
				`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) RETURNING "${primaryKey}"`,
				values,
			);

			res.json({
				status: "success",
				message: "Row inserted successfully",
				insertId: result.rows[0]?.[primaryKey] ?? null,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Insert row error:", error);
		res.status(500).json({ error: `Failed to insert row: ${error.message}` });
	}
});

/**
 * Update row
 */
router.put("/tables/:table/:id", authenticateAdmin, async (req, res) => {
	try {
		const { table, id } = req.params;
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}
		const data = req.body;

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const tableColumns = await getTableColumns(client, table);
			const sanitized = sanitizeRowData(data, tableColumns);

			if (!sanitized || Object.keys(sanitized).length === 0) {
				return res.status(400).json({ error: "No editable data provided" });
			}

			// Special handling for accounts table password hashing
			if (table === "accounts" && sanitized.password_hash) {
				// Get current password hash
				const result = await client.query("SELECT password_hash FROM accounts WHERE id = $1", [id]);
				const currentUser = result.rows[0];
				if (currentUser && currentUser.password_hash === sanitized.password_hash) {
					// Password hasn't changed (it's the same hash), so don't update it
					delete sanitized.password_hash;
				} else {
					// Password changed, hash it
					sanitized.password_hash = await bcrypt.hash(sanitized.password_hash, 10);
				}
			}

			const primaryKey = await getPrimaryKey(client, table);

			const columns = Object.keys(sanitized);
			const values = Object.values(sanitized);
			const setClause = columns.map((c, i) => `"${c}" = $${i + 1}`).join(", ");

			const result = await client.query(
				`UPDATE "${table}" SET ${setClause} WHERE "${primaryKey}" = $${columns.length + 1}`,
				[...values, id],
			);

			if (result.rowCount === 0) {
				return res.status(404).json({ error: "Row not found" });
			}

			res.json({
				status: "success",
				message: "Row updated successfully",
				affectedRows: Number(result.rowCount),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update row error:", error);
		res.status(500).json({ error: `Failed to update row: ${error.message}` });
	}
});

/**
 * Delete row
 */
router.delete("/tables/:table/:id", authenticateAdmin, async (req, res) => {
	try {
		const { table, id } = req.params;
		if (!isSafeSqlIdentifier(table)) {
			return res.status(400).json({ error: "Invalid table name" });
		}

		const client = await pool.connect();
		try {
			const tableExists = await assertPublicTable(client, table);
			if (!tableExists) {
				return res.status(404).json({ error: "Table not found" });
			}

			const primaryKey = await getPrimaryKey(client, table);

			const result = await client.query(`DELETE FROM "${table}" WHERE "${primaryKey}" = $1`, [id]);

			if (result.rowCount === 0) {
				return res.status(404).json({ error: "Row not found" });
			}

			res.json({
				status: "success",
				message: "Row deleted successfully",
				affectedRows: Number(result.rowCount),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Delete row error:", error);
		res.status(500).json({ error: `Failed to delete row: ${error.message}` });
	}
});

/**
 * Execute raw SQL query (SELECT only for safety)
 */
router.post("/query", authenticateAdmin, async (req, res) => {
	try {
		const { sql } = req.body;

		if (!sql) {
			return res.status(400).json({ error: "SQL query is required" });
		}

		if (!isSafeReadOnlyAdminQuery(sql)) {
			return res.status(403).json({
				error: "Only single-statement read-only queries are allowed (SELECT/WITH/SHOW/DESCRIBE).",
			});
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`SET LOCAL statement_timeout = ${ADMIN_QUERY_TIMEOUT_MS}`);
			await client.query("SET TRANSACTION READ ONLY");
			const result = await client.query(sql);
			await client.query("ROLLBACK");
			res.json({
				status: "success",
				data: result.rows,
				rowCount: result.rowCount,
			});
		} catch (queryError) {
			await client.query("ROLLBACK");
			throw queryError;
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Query error:", error);
		res.status(500).json({ error: `Query failed: ${error.message}` });
	}
});

/**
 * Security telemetry summary for auth/lockout monitoring
 */
router.get("/security/telemetry", authenticateAdmin, async (req, res) => {
	const rawWindowHours = Number.parseInt(String(req.query.windowHours || "24"), 10);
	const windowHours = Number.isFinite(rawWindowHours) ? Math.min(Math.max(rawWindowHours, 1), 24 * 30) : 24;

	let client;
	try {
		client = await pool.connect();
		const summaryResult = await client.query(
			`SELECT
				COUNT(*) FILTER (WHERE event_type = 'login_failed') AS failed_logins,
				COUNT(*) FILTER (WHERE event_type = 'login_locked') AS lock_events,
				COUNT(*) FILTER (WHERE event_type = 'login_success') AS successful_logins,
				COUNT(DISTINCT ip_address) FILTER (WHERE event_type IN ('login_failed', 'login_locked')) AS distinct_source_ips
			 FROM auth_security_events
			 WHERE created_at >= NOW() - (($1)::text || ' hours')::interval`,
			[windowHours],
		);

		const lockedAccountsResult = await client.query(
			`SELECT login_key, failed_attempts, lock_until, last_failed_at
			 FROM auth_login_attempts
			 WHERE lock_until IS NOT NULL
			   AND lock_until > NOW()
			 ORDER BY lock_until DESC
			 LIMIT 200`,
		);

		const topSourcesResult = await client.query(
			`SELECT ip_address, COUNT(*)::int AS attempts
			 FROM auth_security_events
			 WHERE created_at >= NOW() - (($1)::text || ' hours')::interval
			   AND event_type IN ('login_failed', 'login_locked')
			   AND ip_address IS NOT NULL
			 GROUP BY ip_address
			 ORDER BY attempts DESC
			 LIMIT 20`,
			[windowHours],
		);

		const summary = summaryResult.rows[0] || {};
		res.json({
			status: "success",
			windowHours,
			summary: {
				failedLogins: Number(summary.failed_logins || 0),
				lockEvents: Number(summary.lock_events || 0),
				successfulLogins: Number(summary.successful_logins || 0),
				distinctSourceIps: Number(summary.distinct_source_ips || 0),
			},
			lockedLoginKeys: lockedAccountsResult.rows,
			topSources: topSourcesResult.rows,
		});
	} catch (error) {
		console.error("Security telemetry error:", error);
		res.status(500).json({ error: "Failed to fetch security telemetry" });
	} finally {
		if (client) client.release();
	}
});

/**
 * Recent auth security events for investigation and incident response
 */
router.get("/security/events", authenticateAdmin, async (req, res) => {
	const rawLimit = Number.parseInt(String(req.query.limit || "200"), 10);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 200;

	let client;
	try {
		client = await pool.connect();
		const eventsResult = await client.query(
			`SELECT id, event_type, login_key, account_id, ip_address, user_agent, details, created_at
			 FROM auth_security_events
			 ORDER BY created_at DESC
			 LIMIT $1`,
			[limit],
		);

		res.json({
			status: "success",
			count: eventsResult.rows.length,
			events: eventsResult.rows,
		});
	} catch (error) {
		console.error("Security events error:", error);
		res.status(500).json({ error: "Failed to fetch security events" });
	} finally {
		if (client) client.release();
	}
});

/**
 * Clear lockout state for a specific login identifier (admin incident response)
 */
router.delete("/security/lockouts/:loginKey", authenticateAdmin, async (req, res) => {
	const loginKey = String(req.params.loginKey || "")
		.trim()
		.toLowerCase()
		.slice(0, 254);
	if (!loginKey) {
		return res.status(400).json({ error: "loginKey is required" });
	}

	let client;
	try {
		client = await pool.connect();
		const result = await client.query("DELETE FROM auth_login_attempts WHERE login_key = $1", [loginKey]);
		await client.query(
			`INSERT INTO auth_security_events (event_type, login_key, account_id, ip_address, user_agent, details)
			 VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
			[
				"lockout_cleared_admin",
				loginKey,
				req.adminSession?.userId || null,
				null,
				null,
				JSON.stringify({ clearedBy: req.adminSession?.username || "unknown" }),
			],
		);
		res.json({ status: "success", removed: Number(result.rowCount || 0) });
	} catch (error) {
		console.error("Lockout clear error:", error);
		res.status(500).json({ error: "Failed to clear lockout" });
	} finally {
		if (client) client.release();
	}
});

module.exports = router;
