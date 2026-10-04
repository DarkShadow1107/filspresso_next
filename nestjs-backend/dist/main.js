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
const compression_1 = __importDefault(require("compression"));
const express_1 = require("express");
const app_module_1 = require("./app.module");
const database_service_1 = require("./database/database.service");
const constants_1 = require("./config/constants");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
const request_id_middleware_1 = require("./common/middleware/request-id.middleware");
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
    // The app is created with bufferLogs: true, but nothing ever called
    // useLogger(), so the log level was hardcoded to Nest's default. LOG_LEVEL
    // now actually controls it: set `verbose` when Phase 0 request-timing
    // instrumentation needs to be observed.
    const logLevel = (0, constants_1.resolveLogLevel)(process.env.LOG_LEVEL);
    // useLogger() takes a LogLevel[] (the set of enabled levels), not a single level.
    app.useLogger([logLevel]);
    logger.log(`Logger level: ${logLevel}`);
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
    app.use((0, express_1.json)({ limit: "10mb", strict: true }));
    app.use((0, express_1.urlencoded)({ extended: true }));
    app.use((0, compression_1.default)({ level: 6, threshold: 1024 }));
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
    // Phase 2 (PLAN_NESTJS_SCALING.md section 4). enableShutdownHooks() makes
    // onModuleDestroy run on SIGTERM, which is what clears the security
    // observability intervals -- without it they are never cleared and the
    // process is killed with timers still armed.
    //
    // This must be registered unconditionally. It used to live inside the
    // non-Docker branch, so in Docker (i.e. in every real deployment) the
    // graceful path never ran at all.
    app.enableShutdownHooks();
    // Bound the drain so `docker stop` does not escalate to SIGKILL partway
    // through a checkout or an in-flight order.
    const shutdownTimeoutMs = Math.max(1_000, Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "25000", 10) || 25_000);
    let shuttingDown = false;
    const gracefulShutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.log(`Received ${signal}; draining for up to ${shutdownTimeoutMs}ms`);
        const hardExit = setTimeout(() => {
            logger.warn("Graceful shutdown timed out; forcing exit");
            process.exit(1);
        }, shutdownTimeoutMs);
        // Do not let the timer itself keep the event loop alive.
        hardExit.unref();
        try {
            // Closes the listener first so no new connections are accepted, then
            // lets in-flight requests finish.
            await app.close();
            const db = app.get(database_service_1.DatabaseService, { strict: false });
            await db.endPool();
            logger.log("Graceful shutdown complete");
            process.exit(0);
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger.error(`Graceful shutdown failed: ${detail}`);
            process.exit(1);
        }
    };
    process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
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
