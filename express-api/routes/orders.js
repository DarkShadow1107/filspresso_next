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

// Tier discount percentages
const TIER_DISCOUNTS = {
	None: 0,
	Connoisseur: 5,
	Expert: 10,
	Master: 15,
	Virtuoso: 18,
	Ambassador: 20,
};

// Tier thresholds (in capsules)
const TIER_THRESHOLDS = [
	{ tier: "Ambassador", min: 7000 },
	{ tier: "Virtuoso", min: 4000 },
	{ tier: "Master", min: 2000 },
	{ tier: "Expert", min: 750 },
	{ tier: "Connoisseur", min: 1 },
];

// Free shipping tiers
const FREE_SHIPPING_TIERS = ["Master", "Virtuoso", "Ambassador"];
const FREE_SHIPPING_THRESHOLD_TIERS = { Expert: 150 };

/**
 * Get user's member tier
 */
async function getUserTier(conn, accountId) {
	try {
		// First try to get from member_status table
		const [status] = await conn.query("SELECT current_tier FROM member_status WHERE account_id = ?", [accountId]);

		if (status && status.current_tier) {
			return status.current_tier;
		}
	} catch (error) {
		// Table might not exist yet, continue to fallback
		console.log("member_status table not available, calculating tier from orders");
	}

	// Fallback: Calculate tier from orders
	try {
		const [result] = await conn.query(
			`SELECT COALESCE(SUM(oi.quantity), 0) as total_capsules
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       WHERE o.account_id = ? 
       AND o.status IN ('confirmed', 'shipped', 'delivered')
       AND oi.product_type = 'capsule'`,
			[accountId]
		);

		const totalCapsules = Number(result?.total_capsules || 0) * 10; // sleeves * 10

		for (const threshold of TIER_THRESHOLDS) {
			if (totalCapsules >= threshold.min) {
				return threshold.tier;
			}
		}
	} catch (error) {
		console.error("Error calculating tier from orders:", error);
	}

	return "None";
}

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
					AND oi.product_type != 'service'
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

/**
 * Get user's capsule order stats for member status tiers
 * GET /api/orders/capsule-stats
 * Returns total capsules ordered, yearly breakdown, and tier info
 *
 * Capsule count: Each order item quantity = sleeves, each sleeve = 10 capsules
 *
 * Tier Structure (within anniversary year):
 * - Connoisseur: 1+ capsules (first order)
 * - Expert: 750+ capsules
 * - Master: 2000+ capsules
 * - Virtuoso: 4000+ capsules
 * - Ambassador: 7000+ capsules
 */
router.get("/capsule-stats", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			// Get account creation date
			const [accountInfo] = await conn.query(`SELECT created_at FROM accounts WHERE id = ?`, [req.user.id]);

			const accountCreatedAt = accountInfo?.created_at || new Date();
			const accountYear = new Date(accountCreatedAt).getFullYear();
			const currentYear = new Date().getFullYear();

			// Each quantity = sleeves, each sleeve = 10 capsules
			const CAPSULES_PER_SLEEVE = 10;

			// Get total sleeves ordered all-time, split by Original vs Vertuo
			// product_id or product_image path indicates Original vs Vertuo
			const [totalResult] = await conn.query(
				`SELECT 
					COALESCE(SUM(oi.quantity), 0) as total_sleeves,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'original-%' 
							OR LOWER(oi.product_image) LIKE '%/original/%' 
						THEN oi.quantity ELSE 0 END), 0) as original_sleeves,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'vertuo-%' 
							OR LOWER(oi.product_image) LIKE '%/vertuo/%' 
						THEN oi.quantity ELSE 0 END), 0) as vertuo_sleeves
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'`,
				[req.user.id]
			);

			const totalCapsules = (Number(totalResult?.total_sleeves) || 0) * CAPSULES_PER_SLEEVE;
			const originalCapsules = (Number(totalResult?.original_sleeves) || 0) * CAPSULES_PER_SLEEVE;
			const vertuoCapsules = (Number(totalResult?.vertuo_sleeves) || 0) * CAPSULES_PER_SLEEVE;

			// Get sleeves ordered per year (from account creation year to now)
			const yearlyStats = await conn.query(
				`SELECT 
					YEAR(o.created_at) as year,
					COALESCE(SUM(oi.quantity), 0) as sleeves_ordered,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'original-%' 
							OR LOWER(oi.product_image) LIKE '%/original/%' 
						THEN oi.quantity ELSE 0 END), 0) as original_sleeves,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'vertuo-%' 
							OR LOWER(oi.product_image) LIKE '%/vertuo/%' 
						THEN oi.quantity ELSE 0 END), 0) as vertuo_sleeves,
					COUNT(DISTINCT o.id) as order_count
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'
					AND YEAR(o.created_at) >= ?
				GROUP BY YEAR(o.created_at)
				ORDER BY year DESC`,
				[req.user.id, accountYear]
			);

			// Get sleeves ordered in current anniversary year
			const createdDate = new Date(accountCreatedAt);
			const today = new Date();

			// Calculate current anniversary period
			let anniversaryStart = new Date(today.getFullYear(), createdDate.getMonth(), createdDate.getDate());
			if (anniversaryStart > today) {
				anniversaryStart = new Date(today.getFullYear() - 1, createdDate.getMonth(), createdDate.getDate());
			}
			const anniversaryEnd = new Date(anniversaryStart);
			anniversaryEnd.setFullYear(anniversaryEnd.getFullYear() + 1);

			const [currentPeriodResult] = await conn.query(
				`SELECT 
					COALESCE(SUM(oi.quantity), 0) as sleeves_this_period,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'original-%' 
							OR LOWER(oi.product_image) LIKE '%/original/%' 
						THEN oi.quantity ELSE 0 END), 0) as original_sleeves,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'vertuo-%' 
							OR LOWER(oi.product_image) LIKE '%/vertuo/%' 
						THEN oi.quantity ELSE 0 END), 0) as vertuo_sleeves
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'
					AND o.created_at >= ?
					AND o.created_at < ?`,
				[req.user.id, anniversaryStart.toISOString().split("T")[0], anniversaryEnd.toISOString().split("T")[0]]
			);

			const currentPeriodCapsules = (Number(currentPeriodResult?.sleeves_this_period) || 0) * CAPSULES_PER_SLEEVE;
			const currentPeriodOriginal = (Number(currentPeriodResult?.original_sleeves) || 0) * CAPSULES_PER_SLEEVE;
			const currentPeriodVertuo = (Number(currentPeriodResult?.vertuo_sleeves) || 0) * CAPSULES_PER_SLEEVE;

			// New tier structure: Connoisseur, Expert, Master, Virtuoso, Ambassador
			const getTier = (capsules) => {
				if (capsules >= 7000) return { name: "Ambassador", level: 5 };
				if (capsules >= 4000) return { name: "Virtuoso", level: 4 };
				if (capsules >= 2000) return { name: "Master", level: 3 };
				if (capsules >= 750) return { name: "Expert", level: 2 };
				if (capsules >= 1) return { name: "Connoisseur", level: 1 };
				return null; // No tier yet
			};

			const getNextTierInfo = (capsules) => {
				if (capsules >= 7000) return null; // Already at max
				if (capsules >= 4000) return { name: "Ambassador", needed: 7000, remaining: 7000 - capsules };
				if (capsules >= 2000) return { name: "Virtuoso", needed: 4000, remaining: 4000 - capsules };
				if (capsules >= 750) return { name: "Master", needed: 2000, remaining: 2000 - capsules };
				if (capsules >= 1) return { name: "Expert", needed: 750, remaining: 750 - capsules };
				return { name: "Connoisseur", needed: 1, remaining: 1 };
			};

			const currentTier = getTier(currentPeriodCapsules);
			const nextTier = getNextTierInfo(currentPeriodCapsules);

			// Build yearly history with highest tier achieved each year
			const yearlyHistory = [];
			for (const yearData of serializeBigInt(yearlyStats)) {
				const capsules = yearData.sleeves_ordered * CAPSULES_PER_SLEEVE;
				const tier = getTier(capsules);
				yearlyHistory.push({
					year: yearData.year,
					capsules: capsules,
					originalCapsules: yearData.original_sleeves * CAPSULES_PER_SLEEVE,
					vertuoCapsules: yearData.vertuo_sleeves * CAPSULES_PER_SLEEVE,
					orders: yearData.order_count,
					tier: tier?.name || null,
					tierLevel: tier?.level || 0,
				});
			}

			// Fill in missing years with 0 capsules (no tier)
			for (let year = accountYear; year <= currentYear; year++) {
				if (!yearlyHistory.find((y) => y.year === year)) {
					yearlyHistory.push({
						year,
						capsules: 0,
						originalCapsules: 0,
						vertuoCapsules: 0,
						orders: 0,
						tier: null,
						tierLevel: 0,
					});
				}
			}
			yearlyHistory.sort((a, b) => b.year - a.year);

			// Days remaining in current anniversary period
			const daysRemaining = Math.ceil((anniversaryEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

			// Save/update member_status in database
			try {
				await conn.query(
					`INSERT INTO member_status 
						(account_id, total_capsules, original_capsules, vertuo_capsules, current_tier, 
						 current_year_capsules, current_year_start, highest_tier_achieved)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					ON DUPLICATE KEY UPDATE 
						total_capsules = VALUES(total_capsules),
						original_capsules = VALUES(original_capsules),
						vertuo_capsules = VALUES(vertuo_capsules),
						current_tier = VALUES(current_tier),
						current_year_capsules = VALUES(current_year_capsules),
						current_year_start = VALUES(current_year_start),
						highest_tier_achieved = CASE 
							WHEN highest_tier_achieved IS NULL THEN VALUES(current_tier)
							WHEN VALUES(current_tier) IS NULL THEN highest_tier_achieved
							WHEN FIELD(VALUES(current_tier), 'Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') > 
								 FIELD(highest_tier_achieved, 'Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') 
							THEN VALUES(current_tier)
							ELSE highest_tier_achieved
						END,
						updated_at = NOW()`,
					[
						req.user.id,
						totalCapsules,
						originalCapsules,
						vertuoCapsules,
						currentTier?.name || null,
						currentPeriodCapsules,
						anniversaryStart.toISOString().split("T")[0],
						currentTier?.name || null,
					]
				);

				// Update yearly history in member_status_history
				for (const yearData of yearlyHistory) {
					if (yearData.capsules > 0 || yearData.year === currentYear) {
						await conn.query(
							`INSERT INTO member_status_history 
								(account_id, year, capsules_ordered, original_capsules, vertuo_capsules, order_count, highest_tier)
							VALUES (?, ?, ?, ?, ?, ?, ?)
							ON DUPLICATE KEY UPDATE 
								capsules_ordered = VALUES(capsules_ordered),
								original_capsules = VALUES(original_capsules),
								vertuo_capsules = VALUES(vertuo_capsules),
								order_count = VALUES(order_count),
								highest_tier = CASE 
									WHEN highest_tier IS NULL THEN VALUES(highest_tier)
									WHEN VALUES(highest_tier) IS NULL THEN highest_tier
									WHEN FIELD(VALUES(highest_tier), 'Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') > 
										 FIELD(highest_tier, 'Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') 
									THEN VALUES(highest_tier)
									ELSE highest_tier
								END,
								updated_at = NOW()`,
							[
								req.user.id,
								yearData.year,
								yearData.capsules,
								yearData.originalCapsules,
								yearData.vertuoCapsules,
								yearData.orders,
								yearData.tier,
							]
						);
					}
				}
			} catch (dbError) {
				// Log but don't fail - table may not exist yet
				console.warn("Could not save member status to database:", dbError.message);
			}

			// Get machines breakdown by Original vs Vertuo
			const [machineStats] = await conn.query(
				`SELECT 
					COUNT(*) as total_machines,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'original-%' 
							OR LOWER(oi.product_image) LIKE '%/original/%'
							OR LOWER(oi.product_name) LIKE '%essenza%'
							OR LOWER(oi.product_name) LIKE '%pixie%'
							OR LOWER(oi.product_name) LIKE '%citiz%'
							OR LOWER(oi.product_name) LIKE '%inissia%'
							OR (LOWER(oi.product_name) LIKE '%lattissima%' AND LOWER(oi.product_name) NOT LIKE '%vertuo%')
							OR (LOWER(oi.product_name) LIKE '%creatista%' AND LOWER(oi.product_name) NOT LIKE '%vertuo%')
						THEN oi.quantity ELSE 0 END), 0) as original_machines,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'vertuo-%' 
							OR LOWER(oi.product_image) LIKE '%/vertuo/%'
							OR LOWER(oi.product_name) LIKE '%vertuo next%'
							OR LOWER(oi.product_name) LIKE '%vertuo pop%'
							OR LOWER(oi.product_name) LIKE '%vertuo plus%'
							OR LOWER(oi.product_name) LIKE '%vertuo lattissima%'
							OR LOWER(oi.product_name) LIKE '%vertuo creatista%'
						THEN oi.quantity ELSE 0 END), 0) as vertuo_machines
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND (
						oi.product_type = 'machine'
						OR LOWER(oi.product_name) LIKE '%machine%'
						OR LOWER(oi.product_name) LIKE '%vertuo next%'
						OR LOWER(oi.product_name) LIKE '%vertuo pop%'
						OR LOWER(oi.product_name) LIKE '%vertuo plus%'
						OR LOWER(oi.product_name) LIKE '%essenza%'
						OR LOWER(oi.product_name) LIKE '%pixie%'
						OR LOWER(oi.product_name) LIKE '%citiz%'
						OR LOWER(oi.product_name) LIKE '%lattissima%'
						OR LOWER(oi.product_name) LIKE '%creatista%'
						OR LOWER(oi.product_name) LIKE '%inissia%'
					)`,
				[req.user.id]
			);

			res.json({
				totalCapsules,
				originalCapsules,
				vertuoCapsules,
				machineStats: {
					total: Number(machineStats?.total_machines) || 0,
					original: Number(machineStats?.original_machines) || 0,
					vertuo: Number(machineStats?.vertuo_machines) || 0,
				},
				currentPeriod: {
					capsules: currentPeriodCapsules,
					originalCapsules: currentPeriodOriginal,
					vertuoCapsules: currentPeriodVertuo,
					startDate: anniversaryStart.toISOString().split("T")[0],
					endDate: anniversaryEnd.toISOString().split("T")[0],
					daysRemaining: Math.max(0, daysRemaining),
				},
				currentTier,
				nextTier,
				yearlyHistory,
				accountCreatedAt: accountCreatedAt,
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get capsule stats error:", error);
		res.status(500).json({ error: "Failed to get capsule stats" });
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
               o.discount_tier, o.discount_percent, o.discount_amount,
               uc.card_type, uc.card_last_four,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
        FROM orders o
        LEFT JOIN user_cards uc ON o.card_id = uc.id
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
 * Get consumption history for graphs
 * GET /api/orders/consumption-history
 * Returns daily breakdown of capsules and machines ordered (Original vs Vertuo)
 */
router.get("/consumption-history", authenticate, async (req, res) => {
	try {
		const conn = await pool.getConnection();
		try {
			// Get account creation date to start the graph
			const [accountInfo] = await conn.query(`SELECT created_at FROM accounts WHERE id = ?`, [req.user.id]);
			const accountCreatedAt = accountInfo?.created_at || new Date();

			// Daily capsule stats
			const capsuleStats = await conn.query(
				`SELECT 
					DATE(o.created_at) as date,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'original-%' 
							OR LOWER(oi.product_image) LIKE '%/original/%' 
						THEN oi.quantity ELSE 0 END), 0) * 10 as original_capsules,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'vertuo-%' 
							OR LOWER(oi.product_image) LIKE '%/vertuo/%' 
						THEN oi.quantity ELSE 0 END), 0) * 10 as vertuo_capsules
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'
				GROUP BY DATE(o.created_at)
				ORDER BY date ASC`,
				[req.user.id]
			);

			// Daily machine stats
			const machineStats = await conn.query(
				`SELECT 
					DATE(o.created_at) as date,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'original-%' 
							OR LOWER(oi.product_image) LIKE '%/original/%'
							OR LOWER(oi.product_name) LIKE '%essenza%'
							OR LOWER(oi.product_name) LIKE '%pixie%'
							OR LOWER(oi.product_name) LIKE '%citiz%'
							OR LOWER(oi.product_name) LIKE '%inissia%'
							OR (LOWER(oi.product_name) LIKE '%lattissima%' AND LOWER(oi.product_name) NOT LIKE '%vertuo%')
							OR (LOWER(oi.product_name) LIKE '%creatista%' AND LOWER(oi.product_name) NOT LIKE '%vertuo%')
						THEN oi.quantity ELSE 0 END), 0) as original_machines,
					COALESCE(SUM(CASE 
						WHEN LOWER(oi.product_id) LIKE 'vertuo-%' 
							OR LOWER(oi.product_image) LIKE '%/vertuo/%'
							OR LOWER(oi.product_name) LIKE '%vertuo next%'
							OR LOWER(oi.product_name) LIKE '%vertuo pop%'
							OR LOWER(oi.product_name) LIKE '%vertuo plus%'
							OR LOWER(oi.product_name) LIKE '%vertuo lattissima%'
							OR LOWER(oi.product_name) LIKE '%vertuo creatista%'
						THEN oi.quantity ELSE 0 END), 0) as vertuo_machines
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = ? 
					AND o.status != 'cancelled'
					AND (
						oi.product_type = 'machine'
						OR LOWER(oi.product_name) LIKE '%machine%'
						OR LOWER(oi.product_name) LIKE '%vertuo next%'
						OR LOWER(oi.product_name) LIKE '%vertuo pop%'
						OR LOWER(oi.product_name) LIKE '%vertuo plus%'
						OR LOWER(oi.product_name) LIKE '%essenza%'
						OR LOWER(oi.product_name) LIKE '%pixie%'
						OR LOWER(oi.product_name) LIKE '%citiz%'
						OR LOWER(oi.product_name) LIKE '%lattissima%'
						OR LOWER(oi.product_name) LIKE '%creatista%'
						OR LOWER(oi.product_name) LIKE '%inissia%'
					)
				GROUP BY DATE(o.created_at)
				ORDER BY date ASC`,
				[req.user.id]
			);

			res.json({
				accountCreatedAt,
				capsules: serializeBigInt(capsuleStats),
				machines: serializeBigInt(machineStats),
			});
		} finally {
			conn.release();
		}
	} catch (error) {
		console.error("Get consumption history error:", error);
		res.status(500).json({ error: "Failed to get consumption history" });
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

			// Get user's member tier for discount calculation
			const memberTier = await getUserTier(conn, req.user.id);
			const discountPercent = TIER_DISCOUNTS[memberTier] || 0;

			// Calculate subtotal from items
			let subtotal = 0;
			for (const item of items) {
				subtotal += item.unitPrice * item.quantity;
			}

			// Calculate discount amount
			const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
			const subtotalAfterDiscount = Math.round((subtotal - discountAmount) * 100) / 100;

			// Determine free shipping based on tier
			let tierBasedFreeShipping = false;
			if (FREE_SHIPPING_TIERS.includes(memberTier)) {
				tierBasedFreeShipping = true;
			} else if (
				FREE_SHIPPING_THRESHOLD_TIERS[memberTier] &&
				subtotalAfterDiscount >= FREE_SHIPPING_THRESHOLD_TIERS[memberTier]
			) {
				tierBasedFreeShipping = true;
			}

			// Use shipping cost from frontend, or calculate based on tier/subtotal
			const finalShippingCost = isSubscription
				? 0
				: shippingCost !== undefined
				? shippingCost
				: tierBasedFreeShipping || subtotalAfterDiscount >= 200
				? 0
				: 24.99;
			// Use total from frontend, or calculate as discounted subtotal + shipping (VAT is included in prices)
			const finalTotal = total !== undefined ? total : subtotalAfterDiscount + finalShippingCost;
			// Tax is 21% of total (included in price, calculated for display purposes)
			const tax = Math.round(finalTotal * 0.21 * 100) / 100;

			// Generate order number - use SUB prefix for subscriptions
			const orderPrefix = isSubscription ? "SUB" : "ORD";
			const orderNumber = `${orderPrefix}-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

			// Create order with discount info
			const orderResult = await conn.query(
				`INSERT INTO orders 
         (account_id, order_number, status, subtotal, shipping_cost, tax, total,
          shipping_address, billing_address, payment_method, card_id, notes,
          weather_condition, estimated_delivery, expected_delivery_date,
          discount_tier, discount_percent, discount_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					req.user.id,
					orderNumber,
					orderStatus,
					subtotal, // Original subtotal before discount
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
					memberTier !== "None" ? memberTier : null, // discount_tier
					discountPercent, // discount_percent
					discountAmount, // discount_amount
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
