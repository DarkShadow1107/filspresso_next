import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

import { chatMemoryLimitForTier } from "../src/chat/chat-history.service";

const SERVICE = path.resolve(__dirname, "..", "src", "chat", "chat-history.service.ts");
const CONTROLLER = path.resolve(__dirname, "..", "src", "chat", "chat.controller.ts");
const SESSION = path.resolve(__dirname, "..", "src", "common", "guards", "active-session.service.ts");

/**
 * Retention caps were computed from `req.user.subscription`, but the session does not
 * carry a subscription: `ActiveSessionService.resolve()` returns `{ token, claims,
 * accountId }`. So the tier was always null and every plan -- including MAX and
 * ULTIMATE -- was capped at the anonymous allowance of 5 conversations.
 */
describe("chat retention cap", () => {
  it("caps each tier as advertised", () => {
    assert.equal(chatMemoryLimitForTier("none"), 5);
    assert.equal(chatMemoryLimitForTier("free"), 5);
    assert.equal(chatMemoryLimitForTier("basic"), 20);
    assert.equal(chatMemoryLimitForTier("plus"), 50);
    assert.equal(chatMemoryLimitForTier("pro"), 100);
    assert.equal(chatMemoryLimitForTier("max"), 200);
    assert.equal(chatMemoryLimitForTier("ultimate"), 200);
  });

  it("falls back to the anonymous cap for an unknown or missing tier", () => {
    // Not to something generous: an unrecognised value must never widen retention.
    assert.equal(chatMemoryLimitForTier(null), 5);
    assert.equal(chatMemoryLimitForTier(undefined), 5);
    assert.equal(chatMemoryLimitForTier(""), 5);
    assert.equal(chatMemoryLimitForTier("enterprise"), 5);
    assert.equal(chatMemoryLimitForTier("toString"), 5, "prototype keys must not resolve");
  });

  it("is case insensitive", () => {
    assert.equal(chatMemoryLimitForTier("ULTIMATE"), 200);
    assert.equal(chatMemoryLimitForTier(" Pro "), 100);
  });

  it("reads the tier from the account row, not from the session", () => {
    const service = readFileSync(SERVICE, "utf8");
    assert.match(
      service,
      /SELECT subscription FROM accounts WHERE id = \$1/,
      "the tier must come from the accounts row",
    );
    assert.doesNotMatch(
      service,
      /replaceHistory\([\s\S]{0,200}tier: string \| null/,
      "replaceHistory must not accept a caller-supplied tier",
    );
  });

  it("resolves the tier inside the transaction", () => {
    const service = readFileSync(SERVICE, "utf8");
    const begin = service.indexOf('await client.query("BEGIN")');
    const resolve = service.indexOf("await resolveAccountTier(client, accountId)");
    assert.ok(begin !== -1 && resolve !== -1, "expected a BEGIN and a tier lookup");
    assert.ok(resolve > begin, "the tier must be read after BEGIN, so it sees a consistent row");
  });

  it("no longer reads a subscription off req.user", () => {
    const controller = readFileSync(CONTROLLER, "utf8");
    assert.doesNotMatch(
      controller,
      /req\.user\?\.\[?["']?subscription/,
      "the controller must not pass req.user.subscription, which is always undefined",
    );
  });

  it("documents that the session carries no subscription", () => {
    // Guards the root cause rather than the symptom: if a future change adds
    // `subscription` to the resolved session, this note must be revisited.
    const session = readFileSync(SESSION, "utf8");
    assert.doesNotMatch(
      session,
      /subscription:\s*string/,
      "if the session ever does carry a subscription, the tier lookup in ChatHistoryService needs revisiting",
    );
  });
});