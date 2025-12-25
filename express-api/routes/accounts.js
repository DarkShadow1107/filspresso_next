/**
 * Accounts Routes
 * GET /api/accounts/:id - Get account details
 * PUT /api/accounts/:id - Update account
 * DELETE /api/accounts/:id - Delete account
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

/**
 * Get account details
 */
router.get("/:id", authenticate, async (req, res) => {
	try {
		const accountId = parseInt(req.params.id);

		// Users can only access their own account
		if (accountId !== req.user.id) {
			return res.status(403).json({ error: "Access denied" });
		}

		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT a.id, a.username, a.email, a.name, a.icon, a.subscription_id,
                a.email_verified, a.last_login, a.created_at,
                s.name as subscription_name, s.description as subscription_description,
                s.price_ron as subscription_price, s.features as subscription_features
        FROM accounts a
        LEFT JOIN subscriptions s ON a.subscription_id = s.id
        WHERE a.id = $1`,
				[accountId]
			);

			const account = result.rows[0];

			if (!account) {
				return res.status(404).json({ error: "Account not found" });
			}

			res.json({ account });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get account error:", error);
		res.status(500).json({ error: "Failed to get account" });
	}
});

/**
 * Update account details
 */
router.put("/:id", authenticate, async (req, res) => {
	try {
		const accountId = parseInt(req.params.id);

		if (accountId !== req.user.id) {
			return res.status(403).json({ error: "Access denied" });
		}

		const { name, icon, username } = req.body;

		const client = await pool.connect();
		try {
			// Check if new username is taken (if changing)
			if (username && username !== req.user.username) {
				const result = await client.query("SELECT id FROM accounts WHERE username = $1 AND id != $2", [
					username.toLowerCase(),
					accountId,
				]);
				if (result.rows.length > 0) {
					return res.status(409).json({ error: "Username already taken" });
				}
			}

			// Build update query dynamically
			const updates = [];
			const params = [];
			let paramIdx = 1;

			if (name !== undefined) {
				updates.push(`name = $${paramIdx++}`);
				params.push(name);
			}
			if (icon !== undefined) {
				updates.push(`icon = $${paramIdx++}`);
				params.push(icon);
			}
			if (username !== undefined) {
				updates.push(`username = $${paramIdx++}`);
				params.push(username.toLowerCase());
			}

			if (updates.length === 0) {
				return res.status(400).json({ error: "No fields to update" });
			}

			params.push(accountId);

			await client.query(`UPDATE accounts SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${paramIdx}`, params);

			// Get updated account
			const result = await client.query(
				"SELECT id, username, email, name, icon, subscription_id FROM accounts WHERE id = $1",
				[accountId]
			);
			const account = result.rows[0];

			res.json({ message: "Account updated", account });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update account error:", error);
		res.status(500).json({ error: "Failed to update account" });
	}
});

/**
 * Delete account
 */
router.delete("/:id", authenticate, async (req, res) => {
	try {
		const accountId = parseInt(req.params.id);

		if (accountId !== req.user.id) {
			return res.status(403).json({ error: "Access denied" });
		}

		const client = await pool.connect();
		try {
			await client.query("DELETE FROM accounts WHERE id = $1", [accountId]);
			res.json({ message: "Account deleted successfully" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Delete account error:", error);
		res.status(500).json({ error: "Failed to delete account" });
	}
});

/**
 * Update subscription
 */
router.put("/:id/subscription", authenticate, async (req, res) => {
	try {
		const accountId = parseInt(req.params.id);

		if (accountId !== req.user.id) {
			return res.status(403).json({ error: "Access denied" });
		}

		const { subscriptionId } = req.body;

		const client = await pool.connect();
		try {
			// Verify subscription exists
			const result = await client.query("SELECT id, name FROM subscriptions WHERE id = $1", [subscriptionId]);
			const subscription = result.rows[0];

			if (!subscription) {
				return res.status(404).json({ error: "Subscription not found" });
			}

			await client.query("UPDATE accounts SET subscription_id = $1, updated_at = NOW() WHERE id = $2", [
				subscriptionId,
				accountId,
			]);

			res.json({
				message: "Subscription updated",
				subscription: subscription.name,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update subscription error:", error);
		res.status(500).json({ error: "Failed to update subscription" });
	}
});

/**
 * Update account preferences (graph theme, etc.)
 */
router.put("/preferences", async (req, res) => {
	try {
		const { accountId, graph_theme } = req.body;

		if (!accountId) {
			return res.status(400).json({ error: "Account ID is required" });
		}

		// Validate theme
		const validThemes = ["classic", "neon", "minimal", "gradient", "monochrome"];
		if (graph_theme && !validThemes.includes(graph_theme)) {
			return res.status(400).json({ error: "Invalid theme" });
		}

		const client = await pool.connect();
		try {
			const updates = [];
			const params = [];
			let paramIdx = 1;

			if (graph_theme) {
				updates.push(`graph_theme = $${paramIdx++}`);
				params.push(graph_theme);
			}

			if (updates.length === 0) {
				return res.status(400).json({ error: "No preferences to update" });
			}

			params.push(accountId);

			await client.query(`UPDATE accounts SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${paramIdx}`, params);

			res.json({ message: "Preferences updated", graph_theme });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update preferences error:", error);
		res.status(500).json({ error: "Failed to update preferences" });
	}
});

/**
 * Get account preferences
 */
router.get("/preferences/:id", async (req, res) => {
	try {
		const accountId = parseInt(req.params.id);

		const client = await pool.connect();
		try {
			const result = await client.query("SELECT graph_theme FROM accounts WHERE id = $1", [accountId]);

			if (result.rows.length === 0) {
				return res.status(404).json({ error: "Account not found" });
			}

			res.json({ graph_theme: result.rows[0].graph_theme || "classic" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get preferences error:", error);
		res.status(500).json({ error: "Failed to get preferences" });
	}
});

module.exports = router;
