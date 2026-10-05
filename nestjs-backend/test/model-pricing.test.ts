import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
	MODEL_TOKEN_PRICING,
	OUTPUT_PRICE_MULTIPLIER,
	costRon,
	effectiveRates,
	pricingTable,
	resolveTokenPrice,
} from "../src/billing/model-pricing";

const { describe, it } = test;

// The allowance table lives in model-usage.service.ts. Read its source rather than
// importing it, so this stays a genuine cross-check between two independent files.
const LIMITS = readFileSync(
	path.resolve(__dirname, "..", "src", "kafelot", "model-usage.service.ts"),
	"utf-8",
);

/**
 * The agreed price list, written out independently of the implementation.
 *
 * Deliberately not derived from `MODEL_TOKEN_PRICING`: a test that reads its own
 * expectation back out of the code under test cannot fail. These are the numbers as
 * specified, so a typo in the table is caught rather than mirrored.
 */
const SPEC: Array<[string, number, number]> = [
	// model key,               RON / 1M input, subscriber discount %
	["lfm2_5_230m_q4_k_m", 0.3, 30],
	["lfm2_5_350m_q8_0", 0.5, 30],
	["lfm2_5_1_2b_instruct_q4_k_m", 2, 60],
	["lfm2_5_1_2b_thinking_q4_k_m", 3, 60],
	["lfm2_5_2_6b_q4_0", 7, 40],
	["lfm2_5_8b_a1b_q4_k_m", 20, 25],
	["lfm2_5_vl_450m_q4_k_m", 1, 25],
	["lfm2_5_vl_3b_q4_k_m", 10, 25],
	["lfm2_5_audio_1_5b_q4_0", 5, 25],
];

describe("token pricing matches the agreed list", () => {
	for (const [key, input, discount] of SPEC) {
		it(`${key}: ${input} RON/1M input, ${discount}% off for subscribers`, () => {
			const p = resolveTokenPrice(key, false);
			assert.equal(p.known, true);
			assert.equal(p.apiInputPer1M, input, "API input price");
			assert.equal(p.apiOutputPer1M, input * OUTPUT_PRICE_MULTIPLIER, "output is 5x input");
			assert.equal(p.subscriberDiscountPercent, discount);
		});
	}

	it("prices exactly the nine models that are metered", () => {
		// A model that is metered for prompts but missing from the price table would be
		// served for free. This is the check that catches it.
		assert.deepEqual(Object.keys(MODEL_TOKEN_PRICING).sort(), SPEC.map(([k]) => k).sort());
	});

	it("covers every key in MODEL_MONTHLY_LIMITS, so nothing is served free", () => {
		// Parse the metered-model table out of the allowance source rather than importing
		// it, so this stays a genuine cross-check between two files.
		const keys = [...LIMITS.matchAll(/^\t(lfm2_5_\w+):/gm)].map((m) => m[1]);
		assert.ok(keys.length > 0, "could not parse MODEL_MONTHLY_LIMITS");
		const missing = keys.filter((k) => !MODEL_TOKEN_PRICING[k]);
		assert.deepEqual(missing, [], `metered but unpriced: ${missing.join(", ")}`);
	});
});

describe("subscriber pricing", () => {
	it("discounts input and output alike", () => {
		const p = resolveTokenPrice("lfm2_5_230m_q4_k_m", true);
		assert.equal(p.subscriberInputPer1M, 0.21, "0.30 less 30%");
		assert.equal(p.subscriberOutputPer1M, 1.05, "1.50 less 30%");
	});

	it("keeps output at exactly 5x the subscriber input rate", () => {
		// Discounting only input would break this, which is why both are discounted.
		for (const [key] of SPEC) {
			const p = resolveTokenPrice(key, true);
			assert.equal(
				p.subscriberOutputPer1M,
				Math.round(p.subscriberInputPer1M * OUTPUT_PRICE_MULTIPLIER * 1e8) / 1e8,
				key,
			);
		}
	});

	it("bills a subscriber the discounted rate and a non-subscriber the list rate", () => {
		const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
		assert.equal(costRon("lfm2_5_230m_q4_k_m", usage, false), 1.8, "0.30 + 1.50");
		assert.equal(costRon("lfm2_5_230m_q4_k_m", usage, true), 1.26, "0.21 + 1.05");
	});

	it("effectiveRates never leaks the API price to a subscriber", () => {
		const rates = effectiveRates(resolveTokenPrice("lfm2_5_8b_a1b_q4_k_m", true));
		assert.equal(rates.inputPer1M, 15, "20 less 25%");
		assert.equal(rates.outputPer1M, 75);
		assert.notEqual(rates.inputPer1M, 20);
	});
});

describe("cost arithmetic", () => {
	it("scales linearly with tokens", () => {
		const one = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 1_000_000, outputTokens: 0 }, false);
		const half = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 500_000, outputTokens: 0 }, false);
		assert.equal(one, 0.3);
		assert.equal(half, 0.15);
	});

	it("bills a realistic short exchange as a fraction of a ban", () => {
		// 400 in / 120 out on the 230M at list price.
		assert.equal(
			costRon("lfm2_5_230m_q4_k_m", { inputTokens: 400, outputTokens: 120 }, false),
			0.0003,
		);
	});

	it("bills nothing for zero usage", () => {
		assert.equal(costRon("lfm2_5_230m_q4_k_m", { inputTokens: 0, outputTokens: 0 }, false), 0);
	});

	it("zeroes only the malformed field, and never returns NaN", () => {
		const price = (u: { inputTokens: number; outputTokens: number }) =>
			costRon("lfm2_5_230m_q4_k_m", u, false);

		// A bad input count must not poison a good output count, nor the reverse.
		assert.equal(price({ inputTokens: Number.NaN, outputTokens: 100 }),
			price({ inputTokens: 0, outputTokens: 100 }));
		assert.equal(price({ inputTokens: 100, outputTokens: Number.NaN }),
			price({ inputTokens: 100, outputTokens: 0 }));
		// Infinity must not become an infinite charge.
		assert.equal(price({ inputTokens: Number.POSITIVE_INFINITY, outputTokens: 0 }), 0);
		assert.equal(price({ inputTokens: 0, outputTokens: Number.POSITIVE_INFINITY }), 0);
		// Negative counts are not a discount.
		assert.equal(price({ inputTokens: -5, outputTokens: -5 }), 0);
	});

	it("rounds to 8 decimals, the storage precision", () => {
		// 1 token of input on the 230M is 3e-7 RON; two of them is 6e-7. Accumulating
		// unrounded floats drifts, so every charge is snapped to what we can store.
		const cost = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 1, outputTokens: 1 }, false);
		assert.equal(cost, 0.0000018);
		assert.equal(String(cost).length <= 10, true);
	});
});

describe("unknown models", () => {
	it("resolve to zero and report known=false", () => {
		// A typo must not 500 a request llama.cpp already served. The caller decides what
		// to do about a zero charge; `known` is how it finds out.
		const p = resolveTokenPrice("not-a-model", false);
		assert.equal(p.known, false);
		assert.equal(costRon("not-a-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, false), 0);
	});

	it("does not treat inherited object properties as models", () => {
		// prototype pollution guard: "constructor" must not resolve to a price.
		assert.equal(resolveTokenPrice("constructor", false).known, false);
		assert.equal(resolveTokenPrice("toString", false).known, false);
	});
});

describe("pricingTable", () => {
	it("lists every model with both audiences' rates", () => {
		const table = pricingTable();
		assert.equal(table.currency, "RON");
		assert.equal(table.unit, "per_1m_tokens");
		assert.equal(table.outputMultiplier, 5);
		assert.equal(table.models.length, SPEC.length);
		for (const model of table.models) {
			assert.equal(model.known, true);
			assert.ok(model.apiInputPer1M > 0);
			assert.ok(model.subscriberInputPer1M > 0);
			assert.ok(model.subscriberInputPer1M < model.apiInputPer1M, `${model.modelKey} not discounted`);
		}
	});
});
