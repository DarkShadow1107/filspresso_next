/**
 * Kafelot AI Prompt Limit Routes
 *
 * POST /api/kafelot/check-and-use  - Check + atomically decrement a prompt (authenticated or anonymous)
 * GET  /api/kafelot/status         - Get remaining prompts without decrementing
 * GET  /api/kafelot/anonymous      - [admin] List all anonymous user records
 * PUT  /api/kafelot/anonymous/:id  - [admin] Update anonymous user limit/prompts
 * GET  /api/kafelot/users          - [admin] List authenticated user usage records
 * PUT  /api/kafelot/users/:id      - [admin] Update authenticated user limit/prompts
 */

const express = require("express");
const net = require("net");
const pool = require("../db/connection");
const { authenticate, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// Monthly prompt limits per subscription tier
const PROMPT_LIMITS = {
	anonymous: 5,
	free: 15,
	basic: 50,
	plus: 100,
	pro: 150,
	max: 300,
	ultimate: 1000,
};

/**
 * Returns the first day of next month (UTC) as "YYYY-MM-DD" – the reset date.
 */
function nextMonthReset() {
	const now = new Date();
	const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
	return next.toISOString().split("T")[0];
}

/**
 * Returns current month as "YYYY-MM".
 */
function currentMonthYear() {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeClientIp(value) {
	if (!value) {
		return null;
	}

	let candidate = Array.isArray(value) ? String(value[0] || "") : String(value).split(",")[0].trim();
	candidate = candidate.replace(/^"|"$/g, "").trim();

	if (!candidate) {
		return null;
	}

	if (candidate.startsWith("[") && candidate.includes("]")) {
		candidate = candidate.slice(1, candidate.indexOf("]")).trim();
	}

	const mappedIpv4Match = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
	if (mappedIpv4Match && net.isIP(mappedIpv4Match[1]) === 4) {
		return mappedIpv4Match[1];
	}

	if (net.isIP(candidate)) {
		return candidate;
	}

	const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
	if (ipv4WithPortMatch && net.isIP(ipv4WithPortMatch[1]) === 4) {
		return ipv4WithPortMatch[1];
	}

	return null;
}

function getClientIp(req) {
	return (
		normalizeClientIp(req.headers["cf-connecting-ip"]) ||
		normalizeClientIp(req.headers["x-real-ip"]) ||
		normalizeClientIp(req.headers["x-forwarded-for"]) ||
		normalizeClientIp(req.ip) ||
		normalizeClientIp(req.socket?.remoteAddress) ||
		null
	);
}

/**
 * Resolve subscription tier from a raw JWT payload (no DB query needed since
 * authenticate() already fetches user). Fallback to 'free'.
 */
function tierToLimit(tier) {
	const t = (tier || "free").toLowerCase();
	return PROMPT_LIMITS[t] ?? PROMPT_LIMITS.free;
}

/**
 * Fetch the active subscription tier for an account from the DB.
 * Returns lowercase tier string, e.g. "basic", "free".
 */
async function fetchUserTier(client, accountId) {
	try {
		const { rows } = await client.query(
			`SELECT subscription_tier FROM user_subscriptions
             WHERE account_id = $1 AND is_active = TRUE AND status IN ('active','ending')
             ORDER BY created_at DESC LIMIT 1`,
			[accountId],
		);
		return (rows[0]?.subscription_tier || "free").toLowerCase();
	} catch {
		return "free";
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get or create an anonymous user record, resetting usage when the reset date
 * has passed.  Returns the current row.
 */
async function getOrCreateAnonymous(client, fingerprint, ip, userAgent, systemInfo) {
	const resetDate = nextMonthReset();

	// Upsert anonymous user
	await client.query(
		`INSERT INTO kafelot_anonymous_users (fingerprint, ip_address, user_agent, system_info, reset_date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (fingerprint) DO UPDATE
           SET ip_address = EXCLUDED.ip_address,
               user_agent = EXCLUDED.user_agent,
               system_info = EXCLUDED.system_info,
               updated_at = CURRENT_TIMESTAMP`,
		[fingerprint, ip, userAgent, systemInfo, resetDate],
	);

	// Reset usage if the stored reset_date is in the past
	await client.query(
		`UPDATE kafelot_anonymous_users
         SET prompts_used = 0,
             reset_date   = $1::DATE,
             updated_at   = CURRENT_TIMESTAMP
         WHERE fingerprint = $2
           AND reset_date <= CURRENT_DATE`,
		[resetDate, fingerprint],
	);

	const { rows } = await client.query(`SELECT * FROM kafelot_anonymous_users WHERE fingerprint = $1`, [fingerprint]);
	return rows[0];
}

/**
 * Get or create an authenticated user's monthly usage record.
 */
async function getOrCreateUserUsage(client, accountId, tier) {
	const monthYear = currentMonthYear();
	const resetDate = nextMonthReset();
	const limit = tierToLimit(tier);

	// Ensure row exists for this month
	await client.query(
		`INSERT INTO kafelot_prompt_usage (account_id, month_year, prompts_limit, subscription_tier, reset_date)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, month_year) DO UPDATE
           SET subscription_tier = EXCLUDED.subscription_tier,
               prompts_limit = GREATEST(kafelot_prompt_usage.prompts_limit, EXCLUDED.prompts_limit),
               updated_at = CURRENT_TIMESTAMP`,
		[accountId, monthYear, limit, tier, resetDate],
	);

	const { rows } = await client.query(`SELECT * FROM kafelot_prompt_usage WHERE account_id = $1 AND month_year = $2`, [
		accountId,
		monthYear,
	]);
	return rows[0];
}

// ---------------------------------------------------------------------------
// POST /api/kafelot/check-and-use
// ---------------------------------------------------------------------------
router.post("/check-and-use", optionalAuth, async (req, res) => {
	const fingerprint = req.headers["x-kafelot-fingerprint"];
	const ip = getClientIp(req);
	const userAgent = req.headers["user-agent"] || "";
	const systemInfo = req.body?.system_info || {};

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		if (req.user) {
			// ── Authenticated user ──────────────────────────────────────────────
			const tier = await fetchUserTier(client, req.user.id);
			const row = await getOrCreateUserUsage(client, req.user.id, tier);

			if (row.prompts_used >= row.prompts_limit) {
				await client.query("ROLLBACK");
				return res.status(429).json({
					error: "PROMPT_LIMIT_REACHED",
					prompts_remaining: 0,
					prompts_limit: row.prompts_limit,
					reset_date: row.reset_date,
					tier,
				});
			}

			await client.query(
				`UPDATE kafelot_prompt_usage
                 SET prompts_used = prompts_used + 1,
                     updated_at   = CURRENT_TIMESTAMP
                 WHERE account_id = $1 AND month_year = $2`,
				[req.user.id, currentMonthYear()],
			);

			await client.query("COMMIT");
			return res.json({
				allowed: true,
				prompts_remaining: row.prompts_limit - row.prompts_used - 1,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier,
			});
		} else {
			// ── Anonymous user ──────────────────────────────────────────────────
			if (!fingerprint) {
				// No fingerprint header → still allow but don't track
				await client.query("ROLLBACK");
				return res.json({
					allowed: true,
					prompts_remaining: PROMPT_LIMITS.anonymous,
					prompts_limit: PROMPT_LIMITS.anonymous,
				});
			}

			const row = await getOrCreateAnonymous(client, fingerprint, ip, userAgent, systemInfo);

			if (row.prompts_used >= row.prompts_limit) {
				await client.query("ROLLBACK");
				return res.status(429).json({
					error: "PROMPT_LIMIT_REACHED",
					prompts_remaining: 0,
					prompts_limit: row.prompts_limit,
					reset_date: row.reset_date,
					tier: "anonymous",
				});
			}

			await client.query(
				`UPDATE kafelot_anonymous_users
                 SET prompts_used = prompts_used + 1,
                     updated_at   = CURRENT_TIMESTAMP
                 WHERE fingerprint = $1`,
				[fingerprint],
			);

			await client.query("COMMIT");
			return res.json({
				allowed: true,
				prompts_remaining: row.prompts_limit - row.prompts_used - 1,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier: "anonymous",
			});
		}
	} catch (err) {
		await client.query("ROLLBACK");
		console.error("Kafelot check-and-use error:", err);
		// On DB error allow the prompt so users aren't blocked by infra issues
		return res.json({ allowed: true, prompts_remaining: -1, prompts_limit: -1 });
	} finally {
		client.release();
	}
});

// ---------------------------------------------------------------------------
// GET /api/kafelot/status
// ---------------------------------------------------------------------------
router.get("/status", optionalAuth, async (req, res) => {
	const fingerprint = req.headers["x-kafelot-fingerprint"];
	const ip = getClientIp(req);
	const userAgent = req.headers["user-agent"] || "";

	const client = await pool.connect();
	try {
		if (req.user) {
			const tier = await fetchUserTier(client, req.user.id);
			const row = await getOrCreateUserUsage(client, req.user.id, tier);
			return res.json({
				prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used),
				prompts_used: row.prompts_used,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier,
			});
		} else {
			if (!fingerprint) {
				return res.json({
					prompts_remaining: PROMPT_LIMITS.anonymous,
					prompts_used: 0,
					prompts_limit: PROMPT_LIMITS.anonymous,
					tier: "anonymous",
				});
			}
			const row = await getOrCreateAnonymous(client, fingerprint, ip, userAgent, {});
			return res.json({
				prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used),
				prompts_used: row.prompts_used,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier: "anonymous",
			});
		}
	} catch (err) {
		console.error("Kafelot status error:", err);
		return res.json({
			prompts_remaining: PROMPT_LIMITS.anonymous,
			prompts_limit: PROMPT_LIMITS.anonymous,
			tier: "anonymous",
		});
	} finally {
		client.release();
	}
});

// ---------------------------------------------------------------------------
// Admin endpoints (require authentication + admin role)
// ---------------------------------------------------------------------------
function adminOnly(req, res, next) {
	if (!req.user || req.user.role !== "admin") {
		return res.status(403).json({ error: "Admin access required" });
	}
	next();
}

/**
 * GET /api/kafelot/anonymous
 * List all anonymous user records (paginated)
 */
router.get("/anonymous", authenticate, adminOnly, async (req, res) => {
	const { limit = 50, offset = 0, search = "" } = req.query;
	const client = await pool.connect();
	try {
		const whereClause = search ? `WHERE fingerprint ILIKE $3 OR ip_address ILIKE $3` : "";
		const params = search ? [parseInt(limit), parseInt(offset), `%${search}%`] : [parseInt(limit), parseInt(offset)];

		const { rows } = await client.query(
			`SELECT *, ('A' || id) AS display_id FROM kafelot_anonymous_users ${whereClause} ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
			params,
		);
		const { rows: countRows } = await client.query(
			`SELECT COUNT(*) AS total FROM kafelot_anonymous_users ${whereClause}`,
			search ? [`%${search}%`] : [],
		);
		res.json({ users: rows, total: Number(countRows[0].total) });
	} finally {
		client.release();
	}
});

/**
 * PUT /api/kafelot/anonymous/:id
 * Update anonymous user record (prompts_limit, prompts_used)
 */
router.put("/anonymous/:id", authenticate, adminOnly, async (req, res) => {
	const { prompts_limit, prompts_used } = req.body;
	const client = await pool.connect();
	try {
		const { rows } = await client.query(
			`UPDATE kafelot_anonymous_users
             SET prompts_limit = COALESCE($1, prompts_limit),
                 prompts_used  = COALESCE($2, prompts_used),
                 updated_at    = CURRENT_TIMESTAMP
             WHERE id = $3
             RETURNING *, ('A' || id) AS display_id`,
			[prompts_limit, prompts_used, req.params.id],
		);
		if (!rows[0]) return res.status(404).json({ error: "Not found" });
		res.json(rows[0]);
	} finally {
		client.release();
	}
});

/**
 * GET /api/kafelot/users
 * List all authenticated user prompt usage records
 */
router.get("/users", authenticate, adminOnly, async (req, res) => {
	const { limit = 50, offset = 0, month_year } = req.query;
	const client = await pool.connect();
	try {
		const whereClause = month_year ? `WHERE kpu.month_year = $3` : "";
		const params = month_year ? [parseInt(limit), parseInt(offset), month_year] : [parseInt(limit), parseInt(offset)];

		const { rows } = await client.query(
			`SELECT kpu.*, a.username, a.email
             FROM kafelot_prompt_usage kpu
             JOIN accounts a ON kpu.account_id = a.id
             ${whereClause}
             ORDER BY kpu.updated_at DESC
             LIMIT $1 OFFSET $2`,
			params,
		);
		const { rows: countRows } = await client.query(
			`SELECT COUNT(*) AS total FROM kafelot_prompt_usage ${whereClause}`,
			month_year ? [month_year] : [],
		);
		res.json({ users: rows, total: Number(countRows[0].total) });
	} finally {
		client.release();
	}
});

/**
 * PUT /api/kafelot/users/:id
 * Update authenticated user usage record (prompts_limit, prompts_used)
 */
router.put("/users/:id", authenticate, adminOnly, async (req, res) => {
	const { prompts_limit, prompts_used } = req.body;
	const client = await pool.connect();
	try {
		const { rows } = await client.query(
			`UPDATE kafelot_prompt_usage
             SET prompts_limit = COALESCE($1, prompts_limit),
                 prompts_used  = COALESCE($2, prompts_used),
                 updated_at    = CURRENT_TIMESTAMP
             WHERE id = $3
             RETURNING *`,
			[prompts_limit, prompts_used, req.params.id],
		);
		if (!rows[0]) return res.status(404).json({ error: "Not found" });
		res.json(rows[0]);
	} finally {
		client.release();
	}
});

module.exports = router;
