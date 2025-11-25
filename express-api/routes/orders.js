/**
 * Orders Routes
 * GET /api/orders - Get user's orders
 * GET /api/orders/:id - Get order details
 * POST /api/orders - Create new order
 * PUT /api/orders/:id/status - Update order status
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

/**
 * Get all orders for authenticated user
 */
router.get("/", authenticate, async (req, res) => {
	try {
		const { status, limit = 20, offset = 0 } = req.query;

		const conn = await pool.getConnection();
		try {
			let query = `
        SELECT o.id, o.order_number, o.status, o.subtotal, o.shipping_cost, 
               o.tax, o.total, o.created_at,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
        FROM orders o
        WHERE o.account_id = ?
      `;
			const params = [req.user.id];

			if (status) {
				query += " AND o.status = ?";
				params.push(status);
			}

			query += " ORDER BY o.created_at DESC LIMIT ? OFFSET ?";
			params.push(parseInt(limit), parseInt(offset));

			const orders = await conn.query(query, params);

			// Get total count
			const [countResult] = await conn.query("SELECT COUNT(*) as total FROM orders WHERE account_id = ?", [req.user.id]);

			res.json({
				orders,
				total: Number(countResult.total),
				limit: parseInt(limit),
				offset: parseInt(offset),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get orders error:", error);
		res.status(500).json({ error: "Failed to get orders" });
	}
});

/**
 * Get order details
 */
router.get("/:id", authenticate, async (req, res) => {
	try {
		const orderId = parseInt(req.params.id);

		const conn = await pool.getConnection();
		try {
			// Get order
			const [order] = await conn.query(
				`SELECT o.*, 
                uc.card_holder, uc.card_type, uc.card_last_four
         FROM orders o
         LEFT JOIN user_cards uc ON o.card_id = uc.id
         WHERE o.id = ? AND o.account_id = ?`,
				[orderId, req.user.id]
			);

			if (!order) {
				return res.status(404).json({ error: "Order not found" });
			}

			// Get order items
			const items = await conn.query(
				`SELECT id, product_type, product_id, product_name, product_image,
                quantity, unit_price, total_price
         FROM order_items WHERE order_id = ?`,
				[orderId]
			);

			order.items = items;

			res.json({ order });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get order error:", error);
		res.status(500).json({ error: "Failed to get order" });
	}
});

/**
 * Create new order
 */
router.post("/", authenticate, async (req, res) => {
	try {
		const { items, shippingAddress, billingAddress, paymentMethod, cardId, notes } = req.body;

		if (!items || items.length === 0) {
			return res.status(400).json({ error: "Order must contain at least one item" });
		}

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			// Calculate totals
			let subtotal = 0;
			for (const item of items) {
				subtotal += item.unitPrice * item.quantity;
			}

			const shippingCost = subtotal >= 150 ? 0 : 15; // Free shipping over 150 RON
			const tax = subtotal * 0.19; // 19% VAT
			const total = subtotal + shippingCost + tax;

			// Generate order number
			const orderNumber = `ORD-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

			// Create order
			const orderResult = await conn.query(
				`INSERT INTO orders 
         (account_id, order_number, status, subtotal, shipping_cost, tax, total,
          shipping_address, billing_address, payment_method, card_id, notes)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					req.user.id,
					orderNumber,
					subtotal,
					shippingCost,
					tax,
					total,
					JSON.stringify(shippingAddress),
					JSON.stringify(billingAddress || shippingAddress),
					paymentMethod || "card",
					cardId || null,
					notes || null,
				]
			);

			const orderId = Number(orderResult.insertId);

			// Create order items
			for (const item of items) {
				await conn.query(
					`INSERT INTO order_items 
           (order_id, product_type, product_id, product_name, product_image, 
            quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						orderId,
						item.productType,
						item.productId,
						item.productName,
						item.productImage || null,
						item.quantity,
						item.unitPrice,
						item.unitPrice * item.quantity,
					]
				);
			}

			// Clear user's cart
			await conn.query("DELETE FROM cart_items WHERE account_id = ?", [req.user.id]);

			await conn.commit();

			res.status(201).json({
				message: "Order created successfully",
				order: {
					id: orderId,
					orderNumber,
					status: "pending",
					total,
				},
			});
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Create order error:", error);
		res.status(500).json({ error: "Failed to create order" });
	}
});

/**
 * Cancel order (user can cancel pending orders)
 */
router.put("/:id/cancel", authenticate, async (req, res) => {
	try {
		const orderId = parseInt(req.params.id);

		const conn = await pool.getConnection();
		try {
			const [order] = await conn.query("SELECT id, status FROM orders WHERE id = ? AND account_id = ?", [
				orderId,
				req.user.id,
			]);

			if (!order) {
				return res.status(404).json({ error: "Order not found" });
			}

			if (order.status !== "pending" && order.status !== "confirmed") {
				return res.status(400).json({ error: "Only pending or confirmed orders can be cancelled" });
			}

			await conn.query("UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?", ["cancelled", orderId]);

			res.json({ message: "Order cancelled successfully" });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Cancel order error:", error);
		res.status(500).json({ error: "Failed to cancel order" });
	}
});

module.exports = router;
