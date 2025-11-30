/**
 * Orders Routes
 * GET /api/orders - Get user's orders
 * GET /api/orders/:id - Get order details
 * GET /api/orders/popular - Get most ordered products
 * GET /api/orders/machines - Get user's purchased machines with warranty info
 * GET /api/orders/spending - Get user's total spending summary
 * POST /api/orders - Create new order
 * PUT /api/orders/:id/status - Update order status
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// Default coordinates (Bucharest, Romania)
const DEFAULT_LAT = 44.4323;
const DEFAULT_LON = 26.1063;

/**
 * Fetch current weather and determine delivery estimate
 */
async function getWeatherDeliveryEstimate() {
	try {
		const url = new URL("https://api.open-meteo.com/v1/forecast");
		url.searchParams.set("latitude", DEFAULT_LAT.toString());
		url.searchParams.set("longitude", DEFAULT_LON.toString());
		url.searchParams.set("current", "weather_code,precipitation");
		url.searchParams.set("timezone", "auto");

		const response = await fetch(url.toString());
		if (!response.ok) {
			return { condition: "normal", estimate: "1-2 days", daysMin: 1, daysMax: 2 };
		}

		const data = await response.json();
		const weatherCode = data.current?.weather_code || 0;

		// Determine weather condition and delivery estimate
		// Snow codes: 71-77, 85-86
		// Rain codes: 51-67, 80-82, 95-99
		if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
			return { condition: "snow", estimate: "3-5 days", daysMin: 3, daysMax: 5 };
		} else if ([51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(weatherCode)) {
			return { condition: "rain", estimate: "2-3 days", daysMin: 2, daysMax: 3 };
		} else if ([0, 1].includes(weatherCode)) {
			return { condition: "clear", estimate: "1-2 days", daysMin: 1, daysMax: 2 };
		}

		return { condition: "normal", estimate: "1-2 days", daysMin: 1, daysMax: 2 };
	} catch (error) {
		console.error("Weather fetch error for delivery estimate:", error);
		return { condition: "normal", estimate: "1-2 days", daysMin: 1, daysMax: 2 };
	}
}

/**
 * Calculate expected delivery date from order date and estimate
 */
function calculateExpectedDeliveryDate(daysMax) {
	const date = new Date();
	date.setDate(date.getDate() + daysMax);
	// Format as YYYY-MM-DD for MySQL DATE type
	return date.toISOString().split("T")[0];
}

/**
 * Get all orders for authenticated user
 */
// Helper to convert BigInt to Number in objects
const serializeBigInt = (obj) => {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj === "bigint") return Number(obj);
	if (obj instanceof Date) return obj.toISOString();
	if (Array.isArray(obj)) return obj.map(serializeBigInt);
	if (typeof obj === "object") {
		const result = {};
		for (const key in obj) {
			result[key] = serializeBigInt(obj[key]);
		}
		return result;
	}
	return obj;
};

/**
 * Get most popular/ordered products (capsules only)
 * GET /api/orders/popular?limit=5
 * No authentication required - public endpoint
 * NOTE: This route MUST be before /:id to avoid matching "popular" as an ID
 */
router.get("/popular", async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit) || 5, 20);

		const conn = await pool.getConnection();
		try {
			// Get most ordered capsule products
			const results = await conn.query(
				`SELECT 
					oi.product_id, 
					oi.product_name,
					oi.product_image,
					SUM(oi.quantity) as total_ordered,
					COUNT(DISTINCT oi.order_id) as order_count
				FROM order_items oi
				WHERE oi.product_type = 'capsule'
				GROUP BY oi.product_id, oi.product_name, oi.product_image
				ORDER BY total_ordered DESC
				LIMIT ?`,
				[limit]
			);

			const products = serializeBigInt(results);

			res.json({
				products,
				total: products.length,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get popular products error:", error);
		res.status(500).json({ error: "Failed to get popular products" });
	}
});

/**
 * Get all machines purchased by user
 * GET /api/orders/machines
 * Returns machines and forfaits (packs) from order_items with warranty info
 */
router.get("/machines", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			// Get all machine items from user's orders
			// We look for items where:
			// 1. product_type = 'machine' OR
			// 2. product_name contains machine-related keywords
			// Matching: Machine, Forfait, Vertuo Next, Vertuo Pop, pack
			const machines = await conn.query(
				`SELECT 
					oi.id,
					o.id as order_id,
					o.order_number,
					oi.product_type,
					oi.product_id,
					oi.product_name,
					oi.product_image,
					oi.unit_price,
					oi.quantity,
					o.created_at as purchase_date,
					DATE_ADD(o.created_at, INTERVAL 3 YEAR) as warranty_end_date,
					CASE WHEN DATE_ADD(o.created_at, INTERVAL 3 YEAR) > NOW() THEN TRUE ELSE FALSE END as is_under_warranty,
					CASE 
						WHEN oi.product_id LIKE 'pack-%' OR oi.product_id LIKE 'forfait-%' 
							OR LOWER(oi.product_name) LIKE '%forfait%'
						THEN TRUE ELSE FALSE 
					END as is_forfait
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND (
						oi.product_type = 'machine'
						OR LOWER(oi.product_name) LIKE '%machine%'
						OR LOWER(oi.product_name) LIKE '%forfait%'
						OR LOWER(oi.product_name) LIKE '%vertuo next%'
						OR LOWER(oi.product_name) LIKE '%vertuo pop%'
						OR LOWER(oi.product_name) LIKE '%vertuo plus%'
						OR LOWER(oi.product_name) LIKE '%essenza%'
						OR LOWER(oi.product_name) LIKE '%pixie%'
						OR LOWER(oi.product_name) LIKE '%citiz%'
						OR LOWER(oi.product_name) LIKE '%lattissima%'
						OR LOWER(oi.product_name) LIKE '%creatista%'
						OR LOWER(oi.product_name) LIKE '%inissia%'
						OR oi.product_id LIKE 'pack-%'
						OR oi.product_id LIKE 'forfait-%'
					)
				ORDER BY o.created_at DESC`,
				[req.user.id]
			);

			res.json({
				machines: serializeBigInt(machines),
				total: machines.length,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get machines error:", error);
		res.status(500).json({ error: "Failed to get machines" });
	}
});

/**
 * Get user's total spending summary
 * GET /api/orders/spending
 * Returns breakdown of orders vs subscriptions spending
 */
router.get("/spending", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			// Get total from all orders
			const [ordersResult] = await conn.query(
				`SELECT COALESCE(SUM(total), 0) as orders_total
				FROM orders 
				WHERE account_id = ? AND status != 'cancelled'`,
				[req.user.id]
			);

			// Get subscription spending (from order_items with product_type = 'subscription')
			const [subscriptionResult] = await conn.query(
				`SELECT COALESCE(SUM(oi.total_price), 0) as subscriptions_total
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? AND oi.product_type = 'subscription' AND o.status != 'cancelled'`,
				[req.user.id]
			);

			// Get machines AND forfaits spending
			// Same patterns as /machines endpoint
			const [machinesResult] = await conn.query(
				`SELECT COALESCE(SUM(oi.total_price), 0) as machines_total
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND (
						oi.product_type = 'machine'
						OR LOWER(oi.product_name) LIKE '%machine%'
						OR LOWER(oi.product_name) LIKE '%forfait%'
						OR LOWER(oi.product_name) LIKE '%vertuo next%'
						OR LOWER(oi.product_name) LIKE '%vertuo pop%'
						OR LOWER(oi.product_name) LIKE '%vertuo plus%'
						OR LOWER(oi.product_name) LIKE '%essenza%'
						OR LOWER(oi.product_name) LIKE '%pixie%'
						OR LOWER(oi.product_name) LIKE '%citiz%'
						OR LOWER(oi.product_name) LIKE '%lattissima%'
						OR LOWER(oi.product_name) LIKE '%creatista%'
						OR LOWER(oi.product_name) LIKE '%inissia%'
						OR oi.product_id LIKE 'pack-%'
						OR oi.product_id LIKE 'forfait-%'
					)`,
				[req.user.id]
			);

			// Get capsules/accessories spending (everything that's not a machine/forfait and not a subscription)
			const [productsResult] = await conn.query(
				`SELECT COALESCE(SUM(oi.total_price), 0) as products_total
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND oi.product_type != 'subscription'
					AND oi.product_type != 'machine'
					AND LOWER(oi.product_name) NOT LIKE '%machine%'
					AND LOWER(oi.product_name) NOT LIKE '%forfait%'
					AND LOWER(oi.product_name) NOT LIKE '%vertuo next%'
					AND LOWER(oi.product_name) NOT LIKE '%vertuo pop%'
					AND LOWER(oi.product_name) NOT LIKE '%vertuo plus%'
					AND LOWER(oi.product_name) NOT LIKE '%essenza%'
					AND LOWER(oi.product_name) NOT LIKE '%pixie%'
					AND LOWER(oi.product_name) NOT LIKE '%citiz%'
					AND LOWER(oi.product_name) NOT LIKE '%lattissima%'
					AND LOWER(oi.product_name) NOT LIKE '%creatista%'
					AND LOWER(oi.product_name) NOT LIKE '%inissia%'
					AND oi.product_id NOT LIKE 'pack-%'
					AND oi.product_id NOT LIKE 'forfait-%'`,
				[req.user.id]
			);

			const ordersTotal = Number(ordersResult.orders_total) || 0;
			const subscriptionsTotal = Number(subscriptionResult.subscriptions_total) || 0;
			const machinesTotal = Number(machinesResult.machines_total) || 0;
			const productsTotal = Number(productsResult.products_total) || 0;

			res.json({
				spending: {
					orders: ordersTotal,
					subscriptions: subscriptionsTotal,
					machines: machinesTotal,
					products: productsTotal,
					total: ordersTotal,
				},
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get spending error:", error);
		res.status(500).json({ error: "Failed to get spending" });
	}
});

router.get("/", authenticate, async (req, res) => {
	try {
		const { status, limit = 20, offset = 0 } = req.query;

		const conn = await pool.getConnection();
		try {
			let query = `
        SELECT o.id, o.order_number, o.status, o.subtotal, o.shipping_cost, 
               o.tax, o.total, o.created_at, o.weather_condition, o.estimated_delivery,
               o.expected_delivery_date,
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

			const ordersRaw = await conn.query(query, params);
			const orders = serializeBigInt(ordersRaw);

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
		const { items, shippingAddress, billingAddress, paymentMethod, cardId, notes, shippingCost, total, isSubscription } =
			req.body;

		if (!items || items.length === 0) {
			return res.status(400).json({ error: "Order must contain at least one item" });
		}

		// For subscriptions, no delivery estimate needed
		let weatherCondition = "normal";
		let estimatedDelivery = null;
		let expectedDeliveryDate = null;
		let orderStatus = "pending";

		if (isSubscription) {
			// Subscriptions are confirmed immediately, no delivery
			orderStatus = "confirmed";
			estimatedDelivery = null;
			expectedDeliveryDate = null;
		} else {
			// Get weather-based delivery estimate for regular orders
			const deliveryInfo = await getWeatherDeliveryEstimate();
			weatherCondition = deliveryInfo.condition;
			estimatedDelivery = deliveryInfo.estimate;
			expectedDeliveryDate = calculateExpectedDeliveryDate(deliveryInfo.daysMax);
		}

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			// Calculate subtotal from items
			let subtotal = 0;
			for (const item of items) {
				subtotal += item.unitPrice * item.quantity;
			}

			// Use shipping cost from frontend, default to 24.99 if subtotal < 200 (0 for subscriptions)
			const finalShippingCost = isSubscription
				? 0
				: shippingCost !== undefined
				? shippingCost
				: subtotal >= 200
				? 0
				: 24.99;
			// Use total from frontend, or calculate as subtotal + shipping (VAT is included in prices)
			const finalTotal = total !== undefined ? total : subtotal + finalShippingCost;
			// Tax is 21% of total (included in price, calculated for display purposes)
			const tax = Math.round(finalTotal * 0.21 * 100) / 100;

			// Generate order number - use SUB prefix for subscriptions
			const orderPrefix = isSubscription ? "SUB" : "ORD";
			const orderNumber = `${orderPrefix}-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

			// Create order
			const orderResult = await conn.query(
				`INSERT INTO orders 
         (account_id, order_number, status, subtotal, shipping_cost, tax, total,
          shipping_address, billing_address, payment_method, card_id, notes,
          weather_condition, estimated_delivery, expected_delivery_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					req.user.id,
					orderNumber,
					orderStatus,
					subtotal,
					finalShippingCost,
					tax,
					finalTotal,
					JSON.stringify(shippingAddress),
					JSON.stringify(billingAddress || shippingAddress),
					paymentMethod || "card",
					cardId || null,
					notes || null,
					isSubscription ? null : weatherCondition,
					estimatedDelivery,
					expectedDeliveryDate,
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
