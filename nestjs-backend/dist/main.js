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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const node_fs_1 = __importDefault(require("node:fs"));
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const helmet_1 = __importDefault(require("helmet"));
const express_1 = require("express");
const app_module_1 = require("./app.module");
const database_service_1 = require("./database/database.service");
const constants_1 = require("./config/constants");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
const request_id_middleware_1 = require("./common/middleware/request-id.middleware");
const global_rate_limit_middleware_1 = require("./common/middleware/global-rate-limit.middleware");
const origin_guard_middleware_1 = require("./common/middleware/origin-guard.middleware");
const request_timeout_middleware_1 = require("./common/middleware/request-timeout.middleware");
const cors_origin_1 = require("./common/utils/cors-origin");
const dockerManager = __importStar(require("./common/utils/dockerManager"));
const ensureAppSchema_1 = require("./database/ensureAppSchema");
const trim_strings_pipe_1 = require("./common/pipes/trim-strings.pipe");
const logger = new common_1.Logger("Bootstrap");
function applyTrustProxy(expressInstance, trustProxyRaw) {
    if (trustProxyRaw === "true") {
        expressInstance.set("trust proxy", true);
    }
    else if (trustProxyRaw === "false" || trustProxyRaw === "0") {
        expressInstance.set("trust proxy", false);
    }
    else if (trustProxyRaw && !Number.isNaN(Number.parseInt(trustProxyRaw, 10))) {
        expressInstance.set("trust proxy", Number.parseInt(trustProxyRaw, 10));
    }
}
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    const configService = app.get(config_1.ConfigService);
    const expressInstance = app.getHttpAdapter().getInstance();
    applyTrustProxy(expressInstance, configService.get("trustProxy"));
    expressInstance.disable("x-powered-by");
    app.use((0, helmet_1.default)({
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
    }));
    app.use(request_id_middleware_1.requestIdMiddleware);
    const configuredOrigins = (0, cors_origin_1.parseConfiguredOrigins)(configService.get("corsOrigin") || "http://localhost:3000");
    const isProduction = configService.get("nodeEnv") === "production";
    app.enableCors({
        origin: (origin, callback) => {
            const candidate = String(origin || "").trim();
            if (!candidate || (0, cors_origin_1.isAllowedCorsOrigin)(candidate, configuredOrigins, isProduction)) {
                callback(null, true);
                return;
            }
            callback(new Error("Not allowed by CORS"), false);
        },
        credentials: true,
    });
    if ((0, global_rate_limit_middleware_1.shouldEnableGlobalRateLimit)()) {
        app.use("/api/", (0, global_rate_limit_middleware_1.createGlobalRateLimiter)());
    }
    else {
        logger.warn("Global API rate limiting disabled (non-production mode or explicit disable). Route-specific limiters remain active.");
    }
    app.use((0, express_1.json)({ limit: "10mb", strict: true }));
    app.use((0, express_1.urlencoded)({ extended: true }));
    app.use(origin_guard_middleware_1.originGuardMiddleware);
    app.use((0, request_timeout_middleware_1.createRequestTimeoutMiddleware)(configService.get("requestTimeoutMs") || constants_1.DEFAULT_REQUEST_TIMEOUT_MS));
    app.useGlobalPipes(new trim_strings_pipe_1.TrimStringsPipe(), new common_1.ValidationPipe({
        transform: true,
        whitelist: true,
        forbidUnknownValues: false,
    }));
    app.useGlobalFilters(new http_exception_filter_1.HttpExceptionFilter());
    const runningInDocker = node_fs_1.default.existsSync("/.dockerenv");
    if (runningInDocker) {
        logger.log("Running inside Docker. Postgres is managed by compose.");
    }
    else {
        await dockerManager.startContainer();
        dockerManager.setupShutdownHandlers();
    }
    const strictServiceDbCredentials = String(process.env.STRICT_SERVICE_DB_CREDENTIALS || "false")
        .trim()
        .toLowerCase() === "true";
    const appSchemaBootstrapEnabled = String(process.env.APP_SCHEMA_BOOTSTRAP_ENABLED || (strictServiceDbCredentials ? "false" : "true"))
        .trim()
        .toLowerCase() === "true";
    if (appSchemaBootstrapEnabled) {
        const db = app.get(database_service_1.DatabaseService);
        await (0, ensureAppSchema_1.ensureAppSchema)(db.getPool());
    }
    else {
        logger.log("App schema bootstrap disabled (APP_SCHEMA_BOOTSTRAP_ENABLED=false). Using managed migrations.");
    }
    const port = configService.get("port") || constants_1.DEFAULT_PORT;
    await app.listen(port);
    logger.log(`Filspresso NestJS backend running on port ${port}`);
    logger.log(`Health check: http://localhost:${port}/health`);
}
bootstrap().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start NestJS backend: ${detail}`);
    process.exit(1);
});
