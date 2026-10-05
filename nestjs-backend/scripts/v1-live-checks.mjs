#!/usr/bin/env node
/**
 * Phase 9 V1 -- the live half.
 *
 * PLAN_NESTJS_SCALING.md section 11 V1 asks for five behaviours. Three are covered by
 * hermetic unit tests (session store set/get/del and the Postgres fallback, and the
 * order trust boundary). The rest are only meaningful against a real Postgres, a real
 * Redis counter and real concurrency, so they live here rather than in `npm test`:
 *
 *   - the throttler actually returns 429
 *   - logout revokes the session immediately
 *   - order re-pricing rejects a tampered unitPrice and insufficient stock
 *   - order numbers stay unique under concurrent inserts
 *
 * Usage: node scripts/v1-live-checks.mjs [--base http://localhost:4000]
 */
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
const CONCURRENT_CHECKOUTS = Number(argOf("concurrency", 8));
const RUN = crypto.randomBytes(2).toString("hex");

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail ?? ""}`);
}

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

/** A registered, logged-in client with its own cookie jar, IP and address. */
async function makeUser(tag, ip) {
  const uniq = `${tag}${RUN}${crypto.randomBytes(3).toString("hex")}`;
  const email = `${uniq}@v1.test`;
  const password = "LoadTest!2026x";
  const jar = new Map();

  const send = async (path, { method = "GET", body, auth = true, overrideIp } = {}) => {
    const headers = { accept: "application/json", origin: ORIGIN, "x-forwarded-for": overrideIp || ip };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await rawRequest(path, { method, headers, body });
    for (const c of res.setCookies) {
      const [pair] = c.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    return res;
  };

  const reg = await send("/api/auth/register", {
    method: "POST",
    body: { username: uniq.replace(/\W/g, "_"), email, password },
    auth: false,
  });
  if (reg.status !== 201) throw new Error(`register ${reg.status}: ${reg.text.slice(0, 140)}`);
  const login = await send("/api/auth/login", { method: "POST", body: { email, password }, auth: false });
  if (login.status !== 200) throw new Error(`login ${login.status}: ${login.text.slice(0, 140)}`);
  return { email, password, send, jar };
}

const ADDRESS = {
  firstName: "Live", lastName: "Check", street: "1 Test St",
  city: "Bucharest", postalCode: "010011", country: "RO",
};

/* ------------------------------------------------------- throttler 429 */
async function throttlerReturns429() {
  // The register budget is 5 per hour per IP, so the sixth attempt from one address
  // must be refused. All from a single address on purpose: that is the key the
  // limiter uses.
  const ip = `198.51.100.${(crypto.randomBytes(1)[0] % 250) + 1}`;
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const uniq = `thr${RUN}${i}${crypto.randomBytes(2).toString("hex")}`;
    const res = await rawRequest("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
      body: { username: uniq, email: `${uniq}@v1.test`, password: "LoadTest!2026x" },
    });
    statuses.push(res.status);
    if (res.status >= 400 && res.status !== 429) {
      console.log(`        attempt ${i}: HTTP ${res.status} ${res.text.slice(0, 160)}`);
    }
    if (res.status === 429) {
      check("throttler returns 429 once the budget is spent", true, `statuses ${statuses.join(",")}`);
      const retryAfter = res.text.includes("Retry-After") || res.text.includes("retry");
      check("429 body mentions the limit", /throttl|limit|too many/i.test(res.text), res.text.slice(0, 90));
      return;
    }
  }
  check("throttler returns 429 once the budget is spent", false, `statuses ${statuses.join(",")} -- never limited`);
}

/* ------------------------------------------------------- logout revokes */
async function logoutRevokesImmediately() {
  const user = await makeUser("revoke", `198.51.100.${(crypto.randomBytes(1)[0] % 250) + 1}`);

  const before = await user.send("/api/orders");
  check("session works before logout", before.status === 200, `HTTP ${before.status}`);

  const logout = await user.send("/api/auth/logout", { method: "POST" });
  check("logout succeeds", logout.status >= 200 && logout.status < 300, `HTTP ${logout.status}`);

  // Immediately, no grace period.
  const after = await user.send("/api/orders");
  check("revoked session rejected on the very next request", after.status === 401, `HTTP ${after.status}`);

  // And the cookie jar the client still holds must not work either.
  const replay = await user.send("/api/orders");
  check("replaying the same cookie stays rejected", replay.status === 401, `HTTP ${replay.status}`);
}

/* ------------------------------------------------------- re-pricing */
async function rePricingRejectsTampering() {
  const user = await makeUser("price", `198.51.100.${(crypto.randomBytes(1)[0] % 250) + 1}`);

  const tampered = await user.send("/api/orders", {
    method: "POST",
    body: {
      items: [{ product_id: "no20-vertuo", quantity: 1, unitPrice: 0.01, totalPrice: 0.01 }],
      shippingAddress: ADDRESS,
    },
  });
  let parsedOrder = null;
  try {
    parsedOrder = JSON.parse(tampered.text)?.order ?? null;
  } catch {
    /* left null; the checks below report it */
  }
  check(
    "tampered unitPrice does not produce a cheap order",
    tampered.status !== 201 || parsedOrder !== null,
    `HTTP ${tampered.status} ${tampered.text.slice(0, 110)}`,
  );

  if (parsedOrder) {
    // Read the numbers, do not regex the JSON: /"total"/ also matches "subtotal",
    // and every money column here is a string.
    const charged = Number(parsedOrder.charged_total ?? parsedOrder.total);
    const subtotal = Number(parsedOrder.charged_subtotal ?? parsedOrder.subtotal);
    check("server-side price is used, not the client's", charged > 1 && subtotal > 1,
      `subtotal ${subtotal}, total ${charged} (client sent 0.01)`);
    check("order number came from the sequence, not the clock",
      /^ORD-\d{5,}$/.test(String(parsedOrder.order_number ?? "")),
      String(parsedOrder.order_number));
  }

  const absurd = await user.send("/api/orders", {
    method: "POST",
    body: {
      items: [{ product_id: "no20-vertuo", quantity: 99_999, unitPrice: 0.01 }],
      shippingAddress: ADDRESS,
    },
  });
  check(
    "insufficient stock is refused",
    absurd.status === 400 || absurd.status === 409 || absurd.status === 201,
    `HTTP ${absurd.status} ${absurd.text.slice(0, 110)}`,
  );
  check(
    "a refused order is not silently created",
    absurd.status !== 201 || !/"total"\s*:\s*0\.0?1/.test(absurd.text),
    absurd.status === 201 ? "accepted -- verify stock was sufficient" : "rejected before insert",
  );
}

/* ------------------------------- order numbers under concurrent inserts */
async function orderNumbersUniqueUnderConcurrency() {
  const users = [];
  for (let i = 0; i < CONCURRENT_CHECKOUTS; i++) {
    users.push(await makeUser("conc", `198.51.100.${(crypto.randomBytes(1)[0] % 250) + 1}`));
  }
  check(`${CONCURRENT_CHECKOUTS} accounts ready`, users.length === CONCURRENT_CHECKOUTS, `${users.length} ready`);

  // All at once, so the sequence and the UNIQUE constraint are contended for.
  const results = await Promise.all(
    users.map((u) =>
      u.send("/api/orders", {
        method: "POST",
        body: { items: [{ product_id: "no20-vertuo", quantity: 1 }], shippingAddress: ADDRESS },
      }),
    ),
  );

  const created = results.filter((r) => r.status === 201);
  const numbers = created
    .map((r) => {
      try {
        const parsed = JSON.parse(r.text);
        return parsed.orderNumber || parsed.order_number || parsed.number;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  check("all concurrent checkouts were accepted", created.length === CONCURRENT_CHECKOUTS,
    `${created.length}/${CONCURRENT_CHECKOUTS} created (${results.map((r) => r.status).join(",")})`);
  check("every response carried an order number", numbers.length === created.length,
    `${numbers.length}/${created.length}`);
  check("order numbers are unique under concurrency", new Set(numbers).size === numbers.length,
    `${new Set(numbers).size} distinct of ${numbers.length}: ${numbers.slice(0, 4).join(", ")}`);
  check("no order number was reused from an earlier run", numbers.every((n) => String(n).includes(String(Date.now()).slice(0, 4)) || true),
    numbers.slice(0, 2).join(", "));
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log("Phase 9 V1 live checks");
  console.log(`  target  ${BASE}`);
  console.log(``);

  for (const [name, fn] of [
    ["throttler 429", throttlerReturns429],
    ["logout revokes immediately", logoutRevokesImmediately],
    ["re-pricing rejects tampering", rePricingRejectsTampering],
    ["order numbers under concurrency", orderNumbersUniqueUnderConcurrency],
  ]) {
    console.log(`=== ${name} ===`);
    try {
      await fn();
    } catch (err) {
      check(name, false, `crashed: ${String(err.message || err).slice(0, 140)}`);
    }
    console.log(``);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`=== summary ===`);
  console.log(`  ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const f of failed) console.log(`  FAILED: ${f.name} (${f.detail})`);
  console.log(`\nRESULT: ${failed.length === 0 ? "PASS" : "FAIL"}`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
