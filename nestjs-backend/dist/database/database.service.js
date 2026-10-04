"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const secrets_1 = require("../common/utils/secrets");
/**
 * Reads a pool tuning knob from the environment.
 *
 * Falls back to `fallback` on a missing, non-numeric or out-of-range value rather
 * than handing NaN to `pg`, which would otherwise silently produce a pool that
 * cannot connect.
 */
function parsePoolInt(name, fallback, min) {
    const raw = String(process.env[name] ?? "").trim();
    if (raw === "")
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
        return fallback;
    }
    return parsed;
}
let DatabaseService = DatabaseService_1 = class DatabaseService {
    logger = new common_1.Logger(DatabaseService_1.name);
    pool;
    constructor() {
        const STRICT_SERVICE_DB_CREDENTIALS = String(process.env.STRICT_SERVICE_DB_CREDENTIALS || "false")
            .trim()
            .toLowerCase() === "true";
        const BACKEND_DB_USER = String(process.env.BACKEND_DB_USER || "").trim();
        const ROOT_DB_USER = String(process.env.DB_USER || "filspresso_user").trim();
        const DB_USER = BACKEND_DB_USER || ROOT_DB_USER;
        const BACKEND_DB_PASSWORD = (0, secrets_1.getEnvOrFile)("BACKEND_DB_PASSWORD", { required: false, defaultValue: "" });
        const ROOT_DB_PASSWORD = (0, secrets_1.getEnvOrFile)("DB_PASSWORD", { required: true });
        const DB_PASSWORD = BACKEND_DB_PASSWORD || ROOT_DB_PASSWORD;
        if (STRICT_SERVICE_DB_CREDENTIALS) {
            if (!BACKEND_DB_USER)
                throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_USER");
            if (BACKEND_DB_USER === ROOT_DB_USER)
                throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_USER to differ from DB_USER");
            if (!BACKEND_DB_PASSWORD)
                throw new Error("STRICT_SERVICE_DB_CREDENTIALS=true requires BACKEND_DB_PASSWORD or BACKEND_DB_PASSWORD_FILE");
        }
        this.pool = new pg_1.Pool({
            host: process.env.DB_HOST || "localhost",
            port: Number.parseInt(process.env.DB_PORT || "5432", 10),
            database: process.env.DB_NAME || "filspresso",
            user: DB_USER,
            password: DB_PASSWORD,
            // Pool sizing is configuration, not a constant. The default stays at the
            // historical 20 so behaviour is unchanged until it is tuned deliberately:
            // Postgres allows max_connections=100 by default, so the replica count
            // times DB_POOL_MAX must stay under that or replicas will start failing
            // to connect rather than merely queueing.
            max: parsePoolInt("DB_POOL_MAX", 20, 1),
            min: parsePoolInt("DB_POOL_MIN", 2, 0),
            idleTimeoutMillis: parsePoolInt("DB_POOL_IDLE_TIMEOUT_MS", 30_000, 0),
            connectionTimeoutMillis: 3000,
            statement_timeout: 30000,
            query_timeout: 30000,
            application_name: "filspresso-nestjs-backend",
        });
        // node-postgres emits 'error' on the pool when an *idle* client fails --
        // a Postgres restart, a network blip, an admin terminating the connection.
        // Without a listener Node treats that as an unhandled 'error' event and
        // rethrows, killing the entire process ("throw er; // Unhandled 'error'
        // event"), which is what crash-looped this service. The pool already
        // discards the bad client and opens a fresh one on the next query, so the
        // correct response is to log and keep serving, not to exit.
        this.pool.on("error", (err) => {
            this.logger.error(`Unexpected idle PostgreSQL client error: ${err.message}`);
        });
        this.pool
            .query("SELECT NOW()")
            .then(() => this.logger.log("✅ Connected to PostgreSQL database"))
            .catch((err) => this.logger.error("❌ Failed to connect to PostgreSQL:", err.message));
    }
    getPool() {
        return this.pool;
    }
    /**
     * Closes every pooled connection.
     *
     * Called during graceful shutdown. `pool.end()` drains in-flight queries and
     * resolves when the last client is released; without it the process exits with
     * sockets still open, which is what produces "server closed the connection
     * unexpectedly" for a checkout that was mid-write when SIGTERM arrived.
     */
    async endPool() {
        try {
            await this.pool.end();
            this.logger.log("PostgreSQL pool closed cleanly");
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to close the PostgreSQL pool cleanly: ${detail}`);
        }
    }
    async checkHealth() {
        let client;
        try {
            client = await this.pool.connect();
            await client.query("SELECT 1");
            return { isUp: true, error: null };
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            return { isUp: false, error: detail || "Database health check failed" };
        }
        finally {
            if (client) {
                client.release();
            }
        }
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = DatabaseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DatabaseService);
