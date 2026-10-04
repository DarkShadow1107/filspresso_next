import "reflect-metadata";
import fs from "node:fs";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import compression from "compression";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { DatabaseService } from "./database/database.service";
import { DEFAULT_PORT, DEFAULT_REQUEST_TIMEOUT_MS, resolveLogLevel } from "./config/constants";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";

import { originGuardMiddleware } from "./common/middleware/origin-guard.middleware";
import { createRequestTimeoutMiddleware } from "./common/middleware/request-timeout.middleware";
import { parseConfiguredOrigins, isAllowedCorsOrigin } from "./common/utils/cors-origin";
import * as dockerManager from "./common/utils/dockerManager";
import { ensureAppSchema } from "./database/ensureAppSchema";
import { TrimStringsPipe } from "./common/pipes/trim-strings.pipe";

const logger = new Logger("Bootstrap");

function applyTrustProxy(
	expressInstance: {
		set: (key: string, value: boolean | number) => void;
	},
	trustProxyRaw: string | undefined,
): void {
	if (trustProxyRaw === "true") {
		expressInstance.set("trust proxy", true);
	} else if (trustProxyRaw === "false" || trustProxyRaw === "0") {
		expressInstance.set("trust proxy", false);
	} else if (trustProxyRaw && !Number.isNaN(Number.parseInt(trustProxyRaw, 10))) {
		expressInstance.set("trust proxy", Number.parseInt(trustProxyRaw, 10));
	}
}

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, { bufferLogs: true });
	const configService = app.get(ConfigService);
	const expressInstance = app.getHttpAdapter().getInstance() as {
		set: (key: string, value: boolean | number) => void;
		disable: (key: string) => void;
	};

	applyTrustProxy(expressInstance, configService.get<string>("trustProxy"));
	expressInstance.disable("x-powered-by");

	// The app is created with bufferLogs: true, but nothing ever called
	// useLogger(), so the log level was hardcoded to Nest's default. LOG_LEVEL
	// now actually controls it: set `verbose` when Phase 0 request-timing
	// instrumentation needs to be observed.
	const logLevel = resolveLogLevel(process.env.LOG_LEVEL);
	// useLogger() takes a LogLevel[] (the set of enabled levels), not a single level.
	app.useLogger([logLevel]);
	logger.log(`Logger level: ${logLevel}`);

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

	app.use(requestIdMiddleware);

	const configuredOrigins = parseConfiguredOrigins(configService.get<string>("corsOrigin") || "http://localhost:3000");
	const isProduction = configService.get<string>("nodeEnv") === "production";
	app.enableCors({
		origin: (origin, callback) => {
			const candidate = String(origin || "").trim();
			if (!candidate || isAllowedCorsOrigin(candidate, configuredOrigins, isProduction)) {
				callback(null, true);
				return;
			}
			callback(new Error("Not allowed by CORS"), false);
		},
		credentials: true,
	});

	

	app.use(json({ limit: "10mb", strict: true }));
	app.use(urlencoded({ extended: true }));
	app.use(compression({ level: 6, threshold: 1024 }));
	app.use(originGuardMiddleware);

	app.use(createRequestTimeoutMiddleware(configService.get<number>("requestTimeoutMs") || DEFAULT_REQUEST_TIMEOUT_MS));

	app.useGlobalPipes(
		new TrimStringsPipe(),
		new ValidationPipe({
			transform: true,
			whitelist: true,
			forbidUnknownValues: false,
		}),
	);
	app.useGlobalFilters(new HttpExceptionFilter());

	const runningInDocker = fs.existsSync("/.dockerenv");
	if (runningInDocker) {
		logger.log("Running inside Docker. Postgres is managed by compose.");
	} else {
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
	const shutdownTimeoutMs = Math.max(
		1_000,
		Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "25000", 10) || 25_000,
	);
	let shuttingDown = false;
	const gracefulShutdown = async (signal: string) => {
		if (shuttingDown) return;
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
			const db = app.get(DatabaseService, { strict: false });
			await db.endPool();
			logger.log("Graceful shutdown complete");
			process.exit(0);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			logger.error(`Graceful shutdown failed: ${detail}`);
			process.exit(1);
		}
	};
	process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
	process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

	const strictServiceDbCredentials =
		String(process.env.STRICT_SERVICE_DB_CREDENTIALS || "false")
			.trim()
			.toLowerCase() === "true";
	const appSchemaBootstrapEnabled =
		String(process.env.APP_SCHEMA_BOOTSTRAP_ENABLED || (strictServiceDbCredentials ? "false" : "true"))
			.trim()
			.toLowerCase() === "true";

	if (appSchemaBootstrapEnabled) {
		const db = app.get(DatabaseService);
		await ensureAppSchema(db.getPool());
	} else {
		logger.log("App schema bootstrap disabled (APP_SCHEMA_BOOTSTRAP_ENABLED=false). Using managed migrations.");
	}

	const port = configService.get<number>("port") || DEFAULT_PORT;
	await app.listen(port);

	logger.log(`Filspresso NestJS backend running on port ${port}`);
	logger.log(`Health check: http://localhost:${port}/health`);
}

bootstrap().catch((error) => {
	const detail = error instanceof Error ? error.message : String(error);
	logger.error(`Failed to start NestJS backend: ${detail}`);
	process.exit(1);
});
