"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDockerRunning = isDockerRunning;
exports.containerExists = containerExists;
exports.isContainerRunning = isContainerRunning;
exports.isContainerHealthy = isContainerHealthy;
exports.waitForHealthy = waitForHealthy;
exports.startContainer = startContainer;
exports.stopContainer = stopContainer;
exports.setupShutdownHandlers = setupShutdownHandlers;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const CONTAINER_NAME = "filspresso_postgres";
const COMPOSE_FILE = path.resolve(__dirname, "../../../../docker-compose.yml");
function execAsync(command) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)(command, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            }
            else {
                resolve(stdout.trim());
            }
        });
    });
}
async function isDockerRunning() {
    try {
        await execAsync("docker info");
        return true;
    }
    catch {
        return false;
    }
}
async function containerExists() {
    try {
        const result = await execAsync(`docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`);
        return result.includes(CONTAINER_NAME);
    }
    catch {
        return false;
    }
}
async function isContainerRunning() {
    try {
        const result = await execAsync(`docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" --format "{{.Names}}"`);
        return result.includes(CONTAINER_NAME);
    }
    catch {
        return false;
    }
}
async function isContainerHealthy() {
    try {
        const result = await execAsync(`docker inspect --format="{{.State.Health.Status}}" ${CONTAINER_NAME}`);
        return result === "healthy";
    }
    catch {
        return false;
    }
}
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
        console.log("🔄 Starting existing container...");
        await execAsync(`docker start ${CONTAINER_NAME}`);
    }
    else {
        console.log("📦 Creating PostgreSQL container...");
        await execAsync(`docker compose -f "${COMPOSE_FILE}" up -d postgres`);
    }
    process.stdout.write("⏳ Waiting for PostgreSQL to be healthy");
    const healthy = await waitForHealthy(60000);
    console.log();
    if (healthy) {
        console.log("✅ PostgreSQL container is healthy and ready");
        return true;
    }
    else {
        console.log("⚠️ PostgreSQL container started but health check timed out");
        return true;
    }
}
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
function setupShutdownHandlers() {
    const shutdown = async (signal) => {
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
