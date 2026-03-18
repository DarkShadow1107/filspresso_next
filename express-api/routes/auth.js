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
const pool = require("../db/connection");
const { generateToken, authenticate } = require("../middleware/auth");

const router = express.Router();
const SALT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("filspresso_dummy_password", SALT_ROUNDS);

const AUTH_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000", 10));
const AUTH_MAX_ATTEMPTS = Math.max(5, Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || "30", 10));
const AUTH_LOCK_THRESHOLD = Math.max(3, Number.parseInt(process.env.AUTH_LOCK_THRESHOLD || "5", 10));
const AUTH_FAILURE_WINDOW_MINUTES = Math.max(1, Number.parseInt(process.env.AUTH_FAILURE_WINDOW_MINUTES || "30", 10));
const AUTH_LOCK_BASE_SECONDS = Math.max(5, Number.parseInt(process.env.AUTH_LOCK_BASE_SECONDS || "60", 10));
const AUTH_LOCK_MAX_SECONDS = Math.max(AUTH_LOCK_BASE_SECONDS, Number.parseInt(process.env.AUTH_LOCK_MAX_SECONDS || "1800", 10));

const authAttemptLimiter = rateLimit({
	windowMs: AUTH_WINDOW_MS,
	max: AUTH_MAX_ATTEMPTS,
	standardHeaders: true,
	legacyHeaders: false,
	skipSuccessfulRequests: true,
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
				`INSERT INTO accounts (username, email, password_hash, name, icon) 
        VALUES ($1, $2, $3, $4, $5) RETURNING id`,
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

			let iconUrl = user.icon || null;
			if (iconUrl && !iconUrl.startsWith("/") && !iconUrl.startsWith("http") && !iconUrl.startsWith("data:")) {
				iconUrl = `/images/icons/${iconUrl}`;
			}
			if (iconUrl && !iconUrl.toLowerCase().endsWith(".svg") && !iconUrl.startsWith("data:")) {
				iconUrl = `${iconUrl}.svg`;
			}

			res.status(201).json({
				status: "success",
				message: "User registered successfully",
				account: {
					name: user.name,
					full_name: user.name,
					username: user.username,
					email: user.email,
					role: user.role,
					icon: iconUrl,
					created_at: user.created_at,
				},
				icon_path: iconUrl,
				token,
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
				"SELECT id, username, email, password_hash, name, icon, subscription, role, created_at FROM accounts WHERE email = $1 OR username = $2",
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
			await logAuthSecurityEvent(client, "login_success", {
				loginKey,
				accountId: user.id,
				ipAddress,
				userAgent,
			});

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

			// Remove password hash from response
			delete user.password_hash;

			let iconUrl = user.icon || null;
			if (iconUrl && !iconUrl.startsWith("/") && !iconUrl.startsWith("http") && !iconUrl.startsWith("data:")) {
				iconUrl = `/images/icons/${iconUrl}`;
			}
			if (iconUrl && !iconUrl.toLowerCase().endsWith(".svg") && !iconUrl.startsWith("data:")) {
				iconUrl = `${iconUrl}.svg`;
			}

			res.json({
				status: "success",
				message: "Login successful",
				account: {
					name: user.name,
					full_name: user.name,
					username: user.username,
					email: user.email,
					role: user.role,
					icon: iconUrl,
					created_at: user.created_at,
				},
				token,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Login error:", error);
		res.status(500).json({ status: "error", message: "Login failed" });
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
				"SELECT id, username, email, name, icon, subscription, created_at FROM accounts WHERE id = $1",
				[req.user.id],
			);
			const user = userRes.rows[0];

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const iconFilename = user.icon ? (user.icon.toLowerCase().endsWith(".svg") ? user.icon : `${user.icon}.svg`) : null;

			res.json({
				user: {
					...user,
					full_name: user.name,
					icon: iconFilename ? `/images/icons/${iconFilename}` : null,
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
