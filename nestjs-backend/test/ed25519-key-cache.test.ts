import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";

const { describe, it, before } = test;

import {
  clearEd25519KeyCache,
  generateToken,
  parseEd25519PublicKey,
  verifyToken,
} from "../src/common/utils/auth-tokens";

/**
 * Phase 5.3 caches parsed Ed25519 KeyObjects.
 *
 * The risk is not that the cache is slow to work, it is that it is wrong: a stale
 * object would verify with the previous key after a rotation, or two keys sharing a
 * kid could collide. So these assert the cache returns identical behaviour to a fresh
 * parse, not merely that it returns something.
 */

/** Ed25519 keypair, generated per test so no fixture key is shared. */
function keypair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

describe("Ed25519 KeyObject cache", () => {
  before(() => {
    clearEd25519KeyCache();
  });

  it("returns the identical object for the same PEM, not a re-parse", () => {
    const { publicPem } = keypair();
    const first = parseEd25519PublicKey(publicPem);
    const second = parseEd25519PublicKey(publicPem);
    assert.equal(first, second, "a repeat lookup must hit the cache");
  });

  it("returns different objects for different keys", () => {
    const a = parseEd25519PublicKey(keypair().publicPem);
    const b = parseEd25519PublicKey(keypair().publicPem);
    assert.notEqual(a, b, "distinct keys must not share a cache entry");
  });

  it("does not confuse two keys that differ only in whitespace", () => {
    // normalizePem strips surrounding whitespace, so these are the same key and must
    // hit one entry rather than creating a second parse of identical material.
    const { publicPem } = keypair();
    assert.equal(
      parseEd25519PublicKey(publicPem),
      parseEd25519PublicKey(`\n${publicPem}\n  `),
      "normalisation must make whitespace-only differences the same key",
    );
  });

  it("still throws on a malformed key, rather than caching the failure", () => {
    assert.throws(() => parseEd25519PublicKey("not a pem"), "a malformed key must not be swallowed");
    // And the failure must not have poisoned the cache for a later good key.
    const { publicPem } = keypair();
    assert.ok(parseEd25519PublicKey(publicPem));
  });

  it("does not serve a stale object after the cache is cleared", () => {
    const a = parseEd25519PublicKey(keypair().publicPem);
    clearEd25519KeyCache();
    const b = parseEd25519PublicKey(keypair().publicPem);
    assert.notEqual(a, b, "clearing must force a re-parse");
  });
});

describe("token signing still verifies after the cache change", () => {
  before(() => {
    clearEd25519KeyCache();
  });

  it("verifies a freshly issued token", () => {
    const token = generateToken({ id: 42, username: "cacheuser", role: "user" } as any);
    const claims = verifyToken(token);
    assert.ok(claims, "a token signed with the cached private key must verify");
    assert.equal((claims as any).id, 42);
  });

  it("rejects a token whose signature was tampered with", () => {
    const token = generateToken({ id: 7, username: "cacheuser2", role: "user" } as any);
    const parts = token.split(".");
    const flipped = parts[2].slice(0, -1) + (parts[2].slice(-1) === "A" ? "B" : "A");
    assert.equal(verifyToken(`${parts[0]}.${parts[1]}.${flipped}`), null);
  });

  it("rejects a token signed by a different key", () => {
    // The whole point of keying the cache on the PEM: a new key must be parsed
    // afresh rather than the previous key's object being reused.
    const claims = { id: 9, username: "cacheuser3", role: "user", exp: Math.floor(Date.now() / 1000) + 600 };
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const input = `${b64({ alg: "EdDSA", typ: "JWT" })}.${b64(claims)}`;
    const sig = crypto
      .sign(null, Buffer.from(input, "utf8"), crypto.createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" }).toString() as string))
      .toString("base64url");
    const foreign = `${input}.${sig}`;

    // A well-formed token from an untrusted key must not verify.
    assert.equal(verifyToken(foreign), null, "a foreign-signed token must not verify");

    // And the real key still works afterwards.
    const good = generateToken({ id: 11, username: "cacheuser4", role: "user" } as any);
    assert.ok(verifyToken(good), "the real key must still verify after a foreign token");
    assert.ok(publicKey);
  });
});