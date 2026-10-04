import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { PoolClient } from "pg";
import Redis from "ioredis";

import { DatabaseService } from "../../database/database.service";
import { hashSessionToken } from "../utils/auth-tokens";
import { resolveRedisUrl } from "../utils/redis-url";

export type CachedSession = {
	sessionId: number;
	accountId: number;
};

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
@Injectable()
export class SessionStoreService implements OnModuleDestroy {
	private readonly logger = new Logger(SessionStoreService.name);
	private readonly redis: Redis | null;
	private readonly redisUrl: string;

	constructor(private readonly db: DatabaseService) {
		this.redisUrl = resolveRedisUrl();
		if (!this.redisUrl) {
			this.logger.warn(
				"REDIS_URL is not set; every session lookup will fall back to Postgres",
			);
			this.redis = null;
			return;
		}
		// lazyConnect so a Redis outage at boot cannot crash the process.
		this.redis = new Redis(this.redisUrl, {
			lazyConnect: true,
			maxRetriesPerRequest: 2,
			enableOfflineQueue: false,
			connectTimeout: 2000,
		});
		// Without a listener ioredis emits an unhandled 'error' event and kills the
		// process -- the same class of bug as the missing pg pool listener.
		this.redis.on("error", (err: Error) => {
			this.logger.warn(`Redis session store error: ${err.message}`);
		});
	}

	static keyFor(token: string): string {
		return SessionStoreService.keyForHash(hashSessionToken(token));
	}

	/**
	 * Key for an already-hashed token.
	 *
	 * The DB stores the same hash in `user_sessions.session_token_hash`, so a
	 * revoke that only knows the row (logout-all, revoke-by-id) can compute the
	 * key without the raw token ever being available.
	 */
	static keyForHash(sessionTokenHash: string): string {
		return `sess:${sessionTokenHash}`;
	}

	/** Whole seconds until `expiresAt`, never below 1. */
	static ttlFor(expiresAt: Date): number {
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
	static tokenTtlFor(token: string): number | null {
		const segments = token.split(".");
		if (segments.length !== 3) return null;
		try {
			const payload = JSON.parse(
				Buffer.from(segments[1], "base64url").toString("utf8"),
			) as { exp?: unknown };
			if (typeof payload.exp !== "number") return null;
			return Math.floor(payload.exp - Date.now() / 1000);
		} catch {
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
	static ttlForSession(rowTtlSeconds: number | null, token: string): number {
		const rowTtl = rowTtlSeconds === null ? null : Math.floor(rowTtlSeconds);
		const tokenTtl = SessionStoreService.tokenTtlFor(token);
		if (rowTtl === null && tokenTtl === null) return 0;
		if (rowTtl === null) return Math.max(0, tokenTtl as number);
		if (tokenTtl === null) return Math.max(0, rowTtl);
		return Math.max(0, Math.min(rowTtl, tokenTtl));
	}

	/** Seconds until `expiresAt`, or null when there is no row bound to apply. */
	static rowTtlSeconds(expiresAt: Date | null): number | null {
		if (!expiresAt) return null;
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
	async createAndCache(
		client: PoolClient,
		params: {
			token: string;
			accountId: number;
			expiresAt: Date;
			ipAddress: string | null;
			userAgent: string | null;
		},
	): Promise<number> {
		const result = await client.query(
			`INSERT INTO user_sessions
			   (account_id, session_token_hash, expires_at, ip_address, user_agent)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING id`,
			[
				params.accountId,
				hashSessionToken(params.token),
				params.expiresAt,
				params.ipAddress,
				params.userAgent,
			],
		);
		const sessionId = Number(result.rows[0]?.id ?? 0);
		if (sessionId) {
			const ttl = SessionStoreService.ttlForSession(
				SessionStoreService.rowTtlSeconds(params.expiresAt),
				params.token,
			);
			if (ttl > 0) {
				await this.put(params.token, { sessionId, accountId: Number(params.accountId) }, ttl);
			}
		}
		return sessionId;
	}

	private async healthy(): Promise<boolean> {
		if (!this.redis) return false;
		try {
			if (this.redis.status === "wait") await this.redis.connect();
			return this.redis.status === "ready";
		} catch {
			return false;
		}
	}

	/** Cache a live session. Best-effort: a failure must not fail the login. */
	async put(token: string, session: CachedSession, ttlSeconds: number): Promise<void> {
		if (!(await this.healthy()) || ttlSeconds <= 0) return;
		try {
			await this.redis!.set(
				SessionStoreService.keyFor(token),
				JSON.stringify(session),
				"EX",
				Math.max(1, Math.floor(ttlSeconds)),
			);
		} catch (err) {
			this.logger.warn(
				`Could not cache session: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/**
	 * Remove a session from the cache. This is what makes revocation instant.
	 * Called before the Postgres delete so the window is not widened.
	 */
	async invalidate(token: string): Promise<void> {
		await this.invalidateHash(hashSessionToken(token));
	}

	/** As `invalidate`, for callers that only hold the stored hash. */
	async invalidateHash(sessionTokenHash: string): Promise<void> {
		if (!(await this.healthy())) return;
		try {
			await this.redis!.del(SessionStoreService.keyForHash(sessionTokenHash));
		} catch (err) {
			this.logger.warn(
				`Could not invalidate cached session: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** Remove every cached session for an account (logout-all). */
	async invalidateAllForAccount(accountId: number): Promise<void> {
		if (!(await this.healthy())) return;
		try {
			// Sessions are namespaced by token hash, so account-wide invalidation
			// uses the fact that the value carries the accountId. SCAN rather than
			// KEYS so this never blocks the Redis event loop.
			let cursor = "0";
			do {
				const [next, keys] = await this.redis!.scan(
					cursor,
					"MATCH",
					"sess:*",
					"COUNT",
					200,
				);
				cursor = next;
				if (!keys.length) continue;
				const values = await this.redis!.mget(...keys);
				const doomed = keys.filter((_key, i) => {
					try {
						const parsed = JSON.parse(values[i] ?? "") as CachedSession;
						return Number(parsed.accountId) === Number(accountId);
					} catch {
						return false;
					}
				});
				if (doomed.length) await this.redis!.del(...doomed);
			} while (cursor !== "0");
		} catch (err) {
			this.logger.warn(
				`Could not invalidate account sessions: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/**
	 * Resolve a token hash against the cache, falling back to Postgres.
	 *
	 * Returns null only when the session is genuinely not live. Postgres stays
	 * authoritative: a cache hit is trusted because it was written from a real row
	 * and is deleted on revoke, and a miss re-checks the row.
	 */
	async findLiveSession(
		token: string,
	): Promise<{ hit: "cache" | "database" | "none"; session?: CachedSession }> {
		const key = SessionStoreService.keyFor(token);

		if (await this.healthy()) {
			try {
				const raw = await this.redis!.get(key);
				if (raw) {
					return { hit: "cache", session: JSON.parse(raw) as CachedSession };
				}
			} catch {
				// fall through to Postgres
			}
		}

		const result = await this.db
			.getPool()
			.query(
				`SELECT s.id AS session_id,
				        s.account_id,
				        GREATEST(EXTRACT(EPOCH FROM (s.expires_at - NOW())), 0)::int
				          AS expires_in_seconds
				 FROM user_sessions s
				 WHERE s.session_token_hash = $1 AND s.expires_at > NOW()
				 LIMIT 1`,
				[hashSessionToken(token)],
			);
		const row = result.rows[0];
		if (!row) return { hit: "none" };

		const session: CachedSession = {
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
				const ttl = SessionStoreService.ttlForSession(rowTtl, token);
				if (ttl > 0) {
					await this.redis!.set(key, JSON.stringify(session), "EX", ttl);
				}
			} catch {
				// best effort
			}
		}

		return { hit: "database", session };
	}

	async onModuleDestroy(): Promise<void> {
		if (!this.redis) return;
		try {
			// quit() drains in-flight commands, unlike disconnect().
			await this.redis.quit();
		} catch {
			this.redis.disconnect();
		}
	}
}
