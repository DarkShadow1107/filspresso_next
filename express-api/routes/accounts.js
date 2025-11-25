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

		const conn = await pool.getConnection();
		try {
			const [account] = await conn.query(
				`SELECT a.id, a.username, a.email, a.name, a.icon, a.subscription_id,
                a.email_verified, a.last_login, a.created_at,
                s.name as subscription_name, s.description as subscription_description,
                s.price_ron as subscription_price, s.features as subscription_features
         FROM accounts a
         LEFT JOIN subscriptions s ON a.subscription_id = s.id
         WHERE a.id = ?`,
				[accountId]
			);

			if (!account) {
				return res.status(404).json({ error: "Account not found" });
			}

			res.json({ account });
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			// Check if new username is taken (if changing)
			if (username && username !== req.user.username) {
				const [existing] = await conn.query("SELECT id FROM accounts WHERE username = ? AND id != ?", [
					username.toLowerCase(),
					accountId,
				]);
				if (existing) {
					return res.status(409).json({ error: "Username already taken" });
				}
			}

			// Build update query dynamically
			const updates = [];
			const params = [];

			if (name !== undefined) {
				updates.push("name = ?");
				params.push(name);
			}
			if (icon !== undefined) {
				updates.push("icon = ?");
				params.push(icon);
			}
			if (username !== undefined) {
				updates.push("username = ?");
				params.push(username.toLowerCase());
			}

			if (updates.length === 0) {
				return res.status(400).json({ error: "No fields to update" });
			}

			params.push(accountId);

			await conn.query(`UPDATE accounts SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`, params);

			// Get updated account
			const [account] = await conn.query(
				"SELECT id, username, email, name, icon, subscription_id FROM accounts WHERE id = ?",
				[accountId]
			);

			res.json({ message: "Account updated", account });
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			await conn.query("DELETE FROM accounts WHERE id = ?", [accountId]);
			res.json({ message: "Account deleted successfully" });
		} finally {
			conn.release();
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

		const conn = await pool.getConnection();
		try {
			// Verify subscription exists
			const [subscription] = await conn.query("SELECT id, name FROM subscriptions WHERE id = ?", [subscriptionId]);

			if (!subscription) {
				return res.status(404).json({ error: "Subscription not found" });
			}

			await conn.query("UPDATE accounts SET subscription_id = ?, updated_at = NOW() WHERE id = ?", [
				subscriptionId,
				accountId,
			]);

			res.json({
				message: "Subscription updated",
				subscription: subscription.name,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Update subscription error:", error);
		res.status(500).json({ error: "Failed to update subscription" });
	}
});

module.exports = router;
