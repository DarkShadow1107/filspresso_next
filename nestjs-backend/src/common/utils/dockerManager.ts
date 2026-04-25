import { exec } from "child_process";
import * as path from "path";

const CONTAINER_NAME = "filspresso_postgres";
const COMPOSE_FILE = path.resolve(__dirname, "../../../../docker-compose.yml");

function execAsync(command: string): Promise<string> {
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

export async function isDockerRunning() {
  try {
    await execAsync("docker info");
    return true;
  } catch {
    return false;
  }
}

export async function containerExists() {
  try {
    const result = await execAsync(`docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`);
    return result.includes(CONTAINER_NAME);
  } catch {
    return false;
  }
}

export async function isContainerRunning() {
  try {
    const result = await execAsync(
      `docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" --format "{{.Names}}"`,
    );
    return result.includes(CONTAINER_NAME);
  } catch {
    return false;
  }
}

export async function isContainerHealthy() {
  try {
    const result = await execAsync(`docker inspect --format="{{.State.Health.Status}}" ${CONTAINER_NAME}`);
    return result === "healthy";
  } catch {
    return false;
  }
}

export async function waitForHealthy(timeoutMs = 60000) {
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

export async function startContainer() {
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
    console.log("🔄 Starting existing container...");
    await execAsync(`docker start ${CONTAINER_NAME}`);
  } else {
    console.log("📦 Creating PostgreSQL container...");
    await execAsync(`docker compose -f "${COMPOSE_FILE}" up -d postgres`);
  }

  process.stdout.write("⏳ Waiting for PostgreSQL to be healthy");
  const healthy = await waitForHealthy(60000);
  console.log();

  if (healthy) {
    console.log("✅ PostgreSQL container is healthy and ready");
    return true;
  } else {
    console.log("⚠️ PostgreSQL container started but health check timed out");
    return true;
  }
}

export async function stopContainer() {
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

export function setupShutdownHandlers() {
  const shutdown = async (signal: string) => {
    console.log(`\\n📴 Received ${signal}, shutting down...`);
    await stopContainer();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

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
