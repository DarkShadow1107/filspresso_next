/**
 * Filspresso Express.js API Server
 * Connects Next.js frontend with PostgreSQL database
 *
 * This server automatically manages the PostgreSQL Docker container:
 * - Starts the container when the server starts
 * - Stops the container when the server is shut down (Ctrl+C)
 */

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { execFile } = require("child_process");
const path = require("path");
const { preloadSecrets } = require("./utils/secrets");
const { appendSecurityLedgerEvent, verifySecurityLedgerChain } = require("./utils/securityLedger");
const { requirePolicyDecision } = require("./middleware/policyGate");
const { originGuard } = require("./middleware/originGuard");
const { verifyServiceAssertion } = require("./utils/serviceAssertions");

preloadSecrets([
	{ name: "BACKEND_DB_PASSWORD", required: false },
	{ name: "DB_PASSWORD", required: true },
	{ name: "JWT_SECRET", required: true },
	{ name: "JWT_SIGNING_PRIVATE_KEY", required: false },
	{ name: "JWT_SIGNING_PUBLIC_KEY", required: false },
	{ name: "ENCRYPTION_KEY", required: true },
	{ name: "ENCRYPTION_KEY_LEGACY", required: false },
	{ name: "SERVICE_EVENTS_API_KEY", required: false },
	{ name: "SERVICE_ASSERTION_PUBLIC_KEY", required: false },
	{ name: "SERVICE_ASSERTION_PRIVATE_KEY", required: false },
	{ name: "GO_OPS_CLIENT_CERT", required: false },
	{ name: "GO_OPS_CLIENT_KEY", required: false },
	{ name: "GO_OPS_CA_CERT", required: false },
	{ name: "GO_OPS_API_KEY", required: false },
]);

const pool = require("./db/connection");

// Docker container manager
const dockerManager = require("./utils/dockerManager");
const { ensureAppSchema } = require("./utils/ensureAppSchema");

// Import routes
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/accounts");
const cardsRoutes = require("./routes/cards");
const ordersRoutes = require("./routes/orders");
const cartRoutes = require("./routes/cart");
const chatRoutes = require("./routes/chat");
const weatherRoutes = require("./routes/weather");
const subscriptionsRoutes = require("./routes/subscriptions");
const repairsRoutes = require("./routes/repairs");
const adminRoutes = require("./routes/admin");
const productsRoutes = require("./routes/products");
const favoritesRoutes = require("./routes/favorites");
const kafelotRoutes = require("./routes/kafelot");
const operationsRoutes = require("./routes/operations");
const subscriptionsEngineRoutes = require("./routes/subscriptions_engine");
const cryptoRoutes = require("./routes/crypto");

const app = express();
const PORT = process.env.PORT || 4000;
const AI_HEALTH_HOST = process.env.PYTHON_AI_HOST || process.env.NEXT_PUBLIC_AI_URL || "http://localhost:5000";
const ADMIN_HEALTH_URL = process.env.ADMIN_HEALTH_URL || "";
const STRICT_DB_ONLY_METRICS = process.env.SERVICE_METRICS_STRICT_DB_ONLY === "true";
const SERVICE_EVENTS_API_KEY = process.env.SERVICE_EVENTS_API_KEY || "";
const INTERNAL_SERVICE_ASSERTION_STRICT =
	String(process.env.INTERNAL_SERVICE_ASSERTION_STRICT || "true")
		.trim()
		.toLowerCase() === "true";
const INCIDENT_RETENTION_DAYS = Number.parseInt(process.env.SERVICE_INCIDENT_RETENTION_DAYS || "180", 10);
const RETENTION_JOB_INTERVAL_MS = Number.parseInt(process.env.SERVICE_INCIDENT_RETENTION_JOB_MS || "21600000", 10);
const REQUEST_TIMEOUT_MS = Math.min(
	Math.max(Number.parseInt(process.env.REQUEST_TIMEOUT_MS || "20000", 10) || 20000, 5000),
	120000,
);
const SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES = Math.min(
	Math.max(Number.parseInt(process.env.SECURITY_OBSERVABILITY_WINDOW_MINUTES || "60", 10) || 60, 5),
	24 * 60,
);
const SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES = Math.min(
	Math.max(Number.parseInt(process.env.SECURITY_OBSERVABILITY_MPC_STALE_MINUTES || "30", 10) || 30, 5),
	24 * 60,
);
const SECURITY_LEDGER_ARCHIVE_ENABLED =
	String(process.env.SECURITY_LEDGER_ARCHIVE_ENABLED || "true")
		.trim()
		.toLowerCase() === "true";
const SECURITY_LEDGER_ARCHIVE_INTERVAL_MS = Math.max(
	Number.parseInt(process.env.SECURITY_LEDGER_ARCHIVE_INTERVAL_MS || "3600000", 10) || 3600000,
	15 * 60 * 1000,
);
const SECURITY_LEDGER_ARCHIVE_OLDER_THAN_HOURS = Math.min(
	Math.max(Number.parseInt(process.env.SECURITY_ARCHIVE_OLDER_THAN_HOURS || "24", 10) || 24, 1),
	24 * 365,
);
const SECURITY_LEDGER_ARCHIVE_LIMIT = Math.min(
	Math.max(Number.parseInt(process.env.SECURITY_ARCHIVE_LIMIT || "500", 10) || 500, 1),
	5000,
);
const SECURITY_LEDGER_ARCHIVE_CHAIN_SCOPE = String(process.env.SECURITY_ARCHIVE_CHAIN_SCOPE || "").trim();
const SECURITY_ALERT_WEBHOOK_URL = String(process.env.SECURITY_ALERT_WEBHOOK_URL || "").trim();
const SECURITY_ALERT_WEBHOOK_TIMEOUT_MS = Math.min(
	Math.max(Number.parseInt(process.env.SECURITY_ALERT_WEBHOOK_TIMEOUT_MS || "4000", 10) || 4000, 1000),
	30000,
);
const SECURITY_ALERT_DISPATCH_MIN_SEVERITY =
	String(process.env.SECURITY_ALERT_DISPATCH_MIN_SEVERITY || "high")
		.trim()
		.toLowerCase() || "high";

const TRUST_PROXY_RAW = process.env.TRUST_PROXY;
if (TRUST_PROXY_RAW === "true") {
	app.set("trust proxy", true);
} else if (TRUST_PROXY_RAW === "false" || TRUST_PROXY_RAW === "0") {
	app.set("trust proxy", false);
} else if (TRUST_PROXY_RAW && !Number.isNaN(Number.parseInt(TRUST_PROXY_RAW, 10))) {
	app.set("trust proxy", Number.parseInt(TRUST_PROXY_RAW, 10));
}
app.disable("x-powered-by");

const serviceHealthState = {
	backend: {
		status: "up",
		changedAt: new Date().toISOString(),
		lastCheckedAt: null,
		lastDowntimeAt: null,
		lastRecoveryAt: new Date().toISOString(),
		lastError: null,
	},
	database: {
		status: "up",
		changedAt: new Date().toISOString(),
		lastCheckedAt: null,
		lastDowntimeAt: null,
		lastRecoveryAt: new Date().toISOString(),
		lastError: null,
	},
	ai: {
		status: "up",
		changedAt: new Date().toISOString(),
		lastCheckedAt: null,
		lastDowntimeAt: null,
		lastRecoveryAt: new Date().toISOString(),
		lastError: null,
	},
	administration: {
		status: "up",
		changedAt: new Date().toISOString(),
		lastCheckedAt: null,
		lastDowntimeAt: null,
		lastRecoveryAt: new Date().toISOString(),
		lastError: null,
	},
};

function applyServiceHealth(serviceName, isUp, errorMessage = null) {
	const nowIso = new Date().toISOString();
	const serviceState = serviceHealthState[serviceName];
	if (!serviceState) return;

	const nextStatus = isUp ? "up" : "down";
	if (serviceState.status !== nextStatus) {
		serviceState.status = nextStatus;
		serviceState.changedAt = nowIso;
		if (nextStatus === "down") {
			serviceState.lastDowntimeAt = nowIso;
		} else {
			serviceState.lastRecoveryAt = nowIso;
		}
	}

	serviceState.lastCheckedAt = nowIso;
	serviceState.lastError = errorMessage;
}

async function checkDatabaseHealth() {
	let client;
	try {
		client = await pool.connect();
		await client.query("SELECT 1");
		return { isUp: true, error: null };
	} catch (error) {
		return { isUp: false, error: error.message || "Database health check failed" };
	} finally {
		if (client) client.release();
	}
}

async function checkAiHealth() {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3500);

	try {
		const response = await fetch(`${AI_HEALTH_HOST}/api/health`, {
			method: "GET",
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			return { isUp: false, error: `AI health returned ${response.status}` };
		}

		return { isUp: true, error: null };
	} catch (error) {
		if (error?.name === "AbortError") {
			return { isUp: false, error: "AI health check timed out" };
		}
		return { isUp: false, error: error.message || "AI health check failed" };
	} finally {
		clearTimeout(timeout);
	}
}

async function checkAdministrationHealth(canRunAdmin) {
	if (!canRunAdmin) {
		return { isUp: false, error: "Administration service is unavailable because backend/database is down" };
	}

	if (!ADMIN_HEALTH_URL) {
		return { isUp: true, error: null };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3500);

	try {
		const response = await fetch(ADMIN_HEALTH_URL, {
			method: "GET",
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});

		if (!response.ok) {
			return { isUp: false, error: `Administration health returned ${response.status}` };
		}

		return { isUp: true, error: null };
	} catch (error) {
		if (error?.name === "AbortError") {
			return { isUp: false, error: "Administration health check timed out" };
		}
		return { isUp: false, error: error.message || "Administration health check failed" };
	} finally {
		clearTimeout(timeout);
	}
}

async function pruneOldServiceIncidents() {
	let client;
	try {
		client = await pool.connect();
		const retentionDays = Number.isFinite(INCIDENT_RETENTION_DAYS)
			? Math.min(Math.max(INCIDENT_RETENTION_DAYS, 30), 3650)
			: 180;

		const result = await client.query(
			`DELETE FROM service_health_incidents
			 WHERE occurred_at < (NOW() - ($1::int * INTERVAL '1 day'))`,
			[retentionDays],
		);

		if (result.rowCount && result.rowCount > 0) {
			console.log(`🧹 Retention cleanup removed ${result.rowCount} service incidents older than ${retentionDays} days`);
		}
	} catch (error) {
		console.error("Retention cleanup failed:", error.message || String(error));
	} finally {
		if (client) client.release();
	}
}

function getSecuritySeverity(metrics) {
	if ((metrics.zkVerificationFailures || 0) >= 3 || (metrics.mpcStalledSessions || 0) >= 3) return "critical";
	if ((metrics.policyDenials || 0) >= 10 || (metrics.zkPendingVerifications || 0) >= 10 || (metrics.thresholdExpired || 0) >= 2)
		return "high";
	if ((metrics.policyDenials || 0) >= 3 || (metrics.mpcReadyBacklog || 0) >= 1) return "medium";
	return "low";
}

function securitySeverityRank(severity) {
	const normalized = String(severity || "low")
		.trim()
		.toLowerCase();
	const rank = {
		low: 1,
		medium: 2,
		high: 3,
		critical: 4,
	};
	return rank[normalized] || rank.low;
}

async function dispatchSecurityAlertWebhook(payload, options = {}) {
	if (!SECURITY_ALERT_WEBHOOK_URL) {
		return { dispatched: false, reason: "webhook_not_configured" };
	}

	const minSeverity = String(options.minSeverity || SECURITY_ALERT_DISPATCH_MIN_SEVERITY)
		.trim()
		.toLowerCase();
	const eventSeverity = String(payload?.severity || "low")
		.trim()
		.toLowerCase();
	const force = Boolean(options.force);
	if (!force && securitySeverityRank(eventSeverity) < securitySeverityRank(minSeverity)) {
		return {
			dispatched: false,
			reason: "below_min_severity",
			minSeverity,
			eventSeverity,
		};
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), SECURITY_ALERT_WEBHOOK_TIMEOUT_MS);

	try {
		const response = await fetch(SECURITY_ALERT_WEBHOOK_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			return {
				dispatched: false,
				reason: "webhook_rejected",
				status: response.status,
				details: body || null,
			};
		}

		return {
			dispatched: true,
			status: response.status,
			target: SECURITY_ALERT_WEBHOOK_URL,
		};
	} catch (error) {
		return {
			dispatched: false,
			reason: "webhook_error",
			details: error.message || String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function collectSecurityObservabilitySnapshot(options = {}) {
	const windowMinutes = Number.isFinite(options.windowMinutes)
		? Math.min(Math.max(options.windowMinutes, 5), 24 * 60)
		: SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES;
	const mpcStaleMinutes = Number.isFinite(options.mpcStaleMinutes)
		? Math.min(Math.max(options.mpcStaleMinutes, 5), 24 * 60)
		: SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES;

	const client = await pool.connect();
	try {
		const policyDenialsResult = await client.query(
			`SELECT COUNT(*)::int AS count
			 FROM security_event_ledger
			 WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 minute')
			   AND (
					event_type ILIKE 'policy.%deny%'
					OR event_type ILIKE 'auth.%deny%'
					OR event_type ILIKE 'opa.%deny%'
			   )`,
			[windowMinutes],
		);

		const zkFailuresResult = await client.query(
			`SELECT
				COUNT(*) FILTER (WHERE verified = FALSE)::int AS pending_or_failed,
				COUNT(*) FILTER (WHERE verified = FALSE AND created_at <= NOW() - INTERVAL '15 minutes')::int AS stale_failures
			 FROM zk_proof_sessions
			 WHERE created_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
			[windowMinutes],
		);

		const mpcResult = await client.query(
			`SELECT
				COUNT(*) FILTER (WHERE status IN ('pending', 'ready') AND created_at <= NOW() - ($1::int * INTERVAL '1 minute'))::int AS stalled,
				COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_backlog,
				COUNT(*) FILTER (WHERE status IN ('cancelled', 'expired') AND created_at >= NOW() - ($2::int * INTERVAL '1 minute'))::int AS quorum_failures
			 FROM mpc_quorum_sessions`,
			[mpcStaleMinutes, windowMinutes],
		);

		const thresholdResult = await client.query(
			`SELECT COUNT(*)::int AS expired
			 FROM threshold_operations
			 WHERE status IN ('expired', 'rejected')
			   AND updated_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
			[windowMinutes],
		);

		const archiveResult = await client.query(
			`SELECT
				COUNT(*)::int AS archived_rows_window,
				MAX(archived_at) AS last_archived_at
			 FROM security_event_ledger_archive
			 WHERE archived_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
			[windowMinutes],
		);

		const pendingArchiveResult = await client.query(
			`SELECT COUNT(*)::int AS pending_archive_rows
			 FROM security_event_ledger l
			 LEFT JOIN security_event_ledger_archive a ON a.original_id = l.id
			 WHERE a.id IS NULL
			   AND l.occurred_at <= NOW() - ($1::int * INTERVAL '1 hour')`,
			[SECURITY_LEDGER_ARCHIVE_OLDER_THAN_HOURS],
		);

		const policyDenyTrend = await client.query(
			`SELECT date_trunc('hour', occurred_at) AS bucket, COUNT(*)::int AS count
			 FROM security_event_ledger
			 WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 minute')
			   AND (
					event_type ILIKE 'policy.%deny%'
					OR event_type ILIKE 'auth.%deny%'
					OR event_type ILIKE 'opa.%deny%'
			   )
			 GROUP BY bucket
			 ORDER BY bucket ASC`,
			[windowMinutes],
		);

		const metrics = {
			policyDenials: Number(policyDenialsResult.rows[0]?.count || 0),
			zkPendingVerifications: Number(zkFailuresResult.rows[0]?.pending_or_failed || 0),
			zkVerificationFailures: Number(zkFailuresResult.rows[0]?.stale_failures || 0),
			mpcStalledSessions: Number(mpcResult.rows[0]?.stalled || 0),
			mpcReadyBacklog: Number(mpcResult.rows[0]?.ready_backlog || 0),
			mpcQuorumFailures: Number(mpcResult.rows[0]?.quorum_failures || 0),
			thresholdExpired: Number(thresholdResult.rows[0]?.expired || 0),
		};

		return {
			generatedAt: new Date().toISOString(),
			windowMinutes,
			mpcStaleMinutes,
			severity: getSecuritySeverity(metrics),
			metrics,
			archive: {
				archivedRowsWindow: Number(archiveResult.rows[0]?.archived_rows_window || 0),
				pendingArchiveRows: Number(pendingArchiveResult.rows[0]?.pending_archive_rows || 0),
				lastArchivedAt: archiveResult.rows[0]?.last_archived_at || null,
			},
			trends: {
				policyDenialsPerHour: policyDenyTrend.rows.map((row) => ({
					bucket: row.bucket,
					count: Number(row.count || 0),
				})),
			},
		};
	} finally {
		client.release();
	}
}

let securityArchiveJobRunning = false;
async function runSecurityLedgerArchiveJob() {
	if (!SECURITY_LEDGER_ARCHIVE_ENABLED || securityArchiveJobRunning) {
		return;
	}

	securityArchiveJobRunning = true;
	const args = [
		path.resolve(__dirname, "scripts/archive_security_ledger.js"),
		`--older-than-hours=${SECURITY_LEDGER_ARCHIVE_OLDER_THAN_HOURS}`,
		`--limit=${SECURITY_LEDGER_ARCHIVE_LIMIT}`,
	];
	if (SECURITY_LEDGER_ARCHIVE_CHAIN_SCOPE) {
		args.push(`--chain-scope=${SECURITY_LEDGER_ARCHIVE_CHAIN_SCOPE}`);
	}

	try {
		await new Promise((resolve, reject) => {
			execFile(process.execPath, args, { cwd: __dirname, env: process.env }, (error, stdout, stderr) => {
				if (error) {
					const detail = String(stderr || error.message || "").trim();
					reject(new Error(detail || "security ledger archive job failed"));
					return;
				}

				const output = String(stdout || "").trim();
				if (output) {
					console.log(`Security ledger archive job: ${output}`);
				}
				resolve();
			});
		});
	} catch (error) {
		console.error("Security ledger archive scheduler failed:", error.message || String(error));
	} finally {
		securityArchiveJobRunning = false;
	}
}

function requireServiceEventsApiKey(req, res, next) {
	const serviceName =
		String(req.headers["x-service-name"] || "")
			.trim()
			.slice(0, 128) || "service-events-client";
	const assertionHeader = String(req.headers["x-service-assertion"] || "").trim();
	const assertionAuthorization = String(req.headers.authorization || "").trim();
	const assertionToken =
		assertionHeader || (assertionAuthorization.startsWith("Assertion ") ? assertionAuthorization.slice(10).trim() : "");
	const operationIdHeader = String(req.headers["x-operation-id"] || "").trim();

	if (INTERNAL_SERVICE_ASSERTION_STRICT && !assertionToken) {
		return res.status(401).json({ error: "Service assertion token required" });
	}

	if (!SERVICE_EVENTS_API_KEY && !assertionToken) {
		return res.status(503).json({ error: "Service events ingestion is disabled" });
	}

	if (assertionToken) {
		const assertion = verifyServiceAssertion(assertionToken, {
			expectedScope: "service-events:write",
			requireJti: INTERNAL_SERVICE_ASSERTION_STRICT,
		});
		if (assertion.ok) {
			const claims = assertion.claims || {};
			const operationIdClaim = String(claims.op_id || "").trim();
			if (
				INTERNAL_SERVICE_ASSERTION_STRICT &&
				operationIdHeader &&
				operationIdClaim &&
				operationIdHeader !== operationIdClaim
			) {
				return res.status(401).json({ error: "Invalid service assertion", reason: "operation_id_mismatch" });
			}
			req.serviceIdentity = {
				actor_type: "service",
				service_name: String(claims.sub || serviceName).slice(0, 128),
				role: "service",
			};
			req.serviceAssertion = claims;
			return next();
		}

		if (INTERNAL_SERVICE_ASSERTION_STRICT || !SERVICE_EVENTS_API_KEY) {
			return res
				.status(401)
				.json({ error: "Invalid service assertion", reason: assertion.reason || "verification_failed" });
		}
	}

	if (INTERNAL_SERVICE_ASSERTION_STRICT) {
		return res.status(401).json({ error: "Invalid service assertion", reason: "assertion_required" });
	}

	const headerKey = String(req.headers["x-service-events-key"] || "").trim();
	if (headerKey && headerKey === SERVICE_EVENTS_API_KEY) {
		req.serviceIdentity = { actor_type: "service", service_name: serviceName, role: "service" };
		return next();
	}

	const authHeader = String(req.headers.authorization || "");
	if (authHeader.startsWith("Bearer ")) {
		const bearerKey = authHeader.slice(7).trim();
		if (bearerKey === SERVICE_EVENTS_API_KEY) {
			req.serviceIdentity = { actor_type: "service", service_name: serviceName, role: "service" };
			return next();
		}
	}

	return res.status(401).json({ error: "Unauthorized service events request" });
}

function resolveRequestId(req) {
	const headerValue = String(req.headers["x-request-id"] || "").trim();
	const safeHeader = headerValue.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
	return safeHeader || crypto.randomUUID();
}

// Security middleware
app.use(
	helmet({
		contentSecurityPolicy: {
			useDefaults: false,
			directives: {
				defaultSrc: ["'none'"],
				baseUri: ["'none'"],
				frameAncestors: ["'none'"],
				formAction: ["'self'"],
				imgSrc: ["'self'", "data:"],
				connectSrc: ["'self'"],
				objectSrc: ["'none'"],
				scriptSrc: ["'none'"],
				styleSrc: ["'none'"],
			},
		},
		referrerPolicy: { policy: "no-referrer" },
		crossOriginResourcePolicy: { policy: "same-site" },
	}),
);

app.use((req, res, next) => {
	req.requestId = resolveRequestId(req);
	res.setHeader("x-request-id", req.requestId);
	next();
});

const configuredOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const allowLocalhostOrigin = (origin) => {
	if (!origin) return false;
	return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
};

app.use(
	cors({
		origin: (origin, callback) => {
			if (!origin) return callback(null, true);
			if (configuredOrigins.includes(origin) || (!IS_PRODUCTION && allowLocalhostOrigin(origin))) {
				return callback(null, true);
			}
			return callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
	}),
);

// Rate limiting
const API_RATE_LIMIT_WINDOW_MS = Math.max(60_000, Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || "900000", 10));
const API_RATE_LIMIT_MAX = Math.max(100, Number.parseInt(process.env.API_RATE_LIMIT_MAX || "1200", 10));
const GLOBAL_RATE_LIMIT_EXCLUDED_PATHS = new Set([
	"/auth/login",
	"/auth/register",
	"/admin/login",
	"/kafelot/check-and-use",
	"/kafelot/status",
]);
const limiter = rateLimit({
	windowMs: API_RATE_LIMIT_WINDOW_MS,
	max: API_RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Too many requests, please try again later." },
	// Auth/admin endpoints have dedicated strict limiters, while Kafelot prompt endpoints
	// use a dedicated high-throughput burst limiter in routes/kafelot.js.
	skip: (req) => GLOBAL_RATE_LIMIT_EXCLUDED_PATHS.has(req.path),
});

// Development-friendly behavior: allow disabling the rate-limiter while
// developing locally to avoid hitting 429s during heavy testing / hot reloads.
// - By default the limiter is applied when NODE_ENV !== 'development'.
// - You can also force-disable with DISABLE_RATE_LIMIT_FOR_DEV=true.
// NOTE: For production, prefer per-route controls (e.g. stricter auth limiter)
// as documented in the README.
// Allow several safe ways to disable the global rate limiter while working
// locally or during testing. Defaults (in development) already disabled it,
// but add an explicit override so maintainers can turn it off quickly.
// - NODE_ENV === 'development' (already covered)
// - DISABLE_RATE_LIMIT_FOR_DEV === 'true' (legacy developer toggle)
// - DISABLE_RATE_LIMIT === 'true' (new explicit toggle used during testing)
const shouldEnableGlobalRateLimit =
	process.env.ENABLE_RATE_LIMIT === "true" ||
	(process.env.NODE_ENV === "production" &&
		process.env.DISABLE_RATE_LIMIT_FOR_DEV !== "true" &&
		process.env.DISABLE_RATE_LIMIT !== "true");

if (!shouldEnableGlobalRateLimit) {
	console.log(
		"⚠️ Global API rate limiting disabled (non-production mode or explicit disable). Route-specific auth/admin limiters remain active.",
	);
} else {
	app.use("/api/", limiter);
}

// Body parsing
app.use(express.json({ limit: "10mb", strict: true }));
app.use(express.urlencoded({ extended: true }));
app.use(originGuard);

app.use((req, res, next) => {
	const timeout = setTimeout(() => {
		if (res.headersSent) return;
		res.status(503).json({ error: "Request timed out", requestId: req.requestId });
	}, REQUEST_TIMEOUT_MS);

	const clear = () => clearTimeout(timeout);
	res.on("finish", clear);
	res.on("close", clear);
	next();
});

// Health check
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString(), requestId: req.requestId });
});

app.get("/health/services", async (req, res) => {
	const checkedAt = new Date().toISOString();
	const dbHealth = await checkDatabaseHealth();
	const aiHealth = await checkAiHealth();
	const backendIsUp = dbHealth.isUp;
	const backendError = backendIsUp ? null : "Backend service is unavailable because database is down";
	const adminHealth = await checkAdministrationHealth(backendIsUp);

	applyServiceHealth("backend", backendIsUp, backendError);
	applyServiceHealth("database", dbHealth.isUp, dbHealth.error);
	applyServiceHealth("ai", aiHealth.isUp, aiHealth.error);
	applyServiceHealth("administration", adminHealth.isUp, adminHealth.error);

	const services = {
		backend: { ...serviceHealthState.backend, displayName: "Server-side API" },
		database: { ...serviceHealthState.database, displayName: "PostgreSQL Database" },
		ai: { ...serviceHealthState.ai, displayName: "AI Model Services" },
		administration: { ...serviceHealthState.administration, displayName: "Administration Console" },
	};

	const upCount = Object.values(services).filter((service) => service.status === "up").length;

	res.json({
		status: "ok",
		checkedAt,
		strictDbOnlyMetrics: STRICT_DB_ONLY_METRICS,
		summary: {
			totalServices: Object.keys(services).length,
			upServices: upCount,
			downServices: Object.keys(services).length - upCount,
		},
		services,
	});
});

app.get("/health/services/events", async (req, res) => {
	const rawLimit = Number.parseInt(String(req.query.limit || "120"), 10);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 120;
	const rawWindowHours = Number.parseInt(String(req.query.windowHours || "24"), 10);
	const windowHours = Number.isFinite(rawWindowHours) ? Math.min(Math.max(rawWindowHours, 1), 24 * 365) : 24;

	let client;
	try {
		client = await pool.connect();
		const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
		const result = await client.query(
			`WITH windowed AS (
				SELECT id, service_key, service_name, status, reason, occurred_at, source, created_at
				FROM service_health_incidents
				WHERE occurred_at >= $1
				ORDER BY occurred_at DESC
				LIMIT $2
			), anchors AS (
				SELECT DISTINCT ON (service_key)
					id, service_key, service_name, status, reason, occurred_at, source, created_at
				FROM service_health_incidents
				WHERE occurred_at < $1
				ORDER BY service_key, occurred_at DESC
			)
			SELECT id, service_key, service_name, status, reason, occurred_at, source, created_at
			FROM (
				SELECT * FROM windowed
				UNION ALL
				SELECT * FROM anchors
			) merged
			ORDER BY occurred_at DESC`,
			[sinceIso, limit],
		);

		res.json({ incidents: result.rows, requestId: req.requestId });
	} catch (error) {
		res.status(503).json({
			error: "Service incident history unavailable",
			details: error.message || String(error),
			requestId: req.requestId,
		});
	} finally {
		if (client) client.release();
	}
});

app.get(
	"/health/security/observability",
	requireServiceEventsApiKey,
	requirePolicyDecision({ resource: "service-events", action: "observe" }),
	async (req, res) => {
		const windowMinutesRaw = Number.parseInt(
			String(req.query.windowMinutes || SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES),
			10,
		);
		const mpcStaleMinutesRaw = Number.parseInt(
			String(req.query.mpcStaleMinutes || SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES),
			10,
		);
		const windowMinutes = Number.isFinite(windowMinutesRaw)
			? Math.min(Math.max(windowMinutesRaw, 5), 24 * 60)
			: SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES;
		const mpcStaleMinutes = Number.isFinite(mpcStaleMinutesRaw)
			? Math.min(Math.max(mpcStaleMinutesRaw, 5), 24 * 60)
			: SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES;

		try {
			const snapshot = await collectSecurityObservabilitySnapshot({ windowMinutes, mpcStaleMinutes });
			return res.json({ ...snapshot, requestId: req.requestId });
		} catch (error) {
			return res.status(503).json({
				error: "Security observability snapshot unavailable",
				details: error.message || String(error),
				requestId: req.requestId,
			});
		}
	},
);

app.get(
	"/health/security/alerts",
	requireServiceEventsApiKey,
	requirePolicyDecision({ resource: "service-events", action: "alerts" }),
	async (req, res) => {
		try {
			const snapshot = await collectSecurityObservabilitySnapshot({
				windowMinutes: SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES,
				mpcStaleMinutes: SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES,
			});
			const activeAlert = ["critical", "high"].includes(String(snapshot.severity || "low"));
			return res.json({
				generatedAt: snapshot.generatedAt,
				activeAlert,
				severity: snapshot.severity,
				metrics: snapshot.metrics,
				requestId: req.requestId,
			});
		} catch (error) {
			return res.status(503).json({
				error: "Security alert evaluation unavailable",
				details: error.message || String(error),
				requestId: req.requestId,
			});
		}
	},
);

app.post(
	"/health/security/alerts/dispatch",
	requireServiceEventsApiKey,
	requirePolicyDecision({ resource: "service-events", action: "alerts" }),
	async (req, res) => {
		const body = req.body && typeof req.body === "object" ? req.body : {};
		const force =
			String(body.force || "false")
				.trim()
				.toLowerCase() === "true";
		const minSeverity = String(body.minSeverity || SECURITY_ALERT_DISPATCH_MIN_SEVERITY)
			.trim()
			.toLowerCase();
		const windowMinutesRaw = Number.parseInt(String(body.windowMinutes || SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES), 10);
		const mpcStaleMinutesRaw = Number.parseInt(
			String(body.mpcStaleMinutes || SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES),
			10,
		);

		const windowMinutes = Number.isFinite(windowMinutesRaw)
			? Math.min(Math.max(windowMinutesRaw, 5), 24 * 60)
			: SECURITY_OBSERVABILITY_DEFAULT_WINDOW_MINUTES;
		const mpcStaleMinutes = Number.isFinite(mpcStaleMinutesRaw)
			? Math.min(Math.max(mpcStaleMinutesRaw, 5), 24 * 60)
			: SECURITY_OBSERVABILITY_DEFAULT_MPC_STALE_MINUTES;

		try {
			const snapshot = await collectSecurityObservabilitySnapshot({ windowMinutes, mpcStaleMinutes });
			const dispatchPayload = {
				eventType: "titan.security.alert",
				generatedAt: snapshot.generatedAt,
				severity: snapshot.severity,
				metrics: snapshot.metrics,
				archive: snapshot.archive,
				windowMinutes,
				mpcStaleMinutes,
				source: "express-api",
			};

			const dispatchResult = await dispatchSecurityAlertWebhook(dispatchPayload, {
				minSeverity,
				force,
			});

			return res.json({
				dispatch: dispatchResult,
				snapshot,
				requestId: req.requestId,
			});
		} catch (error) {
			return res.status(503).json({
				error: "Security alert dispatch failed",
				details: error.message || String(error),
				requestId: req.requestId,
			});
		}
	},
);

app.get("/health/services/ledger/verify", requireServiceEventsApiKey, async (req, res) => {
	const chainScope = String(req.query.chainScope || "service-health").trim() || "service-health";
	const maxRowsRaw = Number.parseInt(String(req.query.maxRows || "10000"), 10);
	const maxRows = Number.isFinite(maxRowsRaw) ? Math.min(Math.max(maxRowsRaw, 1), 100000) : 10000;

	let client;
	try {
		client = await pool.connect();
		const verification = await verifySecurityLedgerChain(client, { chainScope, maxRows });
		const statusCode = verification.ok ? 200 : 409;
		return res.status(statusCode).json({ ...verification, requestId: req.requestId });
	} catch (error) {
		return res.status(503).json({
			error: "Security ledger verification unavailable",
			details: error.message || String(error),
			requestId: req.requestId,
		});
	} finally {
		if (client) client.release();
	}
});

app.post(
	"/health/services/events/bulk",
	requireServiceEventsApiKey,
	requirePolicyDecision({ resource: "service-events", action: "ingest" }),
	async (req, res) => {
		const events = Array.isArray(req.body?.events) ? req.body.events : [];
		if (events.length === 0) {
			return res.json({ inserted: 0, requestId: req.requestId });
		}

		let client;
		try {
			client = await pool.connect();
			await client.query("BEGIN");

			let inserted = 0;
			for (const event of events) {
				const serviceKey = typeof event?.service_key === "string" ? event.service_key.trim() : "";
				const serviceName = typeof event?.service_name === "string" ? event.service_name.trim() : "";
				const status = event?.status === "down" ? "down" : event?.status === "up" ? "up" : "";
				const reason = typeof event?.reason === "string" && event.reason.trim().length > 0 ? event.reason.trim() : null;
				const source =
					typeof event?.source === "string" && event.source.trim().length > 0 ? event.source.trim() : "next-api";
				const occurredAt = new Date(event?.occurred_at || Date.now());

				if (!serviceKey || !serviceName || !status || Number.isNaN(occurredAt.getTime())) {
					continue;
				}

				await client.query(
					`INSERT INTO service_health_incidents (service_key, service_name, status, reason, occurred_at, source)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
					[serviceKey, serviceName, status, reason, occurredAt.toISOString(), source],
				);

				await appendSecurityLedgerEvent(client, {
					chainScope: "service-health",
					eventType: `service_health.${status}`,
					serviceName,
					actorType: "service",
					actorId: source,
					correlationId: req.requestId,
					occurredAt: occurredAt.toISOString(),
					payload: {
						service_key: serviceKey,
						service_name: serviceName,
						status,
						reason,
						source,
						occurred_at: occurredAt.toISOString(),
					},
				});
				inserted += 1;
			}

			await client.query("COMMIT");
			return res.json({ inserted, requestId: req.requestId });
		} catch (error) {
			if (client) {
				await client.query("ROLLBACK");
			}
			return res
				.status(503)
				.json({
					error: "Failed to persist service incidents",
					details: error.message || String(error),
					requestId: req.requestId,
				});
		} finally {
			if (client) client.release();
		}
	},
);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/cards", cardsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/repairs", repairsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/kafelot", kafelotRoutes);
app.use("/api/operations", operationsRoutes);
app.use("/api/subscriptions-engine", subscriptionsEngineRoutes);
app.use("/api/crypto", cryptoRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
	console.error("Error:", err);
	res.status(err.status || 500).json({
		error: process.env.NODE_ENV === "development" ? err.message : "Internal server error",
		requestId: req.requestId,
		...(process.env.NODE_ENV === "development" && { stack: err.stack }),
	});
});

// 404 handler
app.use((req, res) => {
	res.status(404).json({ error: "Endpoint not found", requestId: req.requestId });
});

/**
 * Start server.
 * When running inside Docker (detected via /.dockerenv), postgres is already
 * healthy thanks to compose depends_on — skip container management entirely.
 * When running locally, dockerManager starts/stops the postgres container.
 */
const RUNNING_IN_DOCKER = require("fs").existsSync("/.dockerenv");

async function startServer() {
	try {
		if (RUNNING_IN_DOCKER) {
			console.log("🐳 Running inside Docker — postgres managed by compose, skipping dockerManager");
		} else {
			// Local dev: start the postgres container if needed
			await dockerManager.startContainer();
			dockerManager.setupShutdownHandlers();
		}

		await ensureAppSchema();

		// Start Express server
		app.listen(PORT, () => {
			console.log(`🚀 Filspresso Express API running on port ${PORT}`);
			console.log(`📊 Health check: http://localhost:${PORT}/health`);
			console.log(`💡 Press Ctrl+C to stop server`);
		});

		await pruneOldServiceIncidents();
		const cleanupInterval = Number.isFinite(RETENTION_JOB_INTERVAL_MS)
			? Math.max(RETENTION_JOB_INTERVAL_MS, 60 * 60 * 1000)
			: 6 * 60 * 60 * 1000;
		setInterval(pruneOldServiceIncidents, cleanupInterval);

		if (SECURITY_LEDGER_ARCHIVE_ENABLED) {
			await runSecurityLedgerArchiveJob();
			setInterval(runSecurityLedgerArchiveJob, SECURITY_LEDGER_ARCHIVE_INTERVAL_MS);
		}
	} catch (error) {
		console.error("❌ Failed to start server:", error.message);
		console.error("💡 Make sure Docker Desktop is running");
		process.exit(1);
	}
}

startServer();

module.exports = app;
