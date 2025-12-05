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

		const conn = await pool.getConnection();
		try {
			// Check if user exists
			const existing = await conn.query("SELECT id FROM accounts WHERE email = ? OR username = ?", [
				email.toLowerCase(),
				username.toLowerCase(),
			]);

			if (existing.length > 0) {
				return res.status(409).json({ status: "error", message: "User with this email or username already exists" });
			}

			// Hash password
			const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

			// Insert user
			const result = await conn.query(
				`INSERT INTO accounts (username, email, password_hash, name, icon) 
        VALUES (?, ?, ?, ?, ?)`,
				[username.toLowerCase(), email.toLowerCase(), passwordHash, displayName || username, icon || null]
			);

			const userId = Number(result.insertId);

			// Get created user
			const [user] = await conn.query("SELECT id, username, email, name, icon FROM accounts WHERE id = ?", [userId]);

			// Generate token
			const token = generateToken(user);

			res.status(201).json({
				status: "success",
				message: "User registered successfully",
				account: {
					full_name: user.name,
					username: user.username,
					email: user.email,
					icon: user.icon,
				},
				icon_path: user.icon,
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

		const conn = await pool.getConnection();
		try {
			// Find user by email or username
			const [user] = await conn.query(
				"SELECT id, username, email, password_hash, name, icon, subscription FROM accounts WHERE email = ? OR username = ?",
				[loginField.toLowerCase(), loginField.toLowerCase()]
			);

			if (!user) {
				return res.status(401).json({ status: "error", message: "Invalid credentials" });
			}

			// Verify password
			const validPassword = await bcrypt.compare(password, user.password_hash);
			if (!validPassword) {
				return res.status(401).json({ status: "error", message: "Invalid credentials" });
			}

			// Update last login
			await conn.query("UPDATE accounts SET last_login = NOW() WHERE id = ?", [user.id]);

			// Generate token
			const token = generateToken(user);

			// Remove password hash from response
			delete user.password_hash;

			res.json({
				status: "success",
				message: "Login successful",
				account: {
					full_name: user.name,
					username: user.username,
					email: user.email,
					icon: user.icon,
				},
				token,
			});
		} finally {
			conn.release();
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
		const conn = await pool.getConnection();
		try {
			const [user] = await conn.query("SELECT id, username, email, name, icon, subscription FROM accounts WHERE id = ?", [
				req.user.id,
			]);

			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			res.json({ user });
		} finally {
			conn.release();
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
	// With JWT, logout is typically handled client-side by removing the token
	// If you want server-side invalidation, use a token blacklist or sessions
	res.json({ message: "Logged out successfully" });
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

		const conn = await pool.getConnection();
		try {
			// Get current password hash
			const [user] = await conn.query("SELECT password_hash FROM accounts WHERE id = ?", [req.user.id]);

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
			await conn.query("UPDATE accounts SET password_hash = ?, updated_at = NOW() WHERE id = ?", [
				newPasswordHash,
				req.user.id,
			]);

			res.json({ message: "Password changed successfully" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Change password error:", error);
		res.status(500).json({ error: "Failed to change password" });
	}
});

module.exports = router;
