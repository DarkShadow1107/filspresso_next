import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { MODEL_TIER_ACCESS, isMeteredModel, tierAllowsModel } from "../src/kafelot/model-usage.service";

const { describe, it } = test;

const FRONTEND = readFileSync(
	path.resolve(__dirname, "..", "..", "src", "lib", "modelAccess.ts"),
	"utf8",
);

/**
 * Entitlement parity between the backend and the plans page.
 *
 * This file used to assert that two *quota* tables agreed. The quotas are gone -- usage is
 * metered in RON now -- but the parity check is still the valuable part, because the
 * frontend copy decides which models are *shown* while the backend copy decides which are
 * *allowed*. A model shown but refused is the bug this catches.
 */
describe("the backend knows exactly the models that are metered", () => {
	it("meters nine models", () => {
		assert.equal(Object.keys(MODEL_TIER_ACCESS).length, 9);
	});

	it("rejects an unknown model key rather than allowing it unmetered", () => {
		assert.equal(isMeteredModel("not_a_real_model"), false);
		assert.equal(tierAllowsModel("not_a_real_model", "ultimate"), false);
	});

	it("never lets a key reach into Object.prototype", () => {
		// A bare `row[tier] === true` on an object literal would find inherited members.
		for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
			assert.equal(tierAllowsModel(key, "ultimate"), false, key);
			assert.equal(isMeteredModel(key), false, key);
		}
	});

	it("never lets a tier reach into Object.prototype either", () => {
		assert.equal(tierAllowsModel("lfm2_5_8b_a1b_q4_k_m", "constructor"), false);
		assert.equal(tierAllowsModel("lfm2_5_8b_a1b_q4_k_m", "toString"), false);
	});

	it("refuses an unknown tier rather than defaulting it in", () => {
		// The bug that started this: membership written as "not empty, not none, not free"
		// returns true for any unrecognised string, handing a new or misspelled plan every
		// model in the lineup.
		for (const tier of ["enterprise", "admin", "platinum", "vip"]) {
			assert.equal(tierAllowsModel("lfm2_5_8b_a1b_q4_k_m", tier), false, tier);
			assert.equal(tierAllowsModel("lfm2_5_230m_q4_k_m", tier), false, tier);
		}
	});

	it("is case- and whitespace-insensitive about the tier", () => {
		assert.equal(tierAllowsModel("lfm2_5_8b_a1b_q4_k_m", "  ULTIMATE "), true);
		assert.equal(tierAllowsModel("lfm2_5_230m_q4_k_m", "Free"), true);
	});
});

describe("the entitlement matrix is sane", () => {
	it("keeps the 8B A1B ULTIMATE-only", () => {
		// The most expensive model, so the one where a mistake costs the most.
		for (const tier of ["free", "basic", "plus", "pro", "max"]) {
			assert.equal(tierAllowsModel("lfm2_5_8b_a1b_q4_k_m", tier), false, tier);
		}
		assert.equal(tierAllowsModel("lfm2_5_8b_a1b_q4_k_m", "ultimate"), true);
	});

	it("never narrows access as the plan rises", () => {
		// A plans page advertising a downgrade is the failure this catches. Every tier's
		// access set must be a superset of the tier below it.
		const order = ["free", "basic", "plus", "pro", "max", "ultimate"];
		for (let i = 1; i < order.length; i++) {
			const lower = order[i - 1];
			const higher = order[i];
			for (const modelKey of Object.keys(MODEL_TIER_ACCESS)) {
				if (tierAllowsModel(modelKey, lower)) {
					assert.equal(
						tierAllowsModel(modelKey, higher),
						true,
						`${modelKey} is allowed on ${lower} but not ${higher}`,
					);
				}
			}
		}
	});

	it("gives every model at least one tier", () => {
		for (const [modelKey, row] of Object.entries(MODEL_TIER_ACCESS)) {
			assert.ok(
				Object.values(row).some(Boolean),
				`${modelKey} is not reachable on any plan`,
			);
		}
	});

	it("uses booleans, never a leftover prompt count", () => {
		// A numeric value here would be a quota that survived the rename.
		for (const [modelKey, row] of Object.entries(MODEL_TIER_ACCESS)) {
			for (const [tier, value] of Object.entries(row)) {
				assert.equal(typeof value, "boolean", `${modelKey}.${tier} is not a boolean`);
			}
		}
	});
});

describe("parity with the plans page", () => {
	it("the frontend no longer carries a prompt quota", () => {
		// The copy that rendered "120 prompts/month" is gone. If this fails, the plans page
		// is still advertising a budget that nothing enforces.
		assert.doesNotMatch(FRONTEND, /MODEL_MONTHLY_LIMITS/);
		assert.doesNotMatch(FRONTEND, /prompts\/month/);
		assert.doesNotMatch(FRONTEND, /monthlyLimitForModelTier/);
	});

	it("the frontend carries the same entitlement matrix", () => {
		assert.match(FRONTEND, /MODEL_TIER_ACCESS/);
		assert.match(FRONTEND, /tierAllowsModel/);
	});

	it("meters the same model keys on both sides", () => {
		// The frontend keys the matrix by its own constants (`[TEXT_MODEL_230M]: {...}`),
		// so resolve those to their string values rather than grepping for raw keys.
		const constants = new Map(
			[...FRONTEND.matchAll(/export const (\w+) = "(lfm2_5_\w+)"/g)].map((m) => [m[1], m[2]]),
		);
		assert.ok(constants.size >= 9, `only found ${constants.size} model key constants`);
		// Scope to the matrix literal. Scanning the whole file also matches the
		// hand-maintained tables further up, which is how "parsed 54 matrix rows" happened.
		const start = FRONTEND.indexOf("export const MODEL_TIER_ACCESS");
		assert.notEqual(start, -1, "MODEL_TIER_ACCESS not found in modelAccess.ts");
		const end = FRONTEND.indexOf("\n};", start);
		assert.notEqual(end, -1, "MODEL_TIER_ACCESS literal is not closed");
		const literal = FRONTEND.slice(start, end);
		const keys = [...literal.matchAll(/^\t\[(\w+)\]:/gm)]
			.map((m) => constants.get(m[1]))
			.filter((v): v is string => Boolean(v));
		assert.equal(keys.length, 9, `parsed ${keys.length} matrix rows`);
		assert.deepEqual(keys.sort(), Object.keys(MODEL_TIER_ACCESS).sort());
	});
});
