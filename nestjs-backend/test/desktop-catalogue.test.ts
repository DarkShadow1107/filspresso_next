import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { playgroundModelKeys, playgroundModelFile } from "../src/desktop/text-models";

const { describe, it } = test;

const BACKEND_ROOT = path.resolve(__dirname, "..");
const TEXT_MODELS = path.resolve(BACKEND_ROOT, "src", "desktop", "text-models.ts");
const FRONTEND_ACCESS = path.resolve(BACKEND_ROOT, "..", "src", "lib", "modelAccess.ts");
const DESKTOP_CONTROLLER = path.resolve(BACKEND_ROOT, "src", "desktop", "desktop.controller.ts");
const GATEWAY = path.resolve(BACKEND_ROOT, "src", "desktop", "desktop-gateway.service.ts");
const DEVICE_MIGRATION = path.resolve(BACKEND_ROOT, "data", "migrations", "2026-10-desktop-device.sql");

/**
 * Read a `const NAME = [...]` array, resolving entries that are themselves constants.
 *
 * Both halves are needed, and both halves were a bug first. The backend list holds string
 * literals; the frontend's `ALL_TEXT_MODEL_KEYS` holds references to `TEXT_MODEL_230M` and
 * friends, each of which is `export const TEXT_MODEL_230M = "lfm2_5_230m_q4_k_m"`. Reading
 * only literals reports the frontend list as empty and the comparison passes vacuously,
 * which is the worst way for a drift guard to fail: it looks like a working test.
 */
function readConstArray(source: string, constName: string): string[] {
  const start = source.indexOf(`const ${constName}`);
  assert.notEqual(start, -1, `${constName} not found`);
  // Anchored on the `=` that begins the assignment. The first `[` after the name is the one
  // in `TextModelKey[]`, which would parse as an empty array.
  const assignment = /=\s*\[/.exec(source.slice(start));
  assert.ok(assignment, `${constName} has no array literal to read`);
  const open = start + assignment.index + assignment[0].length - 1;
  const close = source.indexOf("]", open);
  const body = source.slice(open + 1, close);

  const entries: string[] = [];
  // The literal branch keeps its quotes so the two branches stay distinguishable -- the
  // quotes are the marker, and consuming them makes a literal indistinguishable from a
  // constant reference that happens to look like one.
  for (const m of body.matchAll(/"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[1] !== undefined) {
      entries.push(m[1]);
      continue;
    }
    const literal = new RegExp(`const ${m[2]} = "([^"]+)"`).exec(source);
    assert.ok(literal, `could not resolve ${m[2]} to a string literal`);
    entries.push(literal[1]);
  }
  return entries;
}

/** The GGUF filename the frontend maps a given model key to. */
function frontendFileForKey(source: string, modelKey: string): string | null {
  const constMatch = new RegExp(`const ((?:TEXT|VISION|AUDIO)_MODEL_[A-Z0-9_]+) = "${modelKey}"`).exec(source);
  if (!constMatch) return null;
  // The map uses computed keys -- `[TEXT_MODEL_230M]: "LFM2.5-...gguf"` -- so the name is
  // bracketed and a bare `NAME:` pattern silently never matches.
  const mapBlock = source.slice(source.indexOf("MODEL_FILE_BY_KEY"));
  const fileMatch = new RegExp(`\\[?\\s*${constMatch[1]}\\s*\\]?\\s*:\\s*"([^"]+)"`).exec(mapBlock);
  return fileMatch ? fileMatch[1] : null;
}

/**
 * The backend restates the Playground's text-model list because it cannot import the
 * frontend's. Two copies of a list that decides what the product sells is exactly the shape
 * that drifts quietly, so the drift is made to fail here instead.
 */
describe("the Playground's text-model list", () => {
  const backend = readFileSync(TEXT_MODELS, "utf8");
  const frontend = readFileSync(FRONTEND_ACCESS, "utf8");

  it("is the same set the web client offers", () => {
    const fromBackend = readConstArray(backend, "PLAYGROUND_TEXT_MODEL_KEYS");
    const fromFrontend = readConstArray(frontend, "ALL_TEXT_MODEL_KEYS");
    assert.ok(fromFrontend.length > 0, "could not parse ALL_TEXT_MODEL_KEYS from the frontend");
    assert.ok(fromBackend.length > 0, "could not parse PLAYGROUND_TEXT_MODEL_KEYS from the backend");
    assert.deepEqual(
      [...fromBackend].sort(),
      [...fromFrontend].sort(),
      "the desktop catalogue and the web line-up must offer the same models; add to both or neither",
    );
  });

  it("maps every model to the same GGUF file the web client requests", () => {
    // The AI service takes a filename, not a key. If this mapping drifts from the frontend's
    // MODEL_FILE_BY_KEY, the gateway silently loads different weights than the app named --
    // a failure that looks like a bad answer rather than a bad mapping.
    const keys = readConstArray(backend, "PLAYGROUND_TEXT_MODEL_KEYS");
    const filesBlock = backend.slice(backend.indexOf("PLAYGROUND_TEXT_MODEL_FILES"));
    for (const key of keys) {
      // Bare identifier keys, as the map is actually written -- matching a quoted key here
      // finds nothing and fails as if the mapping were absent.
      const match = new RegExp(`"?${key}"?\\s*:\\s*"([^"]+)"`).exec(filesBlock);
      assert.ok(match, `no GGUF filename mapped for ${key}`);
      const frontendFile = frontendFileForKey(frontend, key);
      assert.ok(frontendFile, `${key} has no entry in the frontend MODEL_FILE_BY_KEY`);
      assert.equal(match[1], frontendFile, `${key} resolves to a different GGUF file on each side`);
    }
  });

  it("offers no vision or audio model", () => {
    const keys = readConstArray(backend, "PLAYGROUND_TEXT_MODEL_KEYS");
    for (const key of keys) {
      assert.ok(!key.includes("vl_"), `${key} is a vision model and has no place in the Playground`);
      assert.ok(!key.includes("audio"), `${key} is an audio model and has no place in the Playground`);
    }
  });

  it("the full catalogue also serves explicitly mapped Vision and Audio models", () => {
    // The bug this guards against: filtering the pricing table by key prefix swept in the
    // vision and audio models, because they share the `lfm2_5_` prefix.
    const controller = readFileSync(DESKTOP_CONTROLLER, "utf8");
    assert.match(controller, /playgroundModelKeys\(\)/);
    assert.equal(playgroundModelKeys().length, 9);
    assert.equal(playgroundModelFile("lfm2_5_vl_450m_q4_k_m"), "LFM2.5-VL-450M-Q4_K_M.gguf");
    assert.equal(playgroundModelFile("lfm2_5_audio_1_5b_q4_0"), "LFM2.5-Audio-1.5B-Q4_0.gguf");
    assert.equal(playgroundModelFile("constructor"), null);
    for (const key of playgroundModelKeys()) assert.equal(playgroundModelFile(key), frontendFileForKey(frontend, key));
    assert.doesNotMatch(
      controller,
      /startsWith\("lfm2_5_"\)/,
      "the catalogue must use the explicit text-model list, not a key-name prefix",
    );
  });
});

describe("the desktop device grant", () => {
  const service = readFileSync(path.resolve(BACKEND_ROOT, "src", "auth", "auth-complex.service.ts"), "utf8");
  const controller = readFileSync(path.resolve(BACKEND_ROOT, "src", "auth", "desktop-auth.controller.ts"), "utf8");

  it("returns a credential in the body, and is the only path that does", () => {
    assert.match(service, /accessToken: token/);
    assert.match(service, /refreshToken: refresh\.token/);
    // The controller's job is to hand the service's result on untouched; the credential is
    // minted in the service, so asserting the field against the controller was checking the
    // wrong file.
    assert.match(controller, /this\.authComplexService\.desktopTokenGrant/);
    // The web controller strips the token on purpose. If that ever stops happening the
    // cookie-only guarantee is gone, and it is worth failing a test to notice.
    const webController = readFileSync(path.resolve(BACKEND_ROOT, "src", "auth", "auth-complex.controller.ts"), "utf8");
    assert.match(webController, /function withoutToken/);
  });

  it("sets no cookie", () => {
    assert.doesNotMatch(
      controller,
      /setSessionCookie|clearSessionCookie/,
      "a desktop client has no cookie jar; handing it one leaves a second credential path",
    );
  });

  it("stores the refresh credential hashed, never in the clear", () => {
    assert.match(service, /authTokens\.hashSessionToken\(token\)/);
    const rows = readFileSync(path.resolve(BACKEND_ROOT, "src", "common", "guards", "session-store.service.ts"), "utf8");
    assert.match(rows, /hashSessionToken\(params\.refreshToken\)/);
    assert.doesNotMatch(rows, /refresh_token_hash = \$1.*params\.refreshToken[^)]*\)\s*,\s*params\.refreshToken/s);
  });

  it("rotates both credentials in one statement", () => {
    // Two statements would let a crash leave a live access token beside a spent refresh
    // credential, which is the failure the single UPDATE exists to make impossible.
    assert.match(
      service,
      /UPDATE user_sessions\s+SET session_token_hash = \$1, expires_at = \$2, refresh_token_hash = \$3/,
    );
  });

  it("kills the session when a spent refresh token is replayed", () => {
    assert.match(service, /DELETE FROM user_sessions WHERE id = \$1/);
    assert.match(service, /desktop_refresh_reuse_detected/);
  });

  it("gives every failure the same answer", () => {
    // "No such session", "not desktop" and "expired" are different states the client cannot
    // act on differently, so none of them may be distinguishable from outside.
    const matches = service.match(/error: "Invalid refresh token"/g) || [];
    assert.ok(matches.length >= 4, `expected the same error for every refresh failure, found ${matches.length}`);
    assert.doesNotMatch(service, /error: "Refresh token expired"/);
    assert.doesNotMatch(service, /error: "Session not found"/);
  });
});

describe("desktop session storage", () => {
  const migration = readFileSync(DEVICE_MIGRATION, "utf8");

  it("carries device identity and a refresh credential", () => {
    for (const column of ["device_id", "device_name", "platform", "app_version", "client_type", "refresh_token_hash", "refresh_expires_at", "last_seen_at"]) {
      assert.ok(migration.includes(column), `${column} missing from the migration`);
    }
  });

  it("constrains client_type rather than trusting it", () => {
    // This column decides which refresh path a token may use, so it cannot be free text.
    assert.match(migration, /CHECK \(client_type IN \('web', 'desktop'\)\)/);
  });

  it("indexes the lookups the refresh and revoke paths perform", () => {
    assert.match(migration, /idx_user_sessions_refresh_hash/);
    assert.match(migration, /idx_user_sessions_account_device/);
  });
});

describe("auth throttling for the desktop client", () => {
  const policy = readFileSync(path.resolve(BACKEND_ROOT, "src", "config", "rate-limit.policy.ts"), "utf8");
  const guard = readFileSync(path.resolve(BACKEND_ROOT, "src", "common", "guards", "desktop-aware-throttler.guard.ts"), "utf8");

  it("has a budget for both desktop routes", () => {
    assert.match(policy, /"POST \/api\/auth\/desktop\/token":/);
    assert.match(policy, /"POST \/api\/auth\/desktop\/refresh":/);
  });

  it("refreshes on a timer, so its budget is looser than the grant's", () => {
    // A 15-minute access token means a desktop app refreshes several times an hour. Folding
    // that into the grant's budget would sign out every user with a long session.
    const grant = policy.match(/"POST \/api\/auth\/desktop\/token": \{ limit: (\d+)/);
    const refresh = policy.match(/"POST \/api\/auth\/desktop\/refresh": \{ limit: (\d+)/);
    assert.ok(grant && refresh, "both limits must be literal so this comparison is meaningful");
    assert.ok(
      Number(refresh[1]) > Number(grant[1]),
      `refresh budget (${refresh[1]}) must exceed the grant's (${grant[1]})`,
    );
  });

  it("keys the desktop routes per account and device, not per IP", () => {
    assert.match(guard, /DESKTOP_ROUTE_PREFIX/);
    assert.match(guard, /desktopKey/);
    assert.match(guard, /sha256/);
    // The whole point: a shared NAT must not share one login budget.
    assert.ok(guard.includes("body.email") && guard.includes("body.deviceId"));
  });

  it("changes the web login's keying not at all", () => {
    // Only the desktop prefix is special-cased. The stock guard still governs everything
    // else, because a generous per-account limit on the login endpoint is the vulnerability.
    assert.match(guard, /startsWith\(DesktopAwareThrottlerGuard\.DESKTOP_ROUTE_PREFIX\)/);
    assert.match(guard, /super\.getTracker\(req\)/);
  });
});

describe("the desktop entitlement endpoint", () => {
  const controller = readFileSync(DESKTOP_CONTROLLER, "utf8");

  it("answers access, allowance and affordability in one call", () => {
    assert.match(controller, /resolveSpectreAccess/);
    assert.match(controller, /getAllowance/);
    assert.match(controller, /canGenerate/);
  });

  it("is behind the bearer-token guard", () => {
    assert.match(controller, /@UseGuards\(JwtAuthGuard\)/);
  });

  it("reports locked models with their prices rather than hiding them", () => {
    // The lock and the affordability come from the shared policy, so the catalogue and the
    // stream gate cannot disagree about which model an account may use.
    assert.match(controller, /desktopModelAccess/);
    assert.match(controller, /inputPer1M: rates.inputPer1M/);
    assert.match(controller, /label: price.label/);
  });
});

describe("the desktop streaming gateway", () => {
  const gateway = readFileSync(GATEWAY, "utf8");

  it("gates on entitlement and on money before any model load", () => {
    assert.match(gateway, /resolveSpectreAccess/);
    assert.match(gateway, /assertCanGenerate|canGenerate/);
    // The gate must come before the upstream fetch, not after it.
    const gateAt = gateway.search(/assertCanGenerate|canGenerate/);
    const upstreamAt = gateway.search(/chat\/stream/);
    assert.ok(gateAt > -1 && upstreamAt > -1, "both the gate and the upstream call must exist");
    assert.ok(gateAt < upstreamAt, "the money gate must run before the model is asked to do work");
  });

  it("meters on the done frame with an idempotency key", () => {
    assert.match(gateway, /recordUsage/);
    assert.match(gateway, /requestId/);
    // The web route meters with requestId: null and leans on the stream firing once. The
    // desktop gateway generates one per request, so a retried report cannot double-charge.
  });

  it("bills the desktop scope", () => {
    assert.match(gateway, /scope: "desktop"/);
  });
});

describe("rate-limit environment overrides", () => {
  const POLICY = path.resolve(BACKEND_ROOT, "src", "config", "rate-limit.policy.ts");

  it("keeps the literal budget for any route that sets no override", () => {
    // The override must be opt-in per route. If it leaked, an operator raising one budget
    // would silently raise every budget, and the literals in the policy would stop meaning
    // anything.
    const policy = readFileSync(POLICY, "utf8");
    assert.match(policy, /Number\.isNaN\(limit\) \? fallback\.limit : limit/);
    assert.match(policy, /Number\.isNaN\(windowMs\) \? fallback\.ttlMs : windowMs/);
  });

  it("derives a predictable env key from the route", () => {
    // Collapsing runs of separators is the whole point: without the `+`, the space and slash
    // after POST are adjacent and produce `POST__API_...`, a name nobody types correctly. An
    // operator who guesses wrong gets the production number with no warning.
    const policy = readFileSync(POLICY, "utf8");
    assert.match(policy, /\[\^A-Za-z0-9\]\+\/g/);
    assert.ok(
      !policy.includes("replace(/[^A-Za-z0-9]/g"),
      "the single-character class leaves adjacent separators producing doubled underscores",
    );
    const derived = "POST /api/auth/register".replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
    assert.equal(derived, "POST_API_AUTH_REGISTER");
  });

  it("refuses a non-positive override rather than silently disabling the control", () => {
    // A limit of 0 would fail every request on that route, which reads as an outage rather
    // than a misconfiguration.
    const policy = readFileSync(POLICY, "utf8");
    assert.match(policy, /must be a positive integer/);
  });

  it("gives the desktop grant and refresh different budgets", () => {
    const policy = readFileSync(POLICY, "utf8");
    const grant = policy.match(/"POST \/api\/auth\/desktop\/token": \{ limit: (\d+)/);
    const refresh = policy.match(/"POST \/api\/auth\/desktop\/refresh": \{ limit: (\d+)/);
    assert.ok(grant && refresh);
    assert.ok(Number(refresh[1]) > Number(grant[1]));
  });
});
