import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";

import { resolveRedisUrl } from "../utils/redis-url";
import { ResilientThrottlerStorage } from "./resilient-throttler.storage";
import {
	DEFAULT_API_RATE_LIMIT_MAX,
	DEFAULT_API_RATE_LIMIT_WINDOW_MS,
} from "../../config/constants";

/**
 * Global rate limiting (PLAN_NESTJS_SCALING.md section 6).
 *
 * The counter store is Redis rather than the in-memory default because the
 * backend runs behind Caddy and may be scaled out: an in-memory counter gives
 * every replica its own budget, so the effective limit would quietly become
 * `limit x replicas`. Sharing the counter is the whole point.
 *
 * `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` were already declared and
 * validated but never read, which made them look tunable while being dead. They
 * now set the global default; per-route overrides live in
 * `config/rate-limit.policy.ts`.
 *
 * If no Redis URL is configured the in-memory store is used, which is
 * correct-but-per-replica rather than non-functional.
 *
 * Note this is *in addition to* the pre-existing per-identifier login lockout in
 * `auth_login_attempts`. The two are complementary: that one is per username and
 * escalates, this one is per client IP and bounds the total attempt rate.
 */
@Global()
@Module({
	imports: [
		ThrottlerModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => {
					const redisUrl = resolveRedisUrl();
					const storage = new ResilientThrottlerStorage();
					if (redisUrl) {
						storage.useRedis(() => new ThrottlerStorageRedisService(redisUrl));
					}
					return {
						throttlers: [
							{
								name: "default",
								ttl:
									configService.get<number>("apiRateLimitWindowMs") ??
									DEFAULT_API_RATE_LIMIT_WINDOW_MS,
								limit:
									configService.get<number>("apiRateLimitMax") ??
									DEFAULT_API_RATE_LIMIT_MAX,
							},
						],
						storage,
					};
			},
		}),
	],
	providers: [
		{
			provide: APP_GUARD,
			useClass: ThrottlerGuard,
		},
	],
	exports: [ThrottlerModule],
})
export class RateLimitModule {}