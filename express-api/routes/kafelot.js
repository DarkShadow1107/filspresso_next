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
const rateLimit = require("express-rate-limit");
const pool = require("../db/connection");
const { authenticate, optionalAuth } = require("../middleware/auth");

const router = express.Router();

function parseLimitFromEnv(envValue, fallback, minimum = 1) {
	const parsed = Number.parseInt(String(envValue || ""), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(minimum, parsed);
}

const USAGE_SCOPES = Object.freeze({
	GENERAL: "general",
	MOLECULE_HELPER: "molecule_helper",
});

const VALID_USAGE_SCOPES = new Set(Object.values(USAGE_SCOPES));

// Monthly prompt limits per subscription tier (general chat scope)
const GENERAL_PROMPT_LIMITS = {
	anonymous: parseLimitFromEnv(process.env.KAFELOT_LIMIT_ANONYMOUS, 25),
	free: parseLimitFromEnv(process.env.KAFELOT_LIMIT_FREE, 15),
	basic: parseLimitFromEnv(process.env.KAFELOT_LIMIT_BASIC, 50),
	plus: parseLimitFromEnv(process.env.KAFELOT_LIMIT_PLUS, 100),
	pro: parseLimitFromEnv(process.env.KAFELOT_LIMIT_PRO, 150),
	max: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MAX, 300),
	ultimate: parseLimitFromEnv(process.env.KAFELOT_LIMIT_ULTIMATE, 1000),
};

const MOLECULE_HELPER_DEFAULT_LIMIT = parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_HELPER, 200);

// Monthly prompt limits for Molecule Helper scope.
const MOLECULE_PROMPT_LIMITS = {
	anonymous: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_ANONYMOUS, GENERAL_PROMPT_LIMITS.anonymous),
	free: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_FREE, MOLECULE_HELPER_DEFAULT_LIMIT),
	basic: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_BASIC, MOLECULE_HELPER_DEFAULT_LIMIT),
	plus: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_PLUS, MOLECULE_HELPER_DEFAULT_LIMIT),
	pro: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_PRO, MOLECULE_HELPER_DEFAULT_LIMIT),
	max: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_MAX, MOLECULE_HELPER_DEFAULT_LIMIT),
	ultimate: parseLimitFromEnv(process.env.KAFELOT_LIMIT_MOLECULE_ULTIMATE, MOLECULE_HELPER_DEFAULT_LIMIT),
};

const PROMPT_LIMITS_BY_SCOPE = {
	[USAGE_SCOPES.GENERAL]: GENERAL_PROMPT_LIMITS,
	[USAGE_SCOPES.MOLECULE_HELPER]: MOLECULE_PROMPT_LIMITS,
};

const KAFELOT_RATE_LIMIT_WINDOW_MS = Math.max(1_000, parseLimitFromEnv(process.env.KAFELOT_RATE_LIMIT_WINDOW_MS, 60_000, 1_000));
const KAFELOT_RATE_LIMIT_MAX = Math.max(100, parseLimitFromEnv(process.env.KAFELOT_RATE_LIMIT_MAX, 1_200, 100));

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

function kafelotRateLimitKey(req) {
	if (req.user?.id) {
		return `account:${req.user.id}`;
	}

	const fingerprint = String(req.headers["x-kafelot-fingerprint"] || "").trim();
	if (fingerprint) {
		return `fingerprint:${fingerprint}`;
	}

	const ip = getClientIp(req);
	if (ip) {
		return `ip:${ip}`;
	}

	return String(req.ip || "unknown");
}

const kafelotBurstLimiter = rateLimit({
	windowMs: KAFELOT_RATE_LIMIT_WINDOW_MS,
	max: KAFELOT_RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	keyGenerator: kafelotRateLimitKey,
	message: { error: "Too many chat requests in a short time. Please wait and retry." },
});

/**
 * Resolve subscription tier from a raw JWT payload (no DB query needed since
 * authenticate() already fetches user). Fallback to 'free'.
 */
function normalizeUsageScope(value) {
	const normalized = String(value || "")
		.trim()
		.toLowerCase();
	if (!normalized) return USAGE_SCOPES.GENERAL;
	if (VALID_USAGE_SCOPES.has(normalized)) return normalized;
	return USAGE_SCOPES.GENERAL;
}

function resolveUsageScope(req, fallback = USAGE_SCOPES.GENERAL) {
	const bodyScope = req.body && typeof req.body === "object" ? req.body.scope : undefined;
	const headerScope = req.headers["x-kafelot-scope"];
	const queryScope = req.query?.scope;
	return normalizeUsageScope(bodyScope || headerScope || queryScope || fallback);
}

function scopeLimits(usageScope) {
	const normalizedScope = normalizeUsageScope(usageScope);
	return PROMPT_LIMITS_BY_SCOPE[normalizedScope] || GENERAL_PROMPT_LIMITS;
}

function tierToLimit(tier, usageScope = USAGE_SCOPES.GENERAL) {
	const t = normalizeTier(tier);
	const limits = scopeLimits(usageScope);
	return limits[t] ?? limits.free ?? GENERAL_PROMPT_LIMITS.free;
}

function normalizeTier(tier) {
	const normalized = String(tier || "")
		.trim()
		.toLowerCase();
	if (!normalized || normalized === "none") return "free";
	if (Object.prototype.hasOwnProperty.call(GENERAL_PROMPT_LIMITS, normalized)) {
		return normalized;
	}
	return "free";
}

/**
 * Fetch the active subscription tier for an account from the DB.
 * Returns lowercase tier string, e.g. "basic", "free".
 */
async function fetchUserTier(client, accountId) {
	try {
		const { rows } = await client.query(
			`SELECT subscription_tier FROM user_subscriptions
			 WHERE account_id = $1 AND status IN ('active','ending')
			 ORDER BY is_active DESC, created_at DESC LIMIT 1`,
			[accountId],
		);
		if (rows[0]?.subscription_tier) {
			return normalizeTier(rows[0].subscription_tier);
		}

		const accountResult = await client.query("SELECT subscription FROM accounts WHERE id = $1 LIMIT 1", [accountId]);
		return normalizeTier(accountResult.rows[0]?.subscription || "free");
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
async function getOrCreateAnonymous(client, fingerprint, ip, userAgent, systemInfo, usageScope = USAGE_SCOPES.GENERAL) {
	const resetDate = nextMonthReset();
	const anonLimit = scopeLimits(usageScope).anonymous ?? GENERAL_PROMPT_LIMITS.anonymous;

	// Upsert anonymous user
	await client.query(
		`INSERT INTO kafelot_anonymous_users (fingerprint, ip_address, user_agent, system_info, reset_date, prompts_limit)
	         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (fingerprint) DO UPDATE
           SET ip_address = EXCLUDED.ip_address,
               user_agent = EXCLUDED.user_agent,
               system_info = EXCLUDED.system_info,
	               prompts_limit = EXCLUDED.prompts_limit,
	               prompts_used = CASE
	                 WHEN kafelot_anonymous_users.prompts_limit <> EXCLUDED.prompts_limit THEN 0
	                 ELSE kafelot_anonymous_users.prompts_used
	               END,
               updated_at = CURRENT_TIMESTAMP`,
		[fingerprint, ip, userAgent, systemInfo, resetDate, anonLimit],
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
async function getOrCreateUserUsage(client, accountId, tier, usageScope = USAGE_SCOPES.GENERAL) {
	const monthYear = currentMonthYear();
	const resetDate = nextMonthReset();
	usageScope = normalizeUsageScope(usageScope);
	const limit = tierToLimit(tier, usageScope);

	// Ensure row exists for this month
	await client.query(
		`INSERT INTO kafelot_prompt_usage (account_id, month_year, usage_scope, prompts_limit, subscription_tier, reset_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (account_id, month_year, usage_scope) DO UPDATE
           SET subscription_tier = EXCLUDED.subscription_tier,
	               prompts_limit = EXCLUDED.prompts_limit,
	               prompts_used = CASE
	                 WHEN kafelot_prompt_usage.prompts_limit <> EXCLUDED.prompts_limit THEN 0
	                 ELSE kafelot_prompt_usage.prompts_used
	               END,
               updated_at = CURRENT_TIMESTAMP`,
		[accountId, monthYear, usageScope, limit, tier, resetDate],
	);

	const { rows } = await client.query(
		`SELECT * FROM kafelot_prompt_usage WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3`,
		[accountId, monthYear, usageScope],
	);
	return rows[0];
}

// ---------------------------------------------------------------------------
// POST /api/kafelot/check-and-use
// ---------------------------------------------------------------------------
router.post("/check-and-use", optionalAuth, kafelotBurstLimiter, async (req, res) => {
	const fingerprint = req.headers["x-kafelot-fingerprint"];
	const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
	const ip = getClientIp(req);
	const userAgent = req.headers["user-agent"] || "";
	const systemInfo = req.body?.system_info || {};
	const dryRun = req.body?.dry_run === true;
	const usageScope = resolveUsageScope(req);

	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		if (hasBearerToken && !req.user) {
			await client.query("ROLLBACK");
			return res.status(401).json({
				error: "AUTH_SESSION_INVALID",
				message: "Authentication session expired or invalid",
			});
		}

		if (req.user) {
			// ── Authenticated user ──────────────────────────────────────────────
			const tier = await fetchUserTier(client, req.user.id);
			const row = await getOrCreateUserUsage(client, req.user.id, tier, usageScope);

			if (row.prompts_used >= row.prompts_limit) {
				await client.query("ROLLBACK");
				return res.status(429).json({
					error: "PROMPT_LIMIT_REACHED",
					prompts_remaining: 0,
					prompts_limit: row.prompts_limit,
					reset_date: row.reset_date,
					tier,
					scope: usageScope,
				});
			}

			if (dryRun) {
				await client.query("COMMIT");
				return res.json({
					allowed: true,
					prompts_remaining: row.prompts_limit - row.prompts_used,
					prompts_limit: row.prompts_limit,
					reset_date: row.reset_date,
					tier,
					scope: usageScope,
				});
			}

			await client.query(
				`UPDATE kafelot_prompt_usage
                 SET prompts_used = prompts_used + 1,
                     updated_at   = CURRENT_TIMESTAMP
				 WHERE account_id = $1 AND month_year = $2 AND usage_scope = $3`,
				[req.user.id, currentMonthYear(), usageScope],
			);

			await client.query("COMMIT");
			return res.json({
				allowed: true,
				prompts_remaining: row.prompts_limit - row.prompts_used - 1,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier,
				scope: usageScope,
			});
		} else {
			// ── Anonymous user ──────────────────────────────────────────────────
			if (!fingerprint) {
				// No fingerprint header → still allow but don't track
				const anonLimit = scopeLimits(usageScope).anonymous ?? GENERAL_PROMPT_LIMITS.anonymous;
				await client.query("ROLLBACK");
				return res.json({
					allowed: true,
					prompts_remaining: anonLimit,
					prompts_limit: anonLimit,
					scope: usageScope,
				});
			}

			const row = await getOrCreateAnonymous(client, fingerprint, ip, userAgent, systemInfo, usageScope);

			if (row.prompts_used >= row.prompts_limit) {
				await client.query("ROLLBACK");
				return res.status(429).json({
					error: "PROMPT_LIMIT_REACHED",
					prompts_remaining: 0,
					prompts_limit: row.prompts_limit,
					reset_date: row.reset_date,
					tier: "anonymous",
					scope: usageScope,
				});
			}

			if (dryRun) {
				await client.query("COMMIT");
				return res.json({
					allowed: true,
					prompts_remaining: row.prompts_limit - row.prompts_used,
					prompts_limit: row.prompts_limit,
					reset_date: row.reset_date,
					tier: "anonymous",
					scope: usageScope,
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
				scope: usageScope,
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
router.get("/status", optionalAuth, kafelotBurstLimiter, async (req, res) => {
	const fingerprint = req.headers["x-kafelot-fingerprint"];
	const hasBearerToken = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
	const ip = getClientIp(req);
	const userAgent = req.headers["user-agent"] || "";
	const usageScope = resolveUsageScope(req);

	const client = await pool.connect();
	try {
		if (hasBearerToken && !req.user) {
			return res.status(401).json({
				error: "AUTH_SESSION_INVALID",
				message: "Authentication session expired or invalid",
			});
		}

		if (req.user) {
			const tier = await fetchUserTier(client, req.user.id);
			const row = await getOrCreateUserUsage(client, req.user.id, tier, usageScope);
			return res.json({
				prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used),
				prompts_used: row.prompts_used,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier,
				scope: usageScope,
			});
		} else {
			if (!fingerprint) {
				const anonLimit = scopeLimits(usageScope).anonymous ?? GENERAL_PROMPT_LIMITS.anonymous;
				return res.json({
					prompts_remaining: anonLimit,
					prompts_used: 0,
					prompts_limit: anonLimit,
					tier: "anonymous",
					scope: usageScope,
				});
			}
			const row = await getOrCreateAnonymous(client, fingerprint, ip, userAgent, {}, usageScope);
			return res.json({
				prompts_remaining: Math.max(0, row.prompts_limit - row.prompts_used),
				prompts_used: row.prompts_used,
				prompts_limit: row.prompts_limit,
				reset_date: row.reset_date,
				tier: "anonymous",
				scope: usageScope,
			});
		}
	} catch (err) {
		console.error("Kafelot status error:", err);
		const anonLimit = scopeLimits(usageScope).anonymous ?? GENERAL_PROMPT_LIMITS.anonymous;
		return res.json({
			prompts_remaining: anonLimit,
			prompts_limit: anonLimit,
			tier: "anonymous",
			scope: usageScope,
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
	const { limit = 50, offset = 0, month_year, scope } = req.query;
	const client = await pool.connect();
	try {
		const filterParams = [];
		const rowsFilters = [];
		const countFilters = [];
		let rowsParamIndex = 3;
		let countParamIndex = 1;

		if (month_year) {
			rowsFilters.push(`kpu.month_year = $${rowsParamIndex++}`);
			countFilters.push(`kpu.month_year = $${countParamIndex++}`);
			filterParams.push(month_year);
		}
		if (scope) {
			rowsFilters.push(`kpu.usage_scope = $${rowsParamIndex++}`);
			countFilters.push(`kpu.usage_scope = $${countParamIndex++}`);
			filterParams.push(normalizeUsageScope(scope));
		}

		const rowsWhereClause = rowsFilters.length > 0 ? `WHERE ${rowsFilters.join(" AND ")}` : "";
		const countWhereClause = countFilters.length > 0 ? `WHERE ${countFilters.join(" AND ")}` : "";
		const params = [parseInt(limit), parseInt(offset), ...filterParams];

		const { rows } = await client.query(
			`SELECT kpu.*, a.username, a.email
             FROM kafelot_prompt_usage kpu
             JOIN accounts a ON kpu.account_id = a.id
			 ${rowsWhereClause}
             ORDER BY kpu.updated_at DESC
             LIMIT $1 OFFSET $2`,
			params,
		);
		const { rows: countRows } = await client.query(
			`SELECT COUNT(*) AS total FROM kafelot_prompt_usage kpu ${countWhereClause}`,
			filterParams,
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
