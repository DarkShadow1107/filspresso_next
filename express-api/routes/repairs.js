/**
 * Repairs Routes
 * POST /api/repairs - Submit a repair request
 * GET /api/repairs - Get user's repair history
 */

const express = require("express");
const pool = require("../db/connection");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// Default coordinates (Bucharest)
const DEFAULT_LAT = 44.4323;
const DEFAULT_LON = 26.1063;

/**
 * Get user's repair history
 * GET /api/repairs
 */
router.get("/", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			const repairs = await conn.query(
				`SELECT r.*, o.order_number, uc.card_type, uc.card_last_four
				FROM repairs r
				LEFT JOIN orders o ON r.order_id = o.id
				LEFT JOIN user_cards uc ON r.payment_card_id = uc.id
				WHERE r.account_id = ?
				ORDER BY r.created_at DESC`,
				[req.user.id]
			);
			res.json({ repairs });
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Failed to fetch repairs:", error);
		res.status(500).json({ error: "Failed to fetch repair history" });
	}
});

/**
 * Submit a repair request
 * POST /api/repairs
 */
router.post("/", authenticate, async (req, res) => {
	const { machine_id, machine_name, repair_type, is_warranty, estimated_cost, order_id, payment_card_id } = req.body;

	if (!machine_id || !repair_type) {
		return res.status(400).json({ error: "Missing required fields" });
	}

	try {
		// 1. Check Weather
		let isBadWeather = false;
		try {
			const weatherRes = await fetch(
				`https://api.open-meteo.com/v1/forecast?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&current=precipitation,weather_code`
			);
			if (weatherRes.ok) {
				const weatherData = await weatherRes.json();
				const precip = weatherData.current?.precipitation || 0;
				const code = weatherData.current?.weather_code || 0;
				// Codes: 51-67 (drizzle/rain), 71-77 (snow), 80-82 (showers), 95-99 (thunderstorm)
				if (precip > 0.5 || (code >= 51 && code <= 99)) {
					isBadWeather = true;
				}
			}
		} catch (e) {
			console.warn("Failed to fetch weather for repair estimation", e);
		}

		// 2. Calculate Duration
		// Base: 3 to 7 days based on cost/complexity
		// Heuristic: 3 days + 1 day per 50 RON of cost (capped at 4 extra days)
		// If warranty (cost is 0), assume complex -> 5 days base
		let baseDays = 3;
		if (is_warranty) {
			baseDays = 5;
		} else {
			baseDays += Math.min(4, Math.ceil((estimated_cost || 0) / 50));
		}

		// Modifiers
		let duration = baseDays;
		const warrantyDelay = is_warranty ? 2 : 0;
		const weatherDelay = isBadWeather ? 1 : 0;
		duration += warrantyDelay + weatherDelay;

		// Calculate delivery date
		const deliveryDate = new Date();
		deliveryDate.setDate(deliveryDate.getDate() + duration);
		const estimatedDeliveryStr = `${duration} days`;

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			// 3. Create Order
			const orderNumber = `REP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

			const orderResult = await conn.query(
				`INSERT INTO orders 
				(account_id, order_number, status, subtotal, shipping_cost, tax, total, payment_method, card_id, created_at, estimated_delivery, weather_condition, expected_delivery_date)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
				[
					req.user.id,
					orderNumber,
					"processing", // Status
					estimated_cost, // Subtotal
					0, // Shipping
					0, // Tax
					estimated_cost, // Total
					is_warranty ? "warranty" : "card",
					payment_card_id || null,
					estimatedDeliveryStr,
					isBadWeather ? "rain" : "clear",
					deliveryDate.toISOString().split("T")[0], // expected_delivery_date as DATE
				]
			);

			const newOrderId = orderResult.insertId;

			// 4. Create Order Item
			await conn.query(
				`INSERT INTO order_items 
				(order_id, product_type, product_id, product_name, quantity, unit_price, total_price)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					newOrderId,
					"service",
					machine_id,
					`Repair Service: ${machine_name} (${repair_type})${is_warranty ? " [WARRANTY]" : ""}`,
					1,
					estimated_cost,
					estimated_cost,
				]
			);

			// 5. Create Repair Record in dedicated repairs table
			// Strip price from machine name (e.g., "Machine Name - 590,00 RON" -> "Machine Name")
			const cleanMachineName = machine_name.replace(/\s*-\s*[\d,.]+\s*RON\s*$/i, "").trim();

			await conn.query(
				`INSERT INTO repairs 
				(account_id, order_id, machine_id, machine_name, repair_type, is_warranty, estimated_cost, estimated_duration, weather_delay, warranty_delay, status, pickup_date, payment_card_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					req.user.id,
					newOrderId,
					machine_id,
					cleanMachineName,
					repair_type,
					is_warranty,
					estimated_cost,
					duration,
					isBadWeather,
					is_warranty,
					"pending",
					deliveryDate,
					is_warranty ? null : payment_card_id || null,
				]
			);

			await conn.commit();

			res.json({
				success: true,
				orderId: Number(newOrderId),
				orderNumber,
				estimatedDuration: duration,
				estimatedDelivery: deliveryDate.toISOString(),
				isBadWeather,
			});
		} catch (err) {
			await conn.rollback();
			throw err;
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Repair request error:", error);
		res.status(500).json({ error: "Failed to submit repair request" });
	}
});

module.exports = router;
