/**
 * Filspresso Express.js API Server
 * Connects Next.js frontend with MariaDB database
 *
 * This server automatically manages the MariaDB Docker container:
 * - Starts the container when the server starts
 * - Stops the container when the server is shut down (Ctrl+C)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Docker container manager
const dockerManager = require("./utils/dockerManager");

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

const app = express();
const PORT = process.env.PORT || 4000;

// Security middleware
app.use(helmet());
app.use(
	cors({
		origin: process.env.CORS_ORIGIN || "http://localhost:3000",
		credentials: true,
	})
);

// Rate limiting
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // limit each IP to 100 requests per windowMs
	message: { error: "Too many requests, please try again later." },
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
if (
	process.env.NODE_ENV === "development" ||
	process.env.DISABLE_RATE_LIMIT_FOR_DEV === "true" ||
	process.env.DISABLE_RATE_LIMIT === "true"
) {
	console.log(
		"⚠️ Rate limiting disabled (development mode or DISABLE_RATE_LIMIT_FOR_DEV=true / DISABLE_RATE_LIMIT=true). Use route-specific rules for production."
	);
} else {
	app.use("/api/", limiter);
}

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
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
 * Start server with Docker container management
 * 1. Start MariaDB container (if not running)
 * 2. Setup shutdown handlers to stop container on exit
 * 3. Start Express server
 */
async function startServer() {
	try {
		// Start MariaDB container before starting the server
		await dockerManager.startContainer();

		// Setup handlers to stop container when server exits
		dockerManager.setupShutdownHandlers();

		// Start Express server
		app.listen(PORT, () => {
			console.log(`🚀 Filspresso Express API running on port ${PORT}`);
			console.log(`📊 Health check: http://localhost:${PORT}/health`);
			console.log(`💡 Press Ctrl+C to stop server and MariaDB container`);
		});
	} catch (error) {
		console.error("❌ Failed to start server:", error.message);
		console.error("💡 Make sure Docker Desktop is running");
		process.exit(1);
	}
}

startServer();

module.exports = app;
