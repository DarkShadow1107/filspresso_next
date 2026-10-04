import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const SRC = path.resolve(__dirname, "..", "src");

/**
 * Source with comments stripped.
 *
 * These assertions describe what the code must *not* contain, but each change also
 * leaves a comment saying what it removed -- so an unstripped read matches the
 * explanation. The `//` needs a lookbehind for the same reason as before: a bare
 * `//.*$` also eats the `//` in a URL.
 */
function code(rel: string): string {
  return readFileSync(path.join(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/.*$/gm, "");
}


import { deriveAeadKeyForTest, clearDerivedKeyCache } from "../src/common/utils/encryption";

/**
 * Phase 8.3 memoises `hkdfSync`.
 *
 * The risk is not that the cache is slow, it is that it is *wrong*: a cached derived key
 * that does not match what the original code produced would silently break decryption of
 * everything already encrypted, because those ciphertexts are on disk.
 */
describe("derived key cache", () => {
  const KEY = "hex:" + "ab".repeat(32);
  const OTHER = "hex:" + "cd".repeat(32);

  it("returns the same key on every call", () => {
    clearDerivedKeyCache();
    const a = deriveAeadKeyForTest(KEY, "k1");
    const b = deriveAeadKeyForTest(KEY, "k1");
    assert.equal(a.toString("hex"), b.toString("hex"), "a repeat call must not change the key");
  });

  it("matches a cold derivation", () => {
    // The real assertion: cached output must equal uncached output.
    clearDerivedKeyCache();
    const cold = deriveAeadKeyForTest(KEY, "k1").toString("hex");
    clearDerivedKeyCache();
    deriveAeadKeyForTest(KEY, "k1"); // populate
    const warm = deriveAeadKeyForTest(KEY, "k1").toString("hex");
    assert.equal(warm, cold, "the cache must be transparent");
  });

  it("does not confuse two keys", () => {
    clearDerivedKeyCache();
    const a = deriveAeadKeyForTest(KEY, "k1");
    const b = deriveAeadKeyForTest(OTHER, "k1");
    assert.notEqual(a.toString("hex"), b.toString("hex"), "distinct keys must not share an entry");
  });

  it("does not confuse two key ids", () => {
    clearDerivedKeyCache();
    const a = deriveAeadKeyForTest(KEY, "k1");
    const b = deriveAeadKeyForTest(KEY, "k2");
    assert.notEqual(a.toString("hex"), b.toString("hex"));
  });

  it("re-derives after the cache is cleared", () => {
    const first = deriveAeadKeyForTest(KEY, "k1").toString("hex");
    clearDerivedKeyCache();
    const second = deriveAeadKeyForTest(KEY, "k1").toString("hex");
    assert.equal(second, first, "clearing must not change the derived value");
  });

  it("rejects a short key before it can be cached", () => {
    clearDerivedKeyCache();
    assert.throws(() => deriveAeadKeyForTest("hex:aabb", "k1"), /at least 128 bits/);
  });

  it("is bounded", () => {
    const src = code("common/utils/encryption.ts");
    assert.match(src, /DERIVED_KEY_CACHE_LIMIT = \d+/);
    assert.match(src, /if \(derivedKeyCache\.size >= DERIVED_KEY_CACHE_LIMIT\)/);
  });

  it("keeps the sha256 fallback, because derived keys are persisted", () => {
    const src = code("common/utils/encryption.ts");
    assert.match(src, /hkdfSync\("sha256"/);
  });
});

describe("TrimStringsPipe walks in place", () => {
  it("no longer rebuilds every object", () => {
    const src = code("common/pipes/trim-strings.pipe.ts");
    assert.doesNotMatch(src, /Object\.fromEntries/, "must not reallocate every object");
    assert.doesNotMatch(src, /\.map\(/, "must not reallocate every array");
    // In-place assignment is the whole point.
    assert.match(src, /value\[i\] = result\.value/);
    assert.match(src, /record\[key\] = result\.value/);
  });

  it("bounds recursion depth", () => {
    const src = code("common/pipes/trim-strings.pipe.ts");
    assert.match(src, /MAX_TRIM_DEPTH/);
  });
});

describe("Phase 8: bounded work on request paths", () => {
  it("the global JSON body limit is 1 MB, not 10 MB", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "src", "main.ts"), "utf8");
    assert.doesNotMatch(src, /"10mb"/);
    assert.match(src, /MAX_JSON_BODY_BYTES/);
    assert.match(src, /1024 \* 1024/, "the default ceiling must be 1 MB");
  });

  it("the ledger verification ceiling is 5000 rows, not 100000", () => {
    const ledger = code("common/utils/securityLedger.ts");
    assert.doesNotMatch(ledger, /100000/);
    assert.match(ledger, /5000/);
    const controller = code("security-observability/security-observability.controller.ts");
    assert.doesNotMatch(controller, /100000/);
  });
});
describe("Phase 8.5: bulk ingest is bounded and batched", () => {
  const svc = code("security-observability/security-observability.service.ts");

  it("caps the array", () => {
    assert.match(svc, /MAX_BULK_SERVICE_EVENTS/);
    assert.match(svc, /too many events in one batch/);
  });

  it("inserts the incidents in one statement, not one per event", () => {
    assert.match(svc, /FROM unnest\(\$1::text\[\]/);
    // The per-event INSERT must be gone from the loop.
    assert.doesNotMatch(svc, /INSERT INTO service_health_incidents[\s\S]{0,120}VALUES \(\$1, \$2, \$3, \$4, \$5, \$6\)/);
  });

  it("keeps the ledger append inside the per-event loop, because it is a chain", () => {
    // Structural, not a comment: the ledger append is inherently serial (each event
    // hashes the previous one), so it must stay a per-event call. Only the incident
    // insert is batched.
    const loopStart = svc.indexOf("for (const event of events)");
    const batchStart = svc.indexOf("INSERT INTO service_health_incidents", loopStart);
    const loopEnd = batchStart;
    const loopBody = svc.slice(loopStart, loopEnd);
    assert.match(loopBody, /appendSecurityLedgerEvent\(client/);
  });
});

describe("Phase 8.6: image lookups are not per-row stat calls", () => {
  const svc = code("products/products.service.ts");

  it("no longer stats per row", () => {
    const resolveStart = svc.indexOf("private resolveImageExtension");
    assert.ok(resolveStart !== -1, "resolveImageExtension not found");
    const body = svc.slice(resolveStart, resolveStart + 900);
    assert.doesNotMatch(body, /existsSync/, "still calling existsSync per product");
  });

  it("builds one set of basenames instead", () => {
    assert.match(svc, /loadImageBasenames/);
    assert.match(svc, /imageBasenames/);
  });

  it("assigns the cache even when the walk throws", () => {
    // Structural: a missing bind mount must still leave a usable (empty) set rather
    // than propagating and breaking product listing.
    const start = svc.indexOf("private loadImageBasenames");
    assert.ok(start !== -1, "loadImageBasenames not found");
    const body = svc.slice(start, svc.indexOf("private resolveImageExtension", start));
    const tryIdx = body.indexOf("try {");
    const catchIdx = body.indexOf("catch");
    assert.ok(tryIdx !== -1 && catchIdx > tryIdx, "the directory walk must be inside a try/catch");
    // The assignment sits after the catch, so it runs on both paths.
    const assign = body.indexOf("imageBasenames = found");
    assert.ok(assign > catchIdx, "the cache must be assigned after the catch, so a throw still caches");
  });
});
