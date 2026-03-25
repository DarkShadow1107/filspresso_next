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

const ACTIVE_CART_RESERVATION_MINUTES = Math.max(1, Number.parseInt(process.env.CART_RESERVATION_MINUTES || "20", 10));
const CART_STOCK_BUFFER_UNITS = Math.max(0, Number.parseInt(process.env.CART_STOCK_BUFFER_UNITS || "0", 10));

// Tier discount percentages
const TIER_DISCOUNTS = {
	None: 0,
	Connoisseur: 5,
	Expert: 10,
	Master: 15,
	Virtuoso: 18,
	Ambassador: 20,
};

function resolveInventoryTable(productType) {
	if (productType === "capsule") return "coffee_products";
	if (productType === "machine" || productType === "accessory") return "machine_products";
	return null;
}

async function getStockAvailability(client, { accountId, productType, productId, lockRow = false }) {
	const inventoryTable = resolveInventoryTable(productType);
	if (!inventoryTable) {
		return {
			tracked: false,
			availableQuantity: Number.POSITIVE_INFINITY,
		};
	}

	const stockResult = await client.query(
		`SELECT stock
		 FROM ${inventoryTable}
		 WHERE product_id = $1${lockRow ? " FOR UPDATE" : ""}`,
		[productId],
	);

	if (stockResult.rows.length === 0) {
		return {
			tracked: true,
			missingProduct: true,
			availableQuantity: 0,
		};
	}

	const stock = Number(stockResult.rows[0].stock) || 0;
	const reservedByOthersResult = await client.query(
		`SELECT COALESCE(SUM(quantity), 0) AS reserved_qty
		 FROM cart_items
		 WHERE product_type = $1
		   AND product_id = $2
		   AND account_id != $3
		   AND updated_at >= NOW() - (($4)::text || ' minutes')::interval`,
		[productType, productId, accountId, ACTIVE_CART_RESERVATION_MINUTES],
	);

	const reservedByOthers = Number(reservedByOthersResult.rows[0]?.reserved_qty) || 0;
	const availableQuantity = Math.max(0, stock - reservedByOthers - CART_STOCK_BUFFER_UNITS);

	return {
		tracked: true,
		stock,
		reservedByOthers,
		bufferUnits: CART_STOCK_BUFFER_UNITS,
		availableQuantity,
	};
}

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
			[accountId, periodStart.toISOString()],
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
				[req.user.id],
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
		const normalizedQuantity = Number.parseInt(quantity, 10);

		if (!productType || !productId || !productName || unitPrice === undefined) {
			return res.status(400).json({ error: "Product type, ID, name and price are required" });
		}

		if (!["capsule", "machine", "accessory"].includes(productType)) {
			return res.status(400).json({ error: "Invalid product type" });
		}

		if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
			return res.status(400).json({ error: "Quantity must be an integer of at least 1" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			// Check if item already in cart
			const result = await client.query(
				`SELECT id, quantity FROM cart_items 
        WHERE account_id = $1 AND product_type = $2 AND product_id = $3`,
				[req.user.id, productType, productId],
			);
			const existing = result.rows[0];
			const targetQuantity = existing ? existing.quantity + normalizedQuantity : normalizedQuantity;

			const availability = await getStockAvailability(client, {
				accountId: req.user.id,
				productType,
				productId,
				lockRow: true,
			});

			if (availability.missingProduct) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Product not found in stock inventory" });
			}

			if (availability.tracked && targetQuantity > availability.availableQuantity) {
				await client.query("ROLLBACK");
				return res.status(409).json({
					error: `Only ${availability.availableQuantity} units currently available to reserve for this item.`,
					availableQuantity: availability.availableQuantity,
					requestedQuantity: targetQuantity,
					stock: availability.stock,
					reservedByOthers: availability.reservedByOthers,
					bufferUnits: availability.bufferUnits,
				});
			}

			if (existing) {
				// Update quantity
				const newQuantity = targetQuantity;
				await client.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2", [
					newQuantity,
					existing.id,
				]);
				await client.query("COMMIT");
				res.json({ message: "Cart updated", quantity: newQuantity });
			} else {
				// Insert new item with product details
				await client.query(
					`INSERT INTO cart_items (account_id, product_type, product_id, product_name, product_image, unit_price, quantity)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					[req.user.id, productType, productId, productName, productImage || null, unitPrice, normalizedQuantity],
				);
				await client.query("COMMIT");
				res.status(201).json({ message: "Item added to cart" });
			}
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
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
		const normalizedQuantity = Number.parseInt(quantity, 10);

		if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
			return res.status(400).json({ error: "Quantity must be an integer of at least 1" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const result = await client.query(
				"SELECT id, product_type, product_id FROM cart_items WHERE id = $1 AND account_id = $2",
				[itemId, req.user.id],
			);
			const item = result.rows[0];

			if (!item) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Cart item not found" });
			}

			const availability = await getStockAvailability(client, {
				accountId: req.user.id,
				productType: item.product_type,
				productId: item.product_id,
				lockRow: true,
			});

			if (availability.missingProduct) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "Product not found in stock inventory" });
			}

			if (availability.tracked && normalizedQuantity > availability.availableQuantity) {
				await client.query("ROLLBACK");
				return res.status(409).json({
					error: `Only ${availability.availableQuantity} units currently available to reserve for this item.`,
					availableQuantity: availability.availableQuantity,
					requestedQuantity: normalizedQuantity,
					stock: availability.stock,
					reservedByOthers: availability.reservedByOthers,
					bufferUnits: availability.bufferUnits,
				});
			}

			await client.query("UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2", [
				normalizedQuantity,
				itemId,
			]);
			await client.query("COMMIT");

			res.json({ message: "Cart updated" });
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
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
			const result = await client.query("SELECT id FROM cart_items WHERE id = $1 AND account_id = $2", [
				itemId,
				req.user.id,
			]);
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
