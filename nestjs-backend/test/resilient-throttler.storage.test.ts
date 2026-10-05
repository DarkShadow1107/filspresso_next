import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ResilientThrottlerStorage } from "../src/common/guards/resilient-throttler.storage";

const { describe, it } = test;

const MODULE = path.resolve(__dirname, "..", "src", "common", "guards", "rate-limit.module.ts");

/**
 * Phase 9 V4.
 *
 * Stopping Redis made every authenticated route return 503 {"error":"Request timed
 * out"}, because `@nestjs-lab/throttler-storage-redis` parks commands on its offline
 * queue when the socket is down: the promise never settles and never rejects. The
 * session store already degraded to Postgres and never got a chance to run.
 *
 * The central property is therefore not "catches errors" -- it is "cannot be made to
 * hang". A deadline is the only thing that fixes a promise that never settles, so the
 * timeout behaviour is asserted directly rather than left to the outage drill.
 */
describe("ResilientThrottlerStorage", () => {
  it("falls back when the delegate rejects", async () => {
    const storage = new ResilientThrottlerStorage();
    storage.useRedis(() => ({
      increment: async () => {
        throw new Error("ECONNREFUSED");
      },
    }));

    const record = await storage.increment("k", 60_000, 10, 0, "default");
    assert.equal(record.totalHits, 1);
    assert.equal(record.isBlocked, false);
    storage.onModuleDestroy();
  });

  it("falls back when the delegate never settles", async () => {
    const storage = new ResilientThrottlerStorage();
    // The actual Redis-down shape: no rejection, no resolution, ever.
    storage.useRedis(() => ({ increment: () => new Promise<never>(() => {}) }));

    const started = Date.now();
    const record = await storage.increment("k", 60_000, 10, 0, "default");
    const elapsed = Date.now() - started;

    assert.equal(record.totalHits, 1, "must still count the hit locally");
    // Generous upper bound: the point is that it returns at all, and nowhere near the
    // request-timeout middleware's budget.
    assert.ok(elapsed < 5_000, `returned in ${elapsed}ms, expected the deadline to fire`);
    storage.onModuleDestroy();
  });

  it("uses the delegate when Redis answers", async () => {
    const storage = new ResilientThrottlerStorage();
    // Not `async`: the factory must return the storage itself, and TypeScript enforces
    // that. An async factory yields a Promise, `.increment` is undefined, and every
    // call would silently fall back to the local counter.
    storage.useRedis(() => ({
      increment: async () => ({ totalHits: 41, timeToExpire: 30, isBlocked: true, timeToBlockExpire: 12 }),
    }));

    const record = await storage.increment("k", 60_000, 10, 0, "default");
    assert.equal(record.totalHits, 41);
    assert.equal(record.isBlocked, true, "a block decided in Redis must be honoured, not re-decided locally");
    storage.onModuleDestroy();
  });

  it("blocks once the local count passes the limit", async () => {
    const storage = new ResilientThrottlerStorage();
    storage.useRedis(() => ({ increment: () => new Promise<never>(() => {}) }));

    let last = await storage.increment("k", 60_000, 3, 30_000, "default");
    assert.equal(last.isBlocked, false);
    for (let i = 0; i < 3; i++) last = await storage.increment("k", 60_000, 3, 30_000, "default");

    // Degrading to in-process must not mean "no limit": that would turn a cache
    // outage into an unbounded one.
    assert.equal(last.totalHits, 4);
    assert.equal(last.isBlocked, true, "local fallback must still enforce the limit");
    assert.ok(last.timeToBlockExpire > 0);
    storage.onModuleDestroy();
  });

  it("recovers onto Redis again after the cooldown", async () => {
    const storage = new ResilientThrottlerStorage();
    let healthy = false;
    storage.useRedis(() => ({
      increment: async () => {
        if (!healthy) return new Promise<never>(() => {});
        return { totalHits: 7, timeToExpire: 10, isBlocked: false, timeToBlockExpire: 0 };
      },
    }));

    const degraded = await storage.increment("k", 60_000, 10, 0, "default");
    assert.equal(degraded.totalHits, 1, "counts locally while Redis is down");

    healthy = true;
    // The cooldown is deliberately short in the test's favour only by waiting it out;
    // assert the probe happens rather than that Redis is never retried.
    await new Promise((r) => setTimeout(r, 10_500));
    const recovered = await storage.increment("k2", 60_000, 10, 0, "default");
    assert.equal(recovered.totalHits, 7, "must go back to Redis once it recovers");
    storage.onModuleDestroy();
  });

  it("is wired into the module, replacing the bare Redis storage", () => {
    const src = readFileSync(MODULE, "utf8");
    assert.match(src, /ResilientThrottlerStorage/, "module must build the resilient storage");
    // A bare `storage: new ThrottlerStorageRedisService(...)` is the exact
    // configuration that 503s the whole API during an outage.
    assert.doesNotMatch(
      src,
      /storage:\s*new ThrottlerStorageRedisService/,
      "must not pass the Redis storage directly; it has no outage behaviour",
    );
    assert.match(src, /useRedis\(/, "must attach Redis through useRedis()");
  });
});
