#!/usr/bin/env node
/**
 * Phase 9 V3 -- load test.
 *
 * Drives N concurrent authenticated virtual users through a mix of orders,
 * subscriptions and cards, sampling the connection pool the whole time.
 *
 * Each virtual user gets its own x-forwarded-for. That is not a trick to dodge the
 * rate limiter: 50 real users arrive from 50 different addresses, and the limiter is
 * per-IP by design. Reusing one source address would not test 50 users, it would test
 * one user against their own limit.
 *
 * Usage:
 *   node scripts/load-test.mjs [--users 50] [--ops 6] [--base http://localhost:4000]
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const USERS = Number(argOf("users", 50));
const OPS = Number(argOf("ops", 6));
const BASE = argOf("base", process.env.LOAD_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const POOL_WARN = Number(argOf("pool-warn", 0));
const LOGIN_P95_TARGET = Number(argOf("login-p95", 2000));
const VERBOSE = argv.includes("--verbose");
const SAMPLE_MS = Number(argOf("sample-ms", 200));
// Must be one of CORS_ORIGIN. Cookie-authenticated writes are rejected without a
// matching Origin by the CSRF guard, so omitting this makes every card/subscription
// create a 403 and quietly skips the write paths this test exists to exercise.
const ORIGIN = argOf("origin", process.env.LOAD_ORIGIN || "http://localhost:3000");

const stamp = Date.now().toString(36);
// Register is budgeted at 5/hour per client IP, so a fixed address would make the
// second run of this test fail on its own setup. Offset the address by the run so
// repeat runs get a fresh budget.
const RUN_OCTET = Number.parseInt(stamp.slice(-3), 36) % 200;
const clientIp = (index) => `198.18.${RUN_OCTET}.${(index % 250) + 1}`;
const results = { byStatus: new Map(), byOp: new Map(), errors: [] };
const latencies = { login: [], op: [] };

function record(op, status, ms) {
  const key = `${op} ${status}`;
  results.byStatus.set(key, (results.byStatus.get(key) || 0) + 1);
  if (!results.byOp.has(op)) results.byOp.set(op, []);
  results.byOp.get(op).push(ms);
  if (status >= 500) results.errors.push(`${op} -> ${status}`);
  if (status === 0) results.errors.push(`${op} -> transport error`);
}

async function call(op, { method = "GET", path: p, body, cookie, ip }) {
  const started = performance.now();
  const headers = { accept: "application/json", origin: ORIGIN };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (ip) headers["x-forwarded-for"] = ip;
  try {
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const ms = performance.now() - started;
    record(op, res.status, ms);
    const text = await res.text();
    return { status: res.status, ms, text, setCookie: res.headers.get("set-cookie") };
  } catch (err) {
    const ms = performance.now() - started;
    record(op, 0, ms);
    return { status: 0, ms, text: String(err) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.max(0, Math.round(sorted[Math.max(0, idx)]));
}

function cookieFrom(setCookie) {
  if (!setCookie) return null;
  const first = setCookie.split(",").find((c) => c.trim().startsWith("filspresso_session="));
  return first ? first.split(";")[0].trim() : null;
}

/**
 * Pick a capsule that is actually purchasable.
 *
 * Hardcoding a product_id makes the test rot: earlier runs ordered no20-vertuo until
 * its stock hit 0, and every later run then failed its own setup with a correct
 * 409 INSUFFICIENT_STOCK -- which is the app working, not the test passing. Resolve it
 * from the catalogue and require real headroom.
 */
let cachedSku = null;
let skuLookup = null;
function inStockSku() {
  // Memoise the promise, not the value: 50 virtual users start together and a
  // value-only cache let all 50 issue the lookup before the first one resolved.
  if (!skuLookup) skuLookup = resolveSku();
  return skuLookup;
}

async function resolveSku() {
  const res = await call("catalogue", { path: "/api/products/coffee" });
  if (res.status !== 200) throw new Error(`catalogue unavailable: HTTP ${res.status}`);
  let rows;
  try {
    const parsed = JSON.parse(res.text);
    rows = Array.isArray(parsed) ? parsed : parsed.products || parsed.data || [];
  } catch {
    rows = [];
  }
  // Needs enough headroom for every order this run will place, with slack so a repeat
  // run does not immediately run the SKU dry. The catalogue tops out at 500.
  const best = rows
    .filter((r) => typeof r.stock === "number" && r.stock >= 200 && r.productId)
    .sort((a, b) => b.stock - a.stock)[0];
  if (!best) throw new Error("no capsule has stock headroom; cannot run a checkout load test");
  cachedSku = best.productId;
  console.log(`  ordering    ${cachedSku} (stock ${best.stock})`);
  return cachedSku;
}

/** One virtual user: register, log in, then hit the authenticated mix repeatedly. */
async function virtualUser(index) {
  const ip = clientIp(index);
  const email = `load${stamp}.${index}@load.test`;
  const username = `load${stamp}_${index}`;
  const password = "LoadTest!2026x";

  const reg = await call("register", {
    method: "POST",
    path: "/api/auth/register",
    body: { username, email, password },
    ip,
  });
  if (reg.status !== 201) {
    return { index, registered: false, reason: `register ${reg.status}: ${reg.text.slice(0, 120)}` };
  }

  const login = await call("login", {
    method: "POST",
    path: "/api/auth/login",
    body: { email, password },
    ip,
  });
  latencies.login.push(login.ms);
  const cookie = cookieFrom(login.setCookie) || cookieFrom(reg.setCookie);
  if (!cookie) {
    return { index, registered: true, loggedIn: false, reason: `login ${login.status}: no session cookie` };
  }

  // A warm-up call proves the cookie actually authenticates before we measure.
  const sku = await inStockSku();

  const whoami = await call("orders.list", { path: "/api/orders", cookie, ip });
  if (whoami.status === 401) {
    return { index, registered: true, loggedIn: true, authed: false, reason: "session rejected with 401" };
  }

  for (let round = 0; round < OPS; round++) {
    const r = round;
    // A spread of authenticated reads and writes, mirroring the plan's mix.
    await call("orders.list", { path: "/api/orders", cookie, ip });
    // The heaviest write in the app: server-side re-pricing, stock lock, sequence
    // order number, batched item insert and invoice payload.
    await call("orders.create", {
      method: "POST",
      path: "/api/orders",
      body: {
        items: [{ product_id: sku, quantity: 1 }],
        shippingAddress: {
          firstName: "Load", lastName: "Tester", street: "1 Test St",
          city: "Bucharest", postalCode: "010011", country: "RO",
        },
      },
      cookie,
      ip,
    });
    if (r % 2 === 0) {
      await call("cards.create", {
        method: "POST",
        path: "/api/cards",
        // Shape per CardsService.addCard: cardNumber/expiry/cardHolder are required
        // and the number must be 13-19 digits once non-digits are stripped. A Luhn
        // valid test number keeps this from tripping any future real validation.
        body: {
          cardNumber: "4242424242424242",
          expiry: "12/30",
          cvv: "123",
          cardHolder: `Load Tester ${index}`,
          isDefault: r === 0,
        },
        cookie,
        ip,
      });
    } else {
      await call("cards.list", { path: "/api/cards", cookie, ip });
    }
    if (r % 3 === 0) {
      await call("cart.get", { path: "/api/cart", cookie, ip });
    }
    if (r % 3 === 1) {
      await call("subs.create", {
        method: "POST",
        path: "/api/subscriptions",
        // Shape per SubscriptionsService.createSubscription: `tier`, not `plan`, and a
        // billingCycle of monthly|annual. "basic" keeps it off the free tier so the
        // price and renewal-date paths are the ones actually exercised.
        body: { tier: "basic", billingCycle: "monthly" },
        cookie,
        ip,
      });
    }
    if (r % 4 === 0) {
      await call("favorites.list", { path: "/api/favorites", cookie, ip });
    }
    await call("orders.popular", { path: "/api/orders/popular", ip });
    await call("products.coffee", { path: "/api/products/coffee", ip });
    latencies.op.push(performance.now());
  }
  return { index, registered: true, loggedIn: true, authed: true };
}

/** Samples pool occupancy while the load runs. */
function startSampler() {
  const samples = [];
  let stop = false;
  (async () => {
    while (!stop) {
      try {
        const res = await fetch(`${BASE}/health/services`);
        const json = await res.json();
        if (json?.pool) samples.push({ t: Date.now(), ...json.pool });
      } catch {
        /* a missed sample is not itself a failure */
      }
      await sleep(SAMPLE_MS);
    }
  })();
  return {
    samples,
    stop: () => {
      stop = true;
    },
  };
}

async function main() {
  console.log(`Phase 9 V3 load test`);
  console.log(`  target      ${BASE}`);
  console.log(`  users       ${USERS} concurrent`);
  console.log(`  rounds/user ${OPS}`);
  console.log(`  origin      ${ORIGIN}`);
  console.log(`  p95 target  login < ${LOGIN_P95_TARGET}ms, pool waiting <= ${POOL_WARN}`);
  console.log(``);

  const sampler = startSampler();
  const started = Date.now();

  const settled = await Promise.allSettled(
    Array.from({ length: USERS }, (_, i) => virtualUser(i)),
  );
  const outcomes = settled.map((s) =>
    s.status === "fulfilled" ? s.value : { index: -1, reason: String(s.reason) },
  );
  sampler.stop();

  const elapsed = Date.now() - started;
  const failed = outcomes.filter((o) => o.reason);
  const unauthed = outcomes.filter((o) => o.authed === false);
  const totalRequests = [...results.byStatus.values()].reduce((a, b) => a + b, 0);
  const serverErrors = [...results.byStatus.entries()].filter(([k, v]) => k.endsWith(" 500") || k.endsWith(" 502") || k.endsWith(" 503"));
  const fivexx = [...results.byStatus.entries()].filter(([k]) => /\s5\d\d$/.test(k));

  const maxWaiting = sampler.samples.reduce((m, s) => Math.max(m, s.waiting ?? 0), 0);
  const maxTotal = sampler.samples.reduce((m, s) => Math.max(m, s.total ?? 0), 0);
  const poolMax = sampler.samples.reduce((m, s) => Math.max(m, s.max ?? 0), 0);
  const loginP95 = percentile(latencies.login, 95);
  const opTimes = [...results.byOp.values()].flat();
  const orderCreates = [...results.byStatus.entries()]
    .filter(([k]) => k.startsWith("orders.create 2"))
    .reduce((n, [, v]) => n + v, 0);

  console.log(`=== outcome ===`);
  console.log(`  users            ${USERS - failed.length}/${USERS} completed`);
  console.log(`  requests         ${totalRequests} in ${(elapsed / 1000).toFixed(1)}s (${(totalRequests / (elapsed / 1000)).toFixed(1)}/s)`);
  console.log(``);

  console.log(`=== latency ===`);
  console.log(`  login p50/p95/max  ${percentile(latencies.login, 50)} / ${loginP95} / ${percentile(latencies.login, 100)} ms`);
  console.log(`  request p50/p95/max ${percentile(opTimes, 50)} / ${percentile(opTimes, 95)} / ${percentile(opTimes, 100)} ms`);
  for (const [op, times] of [...results.byOp.entries()].sort()) {
    console.log(`    ${op.padEnd(16)} n=${String(times.length).padStart(5)}  p95=${String(percentile(times, 95)).padStart(6)}ms`);
  }
  console.log(``);

  console.log(`=== pool (${sampler.samples.length} samples) ===`);
  console.log(`  max waiting   ${maxWaiting}   (target <= ${POOL_WARN})`);
  console.log(`  max total     ${maxTotal} of max ${poolMax}`);
  console.log(``);

  console.log(`=== status codes ===`);
  for (const [k, v] of [...results.byStatus.entries()].sort()) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }
  console.log(``);

  if (failed.length) {
    console.log(`=== user failures (${failed.length}) ===`);
    for (const f of failed.slice(0, 8)) console.log(`  #${f.index}: ${f.reason}`);
    console.log(``);
  }

  // If every write 403s the run looks "clean" (no 5xx) while having tested nothing, so
  // require at least one accepted write per write-path.
  const accepted = (op) =>
    [...results.byStatus.entries()]
      .filter(([k]) => k.startsWith(`${op} 2`))
      .reduce((n, [, v]) => n + v, 0);

  const checks = [
    { name: "no user failed to complete", ok: failed.length === 0, detail: `${failed.length} failed` },
    { name: "every session authenticated", ok: unauthed.length === 0, detail: `${unauthed.length} got 401` },
    { name: "no 5xx", ok: fivexx.length === 0, detail: fivexx.map(([k, v]) => `${k} x${v}`).join(", ") || "none" },
    { name: "pool never exhausted", ok: maxWaiting <= POOL_WARN, detail: `max waiting ${maxWaiting}` },
    { name: `login p95 < ${LOGIN_P95_TARGET}ms`, ok: loginP95 > 0 && loginP95 < LOGIN_P95_TARGET, detail: `${loginP95}ms` },
    { name: "orders were created", ok: orderCreates > 0, detail: `${orderCreates} created` },
    { name: "card writes accepted", ok: accepted("cards.create") > 0, detail: `${accepted("cards.create")} 2xx, ${results.byStatus.get("cards.create 403") || 0} 403` },
    { name: "subscription writes accepted", ok: accepted("subs.create") > 0, detail: `${accepted("subs.create")} 2xx, ${results.byStatus.get("subs.create 403") || 0} 403` },
  ];

  console.log(`=== assertions ===`);
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(32)} ${c.detail}`);
  }
  console.log(``);
  console.log(`RESULT: ${allOk ? "PASS" : "FAIL"}`);
  if (VERBOSE) {
    for (const e of results.errors.slice(0, 20)) console.log(`  err ${e}`);
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(`load test crashed: ${err?.stack || err}`);
  process.exit(2);
});
