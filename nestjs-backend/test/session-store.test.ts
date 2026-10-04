import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { SessionStoreService } from "../src/common/guards/session-store.service";
import { hashSessionToken } from "../src/common/utils/auth-tokens";

/**
 * Phase 3 session-store contract.
 *
 * The properties that matter here are security properties, not just plumbing:
 * a raw token must never be used as (or appear in) a key, a cached entry must
 * never outlive the row it came from, and a Redis outage must degrade to slower
 * rather than to unauthenticated.
 *
 * Redis is not available in unit tests, so these run against the Postgres-fallback
 * path with a stub pool, which is the path that decides the answer when Redis is
 * down -- i.e. the security-critical one.
 */

type Row = Record<string, unknown> | null;

class PoolStub {
	constructor(private readonly row: Row) {}
	queries: string[] = [];
	query(sql: string, params?: unknown[]) {
		this.queries.push(sql);
		void params;
		return Promise.resolve({ rows: this.row ? [this.row] : [] });
	}
}

function stubDb(row: Row) {
	const pool = new PoolStub(row);
	return { getPool: () => pool, pool } as never;
}

const TOKEN = "header.payload.signature";

test("cache keys are derived from the hash, never the raw token", () => {
	const key = SessionStoreService.keyFor(TOKEN);
	assert.ok(key.startsWith("sess:"));
	assert.ok(!key.includes(TOKEN), "raw token must not appear in the cache key");
	// The key must be the 64-char hex sha256, not any part of the token.
	assert.match(key, /^sess:[0-9a-f]{64}$/);
});

test("keyFor and keyForHash agree, so revoke-by-row can evict the same entry", () => {
	// A revoke that only has `user_sessions.session_token_hash` must be able to
	// compute the key that login wrote, or revocation would silently stop working.
	assert.equal(
		SessionStoreService.keyFor(TOKEN),
		SessionStoreService.keyForHash(hashSessionToken(TOKEN)),
	);
});

test("a live row found in Postgres resolves, and the JWT account must match it", async () => {
	const store = new SessionStoreService(
		stubDb({ session_id: 42, account_id: 7, expires_in_seconds: 900 }),
	);
	const found = await store.findLiveSession(TOKEN);
	assert.equal(found.hit, "database");
	assert.deepEqual(found.session, { sessionId: 42, accountId: 7 });
});

test("a revoked or expired row resolves to nothing (no cache window on logout)", async () => {
	// After `DELETE FROM user_sessions` there is no row, and Redis is unreachable
	// here, so the fallback must report "none" rather than trusting anything.
	const store = new SessionStoreService(stubDb(null));
	const found = await store.findLiveSession(TOKEN);
	assert.equal(found.hit, "none");
	assert.equal(found.session, undefined);
});

test("Redis being down never throws and never fabricates a session", async () => {
	const store = new SessionStoreService(
		stubDb({ session_id: 1, account_id: 2, expires_in_seconds: 60 }),
	);
	// findLiveSession must resolve rather than reject: an outage degrades to
	// Postgres, it does not 500 every authenticated request.
	await assert.doesNotReject(() => store.findLiveSession(TOKEN));
	// put/invalidate/invalidateHash are all best-effort and must swallow the outage.
	await assert.doesNotReject(() => store.put(TOKEN, { sessionId: 1, accountId: 2 }, 60));
	await assert.doesNotReject(() => store.invalidate(TOKEN));
	await assert.doesNotReject(() => store.invalidateHash("b".repeat(64)));
	await assert.doesNotReject(() => store.invalidateAllForAccount(1));
});

test("the fallback query keeps the expiry predicate, so an expired row cannot be cached", async () => {
	const pool = new PoolStub(null);
	const store = new SessionStoreService({ getPool: () => pool } as never);
	await store.findLiveSession(TOKEN);
	assert.match(pool.queries[0], /expires_at\s*>\s*NOW\(\)/i);
});

test("the fallback query returns the remaining lifetime to bound the TTL", async () => {
	const pool = new PoolStub(null);
	const store = new SessionStoreService({ getPool: () => pool } as never);
	await store.findLiveSession(TOKEN);
	// Without this the repopulate step would have to guess a TTL, and a guess that
	// outruns `expires_at` would resurrect a dead session.
	assert.match(pool.queries[0], /expires_in_seconds/i);
});

test("the cached TTL is the shorter of the row and the token", () => {
	// Regression: JWT_EXPIRES_IN is 15m but AUTH_SESSION_IDLE_TIMEOUT_DAYS is 30d.
	// Keying off the row alone gave every login a ~30-day cache entry for a
	// 15-minute token, so ~30 days of dead keys accumulated per login.
	const rowTtl = 30 * 86_400;
	const tokenTtl = 900;
	assert.ok((SessionStoreService.rowTtlSeconds(new Date(Date.now() + rowTtl * 1000)) ?? 0) > 2_500_000);
	// Ranged rather than exact, because `exp` is whole seconds and `Date.now()` is not.
	const ttl = SessionStoreService.ttlForSession(rowTtl, liveToken(tokenTtl));
	assert.ok(ttl <= tokenTtl && ttl >= tokenTtl - 2, `expected ~${tokenTtl}, got ${ttl}`);
	assert.ok(ttl < rowTtl, "the row bound must not win when the token expires first");
});

test("both write paths share one TTL function, so they cannot drift again", () => {
	// Live testing caught the login path using the token lifetime while the
	// Postgres-fallback repopulate used the row's, so a cache flush re-seeded
	// 30-day entries. Both now call ttlForSession; assert the real shared function
	// from both directions rather than restating Math.min twice.
	const rowTtl = 2_592_000;
	const token = liveToken(900);
	const viaLoginPath = SessionStoreService.ttlForSession(
		SessionStoreService.rowTtlSeconds(new Date(Date.now() + rowTtl * 1000)),
		token,
	);
	const viaFallbackPath = SessionStoreService.ttlForSession(rowTtl, token);
	assert.ok(viaLoginPath <= 900 && viaLoginPath >= 890, `login path gave ${viaLoginPath}`);
	assert.ok(viaFallbackPath <= 900 && viaFallbackPath >= 890, `fallback path gave ${viaFallbackPath}`);
	assert.ok(Math.abs(viaLoginPath - viaFallbackPath) <= 2);
});

test("an inverted configuration still honours the row bound", () => {
	// If a deployment ever sets a JWT lifetime longer than the session idle
	// timeout, the row is the tighter bound and must win -- otherwise the cache
	// would keep a session alive past the row that backs it.
	const rowTtl = 60;
	const ttl = SessionStoreService.ttlForSession(rowTtl, liveToken(900));
	assert.ok(ttl <= rowTtl && ttl >= rowTtl - 2, `expected ~${rowTtl}, got ${ttl}`);
});

test("ttlForSession returns 0 (do not cache) when nothing is usable", () => {
	assert.equal(SessionStoreService.ttlForSession(null, "garbage"), 0);
});

test("ttlForSession never returns a negative EX", () => {
	// An already-expired row or token must not produce a negative TTL, which redis
	// rejects outright and would turn into a thrown error inside a request.
	assert.equal(SessionStoreService.ttlForSession(-10, liveToken(900)), 0);
	assert.equal(SessionStoreService.ttlForSession(900, liveToken(-10)), 0);
});

function liveToken(ttlSeconds: number): string {
	const payload = Buffer.from(
		JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
	).toString("base64url");
	return `h.${payload}.s`;
}

test("ttlFor never returns 0 or negative, which redis rejects as EX", () => {
	assert.equal(SessionStoreService.ttlFor(new Date(Date.now() - 5000)), 1);
	assert.equal(SessionStoreService.ttlFor(new Date(Date.now())), 1);
	assert.equal(SessionStoreService.ttlFor(new Date(Date.now() + 90_000)), 90);
});

test("the cache TTL is bounded by the token lifetime, not just the session row", () => {
	const payload = Buffer.from(
		JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 }),
	).toString("base64url");
	const tokenTtl = SessionStoreService.tokenTtlFor(`h.${payload}.s`);
	assert.ok(tokenTtl !== null && tokenTtl <= 600 && tokenTtl > 590);
});

test("tokenTtlFor returns null rather than throwing on a malformed token", () => {
	assert.equal(SessionStoreService.tokenTtlFor("not-a-jwt"), null);
	assert.equal(SessionStoreService.tokenTtlFor("only.two"), null);
	assert.equal(SessionStoreService.tokenTtlFor("a.!!!notbase64!!!.c"), null);
	// A JWT-shaped token with no numeric exp must not yield NaN.
	assert.equal(SessionStoreService.tokenTtlFor(`h.${Buffer.from('{"exp":"soon"}').toString("base64url")}.s`), null);
});
