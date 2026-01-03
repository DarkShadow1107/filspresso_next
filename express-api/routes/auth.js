/**
 * Authentication Routes
 * POST /api/auth/register - Register new user
 * POST /api/auth/login - Login user
 * POST /api/auth/logout - Logout user
 * GET /api/auth/me - Get current user
 */

const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/connection");
const { generateToken, authenticate } = require("../middleware/auth");

const router = express.Router();
const SALT_ROUNDS = 12;

/**
 * Register a new user
 */
router.post("/register", async (req, res) => {
	try {
		const { username, email, password, full_name, name, icon } = req.body;
		const displayName = full_name || name;

		// Validation
		if (!username || !email || !password) {
			return res.status(400).json({ status: "error", message: "Username, email, and password are required" });
		}

		if (password.length < 8) {
			return res.status(400).json({ status: "error", message: "Password must be at least 8 characters" });
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
				[username.toLowerCase(), email.toLowerCase(), passwordHash, displayName || username, icon || null]
			);

			const userId = result.rows[0].id;

			// Get created user
			const userRes = await client.query("SELECT id, username, email, name, icon, role FROM accounts WHERE id = $1", [
				userId,
			]);
			const user = userRes.rows[0];

			// Generate token
			const token = generateToken(user);

			const iconFilename = user.icon ? (user.icon.toLowerCase().endsWith(".svg") ? user.icon : `${user.icon}.svg`) : null;

			res.status(201).json({
				status: "success",
				message: "User registered successfully",
				account: {
					full_name: user.name,
					username: user.username,
					email: user.email,
					role: user.role,
					icon: iconFilename ? `/images/icons/${iconFilename}` : null,
				},
				icon_path: iconFilename ? `/images/icons/${iconFilename}` : null,
				token,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Registration error:", error);
		res.status(500).json({ status: "error", message: "Registration failed" });
	}
});

/**
 * Login user
 */
router.post("/login", async (req, res) => {
	try {
		const { email, username, password } = req.body;
		const loginField = email || username;

		if (!loginField || !password) {
			return res.status(400).json({ status: "error", message: "Email/username and password are required" });
		}

		const client = await pool.connect();
		try {
			// Find user by email or username
			const userRes = await client.query(
				"SELECT id, username, email, password_hash, name, icon, subscription FROM accounts WHERE email = $1 OR username = $2",
				[loginField.toLowerCase(), loginField.toLowerCase()]
			);
			const user = userRes.rows[0];

			if (!user) {
				return res.status(401).json({ status: "error", message: "Invalid credentials" });
			}

			// Verify password
			const validPassword = await bcrypt.compare(password, user.password_hash);
			if (!validPassword) {
				return res.status(401).json({ status: "error", message: "Invalid credentials" });
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
				[user.id, token, expiresAt, req.ip, req.get("user-agent")]
			);

			// Remove password hash from response
			delete user.password_hash;

			const iconFilename = user.icon ? (user.icon.toLowerCase().endsWith(".svg") ? user.icon : `${user.icon}.svg`) : null;

			res.json({
				status: "success",
				message: "Login successful",
				account: {
					full_name: user.name,
					username: user.username,
					email: user.email,
					role: user.role,
					icon: iconFilename ? `/images/icons/${iconFilename}` : null,
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
				"SELECT id, username, email, name, icon, subscription FROM accounts WHERE id = $1",
				[req.user.id]
			);
			const user = userRes.rows[0];

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const iconFilename = user.icon ? (user.icon.toLowerCase().endsWith(".svg") ? user.icon : `${user.icon}.svg`) : null;

			res.json({
				user: {
					...user,
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
		const client = await pool.connect();
		try {
			await client.query("DELETE FROM user_sessions WHERE session_token = $1", [token]);
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

		if (!currentPassword || !newPassword) {
			return res.status(400).json({ error: "Current and new password are required" });
		}

		if (newPassword.length < 8) {
			return res.status(400).json({ error: "New password must be at least 8 characters" });
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
				return res.status(401).json({ error: "Current password is incorrect" });
			}

			// Hash new password
			const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

			// Update password
			await client.query("UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
				newPasswordHash,
				req.user.id,
			]);

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
