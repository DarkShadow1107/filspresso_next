"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const throttler_storage_redis_1 = require("@nest-lab/throttler-storage-redis");
const redis_url_1 = require("../utils/redis-url");
const constants_1 = require("../../config/constants");
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
let RateLimitModule = class RateLimitModule {
};
exports.RateLimitModule = RateLimitModule;
exports.RateLimitModule = RateLimitModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            throttler_1.ThrottlerModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (configService) => {
                    const redisUrl = (0, redis_url_1.resolveRedisUrl)();
                    return {
                        throttlers: [
                            {
                                name: "default",
                                ttl: configService.get("apiRateLimitWindowMs") ??
                                    constants_1.DEFAULT_API_RATE_LIMIT_WINDOW_MS,
                                limit: configService.get("apiRateLimitMax") ??
                                    constants_1.DEFAULT_API_RATE_LIMIT_MAX,
                            },
                        ],
                        ...(redisUrl ? { storage: new throttler_storage_redis_1.ThrottlerStorageRedisService(redisUrl) } : {}),
                    };
                },
            }),
        ],
        providers: [
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
        ],
        exports: [throttler_1.ThrottlerModule],
    })
], RateLimitModule);
