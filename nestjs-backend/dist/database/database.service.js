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
let DatabaseService = DatabaseService_1 = class DatabaseService {
    logger = new common_1.Logger(DatabaseService_1.name);
    pool;
    constructor() {
        const STRICT_SERVICE_DB_CREDENTIALS = String(process.env.STRICT_SERVICE_DB_CREDENTIALS || "false").trim().toLowerCase() === "true";
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
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        this.pool
            .query("SELECT NOW()")
            .then(() => this.logger.log("✅ Connected to PostgreSQL database"))
            .catch((err) => this.logger.error("❌ Failed to connect to PostgreSQL:", err.message));
    }
    getPool() {
        return this.pool;
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
