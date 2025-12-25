/**
 * Cart Routes (Server-side persistent cart)
 * GET /api/cart - Get user's cart
 * POST /api/cart - Add item to cart
 * PUT /api/cart/:id - Update cart item quantity
 * DELETE /api/cart/:id - Remove item from cart
 * DELETE /api/cart - Clear cart
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Tier discount percentages
const TIER_DISCOUNTS = {
	None: 0,
	Connoisseur: 5,
	Expert: 10,
	Master: 15,
	Virtuoso: 18,
	Ambassador: 20,
};

// Function to get user's current tier
async function getUserTier(client, accountId) {
	try {
		// First check if member_status table exists
		try {
			const result = await client.query(`SELECT current_tier FROM member_status WHERE account_id = $1`, [accountId]);
			const memberStatus = result.rows[0];

			if (memberStatus && memberStatus.current_tier) {
				return memberStatus.current_tier;
			}
		} catch (tableError) {
			// Table doesn't exist yet, fall through to calculate from orders
			// PostgreSQL error code for undefined_table is 42P01
			if (tableError.code !== "42P01") {
				console.error("Error checking member_status:", tableError);
			}
		}

		// If no status found or table doesn't exist, calculate from orders
		const accountResult = await client.query(`SELECT created_at FROM accounts WHERE id = $1`, [accountId]);
		const accountRow = accountResult.rows;

		if (!accountRow || accountRow.length === 0) {
			return "None";
		}

		const accountCreated = new Date(accountRow[0].created_at);
		const now = new Date();

		// Calculate current membership year
		let periodStart = new Date(accountCreated);
		while (periodStart <= now) {
			const nextYear = new Date(periodStart);
			nextYear.setFullYear(nextYear.getFullYear() + 1);
			if (nextYear > now) break;
			periodStart = nextYear;
		}

		// Count capsules in current period
		const capsuleResult = await client.query(
			`SELECT COALESCE(SUM(oi.quantity), 0) as total_sleeves
			FROM orders o
			JOIN order_items oi ON o.id = oi.order_id
			WHERE o.account_id = $1
			AND o.created_at >= $2
			AND oi.product_type = 'capsule'`,
			[accountId, periodStart.toISOString()]
		);

		const totalCapsules = (Number(capsuleResult.rows[0]?.total_sleeves) || 0) * 10;

		// Determine tier
		if (totalCapsules >= 7000) return "Ambassador";
		if (totalCapsules >= 4000) return "Virtuoso";
		if (totalCapsules >= 2000) return "Master";
		if (totalCapsules >= 750) return "Expert";
		if (totalCapsules >= 1) return "Connoisseur";
		return "None";
	} catch (error) {
		console.error("Error getting user tier:", error);
		return "None";
	}
}

/**
 * Get user's cart items (product details come from frontend JSON data)
 */
router.get("/", authenticate, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			const result = await client.query(
				`SELECT id, product_type, product_id, product_name, product_image, unit_price, quantity, created_at
        FROM cart_items
        WHERE account_id = $1
        ORDER BY created_at DESC`,
				[req.user.id]
			);
			const cartItems = result.rows;

			// Get user's member tier for discount
			const memberTier = await getUserTier(client, req.user.id);
			const discountPercent = TIER_DISCOUNTS[memberTier] || 0;

			// Calculate totals
			const items = cartItems.map((item) => ({
				id: item.id,
				productType: item.product_type,
				productId: item.product_id,
				name: item.product_name,
				image: item.product_image,
				price: parseFloat(item.unit_price),
				quantity: item.quantity,
				totalPrice: parseFloat(item.unit_price) * item.quantity,
			}));

			const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
			const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
			const subtotalAfterDiscount = subtotal - discountAmount;
			const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

			res.json({
				items,
				subtotal,
				itemCount,
				memberTier,
				discountPercent,
				discountAmount,
				subtotalAfterDiscount,
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get cart error:", error);
		res.status(500).json({ error: "Failed to get cart" });
	}
});

/**
 * Add item to cart (product details come from frontend)
 */
router.post("/", authenticate, async (req, res) => {
	try {
		const { productType, productId, productName, productImage, unitPrice, quantity = 1 } = req.body;

		if (!productType || !productId || !productName || unitPrice === undefined) {
			return res.status(400).json({ error: "Product type, ID, name and price are required" });
		}

		if (!["capsule", "machine", "accessory"].includes(productType)) {
			return res.status(400).json({ error: "Invalid product type" });
		}

		const client = await pool.connect();
		try {
			// Check if item already in cart
			const result = await client.query(
				`SELECT id, quantity FROM cart_items 
        WHERE account_id = $1 AND product_type = $2 AND product_id = $3`,
				[req.user.id, productType, productId]
			);
			const existing = result.rows[0];

			if (existing) {
				// Update quantity
				const newQuantity = existing.quantity + quantity;
				await client.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2", [
					newQuantity,
					existing.id,
				]);
				res.json({ message: "Cart updated", quantity: newQuantity });
			} else {
				// Insert new item with product details
				await client.query(
					`INSERT INTO cart_items (account_id, product_type, product_id, product_name, product_image, unit_price, quantity)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					[req.user.id, productType, productId, productName, productImage || null, unitPrice, quantity]
				);
				res.status(201).json({ message: "Item added to cart" });
			}
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Add to cart error:", error);
		res.status(500).json({ error: "Failed to add to cart" });
	}
});

/**
 * Update cart item quantity
 */
router.put("/:id", authenticate, async (req, res) => {
	try {
		const itemId = parseInt(req.params.id);
		const { quantity } = req.body;

		if (!quantity || quantity < 1) {
			return res.status(400).json({ error: "Quantity must be at least 1" });
		}

		const client = await pool.connect();
		try {
			const result = await client.query("SELECT id FROM cart_items WHERE id = $1 AND account_id = $2", [itemId, req.user.id]);
			const item = result.rows[0];

			if (!item) {
				return res.status(404).json({ error: "Cart item not found" });
			}

			await client.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2", [quantity, itemId]);

			res.json({ message: "Cart updated" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Update cart error:", error);
		res.status(500).json({ error: "Failed to update cart" });
	}
});

/**
 * Remove item from cart
 */
router.delete("/:id", authenticate, async (req, res) => {
	try {
		const itemId = parseInt(req.params.id);

		const client = await pool.connect();
		try {
			const result = await client.query("SELECT id FROM cart_items WHERE id = $1 AND account_id = $2", [itemId, req.user.id]);
			const item = result.rows[0];

			if (!item) {
				return res.status(404).json({ error: "Cart item not found" });
			}

			await client.query("DELETE FROM cart_items WHERE id = $1", [itemId]);

			res.json({ message: "Item removed from cart" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Remove from cart error:", error);
		res.status(500).json({ error: "Failed to remove from cart" });
	}
});

/**
 * Clear entire cart
 */
router.delete("/", authenticate, async (req, res) => {
	try {
		const client = await pool.connect();
		try {
			await client.query("DELETE FROM cart_items WHERE account_id = $1", [req.user.id]);
			res.json({ message: "Cart cleared" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Clear cart error:", error);
		res.status(500).json({ error: "Failed to clear cart" });
	}
});

module.exports = router;
