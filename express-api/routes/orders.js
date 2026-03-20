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
const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || "http://localhost:8082";

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

function resolveInventoryTable(productType) {
	if (productType === "capsule") return "coffee_products";
	if (productType === "machine" || productType === "accessory") return "machine_products";
	return null;
}

function createHttpError(status, message, details) {
	const error = new Error(message);
	error.status = status;
	error.details = details;
	return error;
}

function formatAddress(address) {
	if (!address) return "";
	if (typeof address === "string") return address;
	if (typeof address === "object") {
		const chunks = [
			address.fullName,
			address.name,
			address.line1,
			address.line2,
			address.street,
			address.city,
			address.state,
			address.postalCode,
			address.zip,
			address.country,
		];
		return chunks
			.filter((chunk) => typeof chunk === "string" && chunk.trim().length > 0)
			.map((chunk) => chunk.trim())
			.join(", ");
	}
	return "";
}

/**
 * Get user's member tier
 */
async function getUserTier(client, accountId) {
	try {
		// First try to get from member_status table
		const result = await client.query("SELECT current_tier FROM member_status WHERE account_id = $1", [accountId]);
		const status = result.rows[0];

		if (status && status.current_tier) {
			return status.current_tier;
		}
	} catch (error) {
		// Table might not exist yet, continue to fallback
		console.log("member_status table not available, calculating tier from orders");
	}

	// Fallback: Calculate tier from orders
	try {
		const result = await client.query(
			`SELECT COALESCE(SUM(oi.quantity), 0) as total_capsules
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.account_id = $1 
        AND o.status IN ('confirmed', 'shipped', 'delivered')
        AND oi.product_type = 'capsule'`,
			[accountId],
		);

		const totalCapsules = Number(result.rows[0]?.total_capsules || 0) * 10; // sleeves * 10

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
	// Format as YYYY-MM-DD for PostgreSQL DATE type
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

		const client = await pool.connect();
		try {
			// Get most ordered capsule products from real order history
			const result = await client.query(
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
				LIMIT $1`,
				[limit],
			);

			const products = serializeBigInt(result.rows);

			res.json({
				products,
				total: products.length,
			});
		} finally {
			client.release();
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
		const client = await pool.connect();
		try {
			// Get all machine items from user's orders
			// We look for items where:
			// 1. product_type = 'machine' OR
			// 2. product_name contains machine-related keywords
			// Matching: Machine, Forfait, Vertuo Next, Vertuo Pop, pack
			const result = await client.query(
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
					(o.created_at + INTERVAL '3 years') as warranty_end_date,
					CASE WHEN (o.created_at + INTERVAL '3 years') > NOW() THEN TRUE ELSE FALSE END as is_under_warranty,
					CASE 
						WHEN oi.product_id LIKE 'pack-%' OR oi.product_id LIKE 'forfait-%' 
							OR LOWER(oi.product_name) LIKE '%forfait%'
						THEN TRUE ELSE FALSE 
					END as is_forfait
				FROM order_items oi
				JOIN orders o ON oi.order_id = o.id
				WHERE o.account_id = $1 
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
				[req.user.id],
			);

			const machines = serializeBigInt(result.rows);

			res.json({
				machines,
				total: machines.length,
			});
		} finally {
			client.release();
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
		const client = await pool.connect();
		try {
			// Get total from all orders
			const ordersResult = await client.query(
				`SELECT COALESCE(SUM(total), 0) as orders_total
				FROM orders 
				WHERE account_id = $1 AND status != 'cancelled'`,
				[req.user.id],
			);

			const taxesResult = await client.query(
				`SELECT COALESCE(SUM(tax), 0) as taxes_total
				FROM orders
				WHERE account_id = $1 AND status != 'cancelled'`,
				[req.user.id],
			);

			// Category totals should reflect actual paid item value after order-level discounts.
			const categorySpendingResult = await client.query(
				`WITH categorized_items AS (
					SELECT
						oi.product_type,
						COALESCE(LOWER(oi.product_name), '') as product_name,
						oi.product_id,
						CASE
							WHEN COALESCE(o.subtotal, 0) > 0 THEN
								oi.total_price * GREATEST((o.subtotal - COALESCE(o.discount_amount, 0)) / o.subtotal, 0)
							ELSE oi.total_price
						END as adjusted_total
					FROM order_items oi
					JOIN orders o ON oi.order_id = o.id
					WHERE o.account_id = $1
						AND o.status != 'cancelled'
				)
				SELECT
					COALESCE(SUM(CASE WHEN product_type = 'subscription' THEN adjusted_total ELSE 0 END), 0) as subscriptions_total,
					COALESCE(SUM(CASE
						WHEN (
							product_type = 'machine'
							OR product_name LIKE '%machine%'
							OR product_name LIKE '%forfait%'
							OR product_name LIKE '%vertuo next%'
							OR product_name LIKE '%vertuo pop%'
							OR product_name LIKE '%vertuo plus%'
							OR product_name LIKE '%essenza%'
							OR product_name LIKE '%pixie%'
							OR product_name LIKE '%citiz%'
							OR product_name LIKE '%lattissima%'
							OR product_name LIKE '%creatista%'
							OR product_name LIKE '%inissia%'
							OR product_id LIKE 'pack-%'
							OR product_id LIKE 'forfait-%'
						) THEN adjusted_total
						ELSE 0
					END), 0) as machines_total,
					COALESCE(SUM(CASE
						WHEN product_type != 'subscription'
							AND product_type != 'machine'
							AND product_name NOT LIKE '%machine%'
							AND product_name NOT LIKE '%forfait%'
							AND product_name NOT LIKE '%vertuo next%'
							AND product_name NOT LIKE '%vertuo pop%'
							AND product_name NOT LIKE '%vertuo plus%'
							AND product_name NOT LIKE '%essenza%'
							AND product_name NOT LIKE '%pixie%'
							AND product_name NOT LIKE '%citiz%'
							AND product_name NOT LIKE '%lattissima%'
							AND product_name NOT LIKE '%creatista%'
							AND product_name NOT LIKE '%inissia%'
							AND product_id NOT LIKE 'pack-%'
							AND product_id NOT LIKE 'forfait-%'
						THEN adjusted_total
						ELSE 0
					END), 0) as products_total
				FROM categorized_items`,
				[req.user.id],
			);

			const currencyUsageResult = await client.query(
				`SELECT
					UPPER(COALESCE(currency_code, 'RON')) as currency_code,
					COUNT(*)::int as order_count,
					COALESCE(SUM(charged_total), 0) as charged_total,
					COALESCE(SUM(total), 0) as ron_equivalent_total,
					COALESCE(SUM(tax), 0) as conversion_taxes_ron
				FROM orders
				WHERE account_id = $1 AND status != 'cancelled'
				GROUP BY UPPER(COALESCE(currency_code, 'RON'))
				ORDER BY ron_equivalent_total DESC, charged_total DESC`,
				[req.user.id],
			);

			const ordersTotal = Number(ordersResult.rows[0].orders_total) || 0;
			const taxesTotal = Number(taxesResult.rows[0].taxes_total) || 0;
			const subscriptionsTotal = Number(categorySpendingResult.rows[0].subscriptions_total) || 0;
			const machinesTotal = Number(categorySpendingResult.rows[0].machines_total) || 0;
			const productsTotal = Number(categorySpendingResult.rows[0].products_total) || 0;
			const totalCurrencyOrders = currencyUsageResult.rows.reduce((sum, row) => sum + (Number(row.order_count) || 0), 0);
			const totalRonEquivalentAcrossCurrencies = currencyUsageResult.rows.reduce(
				(sum, row) => sum + (Number(row.ron_equivalent_total) || 0),
				0,
			);

			const currencyUsage = currencyUsageResult.rows.map((row) => {
				const orderCount = Number(row.order_count) || 0;
				const ronEquivalentTotal = Number(row.ron_equivalent_total) || 0;
				const percentage =
					totalRonEquivalentAcrossCurrencies > 0
						? Math.round((ronEquivalentTotal / totalRonEquivalentAcrossCurrencies) * 10000) / 100
						: 0;
				return {
					currencyCode: row.currency_code,
					orderCount,
					chargedTotal: Number(row.charged_total) || 0,
					ronEquivalentTotal,
					conversionTaxesRon: Number(row.conversion_taxes_ron) || 0,
					percentage,
				};
			});

			const preferredCurrency = currencyUsage[0]?.currencyCode || "RON";

			res.json({
				spending: {
					orders: ordersTotal,
					subscriptions: subscriptionsTotal,
					machines: machinesTotal,
					products: productsTotal,
					taxes: taxesTotal,
					total: ordersTotal,
				},
				currency: {
					preferredCurrency,
					totalOrders: totalCurrencyOrders,
					multiCurrency: currencyUsage.length > 1,
					usage: currencyUsage,
				},
			});
		} finally {
			client.release();
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
		const client = await pool.connect();
		try {
			// Get account creation date
			const accountInfoResult = await client.query(`SELECT created_at FROM accounts WHERE id = $1`, [req.user.id]);
			const accountInfo = accountInfoResult.rows[0];

			const accountCreatedAt = accountInfo?.created_at || new Date();
			const accountYear = new Date(accountCreatedAt).getFullYear();
			const currentYear = new Date().getFullYear();

			// Each quantity = sleeves, each sleeve = 10 capsules
			const CAPSULES_PER_SLEEVE = 10;

			// Get total sleeves ordered all-time, split by Original vs Vertuo
			// product_id or product_image path indicates Original vs Vertuo
			const totalResultRaw = await client.query(
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
				WHERE o.account_id = $1 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'`,
				[req.user.id],
			);
			const totalResult = totalResultRaw.rows[0];

			const totalCapsules = (Number(totalResult?.total_sleeves) || 0) * CAPSULES_PER_SLEEVE;
			const originalCapsules = (Number(totalResult?.original_sleeves) || 0) * CAPSULES_PER_SLEEVE;
			const vertuoCapsules = (Number(totalResult?.vertuo_sleeves) || 0) * CAPSULES_PER_SLEEVE;

			// Total orders (non-cancelled, excluding repairs) and repairs (order_number starts with REP-)
			const totalOrdersResultRaw = await client.query(
				`SELECT COUNT(*) as total_orders FROM orders WHERE account_id = $1 AND status != 'cancelled' AND order_number NOT LIKE 'REP-%'`,
				[req.user.id],
			);
			const totalOrdersResult = totalOrdersResultRaw.rows[0];

			const totalRepairsResultRaw = await client.query(
				`SELECT COUNT(*) as total_repairs FROM orders WHERE account_id = $1 AND status != 'cancelled' AND order_number LIKE 'REP-%'`,
				[req.user.id],
			);
			const totalRepairsResult = totalRepairsResultRaw.rows[0];

			// Get sleeves ordered per year (from account creation year to now)
			const yearlyStatsResult = await client.query(
				`SELECT 
					EXTRACT(YEAR FROM o.created_at) as year,
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
				WHERE o.account_id = $1 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'
					AND EXTRACT(YEAR FROM o.created_at) >= $2
				GROUP BY EXTRACT(YEAR FROM o.created_at)
				ORDER BY year DESC`,
				[req.user.id, accountYear],
			);
			const yearlyStats = yearlyStatsResult.rows;

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

			const currentPeriodResultRaw = await client.query(
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
				WHERE o.account_id = $1 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'
					AND o.created_at >= $2
					AND o.created_at < $3`,
				[req.user.id, anniversaryStart.toISOString().split("T")[0], anniversaryEnd.toISOString().split("T")[0]],
			);
			const currentPeriodResult = currentPeriodResultRaw.rows[0];

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
				const normalizedYear = Number(yearData.year);
				const sleevesOrdered = Number(yearData.sleeves_ordered) || 0;
				const originalSleeves = Number(yearData.original_sleeves) || 0;
				const vertuoSleeves = Number(yearData.vertuo_sleeves) || 0;
				const orderCount = Number(yearData.order_count) || 0;
				const capsules = sleevesOrdered * CAPSULES_PER_SLEEVE;
				const tier = getTier(capsules);
				yearlyHistory.push({
					year: normalizedYear,
					capsules: capsules,
					originalCapsules: originalSleeves * CAPSULES_PER_SLEEVE,
					vertuoCapsules: vertuoSleeves * CAPSULES_PER_SLEEVE,
					orders: orderCount,
					tier: tier?.name || null,
					tierLevel: tier?.level || 0,
				});
			}

			// Some DB adapters return duplicate yearly rows or mixed year types; keep only the strongest row per year.
			const yearlyHistoryByYear = new Map();
			for (const yearData of yearlyHistory) {
				const existing = yearlyHistoryByYear.get(yearData.year);
				if (
					!existing ||
					yearData.capsules > existing.capsules ||
					(yearData.capsules === existing.capsules && yearData.tierLevel > existing.tierLevel) ||
					(yearData.capsules === existing.capsules &&
						yearData.tierLevel === existing.tierLevel &&
						yearData.orders > existing.orders)
				) {
					yearlyHistoryByYear.set(yearData.year, yearData);
				}
			}
			yearlyHistory.length = 0;
			yearlyHistory.push(...yearlyHistoryByYear.values());

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
				await client.query(
					`INSERT INTO member_status 
						(account_id, total_capsules, original_capsules, vertuo_capsules, current_tier, 
						current_year_capsules, current_year_start, highest_tier_achieved)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
					ON CONFLICT (account_id) DO UPDATE SET 
						total_capsules = EXCLUDED.total_capsules,
						original_capsules = EXCLUDED.original_capsules,
						vertuo_capsules = EXCLUDED.vertuo_capsules,
						current_tier = EXCLUDED.current_tier,
						current_year_capsules = EXCLUDED.current_year_capsules,
						current_year_start = EXCLUDED.current_year_start,
						highest_tier_achieved = CASE 
							WHEN member_status.highest_tier_achieved IS NULL THEN EXCLUDED.current_tier
							WHEN EXCLUDED.current_tier IS NULL THEN member_status.highest_tier_achieved
							WHEN (CASE EXCLUDED.current_tier 
									WHEN 'Connoisseur' THEN 1 WHEN 'Expert' THEN 2 WHEN 'Master' THEN 3 WHEN 'Virtuoso' THEN 4 WHEN 'Ambassador' THEN 5 ELSE 0 END) > 
								 (CASE member_status.highest_tier_achieved 
									WHEN 'Connoisseur' THEN 1 WHEN 'Expert' THEN 2 WHEN 'Master' THEN 3 WHEN 'Virtuoso' THEN 4 WHEN 'Ambassador' THEN 5 ELSE 0 END) 
							THEN EXCLUDED.current_tier
							ELSE member_status.highest_tier_achieved
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
					],
				);

				// Update yearly history in member_status_history
				for (const yearData of yearlyHistory) {
					if (yearData.capsules > 0 || yearData.year === currentYear) {
						await client.query(
							`INSERT INTO member_status_history 
								(account_id, year, capsules_ordered, original_capsules, vertuo_capsules, order_count, highest_tier)
							VALUES ($1, $2, $3, $4, $5, $6, $7)
							ON CONFLICT (account_id, year) DO UPDATE SET 
								capsules_ordered = EXCLUDED.capsules_ordered,
								original_capsules = EXCLUDED.original_capsules,
								vertuo_capsules = EXCLUDED.vertuo_capsules,
								order_count = EXCLUDED.order_count,
								highest_tier = CASE 
									WHEN member_status_history.highest_tier IS NULL THEN EXCLUDED.highest_tier
									WHEN EXCLUDED.highest_tier IS NULL THEN member_status_history.highest_tier
									WHEN (CASE EXCLUDED.highest_tier 
											WHEN 'Connoisseur' THEN 1 WHEN 'Expert' THEN 2 WHEN 'Master' THEN 3 WHEN 'Virtuoso' THEN 4 WHEN 'Ambassador' THEN 5 ELSE 0 END) > 
										 (CASE member_status_history.highest_tier 
											WHEN 'Connoisseur' THEN 1 WHEN 'Expert' THEN 2 WHEN 'Master' THEN 3 WHEN 'Virtuoso' THEN 4 WHEN 'Ambassador' THEN 5 ELSE 0 END) 
									THEN EXCLUDED.highest_tier
									ELSE member_status_history.highest_tier
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
							],
						);
					}
				}
			} catch (dbError) {
				// Log but don't fail - table may not exist yet
				console.warn("Could not save member status to database:", dbError.message);
			}

			// Get machines breakdown by Original vs Vertuo
			const machineStatsResult = await client.query(
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
				WHERE o.account_id = $1 
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
				[req.user.id],
			);
			const machineStats = machineStatsResult.rows[0];

			res.json({
				totalCapsules,
				originalCapsules,
				vertuoCapsules,
				totalOrders: Number(totalOrdersResult?.total_orders) || 0,
				totalRepairs: Number(totalRepairsResult?.total_repairs) || 0,
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
			client.release();
		}
	} catch (error) {
		console.error("Get capsule stats error:", error);
		res.status(500).json({ error: "Failed to get capsule stats" });
	}
});

router.get("/", authenticate, async (req, res) => {
	try {
		const rawLimit = parseInt(req.query.limit) || 1000;
		const limit = Math.min(rawLimit, 1000);
		const offset = parseInt(req.query.offset) || 0;
		const { status } = req.query;

		const client = await pool.connect();
		try {
			let query = `
        SELECT o.id, o.order_number, o.status, o.subtotal, o.shipping_cost, 
                o.tax, o.total, o.created_at, o.weather_condition, o.estimated_delivery,
                o.expected_delivery_date,
                o.discount_tier, o.discount_percent, o.discount_amount,
		o.currency_code, o.exchange_rate, o.conversion_fee_percent,
		o.charged_subtotal, o.charged_shipping_cost, o.charged_tax, o.charged_total,
		o.destination_country,
                uc.card_type, uc.card_last_four,
                (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
        FROM orders o
        LEFT JOIN user_cards uc ON o.card_id = uc.id
        WHERE o.account_id = $1
        `;
			const params = [req.user.id];

			if (status) {
				query += " AND o.status = $2";
				params.push(status);
			}

			const limitParamIndex = params.length + 1;
			const offsetParamIndex = params.length + 2;
			query += ` ORDER BY o.created_at DESC LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`;
			params.push(limit, offset);

			const result = await client.query(query, params);
			const orders = serializeBigInt(result.rows);

			// Get total count
			const countResult = await client.query("SELECT COUNT(*) as total FROM orders WHERE account_id = $1", [req.user.id]);

			res.json({
				orders,
				total: Number(countResult.rows[0].total),
				limit,
				offset,
			});
		} finally {
			client.release();
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
		const client = await pool.connect();
		try {
			// Get account creation date to start the graph
			const accountInfoResult = await client.query(`SELECT created_at FROM accounts WHERE id = $1`, [req.user.id]);
			const accountCreatedAt = accountInfoResult.rows[0]?.created_at || new Date();

			// Daily capsule stats
			const capsuleStatsResult = await client.query(
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
				WHERE o.account_id = $1 
					AND o.status != 'cancelled'
					AND oi.product_type = 'capsule'
				GROUP BY DATE(o.created_at)
				ORDER BY date ASC`,
				[req.user.id],
			);

			// Daily machine stats
			const machineStatsResult = await client.query(
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
				WHERE o.account_id = $1 
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
				[req.user.id],
			);

			res.json({
				accountCreatedAt,
				capsules: serializeBigInt(capsuleStatsResult.rows),
				machines: serializeBigInt(machineStatsResult.rows),
			});
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Get consumption history error:", error);
		res.status(500).json({ error: "Failed to get consumption history" });
	}
});

/**
 * Download invoice PDF (generated by Java invoice service)
 */
router.get("/:id/invoice", authenticate, async (req, res) => {
	let client;
	try {
		const orderId = parseInt(req.params.id, 10);
		if (!Number.isInteger(orderId) || orderId <= 0) {
			return res.status(400).json({ error: "Invalid order id" });
		}

		client = await pool.connect();

		const orderResult = await client.query(
			`SELECT o.*, uc.card_type, uc.card_last_four,
					COALESCE(a.name, a.username, 'Filspresso Customer') AS customer_name,
					a.email AS customer_email
			 FROM orders o
			 LEFT JOIN user_cards uc ON uc.id = o.card_id
			 JOIN accounts a ON a.id = o.account_id
			 WHERE o.id = $1 AND o.account_id = $2`,
			[orderId, req.user.id],
		);

		const order = orderResult.rows[0];
		if (!order) {
			return res.status(404).json({ error: "Order not found" });
		}

		const itemsResult = await client.query(
			`SELECT product_name, product_id, quantity, unit_price, total_price
			 FROM order_items
			 WHERE order_id = $1
			 ORDER BY id ASC`,
			[orderId],
		);

		const payload = {
			invoiceNumber: `INV-${order.order_number}`,
			orderNumber: order.order_number,
			orderDate: order.created_at,
			status: order.status,
			customerName: order.customer_name,
			customerEmail: order.customer_email,
			billingAddress: formatAddress(order.billing_address),
			shippingAddress: formatAddress(order.shipping_address),
			paymentSummary:
				order.card_type && order.card_last_four
					? `${order.card_type.toUpperCase()} •••• ${order.card_last_four}`
					: order.payment_method || "Card",
			currencyCode: (order.currency_code || "RON").toUpperCase(),
			subtotal: Number(order.subtotal || 0),
			discountAmount: Number(order.discount_amount || 0),
			shippingCost: Number(order.shipping_cost || 0),
			tax: Number(order.tax || 0),
			total: Number(order.total || 0),
			items: itemsResult.rows.map((item) => ({
				name: item.product_name,
				sku: item.product_id,
				quantity: Number(item.quantity || 1),
				unitPrice: Number(item.unit_price || 0),
				totalPrice: Number(item.total_price || 0),
			})),
		};

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);
		let invoiceResponse;
		try {
			invoiceResponse = await fetch(`${INVOICE_SERVICE_URL}/api/invoices/render`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/pdf",
				},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
		}

		if (!invoiceResponse.ok) {
			const errorBody = await invoiceResponse.text().catch(() => "");
			console.error("Invoice service error:", invoiceResponse.status, errorBody);
			return res.status(502).json({ error: "Invoice generation service failed" });
		}

		const pdfBuffer = Buffer.from(await invoiceResponse.arrayBuffer());
		const fileName = `filspresso-invoice-${order.order_number}.pdf`;

		res.setHeader("Content-Type", "application/pdf");
		res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
		return res.send(pdfBuffer);
	} catch (error) {
		const message = error?.name === "AbortError" ? "Invoice generation timed out" : "Failed to generate invoice";
		console.error("Get invoice error:", error);
		return res.status(500).json({ error: message });
	} finally {
		if (client) client.release();
	}
});

/**
 * Get order details
 */
router.get("/:id", authenticate, async (req, res) => {
	try {
		const orderId = parseInt(req.params.id);

		const client = await pool.connect();
		try {
			// Get order
			const result = await client.query(
				`SELECT o.*, 
                uc.card_holder, uc.card_type, uc.card_last_four
        FROM orders o
        LEFT JOIN user_cards uc ON o.card_id = uc.id
        WHERE o.id = $1 AND o.account_id = $2`,
				[orderId, req.user.id],
			);
			const order = result.rows[0];

			if (!order) {
				return res.status(404).json({ error: "Order not found" });
			}

			// Get order items
			const itemsResult = await client.query(
				`SELECT id, product_type, product_id, product_name, product_image,
                quantity, unit_price, total_price
        FROM order_items WHERE order_id = $1`,
				[orderId],
			);

			order.items = itemsResult.rows;

			res.json({ order });
		} finally {
			client.release();
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
		const {
			items,
			shippingAddress,
			billingAddress,
			paymentMethod,
			cardId,
			notes,
			shippingCost,
			total,
			isSubscription,
			currencyCode,
			exchangeRate,
			conversionFeePercent,
			chargedSubtotal,
			chargedShippingCost,
			chargedTax,
			chargedTotal,
			destinationCountry,
		} = req.body;

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

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const mergedItemsByProduct = new Map();
			for (const item of items) {
				const quantity = Number.parseInt(item.quantity, 10);
				const unitPrice = Number(item.unitPrice);
				if (!item.productType || !item.productId || !item.productName || !Number.isInteger(quantity) || quantity < 1) {
					throw createHttpError(400, "Order contains invalid item payload");
				}
				if (!Number.isFinite(unitPrice) || unitPrice < 0) {
					throw createHttpError(400, "Order contains invalid item price");
				}

				const key = `${item.productType}::${item.productId}`;
				const existing = mergedItemsByProduct.get(key);
				if (existing) {
					existing.quantity += quantity;
				} else {
					mergedItemsByProduct.set(key, {
						productType: item.productType,
						productId: item.productId,
						productName: item.productName,
						quantity,
					});
				}
			}

			for (const mergedItem of mergedItemsByProduct.values()) {
				const inventoryTable = resolveInventoryTable(mergedItem.productType);
				if (!inventoryTable) continue;

				const stockResult = await client.query(
					`SELECT stock
					 FROM ${inventoryTable}
					 WHERE product_id = $1
					 FOR UPDATE`,
					[mergedItem.productId],
				);

				if (stockResult.rows.length === 0) {
					throw createHttpError(404, `Product ${mergedItem.productId} was not found in inventory`);
				}

				const stock = Number(stockResult.rows[0].stock) || 0;
				if (stock < mergedItem.quantity) {
					throw createHttpError(409, `Insufficient stock for ${mergedItem.productName}`, {
						productId: mergedItem.productId,
						productName: mergedItem.productName,
						requestedQuantity: mergedItem.quantity,
						availableQuantity: stock,
					});
				}
			}

			// Get user's member tier for discount calculation
			const memberTier = await getUserTier(client, req.user.id);
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
			const normalizedCurrencyCode =
				typeof currencyCode === "string" && currencyCode.length === 3 ? currencyCode.toUpperCase() : "RON";
			const normalizedExchangeRate = Number(exchangeRate) > 0 ? Number(exchangeRate) : 1;
			const normalizedFeePercent = Number(conversionFeePercent) > 0 ? Number(conversionFeePercent) : 0;
			const normalizedChargedSubtotal = Number(chargedSubtotal) > 0 ? Number(chargedSubtotal) : subtotalAfterDiscount;
			const normalizedChargedShippingCost =
				Number(chargedShippingCost) >= 0 ? Number(chargedShippingCost) : finalShippingCost;
			const normalizedChargedTax = Number(chargedTax) > 0 ? Number(chargedTax) : 0;
			const normalizedChargedTotal =
				Number(chargedTotal) > 0
					? Number(chargedTotal)
					: normalizedChargedSubtotal + normalizedChargedShippingCost + normalizedChargedTax;

			const tax =
				normalizedCurrencyCode === "RON" ? 0 : Math.round((normalizedChargedTax / normalizedExchangeRate) * 100) / 100;
			const calculatedRonTotal = Math.round((subtotalAfterDiscount + finalShippingCost + tax) * 100) / 100;
			const finalTotal = total !== undefined ? Number(total) : calculatedRonTotal;

			// Generate order number - use SUB prefix for subscriptions
			const orderPrefix = isSubscription ? "SUB" : "ORD";
			const orderNumber = `${orderPrefix}-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

			// Create order with discount info
			const orderResult = await client.query(
				`INSERT INTO orders 
        (account_id, order_number, status, subtotal, shipping_cost, tax, total,
        shipping_address, billing_address, payment_method, card_id, notes,
        weather_condition, estimated_delivery, expected_delivery_date,
		discount_tier, discount_percent, discount_amount, currency_code, exchange_rate,
		conversion_fee_percent, charged_subtotal, charged_shipping_cost, charged_tax,
		charged_total, destination_country)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
        RETURNING id`,
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
					normalizedCurrencyCode,
					normalizedExchangeRate,
					normalizedFeePercent,
					normalizedChargedSubtotal,
					normalizedChargedShippingCost,
					normalizedChargedTax,
					normalizedChargedTotal,
					destinationCountry || shippingAddress?.country || null,
				],
			);

			const orderId = orderResult.rows[0].id;

			// Create order items and update stock
			for (const item of items) {
				const normalizedQuantity = Number.parseInt(item.quantity, 10);
				const normalizedUnitPrice = Number(item.unitPrice);
				await client.query(
					`INSERT INTO order_items 
            (order_id, product_type, product_id, product_name, product_image, 
            quantity, unit_price, total_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
					[
						orderId,
						item.productType,
						item.productId,
						item.productName,
						item.productImage || null,
						normalizedQuantity,
						normalizedUnitPrice,
						normalizedUnitPrice * normalizedQuantity,
					],
				);

				// Update stock in products table based on product type
				if (item.productType === "capsule") {
					// Update coffee_products stock
					const stockUpdateResult = await client.query(
						`UPDATE coffee_products 
						SET stock = stock - $1
						WHERE product_id = $2
						  AND stock >= $1`,
						[normalizedQuantity, item.productId],
					);
					if (stockUpdateResult.rowCount === 0) {
						throw createHttpError(409, `Insufficient stock for ${item.productName}`);
					}
				} else if (item.productType === "machine" || item.productType === "accessory") {
					// Update machine/accessory stock
					const stockUpdateResult = await client.query(
						`UPDATE machine_products 
						SET stock = stock - $1
						WHERE product_id = $2
						  AND stock >= $1`,
						[normalizedQuantity, item.productId],
					);
					if (stockUpdateResult.rowCount === 0) {
						throw createHttpError(409, `Insufficient stock for ${item.productName}`);
					}
				}
			}

			// Clear user's cart
			await client.query("DELETE FROM cart_items WHERE account_id = $1", [req.user.id]);

			await client.query("COMMIT");

			res.status(201).json({
				message: "Order created successfully",
				order: {
					id: orderId,
					orderNumber,
					status: orderStatus,
					total: finalTotal,
					currencyCode: normalizedCurrencyCode,
					chargedTotal: normalizedChargedTotal,
				},
			});
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Create order error:", error);
		if (error?.status) {
			return res.status(error.status).json({
				error: error.message,
				...(error.details ? { details: error.details } : {}),
			});
		}
		res.status(500).json({ error: "Failed to create order" });
	}
});

/**
 * Cancel order (user can cancel pending orders)
 */
router.put("/:id/cancel", authenticate, async (req, res) => {
	try {
		const orderId = parseInt(req.params.id);

		const client = await pool.connect();
		try {
			const result = await client.query("SELECT id, status FROM orders WHERE id = $1 AND account_id = $2", [
				orderId,
				req.user.id,
			]);
			const order = result.rows[0];

			if (!order) {
				return res.status(404).json({ error: "Order not found" });
			}

			if (order.status !== "pending" && order.status !== "confirmed") {
				return res.status(400).json({ error: "Only pending or confirmed orders can be cancelled" });
			}

			// Restore stock for cancelled order items
			const itemsResult = await client.query(
				"SELECT product_type, product_id, quantity FROM order_items WHERE order_id = $1",
				[orderId],
			);
			const orderItems = itemsResult.rows;

			for (const item of orderItems) {
				if (item.product_type === "capsule") {
					await client.query(
						`UPDATE coffee_products 
						SET stock = stock + $1 
						WHERE product_id = $2`,
						[item.quantity, item.product_id],
					);
				} else if (item.product_type === "machine") {
					await client.query(
						`UPDATE machine_products 
						SET stock = stock + $1 
						WHERE product_id = $2`,
						[item.quantity, item.product_id],
					);
				}
			}

			await client.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", ["cancelled", orderId]);

			res.json({ message: "Order cancelled successfully" });
		} finally {
			client.release();
		}
	} catch (error) {
		console.error("Cancel order error:", error);
		res.status(500).json({ error: "Failed to cancel order" });
	}
});

module.exports = router;
