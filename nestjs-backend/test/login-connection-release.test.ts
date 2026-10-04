import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

const SERVICE_PATH = path.resolve(__dirname, "..", "src", "auth", "auth-complex.service.ts");

/**
 * Phase 5.1 moves the Argon2 verify out of the pooled connection.
 *
 * This asserts the ordering rather than the latency. Timing cannot demonstrate the win
 * here -- the login's database work and its Argon2 window are both roughly 200 ms, and
 * the process serialises elsewhere as well, so a wall-clock benchmark of "is a
 * connection free during the verify" needs an Argon2 window far wider than
 * `ARGON2_TIME_COST` allows (passwords.ts clamps it to 10) to be conclusive. The
 * property that matters, and that must not silently regress, is structural: no
 * connection is checked out while `verifyPassword` runs.
 */
function loginSource(): string {
  const src = readFileSync(SERVICE_PATH, "utf8");
  const start = src.indexOf("async login(req: Request");
  assert.notEqual(start, -1, "login() not found in auth-complex.service.ts");
  const end = src.indexOf("async loginMfaVerify(", start);
  assert.notEqual(end, -1, "loginMfaVerify() not found; cannot bound login()");
  return src.slice(start, end);
}

describe("login releases the pooled connection across the Argon2 verify", () => {
  const body = loginSource();

  it("holds the connection in a mutable binding, not a const", () => {
    // `let` is load-bearing: the method gives the connection up mid-way and takes a
    // new one afterwards, so a `const client` could not express this at all.
    assert.match(
      body,
      /let client: PoolClient \| null = await pool\.connect\(\)/,
      "login must declare the client as a mutable, nullable binding",
    );
  });

  it("releases before verifyPassword and re-acquires after it", () => {
    const release = body.indexOf("client.release()");
    const verify = body.indexOf("verifyPassword(");
    const reacquire = body.indexOf("client = await pool.connect()", verify);

    assert.notEqual(release, -1, "login must release the connection explicitly");
    assert.notEqual(verify, -1, "login must call verifyPassword");
    assert.notEqual(reacquire, -1, "login must re-acquire a connection for the write phase");

    assert.ok(release < verify, "the connection must be released before the verify starts");
    assert.ok(reacquire > verify, "the connection must only be taken again after the verify");
  });

  it("nulls the binding on release so no path can use a returned connection", () => {
    // Without this, a throw between release and re-acquire would reach `finally` and
    // release the same client twice, which corrupts the pool.
    const release = body.indexOf("client.release()");
    const nul = body.indexOf("client = null", release);
    assert.ok(nul > release && nul - release < 80, "client must be nulled right after release");
  });

  it("releases only what is actually held", () => {
    assert.match(
      body,
      /finally \{ client\?\.release\(\); \}/,
      "the finally block must tolerate an already-released connection",
    );
  });

  it("captures the password hash before giving the connection up", () => {
    // `user` comes from the released connection's query. Reading a field off it later
    // is fine, but the hash must be lifted out so nothing re-queries on a dead client.
    assert.match(
      body,
      /const passwordHash = user\.password_hash as string;[\s\S]*?client\.release\(\);/,
      "the hash must be captured before the release",
    );
  });
});