import "./test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import configuration from "../src/config/configuration";
import { envValidationSchema } from "../src/config/env.validation";

test("Nest Config v4 retains custom configuration and Joi-validated environment values", async () => {
	const keys = ["NODE_ENV", "PORT", "CORS_ORIGIN", "API_RATE_LIMIT_MAX"] as const;
	const original = new Map(keys.map((key) => [key, process.env[key]]));
	process.env.NODE_ENV = "test";
	process.env.PORT = "4317";
	process.env.CORS_ORIGIN = "https://app.example.test";
	process.env.API_RATE_LIMIT_MAX = "2400";

	@Module({
		imports: [ConfigModule.forRoot({
			isGlobal: true,
			ignoreEnvFile: true,
			load: [configuration],
			validationSchema: envValidationSchema,
			validationOptions: { abortEarly: false },
		})],
	})
	class ConfigCompatFixtureModule {}

	let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
	try {
		app = await NestFactory.createApplicationContext(ConfigCompatFixtureModule, { logger: false });
		const config = app.get(ConfigService);
		assert.equal(config.get<string>("nodeEnv"), "test");
		assert.equal(config.get<number>("port"), 4317);
		assert.equal(config.get<string>("corsOrigin"), "https://app.example.test");
		assert.equal(config.get<number>("apiRateLimitMax"), 2400);
	} finally {
		await app?.close();
		for (const [key, value] of original) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
