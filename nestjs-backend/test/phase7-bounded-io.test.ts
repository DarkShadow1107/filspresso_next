import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const SRC = path.resolve(__dirname, "..", "src");
const INTEGRATIONS = path.join(SRC, "integrations");

function read(rel: string): string {
  return readFileSync(path.join(SRC, rel), "utf8");
}

function adapters(): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(INTEGRATIONS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(path.join(INTEGRATIONS, dir.name))) {
      if (file.endsWith(".adapter.ts")) out.push(path.join(dir.name, file));
    }
  }
  return out;
}

/**
 * Phase 7: stop pinning connections, bound waits.
 *
 * Every outbound call to a process we do not control needs a deadline. Without one, a
 * peer that accepts the connection and then stops responding holds the request open
 * until some much later timeout -- and if the caller was holding a pooled database
 * connection, it holds that too.
 *
 * These assert the *absence* of the unbounded pattern, which is the thing that has
 * repeatedly crept back in.
 */
describe("Phase 7: no unbounded outbound call", () => {
  it("every integrations adapter bounds its requests", () => {
    const list = adapters();
    assert.ok(list.length >= 4, `expected the four adapters, found ${list.length}`);
    for (const rel of list) {
      const src = readFileSync(path.join(INTEGRATIONS, rel), "utf8");
      // Either the shared client or its own AbortController counts as bounded; what must
      // not exist is a fetch with neither.
      const bounded =
        /fetchBounded\(/.test(src) || /new AbortController\(/.test(src);
      assert.ok(bounded, `${rel} makes a fetch with no timeout`);
    }
  });

  it("no service anywhere makes an unbounded fetch()", () => {
    // A file is acceptable if it routes through fetchBounded, or creates its own
    // AbortController and passes the signal. Anything else is an unbounded call.
    const exempt = new Set(["common/utils/httpClient.ts"]);
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
        const rel = path.relative(SRC, full).replace(/\\/g, "/");
        if (exempt.has(rel)) continue;
        const src = readFileSync(full, "utf8");
        if (!/(?<!fetchBounded\()await fetch\(/.test(src)) continue;
        if (/new AbortController\(/.test(src) && /signal:/.test(src)) continue;
        offenders.push(rel);
      }
    };
    walk(SRC);

    assert.deepEqual(offenders, [], "these fetch without a timeout or a size cap");
  });
});

describe("Phase 7: no pooled connection held across a network call", () => {
  it("weather does not hold a connection while fetching", () => {
    const src = read("weather/weather.service.ts");
    // getWeather used to open a client and then call open-meteo inside the same try.
    assert.doesNotMatch(src, /const client = await pool\.connect\(\)/);
    assert.match(src, /fetchWithTimeout/);
    assert.match(src, /pool\.query/);
  });

  it("weather resolves its location over TLS, not plaintext", () => {
    const src = read("weather/weather.service.ts");
    // The comment explaining the change names the old plaintext host on purpose, so
    // comments are stripped before looking for a URL.
    // The lookbehind matters: a plain `//.*$` also matches the `//` in `https://`,
    // which silently truncated the very line this is checking for.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(?<!:)\/\/.*$/gm, "");
    assert.doesNotMatch(code, /ip-api\.com/, "still calls ip-api");
    assert.doesNotMatch(code, /[`"']http:\/\//, "no plaintext HTTP in the weather path");
    assert.match(code, /https:\/\/\$\{GEO_PROVIDER\}/);
    assert.match(src, /WEATHER_GEO_PROVIDER/);
  });

  it("the invoice render releases the connection first", () => {
    const src = read("orders/orders.service.ts");
    const start = src.indexOf("async getOrderInvoice(");
    const end = src.indexOf("\n  // ", start + 10);
    const body = src.slice(start, end);
    const release = body.indexOf("client.release()");
    const fetchCall = body.indexOf("await fetchBounded") >= 0
      ? body.indexOf("await fetchBounded")
      : body.indexOf("await fetch(");
    assert.ok(release !== -1, "the invoice path never releases its connection");
    assert.ok(fetchCall !== -1, "no upstream call found in getOrderInvoice");
    assert.ok(release < fetchCall, "the connection must be released before the render call");
  });

  it("does not ask for gzip on a PDF", () => {
    const src = read("orders/orders.service.ts");
    assert.match(src, /"Accept-Encoding": "identity"/);
  });
});

describe("Phase 7: replay-guard expiry is housekeeping, not a per-request write", () => {
  const src = read("common/utils/replayGuard.ts");

  it("reserveReplayOperation issues no DELETE", () => {
    const start = src.indexOf("export async function reserveReplayOperation");
    const body = src.slice(start);
    assert.doesNotMatch(body, /DELETE FROM/, "the hot path still deletes on every request");
  });

  it("the sweep exists and is separately callable", () => {
    assert.match(src, /export async function sweepExpiredReplayOperations/);
    assert.match(src, /export function startReplaySweep/);
    assert.match(src, /export function stopReplaySweep/);
  });

  it("unrefs its timer so it cannot hold the process open", () => {
    assert.match(src, /sweepTimer\.unref\?\.\(\)/);
  });

  it("is started by the existing scheduler, which is given the pool", () => {
    const scheduler = read("security-observability/security-observability.scheduler.ts");
    assert.match(scheduler, /startReplaySweep\(this\.db\.getPool\(\)\)/);
    assert.match(scheduler, /stopReplaySweep\(\)/);
    const mod = read("security-observability/security-observability.module.ts");
    assert.match(mod, /imports: \[DatabaseModule\]/);
  });

  it("does not depend on an index that does not exist", () => {
    // The expires_at index already existed; adding a second identical one would only add
    // write amplification to the INSERT on the hot path.
    assert.doesNotMatch(read("database/ensureAppSchema.ts"), /idx_security_operation_replay_guard_expires/);
  });
});

describe("Phase 7: bounded responses", () => {
  it("the shared client caps bytes from Content-Length and while streaming", () => {
    const src = read("common/utils/httpClient.ts");
    assert.match(src, /content-length/);
    assert.match(src, /rebufferWithCap/);
    assert.match(src, /UpstreamTooLargeError/);
    // An AbortError must be translated, not leaked as an opaque failure.
    assert.match(src, /UpstreamTimeoutError/);
  });

  it("go_ops caps its buffer and destroys the request on overflow", () => {
    const src = read("operations/operations.service.ts");
    assert.match(src, /goOpsMaxResponseBytes/);
    assert.match(src, /response exceeded/);
    assert.match(src, /req\.destroy\(\)/);
  });
});