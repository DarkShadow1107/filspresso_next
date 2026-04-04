/**
 * JWT Authentication Middleware
 */

const jwt = require("jsonwebtoken");
const pool = require("../db/connection");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "365d";
const AUTH_SESSION_IDLE_TIMEOUT_DAYS = Math.max(1, Number.parseInt(process.env.AUTH_SESSION_IDLE_TIMEOUT_DAYS || "30", 10) || 30);

if (!JWT_SECRET) {
	throw new Error("JWT_SECRET environment variable is required");
}

/**
 * Generate JWT token for a user
 * @param {object} user - User object with id, email, username
 * @returns {string} - JWT token
 */
function generateToken(user) {
	return jwt.sign(
		{
			id: user.id,
			email: user.email,
			username: user.username,
		},
		JWT_SECRET,
		{ expiresIn: JWT_EXPIRES_IN },
	);
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {object|null} - Decoded token or null
 */
function verifyToken(token) {
	try {
		return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
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
};
