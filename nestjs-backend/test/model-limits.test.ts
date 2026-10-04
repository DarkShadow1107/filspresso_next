import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const { describe, it } = test;

import { MODEL_MONTHLY_LIMITS, isMeteredModel, modelLimitForTier } from "../src/kafelot/model-usage.service";

/**
 * The Nest table decides what is enforced; the TypeScript table in
 * `src/lib/modelAccess.ts` is what the plans page shows customers. A mismatch means
 * either users are promised prompts they cannot use, or they are sold a smaller
 * allowance than advertised. A cross-runtime import is impossible, so the canonical
 * source is parsed and compared here.
 */
const MODEL_ACCESS_PATH = path.resolve(__dirname, "..", "..", "src", "lib", "modelAccess.ts");

const TIERS = ["free", "basic", "plus", "pro", "max", "ultimate"] as const;

/** Pull the `MODEL_MONTHLY_LIMITS` literal out of the TypeScript source. */
function parseCanonicalLimits(): Record<string, Record<string, number>> {
  const src = readFileSync(MODEL_ACCESS_PATH, "utf8");
  const start = src.indexOf("MODEL_MONTHLY_LIMITS");
  assert.notEqual(start, -1, "MODEL_MONTHLY_LIMITS not found in src/lib/modelAccess.ts");

  const open = src.indexOf("{", start);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, "MODEL_MONTHLY_LIMITS literal is not closed");

  // The table is keyed by the model-key constants (`[TEXT_MODEL_230M]: {...}`), so
  // resolve those from the same file rather than duplicating the strings here.
  const consts: Record<string, string> = {};
  for (const m of src.matchAll(/export const (\w+)\s*=\s*"([^"]*)"/g)) {
    consts[m[1]] = m[2];
  }
  const missing = [...src.slice(open, close).matchAll(/\[([A-Z_0-9]+)\]/g)]
    .map((m) => m[1])
    .filter((name) => consts[name] === undefined);
  assert.deepEqual([...new Set(missing)], [], "unresolved model-key constants in the canonical table");

  // Evaluate the literal in isolation with those constants in scope. It is plain data
  // with no other external references, so this is safer than a regex over the nested
  // braces, which is what makes drift detectable at all.
  // eslint-disable-next-line no-new-func
  const literal = src.slice(open, close + 1).replace(/\/\/[^\n]*/g, "");
  return new Function(...Object.keys(consts), `return ${literal};`)(
    ...Object.values(consts),
  ) as Record<string, Record<string, number>>;
}

describe("MODEL_MONTHLY_LIMITS parity with src/lib/modelAccess.ts", () => {
  const canonical = parseCanonicalLimits();

  it("parses the canonical table", () => {
    assert.ok(Object.keys(canonical).length > 0, "canonical table parsed empty");
  });

  it("meters exactly the same model keys", () => {
    assert.deepEqual(
      Object.keys(MODEL_MONTHLY_LIMITS).sort(),
      Object.keys(canonical).sort(),
      "model keys drifted between the Nest and Next tables",
    );
  });

  it("gives every model the same limit on every tier", () => {
    const drift: string[] = [];
    for (const modelKey of Object.keys(canonical)) {
      for (const tier of TIERS) {
        const expected = canonical[modelKey]?.[tier] ?? 0;
        const actual = modelLimitForTier(modelKey, tier);
        if (expected !== actual) drift.push(`${modelKey}/${tier}: plans=${expected} nest=${actual}`);
      }
    }
    assert.deepEqual(drift, [], "per-tier limits drifted");
  });

  it("treats an absent tier as 0, never as unlimited", () => {
    // The 8B is ULTIMATE-only. Anyone reading a missing key as "no limit" would hand
    // every lower tier infinite 8B usage.
    assert.equal(modelLimitForTier("lfm2_5_8b_a1b_q4_k_m", "free"), 0);
    assert.equal(modelLimitForTier("lfm2_5_8b_a1b_q4_k_m", "pro"), 0);
    assert.equal(modelLimitForTier("lfm2_5_8b_a1b_q4_k_m", "ultimate"), 120);
  });

  it("rejects unknown model keys rather than allowing them unmetered", () => {
    assert.equal(isMeteredModel("not_a_real_model"), false);
    assert.equal(modelLimitForTier("not_a_real_model", "ultimate"), 0);
  });

  it("never lets a key reach into Object.prototype", () => {
    assert.equal(isMeteredModel("constructor"), false);
    assert.equal(isMeteredModel("__proto__"), false);
    assert.equal(modelLimitForTier("constructor", "ultimate"), 0);
  });

  it("keeps the largest allowance on the largest plan", () => {
    // A sanity check on the data itself, not the plumbing: limits must not invert as
    // the tier rises, or the plans page would advertise a downgrade.
    for (const [modelKey, row] of Object.entries(MODEL_MONTHLY_LIMITS)) {
      const ordered = TIERS.map((t) => row[t] ?? 0);
      for (let i = 1; i < ordered.length; i += 1) {
        assert.ok(
          ordered[i] >= ordered[i - 1],
          `${modelKey}: limit decreases from ${TIERS[i - 1]} to ${TIERS[i]} (${ordered[i - 1]} -> ${ordered[i]})`,
        );
      }
    }
  });
});