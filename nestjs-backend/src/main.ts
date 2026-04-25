import "reflect-metadata";
import fs from "node:fs";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { DatabaseService } from "./database/database.service";
import { DEFAULT_PORT, DEFAULT_REQUEST_TIMEOUT_MS } from "./config/constants";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { createGlobalRateLimiter, shouldEnableGlobalRateLimit } from "./common/middleware/global-rate-limit.middleware";
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

	if (shouldEnableGlobalRateLimit()) {
		app.use("/api/", createGlobalRateLimiter());
	} else {
		logger.warn(
			"Global API rate limiting disabled (non-production mode or explicit disable). Route-specific limiters remain active.",
		);
	}

	app.use(json({ limit: "10mb", strict: true }));
	app.use(urlencoded({ extended: true }));
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
