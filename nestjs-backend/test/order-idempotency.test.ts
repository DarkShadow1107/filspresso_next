import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const SERVICE = path.resolve(__dirname, "..", "src", "orders", "orders.service.ts");
const CONTROLLER = path.resolve(__dirname, "..", "src", "orders", "orders.controller.ts");
const MIGRATION = path.resolve(
  __dirname, "..", "data", "migrations", "2026-10-orders-idempotency.sql",
);

/**
 * Phase 6.4: an idempotency key on POST /api/orders.
 *
 * The 6.1 sequence stops two *different* checkouts from colliding. It does nothing about
 * a *retry* of the same request, which is what a dropped response on a phone produces.
 */
describe("idempotency key plumbing", () => {
  const service = readFileSync(SERVICE, "utf8");

  it("the index name in the service matches the migration", () => {
    // This is the bug that actually shipped during development: the service checked for
    // a constraint name while the migration had created an index, so every concurrent
    // retry 500'd instead of replaying.
    const migration = readFileSync(MIGRATION, "utf8");
    const fromCode = service.match(/IDEMPOTENCY_UNIQUE_INDEX\s*=\s*"([^"]+)"/)?.[1];
    assert.ok(fromCode, "IDEMPOTENCY_UNIQUE_INDEX constant not found");
    assert.ok(
      migration.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${fromCode}`),
      `migration does not create ${fromCode}, which the service expects`,
    );
  });

  it("replays on a unique violation rather than surfacing a 500", () => {
    assert.match(service, /isUniqueViolation\(e, IDEMPOTENCY_UNIQUE_INDEX\)/);
    assert.match(service, /replayStoredResponse/);
  });

  it("checks the SQLSTATE, not the message text", () => {
    // Matching on message would let a product named after the constraint break checkout.
    assert.match(service, /code !== "23505"/);
  });

  it("reads the key from a header, not the body", () => {
    const controller = readFileSync(CONTROLLER, "utf8");
    assert.match(controller, /@Headers\("idempotency-key"\)/);
    assert.doesNotMatch(
      controller,
      /body\["?idempotency/i,
      "the key must not be a body field: the body must stay identical across retries",
    );
  });

  it("stores the response so a replay returns the original", () => {
    assert.match(service, /SET response = \$1::jsonb/);
    assert.match(service, /SELECT id, response FROM orders/);
  });

  it("scopes the key per account", () => {
    // Global uniqueness would let one account probe or block another's key.
    assert.match(service, /WHERE account_id = \$1 AND idempotency_key = \$2/);
    assert.ok(
      readFileSync(MIGRATION, "utf8").includes("ON orders(account_id, idempotency_key)"),
      "the unique index must be (account_id, idempotency_key), not key alone",
    );
  });

  it("bounds the key and rejects unusable ones", () => {
    assert.match(service, /trimmed\.length > 128/);
    assert.match(service, /\^\[A-Za-z0-9\._:-\]\+\$/);
    assert.match(service, /invalid Idempotency-Key/);
  });

  it("keeps keyless requests working", () => {
    // Opt-in per client: a caller that sends no header must get the previous behaviour
    // rather than an error.
    assert.match(service, /const key = normalizeIdempotencyKey\(idempotencyKey\)/);
    assert.match(service, /if \(key\) \{/);
  });

  it("excludes keyless rows from the unique index", () => {
    // Otherwise every ordinary order would collide on NULL.
    assert.match(
      readFileSync(MIGRATION, "utf8"),
      /WHERE idempotency_key IS NOT NULL/,
    );
  });
});