/**
 * Docker Container Manager
 * Manages PostgreSQL container lifecycle alongside Express server
 */

const { exec, spawn } = require("child_process");
const path = require("path");

const CONTAINER_NAME = "filspresso_next_postgres";
const COMPOSE_FILE = path.resolve(__dirname, "../../docker-compose.yml");

/**
 * Execute a command and return a promise
 */
function execAsync(command) {
	return new Promise((resolve, reject) => {
		exec(command, { windowsHide: true }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr || error.message));
			} else {
				resolve(stdout.trim());
			}
		});
	});
}

/**
 * Check if Docker daemon is running
 */
async function isDockerRunning() {
	try {
		await execAsync("docker info");
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if container exists
 */
async function containerExists() {
	try {
		const result = await execAsync(`docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`);
		return result.includes(CONTAINER_NAME);
	} catch {
		return false;
	}
}

/**
 * Check if container is running
 */
async function isContainerRunning() {
	try {
		const result = await execAsync(
			`docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" --format "{{.Names}}"`
		);
		return result.includes(CONTAINER_NAME);
	} catch {
		return false;
	}
}

/**
 * Check if container is healthy
 */
async function isContainerHealthy() {
	try {
		const result = await execAsync(`docker inspect --format="{{.State.Health.Status}}" ${CONTAINER_NAME}`);
		return result === "healthy";
	} catch {
		return false;
	}
}

/**
 * Wait for container to be healthy
 */
async function waitForHealthy(timeoutMs = 60000) {
	const startTime = Date.now();
	const checkInterval = 2000;

	while (Date.now() - startTime < timeoutMs) {
		if (await isContainerHealthy()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, checkInterval));
		process.stdout.write(".");
	}
	return false;
}

/**
 * Start the PostgreSQL container using docker compose
 */
async function startContainer() {
	console.log("🐳 Starting PostgreSQL container...");

	if (!(await isDockerRunning())) {
		throw new Error("Docker daemon is not running. Please start Docker Desktop first.");
	}

	const running = await isContainerRunning();
	if (running) {
		console.log("✅ PostgreSQL container is already running");
		return true;
	}

	const exists = await containerExists();
	if (exists) {
		// Container exists but stopped, start it
		console.log("🔄 Starting existing container...");
		await execAsync(`docker start ${CONTAINER_NAME}`);
	} else {
		// Create and start container using compose (only postgres service)
		console.log("📦 Creating PostgreSQL container...");
		await execAsync(`docker compose -f "${COMPOSE_FILE}" up -d postgres`);
	}

	// Wait for healthy status
	process.stdout.write("⏳ Waiting for PostgreSQL to be healthy");
	const healthy = await waitForHealthy(60000);
	console.log(); // newline after dots

	if (healthy) {
		console.log("✅ PostgreSQL container is healthy and ready");
		return true;
	} else {
		console.log("⚠️ PostgreSQL container started but health check timed out");
		// Still return true, the connection pool will retry
		return true;
	}
}

/**
 * Stop the PostgreSQL container
 */
async function stopContainer() {
	console.log("🛑 Stopping PostgreSQL container...");

	if (!(await isDockerRunning())) {
		console.log("⚠️ Docker daemon is not running");
		return;
	}

	const running = await isContainerRunning();
	if (!running) {
		console.log("ℹ️ PostgreSQL container is not running");
		return;
	}

	await execAsync(`docker stop ${CONTAINER_NAME}`);
	console.log("✅ PostgreSQL container stopped");
}

/**
 * Setup graceful shutdown handlers
 */
function setupShutdownHandlers() {
	const shutdown = async (signal) => {
		console.log(`\n📴 Received ${signal}, shutting down...`);
		await stopContainer();
		process.exit(0);
	};

	// Handle various shutdown signals
	process.on("SIGINT", () => shutdown("SIGINT")); // Ctrl+C
	process.on("SIGTERM", () => shutdown("SIGTERM")); // kill command
	process.on("SIGHUP", () => shutdown("SIGHUP")); // terminal closed

	// Windows-specific: handle Ctrl+C and close events
	if (process.platform === "win32") {
		const readline = require("readline");
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		rl.on("close", () => shutdown("close"));
		rl.on("SIGINT", () => shutdown("SIGINT"));
	}
}

module.exports = {
	startContainer,
	stopContainer,
	isContainerRunning,
	isContainerHealthy,
	isDockerRunning,
	setupShutdownHandlers,
};
