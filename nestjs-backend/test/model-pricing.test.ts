import "./test-env";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
	LONG_CONTEXT_THRESHOLD_TOKENS,
	MODEL_TOKEN_PRICING,
	LEGACY_230M_OUTPUT_PRICE_MULTIPLIER,
	appliesLongContextPricing,
	billedRates,
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
const SPEC: Array<[string, number, number, number]> = [
	// model key,               RON / 1M input, RON / 1M output, subscriber discount %
	["lfm2_5_230m_q4_k_m", 0.3, 1.5, 30],
	["lfm3_1_7b_q4_k_m", 15, 60, 0],
	["lfm3_vl_2b_q4_k_m", 20, 80, 0],
	["lfm3_audio_2b_q4_k_m", 20, 80, 0],
	["lfm3_omni_2b_q4_k_m", 25, 100, 0],
];

describe("token pricing matches the agreed list", () => {
	for (const [key, input, output, discount] of SPEC) {
		it(`${key}: ${input}/${output} RON per 1M, ${discount}% off for subscribers`, () => {
			const p = resolveTokenPrice(key, false);
			assert.equal(p.known, true);
			assert.equal(p.apiInputPer1M, input, "API input price");
			assert.equal(p.apiOutputPer1M, output, "API output price");
			assert.equal(p.subscriberDiscountPercent, discount);
		});
	}

	it("prices exactly the five models that are metered", () => {
		// A model that is metered for prompts but missing from the price table would be
		// served for free. This is the check that catches it.
		assert.deepEqual(Object.keys(MODEL_TOKEN_PRICING).sort(), SPEC.map(([k]) => k).sort());
	});

	it("covers every key in the entitlement matrix, so nothing is served free", () => {
		// Parse the metered-model table out of the allowance source rather than importing
		// it, so this stays a genuine cross-check between two files.
		const keys = [...LIMITS.matchAll(/^\t((?:lfm2_5|lfm3)_\w+):/gm)].map((m) => m[1]);
		assert.ok(keys.length > 0, "could not parse MODEL_TIER_ACCESS");
		const missing = keys.filter((k) => !MODEL_TOKEN_PRICING[k]);
		assert.deepEqual(missing, [], `metered but unpriced: ${missing.join(", ")}`);
	});

	it("keeps the historical 5x output multiplier only for the 230M", () => {
		// LFM 3 is priced at 4x (15/60, 20/80, 25/100); a single multiplier would be wrong
		// for one of the families, which is why output is now explicit per model.
		const legacy = resolveTokenPrice("lfm2_5_230m_q4_k_m", false);
		assert.equal(legacy.apiOutputPer1M, legacy.apiInputPer1M * LEGACY_230M_OUTPUT_PRICE_MULTIPLIER);
		for (const key of ["lfm3_1_7b_q4_k_m", "lfm3_vl_2b_q4_k_m", "lfm3_audio_2b_q4_k_m", "lfm3_omni_2b_q4_k_m"]) {
			const p = resolveTokenPrice(key, false);
			assert.equal(p.apiOutputPer1M, p.apiInputPer1M * 4, key);
		}
	});
});

describe("subscriber pricing", () => {
	it("discounts input and output alike", () => {
		const p = resolveTokenPrice("lfm2_5_230m_q4_k_m", true);
		assert.equal(p.subscriberInputPer1M, 0.21, "0.30 less 30%");
		assert.equal(p.subscriberOutputPer1M, 1.05, "1.50 less 30%");
	});

	it("charges LFM 3 subscribers the full API rate", () => {
		// Both Kafelot and the Playground charge the published API price for LFM 3.
		for (const key of ["lfm3_1_7b_q4_k_m", "lfm3_vl_2b_q4_k_m", "lfm3_audio_2b_q4_k_m", "lfm3_omni_2b_q4_k_m"]) {
			const p = resolveTokenPrice(key, true);
			assert.equal(p.subscriberInputPer1M, p.apiInputPer1M, key);
			assert.equal(p.subscriberOutputPer1M, p.apiOutputPer1M, key);
		}
	});

	it("bills a subscriber the discounted rate and a non-subscriber the list rate", () => {
		const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
		assert.equal(costRon("lfm2_5_230m_q4_k_m", usage, false), 1.8, "0.30 + 1.50");
		assert.equal(costRon("lfm2_5_230m_q4_k_m", usage, true), 1.26, "0.21 + 1.05");
	});

	it("effectiveRates never leaks the 230M API price to a subscriber", () => {
		const rates = effectiveRates(resolveTokenPrice("lfm2_5_230m_q4_k_m", true));
		assert.equal(rates.inputPer1M, 0.21, "0.30 less 30%");
		assert.equal(rates.outputPer1M, 1.05);
		assert.notEqual(rates.inputPer1M, 0.3);
	});
});

describe("long-context pricing", () => {
	it("applies only above 128K input tokens", () => {
		assert.equal(LONG_CONTEXT_THRESHOLD_TOKENS, 131_072);
		assert.equal(appliesLongContextPricing(131_072), false);
		assert.equal(appliesLongContextPricing(131_073), true);
	});

	it("doubles both rates for the whole request", () => {
		const price = resolveTokenPrice("lfm3_1_7b_q4_k_m", false);
		const short = billedRates(price, 100_000);
		const long = billedRates(price, 200_000);
		assert.equal(short.longContext, false);
		assert.equal(short.inputPer1M, 15);
		assert.equal(short.outputPer1M, 60);
		assert.equal(long.longContext, true);
		assert.equal(long.inputPer1M, 30);
		assert.equal(long.outputPer1M, 120);
	});

	it("never surcharges the Free-only 230M", () => {
		// Its window is 128K, so a request it can actually serve never crosses the
		// threshold. Reports with a larger count must not quietly double either.
		const price = resolveTokenPrice("lfm2_5_230m_q4_k_m", false);
		assert.equal(price.longContextPricing, false);
		assert.equal(billedRates(price, 1_000_000).longContext, false);
		assert.equal(costRon("lfm2_5_230m_q4_k_m", { inputTokens: 1_000_000, outputTokens: 0 }, false), 0.3);
	});

	it("charges a 200K-input request at twice the short rate", () => {
		const usage = { inputTokens: 200_000, outputTokens: 10_000 };
		const shortUsage = { inputTokens: 100_000, outputTokens: 10_000 };
		const longCost = costRon("lfm3_omni_2b_q4_k_m", usage, false);
		const shortCost = costRon("lfm3_omni_2b_q4_k_m", shortUsage, false);
		// 0.2M * 50 RON + 0.01M * 200 RON = 10 + 2 = 12
		assert.equal(longCost, 12);
		// 0.1M * 25 RON + 0.01M * 100 RON = 2.5 + 1 = 3.5
		assert.equal(shortCost, 3.5);
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
		assert.equal(table.outputMultiplier, null);
		assert.equal(table.models.length, SPEC.length);
		for (const model of table.models) {
			assert.equal(model.known, true);
			assert.ok(model.apiInputPer1M > 0);
			assert.ok(model.subscriberInputPer1M > 0);
			// LFM 3 is undiscounted, so the subscriber rate is equal rather than lower.
			assert.ok(model.subscriberInputPer1M <= model.apiInputPer1M, `${model.modelKey} is more expensive for subscribers`);
		}
	});
});
