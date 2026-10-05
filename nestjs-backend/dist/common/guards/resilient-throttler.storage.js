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
var ResilientThrottlerStorage_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResilientThrottlerStorage = void 0;
const common_1 = require("@nestjs/common");
/**
 * How long one request will wait for Redis before counting locally.
 *
 * Short enough that a handful of concurrent requests cannot pile up behind it, long
 * enough that a normal Redis round trip (sub-millisecond on a local network) never
 * comes close. A request that misses this still gets a correct count -- just from the
 * local map.
 */
const DELEGATE_DEADLINE_MS = 750;
/** How long to stay off Redis after a failure, before spending one probe. */
const COOLDOWN_MS = 10_000;
/**
 * Rate-limit counter storage that keeps working when Redis does not.
 *
 * Phase 9 V4. With `@nestjs-lab/throttler-storage-redis` as the only storage, stopping
 * Redis made *every* authenticated route return
 *
 *   503 {"error":"Request timed out"}
 *
 * because that package queues commands while the socket is down. The queue never
 * drained, `ThrottlerGuard` blocked inside `increment()`, the request-timeout
 * middleware fired, and no route ever ran -- including the ones whose session lookup
 * has a perfectly good Postgres fallback. A cache outage became a total outage, which
 * is the opposite of what a cache is for.
 *
 * So: Redis when it answers, an in-process map when it does not. That degrades the
 * guarantee from "shared across replicas" to "per replica" for the duration of the
 * outage, which is the same trade the rate-limit module already documents for the
 * no-REDIS_URL case. It never degrades to "no limit at all", and it never blocks.
 *
 * This is deliberately NOT the same trade as the session store, which must fail
 * *closed*: an unauthenticated request is a security problem, an uncounted request is
 * a capacity problem.
 */
let ResilientThrottlerStorage = ResilientThrottlerStorage_1 = class ResilientThrottlerStorage {
    logger = new common_1.Logger(ResilientThrottlerStorage_1.name);
    memory = new Map();
    delegate = null;
    factory = null;
    retryDelegateAt = 0;
    lastWarnedAt = 0;
    constructor() {
        this.sweepTimer = setInterval(() => this.sweep(), 30_000);
        // Never hold the process open for a cache sweep.
        this.sweepTimer.unref?.();
    }
    sweepTimer;
    /**
     * Attach the shared counter store.
     *
     * A factory rather than a constructor argument so the module can build the Redis
     * client only when REDIS_URL is actually configured, and so this stays usable in
     * tests with no Redis at all.
     */
    useRedis(factory) {
        this.factory = factory;
        try {
            this.delegate = factory();
        }
        catch (err) {
            this.logger.warn(`Could not build the Redis throttler storage; rate limits will be per replica: ${err instanceof Error ? err.message : String(err)}`);
            this.delegate = null;
        }
    }
    async increment(key, ttl, limit, blockDuration, throttlerName) {
        if (this.delegate && Date.now() >= this.retryDelegateAt) {
            try {
                // A deadline, not just a catch. `@nestjs-lab/throttler-storage-redis`
                // does not reject when Redis is unreachable -- it parks the command on
                // its offline queue and the returned promise never settles. So
                // try/catch alone never fires, `ThrottlerGuard` blocks forever inside
                // increment(), and the request-timeout middleware turns every route
                // into 503. Racing the delegate is what actually unblocks the request.
                return await this.withDeadline(this.delegate.increment(key, ttl, limit, blockDuration, throttlerName));
            }
            catch (err) {
                this.tripDelegate(err);
            }
        }
        else if (this.delegate) {
            // Inside the cooldown: skip Redis entirely so no request pays the deadline.
            this.tripDelegate(null, true);
        }
        return this.incrementInMemory(key, ttl, limit, blockDuration);
    }
    /** Resolve to the delegate's answer, or reject if it takes longer than the budget. */
    withDeadline(work) {
        let timer;
        const deadline = new Promise((_, reject) => {
            // Deliberately NOT unref'd. This timer is the only thing that guarantees the
            // caller gets an answer when the delegate never settles, so it has to keep
            // the loop alive for its full 750ms. It is cleared in the finally below,
            // so it never outlives the request it belongs to.
            timer = setTimeout(() => reject(new Error("throttler storage deadline exceeded")), DELEGATE_DEADLINE_MS);
        });
        return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
    }
    /**
     * Stop using Redis for a cooldown.
     *
     * Without the cooldown, every single request during an outage would pay the full
     * deadline before falling back, which turns a cache outage into a latency outage
     * on top of the availability one.
     */
    tripDelegate(err, silent = false) {
        if (!silent) {
            const now = Date.now();
            if (now - this.lastWarnedAt > 30_000) {
                this.lastWarnedAt = now;
                this.logger.warn(`Redis throttler storage unusable (${err instanceof Error ? err.message : String(err)}); counting in-process for ${COOLDOWN_MS / 1000}s`);
            }
        }
        this.retryDelegateAt = Date.now() + COOLDOWN_MS;
        if (this.factory) {
            try {
                this.delegate = this.factory();
            }
            catch {
                this.delegate = null;
            }
        }
        else {
            this.delegate = null;
        }
    }
    incrementInMemory(key, ttl, limit, blockDuration) {
        const now = Date.now();
        const ttlMs = ttl > 1000 ? ttl : ttl * 1000;
        const blockMs = blockDuration > 1000 ? blockDuration : blockDuration * 1000;
        let entry = this.memory.get(key);
        if (!entry || entry.expiresAt <= now) {
            entry = { totalHits: 0, expiresAt: now + ttlMs, isBlocked: false, blockExpiresAt: 0 };
            this.memory.set(key, entry);
        }
        entry.totalHits += 1;
        let isBlocked = false;
        if (entry.blockExpiresAt > now) {
            isBlocked = true;
        }
        else if (entry.totalHits > limit) {
            isBlocked = true;
            entry.blockExpiresAt = now + blockMs;
            entry.isBlocked = true;
        }
        const timeToExpire = Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
        const timeToBlockExpire = entry.blockExpiresAt > now ? Math.ceil((entry.blockExpiresAt - now) / 1000) : 0;
        return {
            totalHits: entry.totalHits,
            timeToExpire,
            isBlocked,
            timeToBlockExpire,
        };
    }
    sweep() {
        const now = Date.now();
        for (const [key, entry] of this.memory) {
            if (entry.blockExpiresAt <= now && entry.expiresAt <= now) {
                this.memory.delete(key);
            }
        }
    }
    onModuleDestroy() {
        clearInterval(this.sweepTimer);
        this.memory.clear();
    }
};
exports.ResilientThrottlerStorage = ResilientThrottlerStorage;
exports.ResilientThrottlerStorage = ResilientThrottlerStorage = ResilientThrottlerStorage_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ResilientThrottlerStorage);
