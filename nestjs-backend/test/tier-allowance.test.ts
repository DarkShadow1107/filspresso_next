import test from "node:test";
import assert from "node:assert/strict";

import {
	ANONYMOUS_ALLOWANCE_RON,
	FREE_ALLOWANCE_RON,
	TIER_ALLOWANCE_RON,
	allowanceRon,
	isPaidTier,
	monthKey,
	nextReset,
} from "../src/billing/tier-allowance";
import { costRon } from "../src/billing/model-pricing";

const { describe, it } = test;

describe("monthly allowances", () => {
	it("matches the agreed figures", () => {
		assert.equal(ANONYMOUS_ALLOWANCE_RON, 3);
		assert.equal(FREE_ALLOWANCE_RON, 5);
		// prettier-ignore
		assert.deepEqual(TIER_ALLOWANCE_RON, {
			free: 5, basic: 15, plus: 35, pro: 60, max: 100, ultimate: 240,
		});
	});

	it("gives an anonymous visitor 3 RON regardless of any tier string", () => {
		// An anonymous caller cannot carry entitlement, so a spoofed tier must not buy
		// anything. No account means no plan.
		for (const tier of ["", "none", "free", "basic", "ultimate", "not-a-tier"]) {
			assert.equal(allowanceRon(tier, false), 3, tier);
		}
	});

	it("gives a signed-in free account 5 RON", () => {
		for (const tier of ["", "none", "free"]) {
			assert.equal(allowanceRon(tier, true), 5, tier);
		}
	});

	it("scales with the plan", () => {
		assert.equal(allowanceRon("basic", true), 15);
		assert.equal(allowanceRon("plus", true), 35);
		assert.equal(allowanceRon("pro", true), 60);
		assert.equal(allowanceRon("max", true), 100);
		assert.equal(allowanceRon("ultimate", true), 240);
	});

	it("is case- and whitespace-insensitive", () => {
		assert.equal(allowanceRon("  ULTIMATE ", true), 240);
		assert.equal(allowanceRon("Basic", true), 15);
	});

	it("refuses an unrecognised plan rather than defaulting it to a real allowance", () => {
		// Defaulting a typo'd or newly-added tier to the free rate would let a plan that
		// was meant to be restricted still spend money.
		assert.equal(allowanceRon("enterprise", true), 0);
		assert.equal(allowanceRon("admin", true), 0);
	});

	it("identifies paid tiers for the discount", () => {
		for (const t of ["basic", "plus", "pro", "max", "ultimate"]) {
			assert.equal(isPaidTier(t), true, t);
		}
		for (const t of ["", "none", "free", "nonsense"]) {
			assert.equal(isPaidTier(t), false, t);
		}
	});
});

describe("the month boundary", () => {
	it("keys on UTC so replicas in different zones agree", () => {
		// 23:30 on the last day of the month, local time, is already the next month in UTC
		// for an eastern offset. A local boundary would hand out two allowances.
		assert.equal(monthKey(new Date("2026-01-31T23:30:00Z")), "2026-01");
		assert.equal(monthKey(new Date("2026-02-01T00:30:00Z")), "2026-02");
	});

	it("resets at the first instant of the next UTC month", () => {
		const reset = nextReset(new Date("2026-01-15T12:00:00Z"));
		assert.equal(reset.toISOString(), "2026-02-01T00:00:00.000Z");
	});

	it("resets a December into the following January", () => {
		assert.equal(
			nextReset(new Date("2026-12-20T00:00:00Z")).toISOString(),
			"2027-01-01T00:00:00.000Z",
		);
	});
});

describe("the allowance is money, spent at the effective rate", () => {
	/**
	 * The worked example from the pricing discussion used round numbers (30 RON/1M list,
	 * 20 RON/1M discounted) and was explicitly theoretical. What matters is the *shape* of
	 * the calculation, so these use the real 230M rates -- 0.30/1.50 at list, 0.21/1.05
	 * discounted -- and assert the relationship rather than restate the example's figures.
	 */
	it("a subscriber consumes the allowance at the discounted rate", () => {
		const usage = { inputTokens: 1_000_000, outputTokens: 0 };
		assert.equal(costRon("lfm2_5_230m_q4_k_m", usage, true), 0.21, "0.30 less 30%");
		assert.equal(costRon("lfm2_5_230m_q4_k_m", usage, false), 0.30, "free pays list");
	});

	it("an all-output allowance buys a fifth of the tokens an all-input one does", () => {
		// The reason the plans page quotes RON and not a token count: output costs 5x
		// input, so "15 RON of 230M" is wildly ambiguous without saying how it is spent.
		const rate = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 1_000_000, outputTokens: 0 }, true);
		const sameMoneyOut = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 0, outputTokens: 1_000_000 }, true);
		assert.equal(sameMoneyOut / rate, 5);
		assert.equal(Math.floor(15 / rate), 71, "15 RON buys 71 whole 1M input tokens");
		assert.equal(Math.floor(15 / sameMoneyOut), 14, "or 14 whole 1M output tokens");
	});

	it("makes an Ultimate allowance worth strictly more than a Basic one", () => {
		const rate = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 1_000_000, outputTokens: 0 }, true);
		const basic = Math.floor(15 / rate);
		const ultimate = Math.floor(240 / rate);
		assert.ok(ultimate > basic, `${ultimate} should exceed ${basic}`);
		// 240/15 is exactly 16, so the ratio has to land close to that.
		assert.ok(ultimate / basic > 15 && ultimate / basic < 17, `ratio ${ultimate / basic}`);
	});

	it("an allowance is not a token count: 15 RON is far below 15M tokens", () => {
		// Guards against someone reading the RON figure as tokens somewhere downstream.
		const rate = costRon("lfm2_5_230m_q4_k_m", { inputTokens: 1_000_000, outputTokens: 0 }, true);
		assert.ok(15 / rate < 100, "15 RON is nowhere near 15 million tokens");
	});
});
