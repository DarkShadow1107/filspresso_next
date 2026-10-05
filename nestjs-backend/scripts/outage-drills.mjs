#!/usr/bin/env node
/**
 * Phase 9 V4 + V5 -- outage drills.
 *
 * These stop containers, so they run on the host and drive the API over HTTP.
 *
 *   V4  Redis outage: authenticated traffic must keep working through the Postgres
 *       session fallback, logout must still revoke, and the revocation must survive
 *       Redis coming back (a revoke that only lived in the dead cache has failed).
 *   V5  Shutdown: `stop backend` during active traffic must let in-flight orders
 *       finish and must run pool.end() rather than dropping sockets.
 *
 * Usage: node scripts/outage-drills.mjs [--base http://localhost:4000]
 */
import { execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BASE = argOf("base", process.env.LOAD_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const ORIGIN = argOf("origin", process.env.LOAD_ORIGIN || "http://localhost:3000");
const SERVICE = argOf("service", "filspresso_next");
// A per-run client address, for the same reason the load test uses one per virtual
// user: the register budget is 5/hour *per IP*, and every drill request otherwise
// arrives from the single host address, so back-to-back runs 429 on their own setup.
const CLIENT_IP = argOf("ip", `192.0.2.${(process.pid % 250) + 1}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const log = (m) => console.log(`  ${m}`);
const head = (m) => console.log(`\n=== ${m} ===`);

let jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorb(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

// A keep-alive agent, deliberately. On Windows every request to the published port
// crosses Docker Desktop's userland proxy, and a burst of ~50 *new* TCP connections
// makes it reset some of them at exactly 30s with ECONNRESET -- measured at 14/50 on
// the register burst, while the identical burst from inside the docker network was
// 50/50. Reusing sockets removes most of the churn, so the drill measures the
// application rather than the host's port forwarding.
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function rawRequest(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const url = new URL(BASE + path);
    const mod = url.protocol === "https:" ? https : http;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const finalHeaders = { ...headers };
    if (payload) finalHeaders["content-length"] = String(payload.length);
    const req = mod.request(
      {
        agent,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: finalHeaders,
      },
      (res) => {
        const setCookies = res.headers["set-cookie"] || [];
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text, setCookies }));
      },
    );
    req.on("error", (err) => resolve({ status: 0, text: err.code || String(err), setCookies: [] }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function call(path, { method = "GET", body, auth = true } = {}) {
  const headers = { accept: "application/json", origin: ORIGIN, "x-forwarded-for": CLIENT_IP };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth && jar.size) headers.cookie = cookieHeader();
  const res = await rawRequest(path, { method, headers, body });
  absorb({ headers: { getSetCookie: () => res.setCookies } });
  return { status: res.status, text: res.text };
}

const isTransport = (r) => r.status === 0;

async function waitForHealthy(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return true;
    } catch {
      /* still starting */
    }
    await sleep(1000);
  }
  return false;
}

async function newUser(tag, attempt = 1) {
  jar = new Map();
  const uniq = `${tag}${crypto.randomBytes(5).toString("hex")}`;
  const email = `${uniq}@drill.test`;
  const password = "LoadTest!2026x";
  const reg = await call("/api/auth/register", {
    method: "POST",
    body: { username: uniq.replace(/\W/g, "_"), email, password },
    auth: false,
  });
  // A fresh identity per attempt: a retried register with the same email would
  // collide on the unique index and report a misleading 409.
  if (isTransport(reg) && attempt < 6) {
    await sleep(400 * attempt);
    return newUser(tag, attempt + 1);
  }
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text.slice(0, 160)}`);
  const login = await call("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
  if (isTransport(login) && attempt < 6) {
    await sleep(400 * attempt);
    return newUser(tag, attempt + 1);
  }
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.text.slice(0, 160)}`);
  // Prove the session works and, more importantly, warm it into Redis.
  const warm = await call("/api/orders");
  if (warm.status !== 200) throw new Error(`warm-up failed: ${warm.status} ${warm.text.slice(0, 160)}`);
  return { email, password };
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail ?? ""}`);
}

// On failure, show the body: a bare "HTTP 503" does not say which layer refused.
function why(label, res) {
  if (res.status >= 200 && res.status < 400) return;
  const body = (res.text || "").slice(0, 220).replace(/\s+/g, " ");
  console.log(`        ${label}: HTTP ${res.status} ${body}`);
}

/* ------------------------------------------------------------------ V4 */
async function redisOutage() {
  head("V4  Redis outage drill");
  let user;
  try {
    user = await newUser("redis");
  } catch (err) {
    check("session established before the outage", false, String(err.message).slice(0, 120));
    return;
  }
  check("session established before the outage", true, user.email);

  const inRedis = docker("exec", "filspresso_redis", "redis-cli", "DBSIZE").trim();
  log(`redis DBSIZE before stop: ${inRedis}`);

  docker("stop", "-t", "5", "filspresso_redis");
  log("redis stopped");
  await sleep(2000);

  // 1. Authenticated read must survive via the Postgres fallback.
  const read = await call("/api/orders");
  check("authenticated read works with redis down", read.status === 200, `HTTP ${read.status}`);
  why("orders", read);

  // 2. A second read, to be sure it is not a cached response.
  const read2 = await call("/api/cart");
  check("second authenticated read works", read2.status === 200, `HTTP ${read2.status}`);
  why("cart", read2);

  // 3. Logout must still revoke.
  const logout = await call("/api/auth/logout", { method: "POST" });
  check("logout accepted with redis down", logout.status >= 200 && logout.status < 300, `HTTP ${logout.status}`);
  why("logout", logout);

  // 4. The revoked session must be rejected -- this is the fail-open case.
  const afterLogout = await call("/api/orders");
  check("revoked session rejected (no fail-open)", afterLogout.status === 401, `HTTP ${afterLogout.status}`);

  docker("start", "filspresso_redis");
  log("redis restarted");
  await sleep(3000);

  // 5. Revocation must be durable: the deny-list has to have reached Postgres,
  //    otherwise restarting Redis silently resurrects every logged-out session.
  const afterRestart = await call("/api/orders");
  check("still revoked after redis returns", afterRestart.status === 401, `HTTP ${afterRestart.status}`);

  // 6. And a fresh login must work again.
  const relogin = await call("/api/auth/login", { method: "POST", body: { email: user.email, password: user.password }, auth: false });
  check("fresh login works after recovery", relogin.status === 200, `HTTP ${relogin.status}`);
  const reloginRead = await call("/api/orders");
  check("new session authenticates", reloginRead.status === 200, `HTTP ${reloginRead.status}`);
}

/* ------------------------------------------------------------------ V5 */
async function shutdownDrill() {
  head("V5  graceful shutdown drill");
  let user;
  try {
    user = await newUser("shutdown");
  } catch (err) {
    check("session established before the stop", false, String(err.message).slice(0, 120));
    return;
  }
  check("session established before the stop", true, user.email);

  const orderBody = {
    items: [{ product_id: "no20-vertuo", quantity: 1 }],
    shippingAddress: {
      firstName: "Shut", lastName: "Down", street: "1 Test St",
      city: "Bucharest", postalCode: "010011", country: "RO",
    },
  };

  // Fire orders continuously, then stop the backend underneath them.
  let created = 0;
  let rejected = 0;
  let inFlight = true;
  const inflight = (async () => {
    while (inFlight) {
      const r = await call("/api/orders", { method: "POST", body: orderBody });
      if (r.status === 201) created++;
      else if (r.status === 0 || r.status >= 500) rejected++;
      if (r.status === 0) break;
    }
  })();

  await sleep(1500);
  const stopStart = Date.now();
  let stopOut = "";
  try {
    stopOut = docker("compose", "stop", "-t", "40", "backend");
  } catch (err) {
    stopOut = String(err.stdout || err.message || "");
  }
  const stopSeconds = ((Date.now() - stopStart) / 1000).toFixed(1);
  inFlight = false;
  await inflight;

  log(`docker compose stop took ${stopSeconds}s`);
  log(`orders created before the stop: ${created} (rejected ${rejected})`);

  // pool.end() is what distinguishes a clean drain from a killed process.
  let logs = "";
  try {
    logs = docker("logs", "--since", "3m", "filspresso_backend");
  } catch (err) {
    logs = String(err.stdout || "");
  }
  const poolClosed = /PostgreSQL pool closed cleanly/.test(logs);
  check("pool.end() ran during shutdown", poolClosed, poolClosed ? "logged 'pool closed cleanly'" : "no clean-pool log line");

  const shutdownHook = /Nest application successfully shutdown|shutdown hook|SIGTERM/.test(logs);
  check("nest reported shutdown", shutdownHook, shutdownHook ? "shutdown sequence logged" : "no shutdown sequence logged");

  check("some orders completed before the stop", created > 0, `${created} created`);

  // Restart and confirm the data written before the stop is intact and readable.
  docker("compose", "up", "-d", "backend");
  const up = await waitForHealthy(180000);
  check("backend healthy again after restart", up, up ? "health 200" : "did not become healthy");

  if (up) {
    jar = new Map();
    const relogin = await call("/api/auth/login", {
      method: "POST",
      body: { email: user.email, password: user.password },
      auth: false,
    });
    check("session still valid after restart", relogin.status === 200, `HTTP ${relogin.status}`);
    const orders = await call("/api/orders");
    // The collection route wraps its rows; accept either a bare array or an envelope.
    let persisted = -1;
    if (orders.status === 200) {
      const parsed = JSON.parse(orders.text);
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed.orders || parsed.data || parsed.items || [];
      persisted = rows.length;
    }
    check("orders written before the stop persisted", persisted > 0, `${persisted} orders readable`);
  }
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log("Phase 9 V4 + V5 outage drills");
  console.log(`  target  ${BASE}`);
  console.log(`  client  ${CLIENT_IP}`);

  let fatal = null;
  try {
    await redisOutage();
  } catch (err) {
    fatal = err;
  }
  try {
    if (!fatal) await shutdownDrill();
  } catch (err) {
    fatal = fatal || err;
  } finally {
    // Never leave the stack down, whatever happened above.
    try { docker("start", "filspresso_redis"); } catch { /* already up */ }
    try { docker("compose", "up", "-d", "backend"); } catch { /* already up */ }
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== summary ===`);
  console.log(`  ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const f of failed) console.log(`  FAILED: ${f.name} (${f.detail})`);
  if (fatal) console.log(`\n  drill crashed: ${fatal.stack || fatal}`);
  console.log(`\nRESULT: ${!fatal && failed.length === 0 ? "PASS" : "FAIL"}`);
  process.exit(!fatal && failed.length === 0 ? 0 : 1);
})();
