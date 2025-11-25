/**
 * JWT Authentication Middleware
 */

const jwt = require("jsonwebtoken");
const pool = require("../db/connection");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-here!";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

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
		{ expiresIn: JWT_EXPIRES_IN }
	);
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {object|null} - Decoded token or null
 */
function verifyToken(token) {
	try {
		return jwt.verify(token, JWT_SECRET);
	} catch (error) {
		return null;
	}
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

		const token = authHeader.split(" ")[1];
		const decoded = verifyToken(token);

		if (!decoded) {
			return res.status(401).json({ error: "Invalid or expired token" });
		}

		// Get user from database
		const conn = await pool.getConnection();
		try {
			const [user] = await conn.query("SELECT id, username, email, name, icon, subscription FROM accounts WHERE id = ?", [
				decoded.id,
			]);

			if (!user) {
				return res.status(401).json({ error: "User not found" });
			}

			req.user = user;
			next();
		} finally {
			conn.release();
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

		const token = authHeader.split(" ")[1];
		const decoded = verifyToken(token);

		if (!decoded) {
			req.user = null;
			return next();
		}

		const conn = await pool.getConnection();
		try {
			const [user] = await conn.query("SELECT id, username, email, name, icon, subscription FROM accounts WHERE id = ?", [
				decoded.id,
			]);
			req.user = user || null;
		} finally {
			conn.release();
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
	JWT_SECRET,
	JWT_EXPIRES_IN,
};
