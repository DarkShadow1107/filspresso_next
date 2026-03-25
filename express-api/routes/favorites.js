/**
 * Favorites Routes
 * GET /api/favorites - Get all user favorites
 * POST /api/favorites - Add a favorite
 * DELETE /api/favorites/:type/:id - Remove a favorite
 * POST /api/favorites/sync - Sync local favorites to account
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

/**
 * Get all favorites for the authenticated user
 */
router.get("/", authenticate, async (req, res) => {
	try {
		const result = await pool.query(
			"SELECT product_type, product_category, product_id, created_at FROM favorites WHERE account_id = $1 ORDER BY created_at DESC",
			[req.user.id],
		);
		res.json({ status: "success", favorites: result.rows });
	} catch (error) {
		console.error("Fetch favorites error:", error);
		res.status(500).json({ status: "error", message: "Failed to fetch favorites" });
	}
});

/**
 * Add a product to favorites
 */
router.post("/", authenticate, async (req, res) => {
	try {
		const { product_type, product_id, product_category } = req.body;

		if (!product_type || !product_id) {
			return res.status(400).json({ status: "error", message: "Product type and ID are required" });
		}

		await pool.query(
			"INSERT INTO favorites (account_id, product_type, product_id, product_category) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, product_type, product_id) DO UPDATE SET product_category = EXCLUDED.product_category",
			[req.user.id, product_type, product_id, product_category || null],
		);

		res.status(201).json({ status: "success", message: "Added to favorites" });
	} catch (error) {
		console.error("Add favorite error:", error);
		res.status(500).json({ status: "error", message: "Failed to add favorite" });
	}
});

/**
 * Remove a product from favorites
 */
router.delete("/:type/:id", authenticate, async (req, res) => {
	try {
		const { type, id } = req.params;

		await pool.query("DELETE FROM favorites WHERE account_id = $1 AND product_type = $2 AND product_id = $3", [
			req.user.id,
			type,
			id,
		]);

		res.json({ status: "success", message: "Removed from favorites" });
	} catch (error) {
		console.error("Remove favorite error:", error);
		res.status(500).json({ status: "error", message: "Failed to remove favorite" });
	}
});

/**
 * Sync local favorites to account
 * Expected body: { favorites: [{ product_type: 'capsule', product_id: '...' }, ...] }
 */
router.post("/sync", authenticate, async (req, res) => {
	try {
		const { favorites } = req.body;

		if (!Array.isArray(favorites)) {
			return res.status(400).json({ status: "error", message: "Favorites array is required" });
		}

		if (favorites.length === 0) {
			return res.json({ status: "success", message: "Nothing to sync" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			for (const fav of favorites) {
				await client.query(
					"INSERT INTO favorites (account_id, product_type, product_id, product_category) VALUES ($1, $2, $3, $4) ON CONFLICT (account_id, product_type, product_id) DO UPDATE SET product_category = EXCLUDED.product_category",
					[req.user.id, fav.product_type, fav.product_id, fav.product_category || null],
				);
			}
			await client.query("COMMIT");
		} catch (e) {
			await client.query("ROLLBACK");
			throw e;
		} finally {
			client.release();
		}

		res.json({ status: "success", message: "Favorites synced successfully" });
	} catch (error) {
		console.error("Sync favorites error:", error);
		res.status(500).json({ status: "error", message: "Failed to sync favorites" });
	}
});

module.exports = router;
