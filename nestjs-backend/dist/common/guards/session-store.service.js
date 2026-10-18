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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var SessionStoreService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionStoreService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const database_service_1 = require("../../database/database.service");
const auth_tokens_1 = require("../utils/auth-tokens");
const redis_url_1 = require("../utils/redis-url");
/**
 * Redis-backed session store (PLAN_NESTJS_SCALING.md Phase 3).
 *
 * The per-request `SELECT ... FROM user_sessions` that every authenticated call
 * performed is the single hottest query in the service. This removes it from the
 * hot path while keeping revocation *immediate*, which is the security property
 * that matters:
 *
 * - Keys are `sess:<sha256(token)>`, reusing the existing hash, so a raw token is
 *   never stored in Redis (and a Redis dump cannot be replayed as a session).
 * - The value carries no authority: the JWT signature and `exp` are still verified
 *   on every request. Redis only answers "is this session still live?", which is
 *   exactly the question Postgres was being asked.
 * - Logout and revoke issue an explicit `DEL`, so there is **no cache window**.
 *   A plain TTL cache would widen revocation to the TTL; this does not.
 * - On a Redis miss the Postgres row is consulted and Redis is repopulated, so a
 *   Redis restart self-heals instead of logging everyone out.
 * - If Redis is unavailable the service degrades to Postgres: slower, never
 *   unauthenticated. Failing open here would be a security regression.
 */
let SessionStoreService = SessionStoreService_1 = class SessionStoreService {
    db;
    logger = new common_1.Logger(SessionStoreService_1.name);
    redis;
    redisUrl;
    constructor(db) {
        this.db = db;
        this.redisUrl = (0, redis_url_1.resolveRedisUrl)();
        if (!this.redisUrl) {
            this.logger.warn("REDIS_URL is not set; every session lookup will fall back to Postgres");
            this.redis = null;
            return;
        }
        // lazyConnect so a Redis outage at boot cannot crash the process.
        this.redis = new ioredis_1.default(this.redisUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 2,
            enableOfflineQueue: false,
            connectTimeout: 2000,
        });
        // Without a listener ioredis emits an unhandled 'error' event and kills the
        // process -- the same class of bug as the missing pg pool listener.
        this.redis.on("error", (err) => {
            this.logger.warn(`Redis session store error: ${err.message}`);
        });
    }
    static keyFor(token) {
        return SessionStoreService_1.keyForHash((0, auth_tokens_1.hashSessionToken)(token));
    }
    /**
     * Key for an already-hashed token.
     *
     * The DB stores the same hash in `user_sessions.session_token_hash`, so a
     * revoke that only knows the row (logout-all, revoke-by-id) can compute the
     * key without the raw token ever being available.
     */
    static keyForHash(sessionTokenHash) {
        return `sess:${sessionTokenHash}`;
    }
    /** Whole seconds until `expiresAt`, never below 1. */
    static ttlFor(expiresAt) {
        return Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    }
    /**
     * Seconds left on the token itself, or null if the payload cannot be read.
     *
     * This is deliberately a decode, not a verification: the token was just minted
     * in-process, and the value is only used to bound a cache TTL. It grants no
     * authority, because `ActiveSessionService` still runs `verifyToken` (which
     * enforces `exp`) before the cache is ever consulted.
     *
     * It matters because `JWT_EXPIRES_IN` (15m) is far shorter than
     * `AUTH_SESSION_IDLE_TIMEOUT_DAYS` (30d). Keying the TTL off the row alone left
     * a 15-minute token holding a 30-day cache entry.
     */
    static tokenTtlFor(token) {
        const segments = token.split(".");
        if (segments.length !== 3)
            return null;
        try {
            const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
            if (typeof payload.exp !== "number")
                return null;
            return Math.floor(payload.exp - Date.now() / 1000);
        }
        catch {
            return null;
        }
    }
    /**
     * The TTL for a cached session: the shorter of the row's and the token's.
     *
     * Both write paths (login and the Postgres-fallback repopulate) MUST go through
     * this. They disagreed once -- the login path used the token lifetime while the
     * fallback used the row's -- which meant a cache flush silently re-seeded
     * 30-day entries for 15-minute tokens. One function makes that impossible.
     *
     * Both bounds are needed. The row is usually longer (30d idle timeout vs a 15m
     * token), but if a deployment ever inverts that, a token-only bound would keep
     * caching a session whose row has already been reaped.
     *
     * Returns 0 when neither bound is usable, meaning "do not cache".
     */
    static ttlForSession(rowTtlSeconds, token) {
        const rowTtl = rowTtlSeconds === null ? null : Math.floor(rowTtlSeconds);
        const tokenTtl = SessionStoreService_1.tokenTtlFor(token);
        if (rowTtl === null && tokenTtl === null)
            return 0;
        if (rowTtl === null)
            return Math.max(0, tokenTtl);
        if (tokenTtl === null)
            return Math.max(0, rowTtl);
        return Math.max(0, Math.min(rowTtl, tokenTtl));
    }
    /** Seconds until `expiresAt`, or null when there is no row bound to apply. */
    static rowTtlSeconds(expiresAt) {
        if (!expiresAt)
            return null;
        return Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    }
    /**
     * Insert the `user_sessions` row and cache it in one step.
     *
     * Owning both halves here is deliberate: the row write and the cache write
     * must not drift, and every login path (register, password login, MFA
     * completion, OAuth, admin login) needs both. The INSERT is its own
     * transaction on the pooled connection, so by the time it resolves the row is
     * committed and it is safe to cache.
     *
     * `user_sessions` stays authoritative; the cache is a fast path over it.
     */
    async createAndCache(client, params) {
        const device = params.device ?? null;
        const isDesktop = Boolean(device);
        // A browser session has no refresh credential, so an unexpired row must still be
        // allowed to be null in that column. Desktop rows are the opposite: a refresh token
        // that is absent would leave the app unable to stay signed in, and is better to fail
        // loudly at creation than silently at the first refresh.
        const refreshHash = params.refreshToken ? (0, auth_tokens_1.hashSessionToken)(params.refreshToken) : null;
        const result = await client.query(`INSERT INTO user_sessions
			   (account_id, session_token_hash, expires_at, ip_address, user_agent,
			    device_id, device_name, platform, app_version, client_type,
			    refresh_token_hash, refresh_expires_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			 RETURNING id`, [
            params.accountId,
            (0, auth_tokens_1.hashSessionToken)(params.token),
            params.expiresAt,
            params.ipAddress,
            params.userAgent,
            device?.id ?? null,
            device?.name ?? null,
            device?.platform ?? null,
            device?.appVersion ?? null,
            isDesktop ? "desktop" : "web",
            refreshHash,
            params.refreshExpiresAt ?? null,
        ]);
        const sessionId = Number(result.rows[0]?.id ?? 0);
        if (sessionId) {
            const ttl = SessionStoreService_1.ttlForSession(SessionStoreService_1.rowTtlSeconds(params.expiresAt), params.token);
            if (ttl > 0) {
                await this.put(params.token, { sessionId, accountId: Number(params.accountId) }, ttl);
            }
        }
        return sessionId;
    }
    async healthy() {
        if (!this.redis)
            return false;
        try {
            if (this.redis.status === "wait")
                await this.redis.connect();
            return this.redis.status === "ready";
        }
        catch {
            return false;
        }
    }
    /** Cache a live session. Best-effort: a failure must not fail the login. */
    async put(token, session, ttlSeconds) {
        if (!(await this.healthy()) || ttlSeconds <= 0)
            return;
        try {
            await this.redis.set(SessionStoreService_1.keyFor(token), JSON.stringify(session), "EX", Math.max(1, Math.floor(ttlSeconds)));
        }
        catch (err) {
            this.logger.warn(`Could not cache session: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * Remove a session from the cache. This is what makes revocation instant.
     * Called before the Postgres delete so the window is not widened.
     */
    async invalidate(token) {
        await this.invalidateHash((0, auth_tokens_1.hashSessionToken)(token));
    }
    /** As `invalidate`, for callers that only hold the stored hash. */
    async invalidateHash(sessionTokenHash) {
        if (!(await this.healthy()))
            return;
        try {
            await this.redis.del(SessionStoreService_1.keyForHash(sessionTokenHash));
        }
        catch (err) {
            this.logger.warn(`Could not invalidate cached session: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** Remove every cached session for an account (logout-all). */
    async invalidateAllForAccount(accountId) {
        if (!(await this.healthy()))
            return;
        try {
            // Sessions are namespaced by token hash, so account-wide invalidation
            // uses the fact that the value carries the accountId. SCAN rather than
            // KEYS so this never blocks the Redis event loop.
            let cursor = "0";
            do {
                const [next, keys] = await this.redis.scan(cursor, "MATCH", "sess:*", "COUNT", 200);
                cursor = next;
                if (!keys.length)
                    continue;
                const values = await this.redis.mget(...keys);
                const doomed = keys.filter((_key, i) => {
                    try {
                        const parsed = JSON.parse(values[i] ?? "");
                        return Number(parsed.accountId) === Number(accountId);
                    }
                    catch {
                        return false;
                    }
                });
                if (doomed.length)
                    await this.redis.del(...doomed);
            } while (cursor !== "0");
        }
        catch (err) {
            this.logger.warn(`Could not invalidate account sessions: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * Resolve a token hash against the cache, falling back to Postgres.
     *
     * Returns null only when the session is genuinely not live. Postgres stays
     * authoritative: a cache hit is trusted because it was written from a real row
     * and is deleted on revoke, and a miss re-checks the row.
     */
    async findLiveSession(token) {
        const key = SessionStoreService_1.keyFor(token);
        if (await this.healthy()) {
            try {
                const raw = await this.redis.get(key);
                if (raw) {
                    return { hit: "cache", session: JSON.parse(raw) };
                }
            }
            catch {
                // fall through to Postgres
            }
        }
        const result = await this.db
            .getPool()
            .query(`SELECT s.id AS session_id,
				        s.account_id,
				        GREATEST(EXTRACT(EPOCH FROM (s.expires_at - NOW())), 0)::int
				          AS expires_in_seconds
				 FROM user_sessions s
				 WHERE s.session_token_hash = $1 AND s.expires_at > NOW()
				 LIMIT 1`, [(0, auth_tokens_1.hashSessionToken)(token)]);
        const row = result.rows[0];
        if (!row)
            return { hit: "none" };
        const session = {
            sessionId: Number(row.session_id),
            accountId: Number(row.account_id),
        };
        // Repopulate with the shorter of the row's remaining lifetime and the
        // token's, so the TTL can never outlive the credential it describes.
        if (await this.healthy()) {
            try {
                const rowTtl = Number.isFinite(Number(row.expires_in_seconds))
                    ? Math.floor(Number(row.expires_in_seconds))
                    : null;
                const ttl = SessionStoreService_1.ttlForSession(rowTtl, token);
                if (ttl > 0) {
                    await this.redis.set(key, JSON.stringify(session), "EX", ttl);
                }
            }
            catch {
                // best effort
            }
        }
        return { hit: "database", session };
    }
    async onModuleDestroy() {
        if (!this.redis)
            return;
        try {
            // quit() drains in-flight commands, unlike disconnect().
            await this.redis.quit();
        }
        catch {
            this.redis.disconnect();
        }
    }
};
exports.SessionStoreService = SessionStoreService;
exports.SessionStoreService = SessionStoreService = SessionStoreService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], SessionStoreService);
