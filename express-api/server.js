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
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
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

const app = express();
const PORT = process.env.PORT || 4000;
const AI_HEALTH_HOST = process.env.PYTHON_AI_HOST || process.env.NEXT_PUBLIC_AI_URL || "http://localhost:5000";
const ADMIN_HEALTH_URL = process.env.ADMIN_HEALTH_URL || "";
const STRICT_DB_ONLY_METRICS = process.env.SERVICE_METRICS_STRICT_DB_ONLY === "true";
const SERVICE_EVENTS_API_KEY = process.env.SERVICE_EVENTS_API_KEY || "";
const INCIDENT_RETENTION_DAYS = Number.parseInt(process.env.SERVICE_INCIDENT_RETENTION_DAYS || "180", 10);
const RETENTION_JOB_INTERVAL_MS = Number.parseInt(process.env.SERVICE_INCIDENT_RETENTION_JOB_MS || "21600000", 10);

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

function requireServiceEventsApiKey(req, res, next) {
	if (!SERVICE_EVENTS_API_KEY) {
		return res.status(503).json({ error: "Service events ingestion is disabled" });
	}

	const headerKey = String(req.headers["x-service-events-key"] || "").trim();
	if (headerKey && headerKey === SERVICE_EVENTS_API_KEY) {
		return next();
	}

	const authHeader = String(req.headers.authorization || "");
	if (authHeader.startsWith("Bearer ")) {
		const bearerKey = authHeader.slice(7).trim();
		if (bearerKey === SERVICE_EVENTS_API_KEY) {
			return next();
		}
	}

	return res.status(401).json({ error: "Unauthorized service events request" });
}

// Security middleware
app.use(helmet());

const configuredOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);

const allowLocalhostOrigin = (origin) => {
	if (!origin) return false;
	return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
};

app.use(
	cors({
		origin: (origin, callback) => {
			if (!origin) return callback(null, true);
			if (configuredOrigins.includes(origin) || allowLocalhostOrigin(origin)) {
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
const limiter = rateLimit({
	windowMs: API_RATE_LIMIT_WINDOW_MS,
	max: API_RATE_LIMIT_MAX,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: "Too many requests, please try again later." },
	// /api/auth/login, /api/auth/register, and /api/admin/login already use dedicated strict limiters.
	skip: (req) => req.path === "/auth/login" || req.path === "/auth/register" || req.path === "/admin/login",
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

// Health check
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
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

		res.json({ incidents: result.rows });
	} catch (error) {
		res.status(503).json({ error: "Service incident history unavailable", details: error.message || String(error) });
	} finally {
		if (client) client.release();
	}
});

app.post("/health/services/events/bulk", requireServiceEventsApiKey, async (req, res) => {
	const events = Array.isArray(req.body?.events) ? req.body.events : [];
	if (events.length === 0) {
		return res.json({ inserted: 0 });
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
			const source = typeof event?.source === "string" && event.source.trim().length > 0 ? event.source.trim() : "next-api";
			const occurredAt = new Date(event?.occurred_at || Date.now());

			if (!serviceKey || !serviceName || !status || Number.isNaN(occurredAt.getTime())) {
				continue;
			}

			await client.query(
				`INSERT INTO service_health_incidents (service_key, service_name, status, reason, occurred_at, source)
				 VALUES ($1, $2, $3, $4, $5, $6)`,
				[serviceKey, serviceName, status, reason, occurredAt.toISOString(), source],
			);
			inserted += 1;
		}

		await client.query("COMMIT");
		return res.json({ inserted });
	} catch (error) {
		if (client) {
			await client.query("ROLLBACK");
		}
		return res.status(503).json({ error: "Failed to persist service incidents", details: error.message || String(error) });
	} finally {
		if (client) client.release();
	}
});

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

// Error handling middleware
app.use((err, req, res, next) => {
	console.error("Error:", err);
	res.status(err.status || 500).json({
		error: process.env.NODE_ENV === "development" ? err.message : "Internal server error",
		...(process.env.NODE_ENV === "development" && { stack: err.stack }),
	});
});

// 404 handler
app.use((req, res) => {
	res.status(404).json({ error: "Endpoint not found" });
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
	} catch (error) {
		console.error("❌ Failed to start server:", error.message);
		console.error("💡 Make sure Docker Desktop is running");
		process.exit(1);
	}
}

startServer();

module.exports = app;
